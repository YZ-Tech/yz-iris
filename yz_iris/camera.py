"""Camera enumeration and frame loop.

The frame loop runs in a background thread (blocking I/O + CPU-bound CV
should not block the asyncio loop). Events are scheduled back onto the
asyncio loop via run_coroutine_threadsafe.
"""
from __future__ import annotations

import asyncio
import sys
import threading
import time
from typing import Any, Callable

from .mediapipe_layer import MediaPipeLayer
from .reducer import IrisState, SemanticReducer


def enumerate_cameras() -> list[dict[str, Any]]:
    """Return list of {index, name} for available cameras."""
    try:
        import cv2
    except ImportError:
        return []

    cameras = []

    # Try to get friendly names via pygrabber on Windows
    name_map: dict[int, str] = {}
    if sys.platform == "win32":
        try:
            from pygrabber.dshow_graph import FilterGraph
            graph = FilterGraph()
            names = graph.get_input_devices()
            for i, name in enumerate(names):
                name_map[i] = name
        except Exception:  # noqa: BLE001
            pass

    backend = cv2.CAP_MSMF if sys.platform == "win32" else cv2.CAP_ANY
    for i in range(10):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            name = name_map.get(i, f"Camera {i}")
            cameras.append({"index": i, "name": name})
            cap.release()
    return cameras


class CameraLoop:
    """Manages the background frame-capture + CV thread."""

    def __init__(self, emit: Callable[[dict[str, Any]], None]) -> None:
        self._emit = emit          # called with event dict from the thread
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._mp = MediaPipeLayer()
        self._reducer = SemanticReducer()
        self._lock = threading.Lock()
        # Raw latest frame + lazy JPEG memo (encoded on pull, not per
        # capture tick — see latest_jpeg).
        self._latest_frame: Any = None
        self._frame_seq: int = 0
        self._encoded_jpeg: bytes | None = None
        self._encoded_seq: int = -1
        self._camera_index: int = 0

    @property
    def state(self) -> IrisState:
        return self._reducer.state

    @property
    def mediapipe_available(self) -> bool:
        return self._mp.available

    @property
    def latest_jpeg(self) -> bytes | None:
        """JPEG of the most recent frame, encoded on demand and memoized
        per frame. The capture loop only stores raw frames; consumers
        (look()/snapshot/scan_room) are occasional, so encoding here
        instead of per capture tick removes continuous CPU burn."""
        with self._lock:
            frame, seq = self._latest_frame, self._frame_seq
            if frame is None or seq == self._encoded_seq:
                return self._encoded_jpeg
        # Encode outside the lock — the loop replaces (never mutates)
        # self._latest_frame, so this reference is stable.
        _, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        data = jpeg_buf.tobytes()
        with self._lock:
            self._encoded_jpeg = data
            self._encoded_seq = seq
        return data

    def set_camera(self, index: int) -> None:
        self._camera_index = index

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        if not self._mp.available:
            self._mp._try_init()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="iris-frame-loop")
        self._thread.start()

    def stop(self) -> None:
        """Stop the capture thread. Keeps the MediaPipe layer alive for reuse."""
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3.0)
            self._thread = None

    def close(self) -> None:
        """Full teardown — stop thread AND close the MediaPipe layer."""
        self.stop()
        self._mp.close()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def _loop(self) -> None:
        try:
            import cv2
        except ImportError:
            return

        backend = cv2.CAP_MSMF if sys.platform == "win32" else cv2.CAP_ANY
        cap = cv2.VideoCapture(self._camera_index, backend)

        if not cap.isOpened():
            return

        try:
            while not self._stop.is_set():
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.1)
                    continue

                # Store the latest RAW frame; JPEG encoding is lazy (see
                # latest_jpeg). Encoding every frame at 10 FPS burned ~3%
                # of a core continuously while the only consumers
                # (look()/snapshot/scan_room) pull on demand.
                with self._lock:
                    self._latest_frame = frame
                    self._frame_seq += 1

                # Run MediaPipe
                result = self._mp.process(frame)

                # Semantic reduction → events
                events = self._reducer.update(result)
                for event in events:
                    self._emit(event)

                time.sleep(0.1)  # ~10 FPS
        finally:
            cap.release()

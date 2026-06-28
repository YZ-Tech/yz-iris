"""BrowserSource — receives JPEG frames from browser getUserMedia over WebSocket.

The browser captures video at ~5 fps, encodes as JPEG, and sends binary WS
messages. Python runs MediaPipe on each frame and emits presence/gaze events
via the same broadcast pipeline as PythonSource.

Server also handles on-demand frame requests (for look()):
  server → {"type": "frame_request", "id": "<uuid>"} → browser
  browser → binary JPEG frame (resolves the pending Future)
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import WebSocket, WebSocketDisconnect

from ..mediapipe_layer import MediaPipeLayer
from ..reducer import IrisState, SemanticReducer
from .base import VideoSource


class BrowserSource(VideoSource):
    def __init__(
        self,
        source_id: str,
        label: str,
        emit: Callable[[dict[str, Any]], None],
    ) -> None:
        self.source_id = source_id
        self.label = label
        self._emit = emit
        self._mp = MediaPipeLayer()
        self._reducer = SemanticReducer()
        self._ws: WebSocket | None = None
        self._connected = False
        self._latest_jpeg: bytes | None = None
        self._pending: asyncio.Future[bytes] | None = None
        self._proc_lock = asyncio.Lock()

    # ── VideoSource protocol ──────────────────────────────────────

    @property
    def running(self) -> bool:
        return self._connected

    @property
    def state(self) -> IrisState:
        return self._reducer.state

    async def get_frame(self) -> bytes | None:
        """Request a fresh frame from the browser (for look())."""
        if not self._ws or not self._connected:
            return self._latest_jpeg
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[bytes] = loop.create_future()
        self._pending = fut
        try:
            await self._ws.send_text(json.dumps({"type": "frame_request", "id": str(uuid.uuid4())}))
            return await asyncio.wait_for(asyncio.shield(fut), timeout=5.0)
        except (asyncio.TimeoutError, Exception):
            return self._latest_jpeg
        finally:
            if self._pending is fut:
                self._pending = None

    def source_info(self) -> dict[str, Any]:
        info = super().source_info()
        info["mediapipe_available"] = self._mp.available
        return info

    # ── WebSocket handler (called by server) ──────────────────────

    async def handle_ws(self, ws: WebSocket) -> None:
        self._ws = ws
        self._connected = True
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                raw_bytes: bytes | None = msg.get("bytes")
                raw_text: str | None = msg.get("text")
                if raw_bytes:
                    await self._on_frame(raw_bytes)
                elif raw_text:
                    await self._on_text(raw_text)
        except (WebSocketDisconnect, Exception):
            pass
        finally:
            self._ws = None
            self._connected = False
            if self._pending and not self._pending.done():
                self._pending.cancel()
            self._pending = None

    async def _on_frame(self, jpeg: bytes) -> None:
        self._latest_jpeg = jpeg
        if self._pending and not self._pending.done():
            # Resolve a waiting get_frame() call — don't also process for ambient
            self._pending.set_result(jpeg)
            return
        # Ambient presence — drop if previous frame still processing
        if not self._proc_lock.locked():
            asyncio.ensure_future(self._process(jpeg))

    async def _on_text(self, text: str) -> None:
        """Option A: browser pushes {type:'mp_frame', faces:[...]} JSON events."""
        try:
            data = json.loads(text)
        except Exception:
            return
        if data.get("type") != "mp_frame":
            return
        import time as _time
        faces: list[dict] = data.get("faces", [])
        present = len(faces) > 0
        position: str | None = None
        if faces:
            cx = faces[0].get("x", 0.5) + faces[0].get("w", 0) / 2
            position = "left" if cx < 0.33 else "right" if cx > 0.67 else "center"
        # Update reducer state directly (browser MP bypasses the frame-debounce path)
        gaze_raw = data.get("gaze")
        gaze = gaze_raw if gaze_raw in ("screen", "away", "unknown") else "unknown"

        s = self._reducer._state
        s.present = present
        s.position = position or "unknown"
        s.gaze = gaze
        s.last_updated = _time.monotonic()
        self._emit({
            "event": "presence",
            "data": {
                "present": present,
                "position": s.position,
                "distance": "unknown",
            },
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        if gaze != "unknown":
            self._emit({
                "event": "gaze",
                "data": {"target": gaze},
                "ts": datetime.now(timezone.utc).isoformat(),
            })

    async def _process(self, jpeg: bytes) -> None:
        async with self._proc_lock:
            events = await asyncio.to_thread(self._run_mp, jpeg)
        for event in events:
            event["ts"] = datetime.now(timezone.utc).isoformat()
            self._emit(event)

    def _run_mp(self, jpeg: bytes) -> list[dict[str, Any]]:
        """CPU-bound MediaPipe inference; runs in thread pool."""
        try:
            import cv2
            import numpy as np
        except ImportError:
            return []
        arr = np.frombuffer(jpeg, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return []
        result = self._mp.process(frame)
        return self._reducer.update(result)

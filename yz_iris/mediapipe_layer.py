"""MediaPipe FaceLandmarker (Tasks API) wrapper for Phase 1 presence + gaze.

Uses the new mediapipe Tasks API (0.10.x+) which replaced mp.solutions.face_mesh.
Model is downloaded once to ~/.jarvyz/models/face_landmarker.task (~5 MB).
"""
from __future__ import annotations

import os
import urllib.request
from typing import TYPE_CHECKING

from .reducer import FrameResult

if TYPE_CHECKING:
    import numpy as np

_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)
_MODEL_PATH = os.path.join(os.path.expanduser("~"), ".jarvyz", "models", "face_landmarker.task")


def _ensure_model() -> str:
    os.makedirs(os.path.dirname(_MODEL_PATH), exist_ok=True)
    if not os.path.exists(_MODEL_PATH):
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
    return _MODEL_PATH


class MediaPipeLayer:
    def __init__(self) -> None:
        self._detector = None
        self._available = False
        self._init_error: str | None = None
        self._try_init()

    def _try_init(self) -> None:
        self._init_error = None
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions
            from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions

            model_path = _ensure_model()
            options = FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_face_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self._detector = FaceLandmarker.create_from_options(options)
            self._available = True
        except Exception as exc:  # noqa: BLE001
            self._available = False
            self._init_error = f"{type(exc).__name__}: {exc}"

    @property
    def available(self) -> bool:
        return self._available

    def process(self, frame: "np.ndarray") -> FrameResult:
        if not self._available or self._detector is None:
            return FrameResult(present=False, position="unknown", distance="unknown", gaze="unknown")

        try:
            import cv2
            import mediapipe as mp
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = self._detector.detect(mp_image)
        except Exception:  # noqa: BLE001
            return FrameResult(present=False, position="unknown", distance="unknown", gaze="unknown")

        if not result.face_landmarks:
            return FrameResult(present=False, position="unknown", distance="unknown", gaze="unknown")

        lm = result.face_landmarks[0]

        xs = [l.x for l in lm]
        ys = [l.y for l in lm]
        cx = (min(xs) + max(xs)) / 2
        face_h = max(ys) - min(ys)

        if cx < 0.38:
            position = "left"
        elif cx > 0.62:
            position = "right"
        else:
            position = "center"

        if face_h > 0.38:
            distance = "near"
        elif face_h < 0.14:
            distance = "far"
        else:
            distance = "medium"

        # Gaze: nose tip (4) vs outer eye corners (33, 263)
        nose_x = lm[4].x
        left_outer_x = lm[33].x
        right_outer_x = lm[263].x
        eye_center_x = (left_outer_x + right_outer_x) / 2
        eye_width = abs(right_outer_x - left_outer_x)

        if eye_width > 0:
            offset_ratio = abs(nose_x - eye_center_x) / eye_width
            gaze = "screen" if offset_ratio < 0.28 else "away"
        else:
            gaze = "unknown"

        return FrameResult(present=True, position=position, distance=distance, gaze=gaze)

    def process_jpeg(self, jpeg: bytes) -> FrameResult:
        """Convenience wrapper — decodes a JPEG buffer then runs process()."""
        try:
            import cv2
            import numpy as np
        except ImportError:
            return FrameResult(present=False, position="unknown", distance="unknown", gaze="unknown")
        arr = np.frombuffer(jpeg, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return FrameResult(present=False, position="unknown", distance="unknown", gaze="unknown")
        return self.process(frame)

    def close(self) -> None:
        if self._detector is not None:
            try:
                self._detector.close()
            except Exception:  # noqa: BLE001
                pass
            self._detector = None
        self._available = False

from __future__ import annotations

from ..camera import CameraLoop
from ..reducer import IrisState
from .base import VideoSource


class PythonSource(VideoSource):
    """Wraps the existing OpenCV + MediaPipe camera loop."""

    source_id = "python"
    label = "Python Camera (OpenCV)"

    def __init__(self, loop: CameraLoop) -> None:
        self._loop = loop

    @property
    def running(self) -> bool:
        return self._loop.running

    @property
    def state(self) -> IrisState:
        return self._loop.state

    async def get_frame(self) -> bytes | None:
        return self._loop.latest_jpeg

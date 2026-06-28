from __future__ import annotations

from typing import Any

from ..reducer import IrisState
from .base import VideoSource


class SourceRegistry:
    def __init__(self) -> None:
        self._sources: dict[str, VideoSource] = {}
        self._active_id: str | None = None

    def register(self, source: VideoSource) -> None:
        self._sources[source.source_id] = source

    def get(self, source_id: str) -> VideoSource | None:
        return self._sources.get(source_id)

    def set_active(self, source_id: str) -> bool:
        if source_id in self._sources:
            self._active_id = source_id
            return True
        return False

    @property
    def active(self) -> VideoSource | None:
        """Explicit active source, or first running source, or first registered."""
        if self._active_id:
            src = self._sources.get(self._active_id)
            if src:
                return src
        for src in self._sources.values():
            if src.running:
                return src
        return next(iter(self._sources.values()), None)

    def best_state(self) -> IrisState:
        active = self.active
        return active.state if active else IrisState()

    def any_running(self) -> bool:
        return any(s.running for s in self._sources.values())

    def list_info(self) -> list[dict[str, Any]]:
        return [s.source_info() for s in self._sources.values()]

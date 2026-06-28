from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..reducer import IrisState


class VideoSource(ABC):
    source_id: str
    label: str

    @property
    @abstractmethod
    def running(self) -> bool: ...

    @property
    @abstractmethod
    def state(self) -> IrisState: ...

    async def get_frame(self) -> bytes | None:
        """Return a JPEG snapshot on demand (for look() / vision LLM)."""
        return None

    def source_info(self) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "label": self.label,
            "running": self.running,
        }

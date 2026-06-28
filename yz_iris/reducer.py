"""Semantic reducer — converts raw per-frame MediaPipe results into sparse events.

Only emits an event when the state meaningfully changes, with debouncing to
prevent flicker from single-frame glitches or transient gaze shifts.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FrameResult:
    present: bool
    position: str       # "left" | "center" | "right" | "unknown"
    distance: str       # "near" | "medium" | "far" | "unknown"
    gaze: str           # "screen" | "away" | "unknown"


@dataclass
class IrisState:
    present: bool = False
    position: str = "unknown"
    distance: str = "unknown"
    gaze: str = "unknown"
    last_updated: float = field(default_factory=time.monotonic)


class SemanticReducer:
    # Presence: require N consistent frames before flipping
    _PRESENCE_FRAMES = 5
    # Gaze: require this many seconds of consistent reading before flipping
    _GAZE_DEBOUNCE_S = 3.0

    def __init__(self) -> None:
        self._state = IrisState()
        # Presence debounce
        self._presence_counter = 0
        self._presence_candidate: bool | None = None
        # Gaze debounce
        self._gaze_candidate: str | None = None
        self._gaze_since: float = 0.0

    @property
    def state(self) -> IrisState:
        return self._state

    def update(self, result: FrameResult) -> list[dict[str, Any]]:
        """Feed a new frame result; returns a (possibly empty) list of events to emit."""
        events: list[dict[str, Any]] = []
        now = time.monotonic()

        # ── presence debounce ────────────────────────────────────────
        if result.present != self._presence_candidate:
            self._presence_candidate = result.present
            self._presence_counter = 1
        else:
            self._presence_counter += 1

        if self._presence_counter >= self._PRESENCE_FRAMES:
            if result.present != self._state.present:
                self._state.present = result.present
                self._state.position = result.position
                self._state.distance = result.distance
                self._state.last_updated = now
                events.append({
                    "event": "presence",
                    "data": {
                        "present": self._state.present,
                        "position": self._state.position,
                        "distance": self._state.distance,
                    },
                })
            elif result.present and (
                result.position != self._state.position
                or result.distance != self._state.distance
            ):
                self._state.position = result.position
                self._state.distance = result.distance
                self._state.last_updated = now
                events.append({
                    "event": "presence",
                    "data": {
                        "present": True,
                        "position": self._state.position,
                        "distance": self._state.distance,
                    },
                })

        # ── gaze debounce ────────────────────────────────────────────
        if not result.present:
            if self._state.gaze != "unknown":
                self._state.gaze = "unknown"
                self._state.last_updated = now
                events.append({"event": "gaze", "data": {"target": "unknown"}})
            self._gaze_candidate = None
        else:
            if result.gaze != self._gaze_candidate:
                self._gaze_candidate = result.gaze
                self._gaze_since = now
            elif (now - self._gaze_since) >= self._GAZE_DEBOUNCE_S:
                if result.gaze != self._state.gaze:
                    self._state.gaze = result.gaze
                    self._state.last_updated = now
                    events.append({"event": "gaze", "data": {"target": self._state.gaze}})

        return events

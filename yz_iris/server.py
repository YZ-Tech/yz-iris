"""FastAPI daemon for the yz-iris satellite — visual awareness for JarvYZ.

Endpoints:
  GET  /health                        — {ok, version, mediapipe_available, running}
  GET  /cameras                       — {cameras: [{index, name}]}
  POST /cameras/rescan                — re-enumerate, same shape
  POST /cameras/select                — {index, label?} → store selection + restart loop
  GET  /state                         — current semantic state (all sources merged)
  POST /start                         — start Python CV loop
  POST /stop                          — stop Python CV loop
  POST /tools/look                    — {focus?} → {ok, text}  (semantic only)
  POST /tools/get_presence            — {} → {ok, text}
  POST /tools/snapshot                — {count?, interval_ms?} → {ok, text, paths[]}
  GET  /snapshot                      — latest JPEG binary from active source
  GET  /prompt_context                — Loom brief contribution (iris state + snapshot hint)
  GET  /sources                       — list all registered sources + status
  POST /sources/{id}/activate         — set as primary source for LLM tools
  WS   /sources/{id}/ws               — browser/mobile source connection
  WS   /mp/ws                         — browser MediaPipe JSON event stream (Option A)
  GET  /cam                           — self-contained mobile camera page
  WS   /events                        — server-pushed presence + gaze events
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel

from . import __version__
from . import objects
from .camera import CameraLoop, enumerate_cameras
from .sources import BrowserSource, PythonSource, SourceRegistry

app = FastAPI(title="iris", version=__version__)

# ────────────────────────── event loop reference ──────────────────
# Stored at startup so background threads can schedule broadcasts via
# call_soon_threadsafe without calling get_running_loop() from a thread
# (which raises RuntimeError).

_event_loop: asyncio.AbstractEventLoop | None = None

# ────────────────────────── WS broadcast ──────────────────────────

_ws_queues: set[asyncio.Queue] = set()


def _emit_from_thread(event: dict[str, Any]) -> None:
    """Thread-safe; also safe to call from within the event loop."""
    if "ts" not in event:
        event["ts"] = datetime.now(timezone.utc).isoformat()
    loop = _event_loop
    if loop is not None and loop.is_running():
        loop.call_soon_threadsafe(_emit_sync, event)


def _emit_sync(event: dict[str, Any]) -> None:
    asyncio.ensure_future(_broadcast(event))


async def _broadcast(event: dict[str, Any]) -> None:
    dead: set[asyncio.Queue] = set()
    for q in list(_ws_queues):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.add(q)
    _ws_queues.difference_update(dead)


# ────────────────────────── sources ───────────────────────────────

_loop = CameraLoop(emit=_emit_from_thread)

_browser_source = BrowserSource("browser", "Browser Camera", _emit_from_thread)
_browser_mp_source = BrowserSource("browser-mp", "Browser MediaPipe", _emit_from_thread)
_mobile_source = BrowserSource("mobile", "Mobile Camera", _emit_from_thread)

_registry = SourceRegistry()

_cameras: list[dict[str, Any]] = []
_selected_index: int = 0
_selected_label: str = ""

# ────────────────────────── lifecycle ─────────────────────────────


@app.on_event("startup")
async def _startup() -> None:
    global _cameras, _event_loop
    _event_loop = asyncio.get_running_loop()
    _cameras = await asyncio.to_thread(enumerate_cameras)
    _registry.register(_browser_source)
    _registry.register(_browser_mp_source)
    _registry.register(_mobile_source)
    _registry.register(PythonSource(_loop))


@app.on_event("shutdown")
async def _shutdown() -> None:
    _loop.close()
    objects.unload()


# ────────────────────────── health ────────────────────────────────


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "version": __version__,
        "mediapipe_available": _loop.mediapipe_available,
        "mediapipe_error": getattr(_loop._mp, "_init_error", None),
        "running": _loop.running,
        "browser_connected": _browser_source.running,
        "selected_index": _selected_index,
        "selected_label": _selected_label,
    }


# ────────────────────────── cameras (Python source) ───────────────


@app.get("/cameras")
async def cameras_list() -> dict:
    return {"cameras": _cameras, "selected_index": _selected_index, "selected_label": _selected_label}


@app.post("/cameras/rescan")
async def cameras_rescan() -> dict:
    global _cameras
    _cameras = await asyncio.to_thread(enumerate_cameras)
    return {"cameras": _cameras, "selected_index": _selected_index, "selected_label": _selected_label}


class SelectBody(BaseModel):
    index: int
    label: str = ""


@app.post("/cameras/select")
async def cameras_select(body: SelectBody) -> dict:
    global _selected_index, _selected_label
    _selected_index = body.index
    _selected_label = body.label
    was_running = _loop.running
    _loop.stop()
    _loop.set_camera(_selected_index)
    if was_running:
        _loop.start()
    return {"ok": True, "index": _selected_index, "label": _selected_label}


# ────────────────────────── state ────────────────────────────────


@app.get("/state")
async def state() -> dict:
    s = _registry.best_state()
    return {
        "running": _loop.running,
        "browser_connected": _browser_source.running,
        "browser_mp_connected": _browser_mp_source.running,
        "mobile_connected": _mobile_source.running,
        "any_running": _registry.any_running(),
        "present": s.present,
        "position": s.position,
        "distance": s.distance,
        "gaze": s.gaze,
        "last_updated": s.last_updated,
        "selected_index": _selected_index,
        "selected_label": _selected_label,
        "sources": _registry.list_info(),
    }


# ────────────────────────── start / stop (Python cam) ────────────


@app.post("/start")
async def start_loop() -> dict:
    _loop.set_camera(_selected_index)
    _loop.start()
    return {"ok": True, "running": _loop.running}


@app.post("/stop")
async def stop_loop() -> dict:
    _loop.stop()
    return {"ok": True, "running": False}


# ────────────────────────── LLM tools ─────────────────────────────


class LookBody(BaseModel):
    focus: str = ""


def _save_frame(frame: bytes, tag: str) -> str:
    """Persist a JPEG to ~/.jarvyz/iris/ and return its path (for the Loom brain
    to Read). Mirrors the snapshot tool's save location."""
    out_dir = Path.home() / ".jarvyz" / "iris"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    p = out_dir / f"{tag}_{ts}.jpg"
    p.write_bytes(frame)
    return str(p)


def _presence_text(s, source_label: str, age_str: str) -> str:
    """Phase 1 scene description — preserved verbatim so `look()` (no focus) and
    the qwen/speakable channel keep their existing wording."""
    if not s.present:
        return f"No person detected in frame via {source_label} (last checked {age_str})."
    gaze_desc = {
        "screen": "facing the screen",
        "away": "looking away from the screen",
        "unknown": "gaze direction unclear",
    }.get(s.gaze, "gaze unknown")
    dist_desc = {
        "near": "close to the camera",
        "far": "far from the camera",
        "medium": "at medium distance",
    }.get(s.distance, "")
    parts = [f"Someone is present in the {s.position} of frame", dist_desc, gaze_desc]
    return ", ".join(p for p in parts if p) + f". (State last updated {age_str} via {source_label}.)"


@app.post("/tools/look")
async def tool_look(body: LookBody) -> dict:
    if not _registry.any_running():
        return {
            "ok": False,
            "text": (
                "No active camera source. Open the Iris page in your browser "
                "and start the Browser Camera, or start the Python Camera loop."
            ),
        }

    active = _registry.active
    s = active.state if active else _registry.best_state()
    age = time.monotonic() - s.last_updated
    age_str = f"{age:.1f}s ago" if age < 60 else "more than a minute ago"
    source_label = active.label if active else "unknown source"
    presence_text = _presence_text(s, source_label, age_str)

    # No focus -> Phase 1 text-only contract, unchanged. (This is the non-VLM
    # qwen brain's only way to "see"; do not break it.)
    if not body.focus:
        return {"ok": True, "text": presence_text}

    # focus -> Phase 2a open-vocab find via YOLOE. Object presence does NOT
    # require a person in frame, so no presence gate here.
    frame = await _get_best_frame()
    if frame is None:
        return {
            "ok": True,
            "text": presence_text + f" Cannot look for '{body.focus}': no frame available.",
            "found": False, "objects": [], "frame_path": None,
            "available": objects.available(),
        }
    det = await asyncio.to_thread(objects.detect, frame, body.focus)
    frame_path = await asyncio.to_thread(_save_frame, frame, "look")
    if not det.get("available"):
        return {
            "ok": True,
            "text": presence_text + f" Looking for '{body.focus}': object detection "
            "isn't installed yet (install YOLOE in setup). Raw frame saved for you to view.",
            "found": False, "objects": [], "frame_path": frame_path, "available": False,
        }
    objs = det.get("objects", [])
    found = len(objs) > 0
    if found:
        labels = ", ".join(sorted({o["label"] for o in objs}))
        find_text = f" Looking for '{body.focus}': found {len(objs)} — {labels}."
    else:
        find_text = f" Looking for '{body.focus}': not found in frame."
    out = {
        "ok": True, "text": presence_text + find_text,
        "found": found, "objects": objs, "frame_path": frame_path, "available": True,
    }
    if det.get("error"):
        out["error"] = det["error"]
    return out


@app.post("/tools/get_presence")
async def tool_get_presence() -> dict:
    if not _registry.any_running():
        return {"ok": True, "text": "Iris is not running."}
    s = _registry.best_state()
    if not s.present:
        return {"ok": True, "text": "No one in frame right now."}
    gaze_map = {"screen": "looking at the screen", "away": "looking away", "unknown": "gaze unclear"}
    return {
        "ok": True,
        "text": f"Someone is in the {s.position} of frame, {gaze_map.get(s.gaze, 'gaze unknown')}.",
    }


# ────────────────────────── scene understanding (YOLOE — Phase 2a) ─


class ScanRoomBody(BaseModel):
    conf: float = 0.25


@app.post("/tools/scan_room")
async def tool_scan_room(body: ScanRoomBody) -> dict:
    """Open-vocabulary inventory of the current scene (prompt-free YOLOE).
    Returns a text summary (qwen/speakable) + structured objects + raw frame
    path (Loom). Degrades gracefully when YOLOE isn't installed."""
    if not _registry.any_running():
        return {
            "ok": False, "text": "No active camera source — start a camera first.",
            "objects": [], "frame_path": None, "count": 0, "available": objects.available(),
        }
    frame = await _get_best_frame()
    if frame is None:
        return {
            "ok": False, "text": "No frame available — start a camera source first.",
            "objects": [], "frame_path": None, "count": 0, "available": objects.available(),
        }
    det = await asyncio.to_thread(objects.detect, frame, None, body.conf)
    frame_path = await asyncio.to_thread(_save_frame, frame, "scan")
    if not det.get("available"):
        return {
            "ok": True,
            "text": "Object detection isn't installed yet — install YOLOE in setup. "
            "Raw frame saved so you can view the scene directly.",
            "objects": [], "frame_path": frame_path, "count": 0, "available": False,
        }
    objs = det.get("objects", [])
    counts = Counter(o["label"] for o in objs)
    summary = ", ".join(f"{n}x {lbl}" if n > 1 else lbl for lbl, n in counts.most_common())
    out = {
        "ok": True,
        "text": f"Scene inventory: {summary}." if summary else "Scene inventory: nothing recognized.",
        "objects": objs, "frame_path": frame_path, "count": len(objs), "available": True,
    }
    if det.get("error"):
        out["error"] = det["error"]
    return out


@app.get("/yoloe/status")
async def yoloe_status() -> dict:
    """Setup-UI helper: is the (AGPL, user-installed) YOLOE engine available?"""
    return objects.status()


@app.post("/yoloe/install")
async def yoloe_install() -> dict:
    """Setup-UI action: pip install ultralytics into the satellite venv. Blocking
    install runs off the event loop. Weights download lazily on first detect."""
    return await asyncio.to_thread(objects.install)


# ────────────────────────── vision frame endpoints ────────────────


async def _get_best_frame() -> bytes | None:
    """Return a JPEG from the best available source.

    Priority:
      1. Running registry sources (Python cam / Browser Camera JPEG stream)
      2. Browser MediaPipe (Option A) — streams JSON only; request JPEG on demand
      3. Cached frames from non-running registry sources
    """
    for src in _registry._sources.values():
        if src.running:
            frame = await src.get_frame()
            if frame:
                return frame
    # Browser MediaPipe sends JSON events, not frames — request one on demand.
    if _mp_ws_clients:
        frame = await _get_mp_snapshot()
        if frame:
            return frame
    # Fall back to any cached frame from non-running registry sources
    for src in _registry._sources.values():
        frame = await src.get_frame()
        if frame:
            return frame
    return None


@app.get("/snapshot")
async def snapshot_latest() -> Response:
    """Return the latest JPEG frame from the active source (binary, image/jpeg)."""
    frame = await _get_best_frame()
    if frame is None:
        raise HTTPException(503, "No frame available — start a camera source first")
    return Response(content=frame, media_type="image/jpeg")


class SnapshotBody(BaseModel):
    count: int = 1
    interval_ms: int = 500


@app.post("/tools/snapshot")
async def tool_snapshot(body: SnapshotBody) -> dict:
    """Capture 1-5 JPEG frames, save to ~/.jarvyz/iris/, return paths.

    The Loom listener calls this tool and then uses Read on the returned
    paths to see actual camera output. Both count and interval_ms are
    optional — defaults capture one frame immediately.
    """
    count = max(1, min(5, body.count))
    out_dir = Path.home() / ".jarvyz" / "iris"
    out_dir.mkdir(parents=True, exist_ok=True)

    paths: list[str] = []
    for i in range(count):
        if i > 0:
            await asyncio.sleep(body.interval_ms / 1000.0)
        frame = await _get_best_frame()
        if frame is None:
            break
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        p = out_dir / f"snap_{ts}_{i}.jpg"
        await asyncio.to_thread(p.write_bytes, frame)
        paths.append(str(p))

    if not paths:
        return {
            "ok": False,
            "text": "No camera source active — start Browser MediaPipe or Python Camera first.",
            "paths": [],
        }

    s = _registry.best_state()
    state_desc = (
        f"person in {s.position} of frame, gaze={s.gaze}"
        if s.present
        else "no one detected in frame"
    )
    return {
        "ok": True,
        "text": (
            f"Captured {len(paths)} frame(s). "
            f"Read these paths to view: {', '.join(paths)}. "
            f"Semantic state: {state_desc}."
        ),
        "paths": paths,
        "count": len(paths),
        "state": {"present": s.present, "position": s.position, "gaze": s.gaze},
    }


@app.get("/prompt_context")
async def prompt_context() -> dict:
    """Contribute iris state + snapshot hint to the Loom prompt brief.

    Returns empty text when no source is running so satellite_prompt.collect()
    skips this contribution silently.
    """
    if not _registry.any_running():
        return {"text": ""}
    s = _registry.best_state()
    sources = [src.label for src in _registry._sources.values() if src.running]
    state_desc = (
        f"person in the {s.position} of frame, gaze={s.gaze}"
        if s.present
        else "no one detected in frame"
    )
    return {
        "text": (
            f"IRIS CAMERA ({', '.join(sources)}): {state_desc}. "
            "To actually SEE the scene, call the `snapshot` tool — it saves JPEG frame(s) "
            "to disk and returns the file paths, which you can then Read as images."
        )
    }


# ────────────────────────── browser MediaPipe WS (Option A) ───────
# Browser runs FaceDetector locally, pushes {type:"mp_frame", faces:[...]}
# text events here. We derive presence and broadcast — no frame upload needed.
#
# On-demand snapshot: server sends {"type":"snapshot_request"}, browser
# captures one JPEG from its <video> element and sends it back as binary.
# _get_mp_snapshot() orchestrates the request/response via a pending future.

_mp_ws_clients: set[WebSocket] = set()
_mp_snapshot_pending: asyncio.Future[bytes] | None = None
_mp_snapshot_lock = asyncio.Lock()


async def _get_mp_snapshot() -> bytes | None:
    """Request a JPEG snapshot from the connected browser MediaPipe client."""
    if not _mp_ws_clients:
        return None
    async with _mp_snapshot_lock:
        ws = next(iter(_mp_ws_clients))
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[bytes] = loop.create_future()
        global _mp_snapshot_pending
        _mp_snapshot_pending = fut
        try:
            await ws.send_text(json.dumps({"type": "snapshot_request"}))
            return await asyncio.wait_for(asyncio.shield(fut), timeout=5.0)
        except Exception:
            return None
        finally:
            _mp_snapshot_pending = None


def _on_mp_snapshot_bytes(data: bytes) -> None:
    """Resolve the pending snapshot future when the browser sends a JPEG back."""
    if _mp_snapshot_pending and not _mp_snapshot_pending.done():
        _mp_snapshot_pending.set_result(data)


@app.websocket("/mp/ws")
async def mp_events_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    _mp_ws_clients.add(websocket)
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            raw_bytes = msg.get("bytes")
            if raw_bytes:
                # Binary response to a snapshot_request
                _on_mp_snapshot_bytes(raw_bytes)
                continue
            text = msg.get("text")
            if text:
                _handle_browser_mp(json.loads(text))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _mp_ws_clients.discard(websocket)


def _handle_browser_mp(data: dict) -> None:
    if data.get("type") != "mp_frame":
        return
    faces: list[dict] = data.get("faces", [])
    present = len(faces) > 0
    position: str | None = None
    if faces:
        cx = faces[0].get("x", 0.5) + faces[0].get("w", 0) / 2
        position = "left" if cx < 0.33 else "right" if cx > 0.67 else "center"
    _emit_sync({
        "type": "presence",
        "present": present,
        "count": len(faces),
        "position": position,
        "gaze": None,
        "source": "browser_mp",
        "ts": datetime.now(timezone.utc).isoformat(),
    })


# ────────────────────────── sources API ───────────────────────────


@app.get("/sources")
async def sources_list() -> dict:
    return {"sources": _registry.list_info()}


class ActivateBody(BaseModel):
    pass


@app.post("/sources/{source_id}/activate")
async def sources_activate(source_id: str) -> dict:
    ok = _registry.set_active(source_id)
    return {"ok": ok, "active": source_id if ok else None}


# ────────────────────────── browser source WS ─────────────────────


@app.websocket("/sources/{source_id}/ws")
async def source_ws(websocket: WebSocket, source_id: str) -> None:
    source = _registry.get(source_id)
    if not isinstance(source, BrowserSource):
        await websocket.close(code=4404)
        return
    await websocket.accept()
    # Send initial ping so the browser knows it's connected
    await websocket.send_text(json.dumps({"type": "connected", "source_id": source_id}))
    await source.handle_ws(websocket)


# ────────────────────────── mobile cam page ───────────────────────

_CAM_PAGE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JarvYZ Camera</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { background: #0d0d12; color: #ccc; font-family: monospace;
           display: flex; flex-direction: column; align-items: center;
           min-height: 100dvh; padding: 16px; gap: 12px }
    h1 { font-size: 1rem; color: #7c4dff }
    video { width: 100%; max-width: 480px; border-radius: 8px;
            border: 1px solid #333; background: #111 }
    #status { font-size: 0.8rem; color: #888; text-align: center }
    #status.ok { color: #4caf50 }
    #status.err { color: #f44336 }
  </style>
</head>
<body>
  <h1>JarvYZ · Camera Source</h1>
  <video id="v" autoplay muted playsinline></video>
  <div id="status">tap to allow camera...</div>
  <script>
    const sourceId = new URLSearchParams(location.search).get('source') || 'mobile'
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = proto + '//' + location.host + '/sources/' + sourceId + '/ws'
    const ws = new WebSocket(wsUrl)
    const video = document.getElementById('v')
    const status = document.getElementById('status')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    let lastSent = 0

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        video.srcObject = stream
        status.textContent = 'camera ready, connecting...'
      })
      .catch(e => {
        status.textContent = 'camera denied: ' + e.message
        status.className = 'err'
      })

    ws.onopen = () => {
      status.textContent = 'streaming to JarvYZ as "' + sourceId + '"'
      status.className = 'ok'
      ;(function capture() {
        requestAnimationFrame(capture)
        if (ws.readyState !== 1 || video.readyState < 2) return
        const now = Date.now()
        if (now - lastSent < 200) return
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        ctx.drawImage(video, 0, 0)
        canvas.toBlob(blob => {
          if (blob && ws.readyState === 1)
            blob.arrayBuffer().then(buf => ws.send(buf))
        }, 'image/jpeg', 0.7)
        lastSent = now
      })()
    }
    ws.onclose = () => { status.textContent = 'disconnected'; status.className = 'err' }
  </script>
</body>
</html>
"""


@app.get("/cam", response_class=HTMLResponse)
async def mobile_cam_page() -> str:
    return _CAM_PAGE


# ────────────────────────── events WS ────────────────────────────


@app.websocket("/events")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _ws_queues.add(q)
    s = _registry.best_state()
    await websocket.send_text(json.dumps({
        "event": "presence",
        "data": {"present": s.present, "position": s.position, "distance": s.distance},
        "ts": datetime.now(timezone.utc).isoformat(),
    }))
    await websocket.send_text(json.dumps({
        "event": "gaze",
        "data": {"target": s.gaze},
        "ts": datetime.now(timezone.utc).isoformat(),
    }))
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=20.0)
                await websocket.send_text(json.dumps(msg))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"event": "ping"}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _ws_queues.discard(q)


# ────────────────────────── static SPA ────────────────────────────

_STATIC = Path(__file__).parent / "static"
if _STATIC.exists():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")

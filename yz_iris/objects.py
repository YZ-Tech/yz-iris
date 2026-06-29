"""YOLOE open-vocabulary object detection — Phase 2a scene understanding.

User-installed, NOT bundled. `ultralytics` (AGPL-3.0) is deliberately absent from
pyproject dependencies; the satellite stays MIT. `available()` reports whether it
is importable, `install()` pips it into the running venv on explicit user action,
and `detect()` degrades gracefully (returns `available=False`, never raises into
the request path) when it isn't there — so `look()` / `scan_room()` never break
the satellite.

Two lazy-resident model singletons (small; fine alongside the other GPU models on
a 4090):
  - text-prompt  : `yoloe-11l-seg.pt`     — open-vocab "find <thing>" via set_classes
  - prompt-free  : `yoloe-11l-seg-pf.pt`  — enumerate everything from the built-in
                                            1200+ LVIS/Objects365 vocabulary

NOTE: the YOLOE inference path is verified against the current ultralytics docs
API but is NOT runnable in this dev environment (no ultralytics installed, GPU is
Windows-side). First real exercise is after the user installs it; every call is
wrapped so a wrong-version API surfaces as a clean error string, not a crash.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import threading
from typing import Any

import numpy as np

# Weights — overridable later via settings if we want to bump to the 26-series.
MODEL_PROMPT = "yoloe-11l-seg.pt"
MODEL_PROMPT_FREE = "yoloe-11l-seg-pf.pt"

_models: dict[str, Any] = {}
_lock = threading.Lock()
_install_error: str | None = None
_installing: bool = False


def available() -> bool:
    """True if ultralytics is importable in this venv."""
    try:
        import ultralytics  # noqa: F401
        return True
    except Exception:
        return False


def status() -> dict[str, Any]:
    return {
        "available": available(),
        "installing": _installing,
        "install_error": _install_error,
        "loaded": sorted(_models.keys()),
        "model_prompt": MODEL_PROMPT,
        "model_prompt_free": MODEL_PROMPT_FREE,
    }


def install() -> dict[str, Any]:
    """Kick off `pip install ultralytics` in a BACKGROUND thread and return
    immediately — the install takes ~1-2 min (well past the JarvYZ proxy's
    request timeout), so the UI polls `status()` for {installing, available,
    install_error} instead of blocking on this call. Weights download lazily on
    the first YOLOE(...) construction, not here. Idempotent while in flight."""
    global _installing, _install_error
    if _installing:
        return {"ok": True, "installing": True, "already": True}
    if available():
        return {"ok": True, "available": True}
    _installing = True
    _install_error = None

    def _work() -> None:
        global _installing, _install_error
        try:
            # This venv is uv-managed and seedless — it has NO `pip` module
            # (`python -m pip` fails with "No module named pip"). Install into
            # it with `uv pip install --python <this-python>`. If uv isn't on
            # PATH, bootstrap pip via ensurepip and use it as a fallback.
            uv = shutil.which("uv")
            if uv:
                r = subprocess.run(
                    [uv, "pip", "install", "--python", sys.executable, "ultralytics>=8.3.0"],
                    capture_output=True, text=True,
                )
            else:
                subprocess.run(
                    [sys.executable, "-m", "ensurepip", "--upgrade"],
                    capture_output=True, text=True,
                )
                r = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "ultralytics>=8.3.0"],
                    capture_output=True, text=True,
                )
            if r.returncode != 0:
                # Surface the REAL reason (last lines of stderr/stdout), not just
                # the exit code — so the setup card shows something actionable.
                msg = (r.stderr or r.stdout or "").strip()
                _install_error = msg[-800:] if msg else f"installer exited {r.returncode}"
            else:
                _install_error = None
        except Exception as e:  # noqa: BLE001 — surfaced via status(), not raised
            _install_error = str(e)
        finally:
            _installing = False

    threading.Thread(target=_work, daemon=True).start()
    return {"ok": True, "installing": True}


def _load(name: str):
    """Lazy-construct + cache a YOLOE model. Weights auto-download on first call."""
    m = _models.get(name)
    if m is not None:
        return m
    with _lock:
        if name not in _models:
            from ultralytics import YOLOE  # local import — optional dep
            _models[name] = YOLOE(name)
    return _models[name]


def _set_classes(model, classes: list[str]) -> None:
    """Apply a text prompt. Current API is `set_classes(names)`; older builds
    needed the text embeddings too — support both."""
    try:
        model.set_classes(classes)
    except TypeError:
        model.set_classes(classes, model.get_text_pe(classes))


def detect(jpeg: bytes, prompt: str | None = None, conf: float = 0.25) -> dict[str, Any]:
    """Run YOLOE on a JPEG byte buffer.

    prompt=None  -> prompt-free model: full open-vocab inventory of the scene.
    prompt="a,b" -> text-prompt model: find only the named thing(s).

    Returns {available, objects:[{label,conf,box[x1,y1,x2,y2]}], error?}. Never
    raises — a missing dep or API mismatch comes back as available/error fields.
    """
    if not available():
        return {"available": False, "objects": []}
    try:
        import cv2
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    except Exception as e:  # noqa: BLE001
        return {"available": True, "objects": [], "error": f"decode failed: {e}"}
    if img is None:
        return {"available": True, "objects": [], "error": "frame decode returned None"}

    try:
        if prompt and prompt.strip():
            classes = [c.strip() for c in prompt.replace(";", ",").split(",") if c.strip()]
            model = _load(MODEL_PROMPT)
            _set_classes(model, classes)
        else:
            model = _load(MODEL_PROMPT_FREE)
        results = model.predict(img, conf=conf, verbose=False)
    except Exception as e:  # noqa: BLE001 — wrong-version API / load failure
        return {"available": True, "objects": [], "error": f"detect failed: {e}"}

    objects: list[dict[str, Any]] = []
    for r in results:
        names = getattr(r, "names", {}) or {}
        boxes = getattr(r, "boxes", None)
        if boxes is None:
            continue
        for b in boxes:
            try:
                cls = int(b.cls[0])
                cf = float(b.conf[0])
                x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
            except Exception:  # noqa: BLE001 — skip a malformed box, keep the rest
                continue
            objects.append({
                "label": names.get(cls, str(cls)),
                "conf": round(cf, 3),
                "box": [x1, y1, x2, y2],
            })
    objects.sort(key=lambda o: -o["conf"])
    return {"available": True, "objects": objects}


def unload() -> None:
    """Drop model references (shutdown). Avoids holding GPU memory after stop."""
    with _lock:
        _models.clear()

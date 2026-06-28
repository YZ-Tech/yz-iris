<!-- ─────────────────────────── JARVYZ SATELLITE ─────────────────────────── -->

# iris

[![JarvYZ](https://img.shields.io/badge/JARVYZ-Satellite-blue.svg?logoColor=white)](../../README.md)
[![Version](https://img.shields.io/badge/VERSION-0.0.1-blue.svg?logo=git&logoColor=white)](pyproject.toml)
[![Python](https://img.shields.io/badge/PYTHON-3.10–3.12-blue.svg?logo=python&logoColor=white)](pyproject.toml)
[![License](https://img.shields.io/badge/LICENSE-MIT-blue.svg?logo=opensourceinitiative&logoColor=white)](pyproject.toml)
[![Kind](https://img.shields.io/badge/KIND-service-blue.svg?logoColor=white)](#)
[![Port](https://img.shields.io/badge/PORT-9007-blue.svg?logoColor=white)](#)
[![Creator](https://img.shields.io/badge/CREATOR-Yeon-blue.svg?logo=github&logoColor=white)](https://github.com/YeonV)
[![Blade](https://img.shields.io/badge/A.K.A-Blade-darkred.svg?logo=github&logoColor=white)](https://github.com/YeonV)

<p align="left">
  <img src="ui/public/logo.svg" alt="JarvYZ" width="200">
</p>

> `yz-iris` — Visual awareness satellite for JarvYZ. Webcam presence detection, gaze estimation, and scene understanding via OpenCV + MediaPipe. All processing is local.

### Techs

[![FastAPI](https://img.shields.io/badge/x-FastAPI-blue.svg?logo=fastapi&logoColor=white&label=)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/x-React-blue.svg?logo=react&logoColor=white&label=)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/x-TypeScript-blue.svg?logo=typescript&logoColor=white&label=)](https://www.typescriptlang.org/)
[![OpenCV](https://img.shields.io/badge/x-OpenCV-blue.svg?logo=opencv&logoColor=white&label=)](https://opencv.org/)
[![MediaPipe](https://img.shields.io/badge/x-MediaPipe-blue.svg?logo=google&logoColor=white&label=)](https://mediapipe.dev/)

**Run** `uv run python -m yz_iris` &nbsp;·&nbsp; **API** `/api/iris/*`

<!-- ───────────────────────────────────────────────────────────────────────── -->

<details>
<summary><b>Documentation</b></summary>

Visual awareness for JarvYZ — detects presence, position, distance, and gaze
direction and exposes live WebSocket events plus two LLM tools (`look`,
`get_presence`). All processing runs **locally**; no frames ever leave the
machine.

## Install

```bash
cd satellites/yz-iris
uv run python -m yz_iris   # http://127.0.0.1:9007
```

OpenCV and MediaPipe are declared as core dependencies and are installed
automatically by `uv`. No manual pip step required.

## Vision sources

Three sources can run simultaneously; the semantic reducer merges their output:

| Source | How it works | Best for |
|---|---|---|
| **Browser MediaPipe** (Option A) | MediaPipe WASM runs in-browser; only JSON landmark events are sent to the satellite — no video upload | lowest latency, GPU offloaded to client |
| **Browser Camera** (Option B) | Browser streams JPEG frames to the satellite; server-side MediaPipe processes them | when you want server-side model control |
| **Python Camera** | OpenCV grabs frames locally; MediaPipe runs server-side | headless / kiosk use |

The UI's nav item power switch controls all sources globally:
- **on** — sources run; auto-resumes the last active state
- **paused** — all cams stopped, UI locked; browser MediaPipe models stay GPU-resident for instant resume
- **off** (right-click) — full teardown; browser WASM models `close()`d, Python loop stopped

## Browser MediaPipe models

Four models are available; any combination can be active simultaneously:

| Model | What it detects | Bundle size |
|---|---|---|
| Face Detector | Presence + bounding box | 224 KB |
| Face Landmarker | 478 landmarks + iris (gaze estimation) | 3.4 MB |
| Pose Landmarker | 33 body keypoints | 4.7 MB |
| Hand Landmarker | Hand + finger landmarks | 8.3 MB |

Models are loaded lazily on first use and cached GPU-resident until power-off.

## Gaze estimation

Derived from Face Landmarker iris landmarks (indices 468/473) relative to eye
corners (33/133/362/263). Nose tip deviation from the eye midpoint flags head
turns as `away`. Three states reach the backend: `screen`, `away`, `unknown`.

## Semantic reducer

Raw detector output is noisy. The `SemanticReducer` applies:

- **Presence debounce** — 5 consecutive frames must agree before emitting a
  `presence` event. Eliminates single-frame glitches.
- **Gaze debounce** — gaze direction must be stable for 3 s before firing.
  Prevents flicker during natural head movement.

Only state _changes_ are emitted, so the WS stream is quiet when nothing moves.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | liveness + version + running state |
| `GET` | `/cameras` | list enumerated OpenCV camera indices + labels |
| `POST` | `/cameras/rescan` | re-enumerate (hot-plug) |
| `POST` | `/cameras/select` | `{index, label}` — set active camera |
| `GET` | `/state` | merged semantic state from all sources |
| `POST` | `/start` | start Python CV loop |
| `POST` | `/stop` | stop Python CV loop |
| `POST` | `/tools/look` | LLM tool: semantic scene description (text only) |
| `POST` | `/tools/get_presence` | LLM tool: one-shot presence query |
| `POST` | `/tools/snapshot` | LLM tool: capture 1-5 JPEG frames → save to disk → return paths |
| `GET` | `/snapshot` | latest JPEG frame binary (image/jpeg) |
| `GET` | `/prompt_context` | Loom brief contribution — iris state + snapshot hint |
| `GET` | `/sources` | list registered sources + status |
| `POST` | `/sources/{id}/activate` | set primary source for LLM tools |
| `WS` | `/sources/{id}/ws` | browser/mobile frame stream |
| `WS` | `/mp/ws` | browser MediaPipe JSON event stream (Option A) |
| `GET` | `/cam` | self-contained mobile camera page |
| `WS` | `/events` | server-pushed presence + gaze events |

## Loom vision workflow

When the iris satellite is running in Loom (external / Claude Mode), the Loom
listener automatically receives iris state in every prompt brief via the
`onPromptBuild` hook (`/prompt_context`). The brief includes who is in frame,
their position and gaze, and an instruction to call `snapshot` for actual frames.

To see the camera:

```
# Via JarvYZ tool dispatch (works in both Ollama and Loom mode):
POST /tools/snapshot {"count": 1}
-> {"ok": true, "paths": ["C:\\Users\\...\\iris\\snap_...jpg"], ...}
# Then Read the path as an image

# Direct from the Loom listener (Bash):
curl -s http://127.0.0.1:9007/tools/snapshot -H "Content-Type: application/json" \
     -d '{"count":3,"interval_ms":400}' | python -c "import sys,json; print(json.load(sys.stdin)['paths'])"
```

Frames are saved under `~/.jarvyz/iris/` with timestamp names. The `snapshot`
tool returns up to 5 frames; the `Get /snapshot` endpoint returns the latest
frame as binary JPEG for direct HTTP consumption.

## UI build pipeline

```bash
cd satellites/yz-iris/ui
npm install

npm run ship          # build:lib + install IIFE to frontend/public/modules/ and backend/.../web/static/modules/
npm run build:pages   # standalone SPA -> yz_iris/static/ (served at / by the satellite)
npm run dev           # dev server at :5187 with proxy to satellite at :9007
```

## Use with JarvYZ

`backend/jarvyz/web/api/iris_satellite.py` proxies `/api/iris/*` to this
satellite. Enable it in `/satellites` — the nav entry and LLM tools appear
automatically. Disable it and they vanish from the tool catalog.

Privacy shield: when any source is active, the TopBar shows **Camera: watching**.

## Roadmap

- **Phase 2 (done)** — Loom vision: `snapshot` tool saves JPEG frames to disk; Loom
  listener reads them directly (no VLM intermediary — Claude IS the VLM). Brief
  hook injects iris state + snapshot hint into every external-mode prompt.
- **Phase 3** — ReSpeaker DOA cross-correlation: match mic direction-of-arrival
  to detected face position to identify the active speaker
- **Phase 4** — yz-people tie-in: match detected faces against enrolled samples
  for named presence (`"Yeon is at the desk"` instead of `"someone is present"`)

## See also

- [SATELLITE_DYNAMIC_MODULES.md](../../backend/_docs/SATELLITE_DYNAMIC_MODULES.md) — manifest + IIFE contract
- [yz-transcript](../yz-transcript/) — closest shape (background loop + WS events + LLM tools)
- [yz-people](../yz-people/) — face enrollment tie-in (Phase 4)

</details>

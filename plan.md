# yz-iris — plan

JarvYZ's visual sense. A webcam feed becomes structured awareness: who is present,
where attention is directed, what's in the room. Data flows to Loom (Claude in Loom
mode) as semantic events + on-demand tools — not a raw pixel firehose.

The name: an iris controls what light enters. yz-iris controls what Claude sees.

Port: **9007**

---

## What this is NOT

- Not a surveillance system. Frames are processed locally, never stored or sent
  off-device unless the user explicitly exports.
- Not a continuous image stream to the LLM. Claude gets semantic summaries and
  on-demand snapshots — the CV models are the filter, not Claude.
- Not a firehose. Events only fire when something meaningful changes.

---

## Architecture

```
webcam (OpenCV)
    |
    +--[frame loop, ~10 Hz, background thread]--+
                                                |
              +-------- CV Pipeline --------+
              |  MediaPipe (face+gaze)      |  <- Apache 2.0, bundleable
              |  YOLOE (open-vocab objects) |  <- user-installed (AGPL-3.0) [Phase 2]
              |  ReSpeaker DOA stream       |  <- via USB HID [Phase 3]
              +----------------------------+
                             |
                    Semantic reducer
                    (only emit on state change)
                             |
              +--------------+---------------+
              |                              |
         Event bus                    REST API
    (WS /events)               (FastAPI, port 9007)
              |                              |
         JarvYZ core                  Loom tools
      (presence, gaze)           (look, get_presence)
```

---

## Resolved decisions

### Camera selector (Q1): Both browser + Python, split by role

| Layer | Job |
|---|---|
| Browser (`enumerateDevices` + `getUserMedia` preview) | Friendly label + live preview so user can visually confirm |
| Satellite `/cameras` endpoint | Python-side enumeration (OpenCV index scan); stores selected index |
| Match | UI shows both lists; user correlates browser label ↔ Python index, sends `{index, label}` to satellite |

Not heavy: `enumerateDevices()` is zero-cost; the browser preview stream is display-only,
separate from the Python CV loop. `pygrabber` on Windows is a tiny COM wrapper.

### Privacy shield (Q3): Add Camera row

`privacy.ts` gets `cameraEnabled?: boolean` + `mimicryEnabled?: boolean` inputs.
New "Camera" row in the popover: `watching` / `idle` / `off`.
The tier itself does not change (all processing local) but the badge chip must not
show full-green while a camera loop is running.

### yz-people face enrollment tie-in (Q4): DEFERRED

Noted. Stays open until yz-people has face enrollment (Phase 4+).

---

## License handling (Ollama model pattern)

We ship only integration code (MIT). Models and heavy packages are user-installed
on first use via the satellite's setup UI:

| Component | License | Install method |
|---|---|---|
| MediaPipe | Apache 2.0 | `pip install mediapipe` — could bundle; kept user-side for consistency |
| YOLOE (Ultralytics) | AGPL-3.0 | User clicks "Install" in UI → satellite runs pip install into its venv |
| YOLOE model weights | AGPL-3.0 | Auto-downloaded on first `YOLO("yoloe-11l-seg.pt")` call |
| NVIDIA Maxine AR SDK | Proprietary NVIDIA EULA | UI links to NVIDIA portal; user installs SDK, sets path in settings |
| MetaHuman Live Link | Unreal EULA (free) | Lives in UE5 — already available if yz-unreal is active |

Setup UI: checklist on first launch, status per dep (missing / installing / ready),
one-click install. License shown before click. Nothing downloaded without user action.

---

## Data layers — priority order

### Tier 1: Always-on, lightweight (MediaPipe, runs on CPU)
- **Person presence** — is someone in frame? rough position (left/center/right, near/far)
- **Gaze direction** — looking at screen vs. away (face landmark heuristic)
- **DOA from ReSpeaker** — speaker angle (0-360 deg) + confidence (Phase 3)

### Tier 2: On-demand or change-triggered (YOLOE — Phase 2)
- **Object inventory** — open-vocabulary; Claude names what to look for
- **Scene state** — lighting level, room context

### Tier 3: Optional, user-activated (needs explicit install — Phase 4)
- **Face mimicry output** — 52 ARKit blendshapes for the avatar; routed DIRECTLY
  to yz-unreal/yz-body, never through Claude
- **Hand gestures** — MediaPipe hands; only useful when a gesture vocabulary is defined

---

## Event contract (WS /events)

All events carry `ts` (ISO timestamp).

```jsonc
{ "event": "presence", "data": { "present": true, "position": "center", "distance": "near" } }
{ "event": "gaze",     "data": { "target": "screen" } }   // "screen" | "away" | "unknown"
{ "event": "doa",      "data": { "angle_deg": 45, "confidence": 0.87 } }  // Phase 3
{ "event": "scene_change", "data": { "type": "lighting", "value": "dim" } }  // Phase 2
```

Reducer debounce rules:
- `presence`: flip only after 5 consistent frames (prevents blink glitches)
- `gaze`: flip only after 3s consistent reading
- `doa`: emitted every 100ms (tiny payload); consumer buffers

---

## Loom tool contract

```jsonc
"tools": [
  {
    "name": "look",
    "description": "Snapshot + text description of what the webcam sees right now.",
    "parameters": { "focus": "string (optional)" }
  },
  {
    "name": "get_presence",
    "description": "Current presence: in-frame/absent, position, gaze. Speakable.",
    "parameters": {}
  }
]
```

---

## ReSpeaker DOA integration (Phase 3)

ReSpeaker 4-mic USB array exposes DOA via `usb_4_mic_array` Python library or raw HID.
Satellite reads in a background thread and:
1. Emits `doa` events on WS
2. Correlates angle with face positions from MediaPipe
3. When yz-people active: narrows speaker candidate pool before voice embedding

Setting: `iris.respeaker_enabled` (bool, default false until user confirms device).

---

## Phases

### Phase 1 (CURRENT) — Camera in, presence + gaze out
- FastAPI server on 9007
- OpenCV frame loop (background thread)
- MediaPipe FaceMesh: person present/absent, position, gaze heuristic
- WS event bus: `presence` + `gaze` events
- `look()` tool: text description from current CV state
- `get_presence()` tool: speakable presence summary
- Camera selector: Python index scan + browser preview UI
- Setup checklist: mediapipe / opencv dep status + install
- Manifest wired into JarvYZ
- Privacy shield: Camera row added

### Phase 2 — Scene understanding
- YOLOE integration with user-install flow
- `scan_room()` tool
- `focus` parameter on `look()` routes YOLOE query
- `scene_change` events

### Phase 3 — ReSpeaker DOA
- DOA reader thread
- DOA + presence correlation
- `doa` events on bus
- `get_presence()` includes current DOA angle

### Phase 4 — Avatar mimicry (yz-unreal dependency)
- MediaPipe Face Mesh 52-blendshape → ARKit coefficient map
- OR NVIDIA Maxine AR SDK (user-installed, proprietary)
- Output → yz-unreal LiveLink port (11111) directly, NOT through Claude
- yz-people face enrollment → named person detection

---

## File layout

```
satellites/yz-iris/
  plan.md
  manifest.json
  pyproject.toml
  yz_iris/
    __init__.py
    __main__.py
    server.py         <- FastAPI app, port 9007
    camera.py         <- OpenCV enumeration + frame loop thread
    mediapipe_layer.py <- presence + gaze detection
    reducer.py        <- semantic state, debounce, event emission
    setup_check.py    <- dep checker + pip installer
  ui/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    scripts/install-to-frontend.mjs
    src/
      index.ts        <- IIFE exports
      App.tsx         <- standalone SPA entry
      IrisPage.tsx    <- main page component
      types.ts
      lib/
        api.ts
        ws.ts
      components/
        CameraSelector.tsx
        PresenceWidget.tsx
        SetupChecklist.tsx
```

---

## Open questions

- **yz-people face enrollment tie-in** — Phase 4+: face embeddings → named person detection

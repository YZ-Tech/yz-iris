/**
 * Option A — browser-side MediaPipe inference.
 * All selected models run in WASM/GPU in the browser.
 * Only semantic JSON events go to the backend — no video upload.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import FaceIcon from '@mui/icons-material/Face'

import { MODELS, type ModelDef, type ModelId, type AnyDetector, loadModel } from './mpModels'
import { drawOverlay, type FrameResults } from './mpDraw'
import { estimateGaze, gazeToBackend, type GazeTarget } from './mpGaze'

type Status = 'idle' | 'requesting' | 'ready' | 'loading' | 'connecting' | 'detecting' | 'error'

interface Props {
  wsUrl: string
  onStatusChange?: (status: Status) => void
  /** Nav-level power state. paused/off = locked UI + cams stopped. on = unlocked + auto-resume. */
  playState?: 'on' | 'paused' | 'off'
}

export function BrowserMPCard({ wsUrl, onStatusChange, playState }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [selectedModels, setSelectedModels] = useState<ModelDef[]>([MODELS[0]])
  const [loadingModels, setLoadingModels] = useState<Set<ModelId>>(new Set())
  const [faceCount, setFaceCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const detectorsRef = useRef<Map<ModelId, AnyDetector>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastDetectRef = useRef(0)
  const statusRef = useRef<Status>('idle')
  // Remembers whether detection was active when the nav was switched to paused/off,
  // so we can auto-resume when it switches back to on.
  const wasActiveRef = useRef(false)

  const notify = useCallback((s: Status) => {
    setStatus(s)
    statusRef.current = s
    onStatusChange?.(s)
  }, [onStatusChange])

  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el && streamRef.current) el.srcObject = streamRef.current
  }, [])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const video = all.filter((d) => d.kind === 'videoinput')
      if (video.length > 0 && video[0].label) {
        setDevices(video)
        setDeviceId(video[0].deviceId)
        notify('ready')
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const requestPermission = async () => {
    notify('requesting')
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      s.getTracks().forEach((t) => t.stop())
      const all = await navigator.mediaDevices.enumerateDevices()
      const video = all.filter((d) => d.kind === 'videoinput')
      setDevices(video)
      if (video.length > 0) setDeviceId(video[0].deviceId)
      notify('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Permission denied')
      notify('error')
    }
  }

  const startDetectionLoop = useCallback(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || video.videoWidth === 0) return

      const now = performance.now()
      if (now - lastDetectRef.current < 100) return
      lastDetectRef.current = now

      const detectors = detectorsRef.current
      const results: FrameResults = {}

      try {
        const fd = detectors.get('face-detector')
        if (fd) results.detections = fd.detectForVideo(video, now).detections

        const fl = detectors.get('face-landmarker')
        if (fl) {
          results.faceLandmarks = fl.detectForVideo(video, now).faceLandmarks
          if (results.faceLandmarks?.[0]) {
            results.gaze = estimateGaze(results.faceLandmarks[0])
          }
        }

        const pl = detectors.get('pose-landmarker')
        if (pl) results.poseLandmarks = pl.detectForVideo(video, now).landmarks

        const hl = detectors.get('hand-landmarker')
        if (hl) results.handLandmarks = hl.detectForVideo(video, now).landmarks
      } catch {
        return
      }

      if (canvas) drawOverlay(results, canvas, video)

      const count = Math.max(
        results.detections?.length ?? 0,
        results.faceLandmarks?.length ?? 0,
        results.poseLandmarks?.length ?? 0,
      )
      setFaceCount(count)

      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'mp_frame',
          faces: (results.detections ?? []).map((d) => ({
            score: d.categories[0]?.score ?? 0,
            x: (d.boundingBox?.originX ?? 0) / video.videoWidth,
            y: (d.boundingBox?.originY ?? 0) / video.videoHeight,
            w: (d.boundingBox?.width ?? 0) / video.videoWidth,
            h: (d.boundingBox?.height ?? 0) / video.videoHeight,
          })),
          face_landmarks: results.faceLandmarks ?? [],
          pose_landmarks: results.poseLandmarks ?? [],
          hand_landmarks: results.handLandmarks ?? [],
          gaze: results.gaze ? gazeToBackend(results.gaze as GazeTarget) : undefined,
          ts: new Date().toISOString(),
        }))
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const stopDetectionLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }, [])

  // Respond to a {"type":"snapshot_request"} from the server by capturing
  // one JPEG from the live video element and sending it as binary.
  const handleSnapshotRequest = useCallback(() => {
    const video = videoRef.current
    const ws = wsRef.current
    if (!video || video.videoWidth === 0 || ws?.readyState !== WebSocket.OPEN) return
    const c = document.createElement('canvas')
    c.width = video.videoWidth
    c.height = video.videoHeight
    c.getContext('2d')!.drawImage(video, 0, 0)
    c.toBlob((blob) => {
      if (blob && wsRef.current?.readyState === WebSocket.OPEN)
        blob.arrayBuffer().then((buf) => wsRef.current?.send(buf))
    }, 'image/jpeg', 0.85)
  }, [])

  // Camera off, WS closed, models stay GPU-resident.
  const stop = useCallback(() => {
    stopDetectionLoop()
    wsRef.current?.close()
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (canvasRef.current) {
      canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
    setFaceCount(0)
    notify('ready')
  }, [stopDetectionLoop, notify])

  // Re-acquire camera using already-loaded models (no reload).
  const resume = useCallback(async () => {
    if (detectorsRef.current.size === 0) return
    setError(null)
    try {
      const constraint = deviceId ? { deviceId: { exact: deviceId } } : true
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraint })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      notify('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onopen = () => { notify('detecting'); startDetectionLoop() }
      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try { if (JSON.parse(evt.data)?.type === 'snapshot_request') handleSnapshotRequest() } catch { /* ignore */ }
      }
      ws.onclose = () => {
        stopDetectionLoop()
        if (canvasRef.current) {
          canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
        setFaceCount(0)
        notify('ready')
      }
      ws.onerror = () => { setError('WebSocket error — is the satellite running?'); notify('error') }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      notify('error')
    }
  }, [deviceId, wsUrl, notify, startDetectionLoop, stopDetectionLoop, handleSnapshotRequest])

  // Nav power switch reactions:
  //   paused → stop camera, keep models in GPU, remember active state
  //   off    → same + free GPU models
  //   on     → auto-resume if was active + models available; else just unlock UI
  useEffect(() => {
    if (!playState) return
    const s = statusRef.current
    const isActive = s === 'detecting' || s === 'connecting' || s === 'loading'

    if (playState === 'paused') {
      if (isActive) { wasActiveRef.current = true; stop() }
    } else if (playState === 'off') {
      if (isActive) { wasActiveRef.current = true; stop() }
      detectorsRef.current.forEach((d) => d.close())
      detectorsRef.current.clear()
    } else if (playState === 'on') {
      if (wasActiveRef.current) void resume()
      wasActiveRef.current = false
    }
  }, [playState, stop, resume])

  const start = async () => {
    setError(null)
    notify('loading')
    try {
      const constraint = deviceId ? { deviceId: { exact: deviceId } } : true
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraint })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream

      const toLoad = selectedModels.map((m) => m.id).filter((id) => !detectorsRef.current.has(id))
      if (toLoad.length > 0) {
        setLoadingModels(new Set(toLoad))
        await Promise.all(
          toLoad.map(async (id) => {
            const detector = await loadModel(id)
            detectorsRef.current.set(id, detector)
            setLoadingModels((prev) => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          }),
        )
      }

      notify('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onopen = () => { notify('detecting'); startDetectionLoop() }
      ws.onmessage = (evt) => {
        if (typeof evt.data !== 'string') return
        try { if (JSON.parse(evt.data)?.type === 'snapshot_request') handleSnapshotRequest() } catch { /* ignore */ }
      }
      ws.onclose = () => {
        stopDetectionLoop()
        if (canvasRef.current) {
          canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
        setFaceCount(0)
        notify('ready')
      }
      ws.onerror = () => { setError('WebSocket error — is the satellite running?'); notify('error') }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      notify('error')
    }
  }

  useEffect(() => () => {
    stopDetectionLoop()
    wsRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    detectorsRef.current.forEach((d) => d.close())
    detectorsRef.current.clear()
  }, [stopDetectionLoop])

  // paused or off = locked: all buttons/selects disabled, cameras blocked
  const locked = !!playState && playState !== 'on'
  const detecting = status === 'detecting'
  const active = detecting || status === 'connecting' || status === 'loading'

  const statusChip = {
    idle: null,
    requesting: <Chip size="small" label="requesting..." />,
    loading: (
      <Chip
        size="small"
        icon={<CircularProgress size={10} />}
        label={loadingModels.size > 0 ? `loading ${loadingModels.size} model...` : 'starting...'}
      />
    ),
    ready: <Chip size="small" label="ready" variant="outlined" />,
    connecting: <Chip size="small" label="connecting..." color="warning" />,
    detecting: (
      <Chip
        size="small"
        icon={<FiberManualRecordIcon sx={{ fontSize: '0.6rem !important' }} />}
        label="detecting"
        color="success"
      />
    ),
    error: <Chip size="small" label="error" color="error" />,
  }[status]

  return (
    <Card variant="outlined" sx={{ borderColor: detecting ? 'success.dark' : undefined }}>
      <CardHeader
        title={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <FaceIcon color={detecting ? 'success' : 'disabled'} fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600} component="div">
              Browser MediaPipe
            </Typography>
            <Chip size="small" label="Option A" sx={{ fontSize: '0.65rem', height: 18 }} />
          </Stack>
        }
        action={<Box sx={{ pr: 1, pt: 0.5 }}>{statusChip}</Box>}
        subheader={
          detecting
            ? faceCount > 0
              ? `${faceCount} subject${faceCount !== 1 ? 's' : ''} detected`
              : 'No subject detected'
            : 'Inference runs in your browser — nothing uploaded'
        }
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          {status === 'idle' && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                MediaPipe runs entirely in your browser via WebAssembly.
                Only detected landmarks are sent to JarvYZ — no video leaves your device.
              </Typography>
              <Button variant="outlined" size="small" startIcon={<VideocamIcon />} onClick={requestPermission} disabled={locked}>
                Allow camera access
              </Button>
            </Stack>
          )}

          {(status === 'ready' || active) && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1}>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Camera</InputLabel>
                  <Select
                    value={deviceId}
                    label="Camera"
                    onChange={(e) => setDeviceId(e.target.value)}
                    disabled={active || locked}
                  >
                    {devices.map((d) => (
                      <MenuItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Autocomplete
                multiple
                options={MODELS}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={selectedModels}
                onChange={(_, val) => {
                  const removed = selectedModels.filter((m) => !val.find((v) => v.id === m.id))
                  for (const m of removed) {
                    detectorsRef.current.get(m.id)?.close()
                    detectorsRef.current.delete(m.id)
                  }
                  setSelectedModels(val)
                }}
                disabled={active || locked}
                disableCloseOnSelect
                renderTags={(val, getTagProps) =>
                  val.map((opt, idx) => (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      size="small"
                      {...getTagProps({ index: idx })}
                      sx={{ borderColor: opt.color, color: opt.color }}
                      variant="outlined"
                    />
                  ))
                }
                renderOption={(props, opt) => (
                  <Box component="li" {...props} key={opt.id}>
                    <Stack>
                      <Typography variant="body2" sx={{ color: opt.color }}>{opt.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {opt.desc} — {opt.size}
                      </Typography>
                    </Stack>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField {...params} label="Models" size="small" placeholder={selectedModels.length === 0 ? 'Pick at least one...' : ''} />
                )}
              />

              <Box
                sx={{
                  position: 'relative',
                  borderRadius: 1,
                  overflow: 'hidden',
                  maxWidth: 360,
                  border: '1px solid',
                  borderColor: detecting && faceCount > 0 ? 'success.dark' : 'divider',
                  display: active ? 'block' : 'none',
                }}
              >
                <video
                  ref={videoCallbackRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', display: 'block' }}
                />
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                />
              </Box>

              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {!active && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<FaceIcon />}
                    onClick={start}
                    disabled={selectedModels.length === 0 || locked}
                  >
                    Start detection
                  </Button>
                )}
                {status === 'loading' && <CircularProgress size={20} />}
                {(status === 'connecting' || detecting) && (
                  <Button variant="outlined" size="small" color="warning" startIcon={<VideocamOffIcon />} onClick={stop} disabled={locked}>
                    Stop
                  </Button>
                )}
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

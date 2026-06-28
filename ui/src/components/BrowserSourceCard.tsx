import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
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
  Typography,
} from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'

export type BrowserSourceStatus = 'idle' | 'requesting' | 'ready' | 'connecting' | 'streaming' | 'error'

interface Props {
  wsUrl: string
  onStatusChange?: (status: BrowserSourceStatus) => void
  /** Nav-level power state. paused/off = locked UI + stream stopped. on = unlocked + auto-resume. */
  playState?: 'on' | 'paused' | 'off'
}

export function BrowserSourceCard({ wsUrl, onStatusChange, playState }: Props) {
  const [status, setStatus] = useState<BrowserSourceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef(document.createElement('canvas'))
  const rafRef = useRef<number>(0)
  const lastSentRef = useRef(0)
  const statusRef = useRef<BrowserSourceStatus>('idle')
  // Remembers whether the stream was active when the nav was paused, for auto-resume on 'on'.
  const wasStreamingRef = useRef(false)

  const setStatusAndNotify = useCallback((s: BrowserSourceStatus) => {
    setStatus(s)
    statusRef.current = s
    onStatusChange?.(s)
  }, [onStatusChange])

  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el && streamRef.current) {
      el.srcObject = streamRef.current
    }
  }, [])

  const enumerate = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    const video = all.filter((d) => d.kind === 'videoinput')
    setDevices(video)
    if (video.length > 0 && !deviceId) setDeviceId(video[0].deviceId)
  }, [deviceId])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((all) => {
      const video = all.filter((d) => d.kind === 'videoinput')
      if (video.length > 0 && video[0].label) {
        setDevices(video)
        setDeviceId(video[0].deviceId)
        setStatusAndNotify('ready')
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const requestPermission = async () => {
    setStatusAndNotify('requesting')
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      s.getTracks().forEach((t) => t.stop())
      await enumerate()
      setStatusAndNotify('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Permission denied')
      setStatusAndNotify('error')
    }
  }

  const startCapture = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!

    const capture = () => {
      rafRef.current = requestAnimationFrame(capture)
      const video = videoRef.current
      const ws = wsRef.current
      if (!video || ws?.readyState !== WebSocket.OPEN) return
      if (video.videoWidth === 0) return
      const now = Date.now()
      if (now - lastSentRef.current < 200) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob || wsRef.current?.readyState !== WebSocket.OPEN) return
        blob.arrayBuffer().then((buf) => wsRef.current?.send(buf))
      }, 'image/jpeg', 0.7)
      lastSentRef.current = now
    }
    rafRef.current = requestAnimationFrame(capture)
  }, [])

  const stopCapture = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }, [])

  const captureOneFrame = useCallback((ws: WebSocket) => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (blob && ws.readyState === WebSocket.OPEN)
        blob.arrayBuffer().then((buf) => ws.send(buf))
    }, 'image/jpeg', 0.85)
  }, [])

  const stop = useCallback(() => {
    stopCapture()
    wsRef.current?.close()
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatusAndNotify('ready')
  }, [stopCapture, setStatusAndNotify])

  const startStream = useCallback(async () => {
    setError(null)
    try {
      const constraint = deviceId ? { deviceId: { exact: deviceId } } : true
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraint })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setStatusAndNotify('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onopen = () => { setStatusAndNotify('streaming'); startCapture() }
      ws.onclose = () => { stopCapture(); setStatusAndNotify('ready') }
      ws.onerror = () => { setError('WebSocket error — is the satellite running?'); setStatusAndNotify('error') }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return
        const msg = JSON.parse(e.data) as { type: string }
        if (msg.type === 'frame_request') captureOneFrame(ws)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatusAndNotify('error')
    }
  }, [deviceId, wsUrl, startCapture, stopCapture, captureOneFrame, setStatusAndNotify])

  // Nav power switch reactions:
  //   paused/off → stop stream, remember if was active
  //   on         → auto-resume if was streaming, else just unlock UI
  useEffect(() => {
    if (!playState) return
    const s = statusRef.current
    const isActive = s === 'streaming' || s === 'connecting'

    if (playState === 'paused' || playState === 'off') {
      if (isActive) { wasStreamingRef.current = true; stop() }
    } else if (playState === 'on') {
      if (wasStreamingRef.current) void startStream()
      wasStreamingRef.current = false
    }
  }, [playState, stop, startStream])

  useEffect(() => () => {
    stopCapture()
    wsRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [stopCapture])

  // paused or off = locked: all buttons/selects disabled, stream blocked
  const locked = !!playState && playState !== 'on'
  const streaming = status === 'streaming'
  const connecting = status === 'connecting'

  const statusChip = {
    idle: null,
    requesting: <Chip size="small" label="requesting permission..." />,
    ready: <Chip size="small" label="ready" variant="outlined" />,
    connecting: <Chip size="small" label="connecting..." color="warning" />,
    streaming: (
      <Chip
        size="small"
        icon={<FiberManualRecordIcon sx={{ fontSize: '0.6rem !important' }} />}
        label="streaming"
        color="success"
      />
    ),
    error: <Chip size="small" label="error" color="error" />,
  }[status]

  return (
    <Card variant="outlined">
      <CardHeader
        title={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {streaming
              ? <VideocamIcon color="success" fontSize="small" />
              : <VideocamOffIcon color="disabled" fontSize="small" />}
            <Typography variant="subtitle1" fontWeight={600} component="div">
              Browser Camera
            </Typography>
          </Stack>
        }
        action={<Box sx={{ pr: 1, pt: 0.5 }}>{statusChip}</Box>}
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          {status === 'idle' && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Use your browser's webcam as the primary vision source — instant activation, no Python required.
              </Typography>
              <Button variant="outlined" size="small" startIcon={<VideocamIcon />} onClick={requestPermission} disabled={locked}>
                Allow camera access
              </Button>
            </Stack>
          )}

          {(status === 'ready' || streaming || connecting) && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel>Camera</InputLabel>
                  <Select
                    value={deviceId}
                    label="Camera"
                    onChange={(e) => setDeviceId(e.target.value)}
                    disabled={streaming || connecting || locked}
                  >
                    {devices.map((d) => (
                      <MenuItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button size="small" onClick={enumerate} disabled={streaming || connecting || locked} sx={{ minWidth: 0 }}>
                  Rescan
                </Button>
              </Stack>

              <Box
                sx={{
                  borderRadius: 1,
                  overflow: 'hidden',
                  maxWidth: 320,
                  border: '1px solid',
                  borderColor: 'divider',
                  display: streaming || connecting ? 'block' : 'none',
                }}
              >
                <video
                  ref={videoCallbackRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', display: 'block' }}
                />
              </Box>

              {streaming && (
                <Typography variant="caption" color="success.main">
                  Sending frames to JarvYZ at 5 fps — MediaPipe runs on the server.
                </Typography>
              )}

              <Stack direction="row" spacing={1}>
                {!streaming && !connecting && (
                  <Button variant="contained" size="small" startIcon={<VideocamIcon />} onClick={startStream} disabled={locked}>
                    Start streaming
                  </Button>
                )}
                {connecting && <CircularProgress size={20} />}
                {streaming && (
                  <Button variant="outlined" size="small" color="warning" startIcon={<VideocamOffIcon />} onClick={stop} disabled={locked}>
                    Stop streaming
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

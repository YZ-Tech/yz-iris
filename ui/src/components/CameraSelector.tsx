import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import VideocamIcon from '@mui/icons-material/Videocam'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { IrisApi } from '../lib/api'
import type { Camera } from '../types'

interface Props {
  api: IrisApi
  pythonCameras: Camera[]
  selectedIndex: number
  selectedLabel: string
  onSelected: (index: number, label: string) => void
  /** When true the Python CV loop owns the camera — browser preview is unavailable. */
  running?: boolean
}

export function CameraSelector({ api, pythonCameras, selectedIndex, selectedLabel, onSelected, running = false }: Props) {
  // Browser-side device list
  const [browserDevices, setBrowserDevices] = useState<MediaDeviceInfo[]>([])
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const [previewDeviceId, setPreviewDeviceId] = useState<string | null>(null)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Python-side selection
  const [pyIndex, setPyIndex] = useState<number>(selectedIndex)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Request camera permission + enumerate
  const requestPermission = async () => {
    setPermError(null)
    try {
      // Get permission via a temp stream, then stop it
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
      setPermissionGranted(true)
      await enumerateBrowserDevices()
    } catch (e) {
      setPermError(e instanceof Error ? e.message : 'Camera permission denied')
    }
  }

  const enumerateBrowserDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    setBrowserDevices(devices.filter((d) => d.kind === 'videoinput'))
  }

  useEffect(() => {
    // Check if permission already granted (labels available without prompting)
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const video = devices.filter((d) => d.kind === 'videoinput')
      if (video.length > 0 && video[0].label) {
        setPermissionGranted(true)
        setBrowserDevices(video)
      }
    }).catch(() => {})
  }, [])

  // Start preview for selected browser device
  useEffect(() => {
    let active = true
    if (previewDeviceId === null) {
      if (previewStream) { previewStream.getTracks().forEach((t) => t.stop()); setPreviewStream(null) }
      return
    }
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: previewDeviceId } } })
      .then((stream) => {
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return }
        setPreviewStream(stream)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [previewDeviceId])

  // Release browser stream when the Python loop takes the camera
  useEffect(() => {
    if (running) {
      setPreviewDeviceId(null)
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop())
        setPreviewStream(null)
      }
    }
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = previewStream ?? null
    }
    return () => {
      if (previewStream && !previewDeviceId) {
        previewStream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [previewStream, previewDeviceId])

  const selectedBrowserDevice = browserDevices.find((d) => d.deviceId === previewDeviceId)

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    const label = selectedBrowserDevice?.label ?? selectedLabel
    try {
      await api.selectCamera(pyIndex, label)
      onSelected(pyIndex, label)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={2}>
      {/* Browser-side picker */}
      <Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Preview
        </Typography>
        {running ? (
          <Typography variant="caption" color="text.secondary">
            Preview unavailable while the Eyes are watching — camera is owned by the Python loop.
            Stop the Eyes to re-enable the preview.
          </Typography>
        ) : !permissionGranted ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<VideocamIcon />}
            onClick={requestPermission}
          >
            Allow camera access
          </Button>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel>Browser camera</InputLabel>
                <Select
                  value={previewDeviceId ?? ''}
                  label="Browser camera"
                  onChange={(e) => setPreviewDeviceId(e.target.value || null)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {browserDevices.map((d) => (
                    <MenuItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={enumerateBrowserDevices}
                sx={{ minWidth: 0 }}
              >
                Rescan
              </Button>
            </Stack>
            {previewDeviceId && (
              <Box
                sx={{
                  borderRadius: 1,
                  overflow: 'hidden',
                  maxWidth: 320,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', display: 'block' }}
                />
              </Box>
            )}
          </Stack>
        )}
        {!running && permError && <Alert severity="error" sx={{ mt: 1 }}>{permError}</Alert>}
      </Box>

      <Divider />

      {/* Python-side picker */}
      <Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Python camera index
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            (match with the preview above)
          </Typography>
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Python camera</InputLabel>
            <Select
              value={pyIndex}
              label="Python camera"
              onChange={(e) => setPyIndex(Number(e.target.value))}
            >
              {pythonCameras.length === 0 && (
                <MenuItem value={0}>Camera 0 (default)</MenuItem>
              )}
              {pythonCameras.map((c) => (
                <MenuItem key={c.index} value={c.index}>
                  [{c.index}] {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <CircularProgress size={16} /> : 'Use this camera'}
          </Button>
        </Stack>
        {selectedLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Current: [{selectedIndex}] {selectedLabel || '—'}
          </Typography>
        )}
        {saveError && <Alert severity="error" sx={{ mt: 1 }}>{saveError}</Alert>}
      </Box>
    </Stack>
  )
}

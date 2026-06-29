import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { WSContext, useStandaloneWs } from './lib/ws'
import { type IrisApi } from './lib/api'
import { BrowserMPCard } from './components/BrowserMPCard'
import { BrowserSourceCard } from './components/BrowserSourceCard'
import { CameraSelector } from './components/CameraSelector'
import { PresenceWidget } from './components/PresenceWidget'
import { YoloeSetupCard } from './components/YoloeSetupCard'
import type { Camera, IrisState } from './types'

export interface IrisPageProps {
  theme?: Theme
  wsUrl?: string
  api: IrisApi
  playState?: 'on' | 'paused' | 'off'
}

function IrisPageInner({ api, playState }: { api: IrisApi; playState?: 'on' | 'paused' | 'off' }) {
  const [state, setState] = useState<IrisState | null>(null)
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  // paused or off = locked: Python camera switch disabled + auto-stopped
  const locked = !!playState && playState !== 'on'
  const runningRef = useRef(false)
  useEffect(() => { runningRef.current = state?.running ?? false }, [state])
  useEffect(() => {
    if (!playState || playState === 'on') return
    if (runningRef.current) {
      api.stop().then(() => api.state().then(setState).catch(() => {})).catch(() => {})
    }
  }, [playState, api])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, c] = await Promise.all([api.state(), api.cameras()])
      setState(s)
      setCameras(c.cameras)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const id = setInterval(() => {
      api.state().then(setState).catch(() => {})
    }, 3000)
    return () => clearInterval(id)
  }, [api])

  const handleToggle = async () => {
    if (!state) return
    setToggling(true)
    try {
      if (state.running) await api.stop()
      else await api.start()
      const s = await api.state()
      setState(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setToggling(false)
    }
  }

  const handleRescanCameras = async () => {
    try {
      const c = await api.rescanCameras()
      setCameras(c.cameras)
      if (state) setState({ ...state, selected_index: c.selected_index, selected_label: c.selected_label })
    } catch { /* ignore */ }
  }

  const handleCameraSelected = async (index: number, label: string) => {
    const s = await api.state().catch(() => state)
    if (s) setState({ ...s, selected_index: index, selected_label: label })
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  const pythonRunning = state?.running ?? false
  const anyRunning = state?.any_running ?? pythonRunning

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card variant="outlined">
        <CardHeader
          title={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {anyRunning
                ? <VisibilityIcon color="success" fontSize="small" />
                : <VisibilityOffIcon color="disabled" fontSize="small" />}
              <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
                {anyRunning ? 'Iris is watching' : 'Iris is idle'}
              </Typography>
            </Stack>
          }
          subheader={
            anyRunning && !pythonRunning
              ? 'via browser camera'
              : pythonRunning
              ? 'via Python camera'
              : undefined
          }
        />
        {anyRunning && state && (
          <CardContent sx={{ pt: 0 }}>
            <PresenceWidget
              initialPresent={state.present}
              initialPosition={state.position}
              initialGaze={state.gaze}
            />
          </CardContent>
        )}
      </Card>

      <BrowserMPCard
        wsUrl={api.mpWsUrl()}
        playState={playState}
        onStatusChange={(s) => {
          if (s === 'detecting' || s === 'ready') {
            api.state().then(setState).catch(() => {})
          }
        }}
      />

      <BrowserSourceCard
        wsUrl={api.sourceWsUrl('browser')}
        playState={playState}
        onStatusChange={(s) => {
          if (s === 'streaming' || s === 'ready') {
            api.state().then(setState).catch(() => {})
          }
        }}
      />

      <Card variant="outlined">
        <CardHeader
          title={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
                Python Camera
              </Typography>
              <Typography variant="caption" color="text.secondary">(optional fallback)</Typography>
            </Stack>
          }
          action={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pr: 1 }}>
              {toggling && <CircularProgress size={16} />}
              <Switch
                checked={pythonRunning}
                disabled={toggling || locked}
                onChange={handleToggle}
                color="success"
                size="small"
              />
              <Button size="small" onClick={handleRescanCameras} disabled={locked} sx={{ mt: 0.5 }}>
                Rescan
              </Button>
            </Stack>
          }
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600, component: 'div' }}
        />
        <CardContent sx={{ pt: 0 }}>
          <CameraSelector
            api={api}
            pythonCameras={cameras}
            selectedIndex={state?.selected_index ?? 0}
            selectedLabel={state?.selected_label ?? ''}
            onSelected={handleCameraSelected}
            running={pythonRunning}
          />
        </CardContent>
      </Card>

      <YoloeSetupCard api={api} />
    </Stack>
  )
}

export function IrisPage({ theme: hostTheme, wsUrl, api, playState }: IrisPageProps) {
  const ws = useStandaloneWs(wsUrl)

  const localTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: hostTheme?.palette?.mode ?? 'dark',
          ...(hostTheme?.palette?.primary != null && { primary: hostTheme.palette.primary }),
          ...(hostTheme?.palette?.secondary != null && { secondary: hostTheme.palette.secondary }),
        },
      }),
    [hostTheme?.palette?.mode, hostTheme?.palette?.primary, hostTheme?.palette?.secondary],
  )

  return (
    <ThemeProvider theme={localTheme}>
      <WSContext.Provider value={ws}>
        <IrisPageInner api={api} playState={playState} />
      </WSContext.Provider>
    </ThemeProvider>
  )
}

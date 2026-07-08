import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Collapse,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { WSContext, adaptHostWs, useStandaloneWs, type HostWSApi } from './lib/ws'
import { type IrisApi } from './lib/api'
import { useYoloe } from './lib/useYoloe'
import { BrowserMPCard } from './components/BrowserMPCard'
import { CameraSelector } from './components/CameraSelector'
import { setMpAssetBase } from './components/mpModels'
import { PowerStrip } from './components/PowerStrip'
import { PresenceWidget } from './components/PresenceWidget'
import { SceneTools } from './components/SceneTools'
import { SourceSelector } from './components/SourceSelector'
import { YoloeSetupCard } from './components/YoloeSetupCard'
import type { Camera, IrisState } from './types'

export interface IrisPageProps {
  theme?: Theme
  /** Host-injected core `/ws` bus (JarvYZ embedded mode). When present, iris
   *  rides the shared bus — no direct socket to the satellite port. Omit for
   *  the standalone SPA, which opens its own `/events` socket. */
  wsApi?: HostWSApi
  api: IrisApi
  playState?: 'on' | 'paused' | 'off'
}

type Compute = 'watch' | 'live'

function IrisPageInner({ api, playState }: { api: IrisApi; playState?: 'on' | 'paused' | 'off' }) {
  const [state, setState] = useState<IrisState | null>(null)
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [compute, setCompute] = useState<Compute>('watch')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const yoloe = useYoloe(api)

  // paused or off = locked: Python camera auto-stopped (cams can't run when the
  // nav power is not 'on'). The per-source cards handle their own lock UI.
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

      {/* Power strip — page-top tri-state, parity with every other body
          part. Embedded mode only (the host injects playState; standalone
          has no core power endpoint to write to). Inside the Unreal CEF
          panel this is the ONLY way to power Eyes. */}
      {playState && <PowerStrip value={playState} />}

      {/* TOP — always visible: what Iris currently sees, source-agnostic. */}
      <Card variant="outlined">
        <CardHeader
          title={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {anyRunning
                ? <VisibilityIcon color="success" fontSize="small" />
                : <VisibilityOffIcon color="disabled" fontSize="small" />}
              <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
                {anyRunning ? 'Eyes are watching' : 'Eyes are idle'}
              </Typography>
            </Stack>
          }
          subheader={
            anyRunning && !pythonRunning
              ? 'via browser camera'
              : pythonRunning
              ? 'via Python camera'
              : 'pick a source below to begin'
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

      {/* COMPUTE layer — where processing happens. Watch (backend, daily) vs Live
          (browser WASM overlays). Tabs imply exclusive modes; both feed the chips. */}
      <Box>
        <Tabs
          value={compute}
          onChange={(_, v: Compute) => setCompute(v)}
          variant="fullWidth"
        >
          <Tab value="watch" label="Watch" />
          <Tab value="live" label="Live" />
        </Tabs>
        <Box sx={{ pt: 2 }}>
          {compute === 'watch' ? (
            <Stack spacing={2}>
              <Card variant="outlined">
                <CardHeader
                  title="Source"
                  subheader="Where pixels come from — backend processes any of them"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                />
                <CardContent sx={{ pt: 0 }}>
                  <SourceSelector
                    api={api}
                    state={state}
                    playState={playState}
                    onStateChange={setState}
                  />
                </CardContent>
              </Card>

              <Card variant="outlined">
                <CardHeader
                  title="Scene detection"
                  subheader="Open-vocabulary: scan the room or find a specific thing"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                />
                <CardContent sx={{ pt: 0 }}>
                  <SceneTools
                    api={api}
                    available={yoloe.available}
                    onOpenAdvanced={() => setAdvancedOpen(true)}
                  />
                </CardContent>
              </Card>
            </Stack>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Realtime detection runs entirely in your browser (WebAssembly) and draws
                live overlays — nothing is uploaded. Requires the browser camera.
              </Typography>
              <BrowserMPCard
                wsUrl={api.mpWsUrl()}
                playState={playState}
                onStatusChange={(s) => {
                  if (s === 'detecting' || s === 'ready') {
                    api.state().then(setState).catch(() => {})
                  }
                }}
              />
            </Stack>
          )}
        </Box>
      </Box>

      {/* ADVANCED — setup + tuning, tucked away. */}
      <Box>
        <Button
          size="small"
          color="inherit"
          onClick={() => setAdvancedOpen((o) => !o)}
          endIcon={advancedOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ color: 'text.secondary' }}
        >
          Advanced
        </Button>
        <Collapse in={advancedOpen}>
          <Card variant="outlined" sx={{ mt: 1 }}>
            <CardContent>
              <Stack spacing={2}>
                <YoloeSetupCard yoloe={yoloe} />

                <Divider />

                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Python camera
                    </Typography>
                    <Button size="small" onClick={handleRescanCameras}>Rescan</Button>
                  </Stack>
                  <CameraSelector
                    api={api}
                    pythonCameras={cameras}
                    selectedIndex={state?.selected_index ?? 0}
                    selectedLabel={state?.selected_label ?? ''}
                    onSelected={handleCameraSelected}
                    running={pythonRunning}
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Collapse>
      </Box>
    </Stack>
  )
}

export function IrisPage({ theme: hostTheme, wsApi, api, playState }: IrisPageProps) {
  // Embedded (host wsApi present): ride the core `/ws` bus via the unwrap
  // adapter, and keep the standalone socket hook dormant. Standalone (no
  // wsApi): open our own `/events` socket. The hook is always called
  // (rules-of-hooks) but only connects when there's no host bus.
  const standaloneWs = useStandaloneWs(undefined, !wsApi)
  const hostWs = useMemo(() => (wsApi ? adaptHostWs(wsApi) : null), [wsApi])
  const ws = hostWs ?? standaloneWs

  // MediaPipe assets ride core's /api/iris proxy when embedded (core's wheel
  // does not ship them); the standalone SPA serves them itself. '/api/iris'
  // is the manifest's stable proxy prefix. See mpModels.setMpAssetBase.
  useEffect(() => {
    setMpAssetBase(wsApi ? '/api/iris' : '')
  }, [wsApi])

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

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { IrisApi } from '../lib/api'
import type { LookResult, ScanResult, YoloeStatus } from '../types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const pct = (c: number) => `${Math.round(c * 100)}%`

// Setup + scene tools for the open-vocabulary engine. The engine (Ultralytics
// YOLOE, AGPL-3.0) is NOT bundled — this card installs it into the satellite's
// venv on explicit user action (background install, polled). Once ready it also
// exposes one-shot Scan room / Find controls that auto-manage the camera:
// if it was off they turn it on, run detection, and turn it back off again
// (a glance never leaves the eye open). If it was already on, it stays on.
export function YoloeSetupCard({ api }: { api: IrisApi }) {
  const [status, setStatus] = useState<YoloeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Scene-tool state.
  const [focus, setFocus] = useState('')
  const [tool, setTool] = useState<'scan' | 'look' | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [look, setLook] = useState<LookResult | null>(null)
  const [toolErr, setToolErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.yoloeStatus())
    } catch (e) {
      setErr(msg(e))
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!status?.installing) return
    const id = window.setInterval(() => { void refresh() }, 3000)
    return () => window.clearInterval(id)
  }, [status?.installing, refresh])

  const onInstall = async () => {
    setErr(null)
    setBusy(true)
    try {
      const r = await api.yoloeInstall()
      if (!r.ok && r.error) setErr(r.error)
      await refresh()
    } catch (e) {
      setErr(msg(e))
    } finally {
      setBusy(false)
    }
  }

  // Run a detection with the camera auto-managed: turn it on if it was off,
  // retry through the warm-up (the first frame can take several seconds), then
  // restore the camera to its prior state.
  const withCamera = useCallback(
    async <T extends { ok: boolean }>(run: () => Promise<T>): Promise<T> => {
      const st = await api.state()
      const wasOn = st.any_running
      if (!wasOn) {
        setPhase('starting camera…')
        await api.start()
        try { await api.activateSource('python') } catch { /* ok */ }
      }
      let res = await run()
      let tries = 0
      while (!res.ok && tries < 10) {
        setPhase('waiting for the camera to warm up…')
        await sleep(2000)
        res = await run()
        tries += 1
      }
      setPhase(null)
      if (!wasOn) { try { await api.stop() } catch { /* ok */ } }
      return res
    },
    [api],
  )

  const runScan = async () => {
    setToolErr(null); setLook(null); setScan(null); setTool('scan')
    try {
      const r = await withCamera(() => api.scanRoom())
      setScan(r)
      if (!r.ok) setToolErr(r.text || 'Scan failed.')
    } catch (e) {
      setToolErr(msg(e))
    } finally {
      setTool(null); setPhase(null)
    }
  }

  const runLook = async () => {
    const f = focus.trim()
    if (!f) return
    setToolErr(null); setScan(null); setLook(null); setTool('look')
    try {
      const r = await withCamera(() => api.look(f))
      setLook(r)
      if (!r.ok) setToolErr(r.text || 'Find failed.')
    } catch (e) {
      setToolErr(msg(e))
    } finally {
      setTool(null); setPhase(null)
    }
  }

  const available = status?.available
  const installing = !!status?.installing || busy

  return (
    <Card variant="outlined">
      <CardHeader
        title="Scene detection (YOLOE)"
        subheader="Open-vocabulary objects for look(focus) and scan_room"
        action={
          available ? (
            <Chip label="ready" color="success" size="small" />
          ) : installing ? (
            <Chip label="installing" color="warning" size="small" />
          ) : (
            <Chip label="not installed" size="small" />
          )
        }
      />
      <CardContent>
        {available ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Engine ready. Scan room lists everything visible; Find locates a specific
              thing. The camera turns on for the shot and back off if it was off.
            </Typography>

            <Divider />

            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
              <Button
                variant="outlined"
                onClick={runScan}
                disabled={!!tool}
                sx={{ minWidth: 116 }}
              >
                {tool === 'scan' ? <CircularProgress size={16} /> : 'Scan room'}
              </Button>
              <TextField
                size="small"
                placeholder="find… e.g. my keys"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runLook() }}
                disabled={!!tool}
                sx={{ flex: 1, minWidth: 160 }}
              />
              <Button
                variant="outlined"
                onClick={runLook}
                disabled={!!tool || !focus.trim()}
                sx={{ minWidth: 88 }}
              >
                {tool === 'look' ? <CircularProgress size={16} /> : 'Find'}
              </Button>
            </Stack>

            {phase && (
              <Typography variant="caption" color="text.secondary">{phase}</Typography>
            )}

            {scan && scan.ok && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {scan.count} object{scan.count === 1 ? '' : 's'} in frame
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
                  {scan.objects.map((o, i) => (
                    <Chip key={i} size="small" variant="outlined" label={`${o.label} ${pct(o.conf)}`} />
                  ))}
                </Stack>
              </Box>
            )}

            {look && look.ok && (
              <Box>
                <Chip
                  size="small"
                  color={look.found ? 'success' : 'default'}
                  label={look.found ? `found ${focus.trim()}` : `no ${focus.trim()} in frame`}
                />
                {look.found && (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
                    {look.objects.map((o, i) => (
                      <Chip key={i} size="small" variant="outlined" label={`${o.label} ${pct(o.conf)}`} />
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {toolErr && <Alert severity="warning">{toolErr}</Alert>}
          </Stack>
        ) : installing ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Installing the engine into the satellite environment — this can take a
              minute or two. The page will update when it is ready.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Adds open-vocabulary object and scene detection. Not bundled — clicking
              Install pulls the{' '}
              <Link
                href="https://github.com/ultralytics/ultralytics"
                target="_blank"
                rel="noreferrer"
              >
                Ultralytics YOLOE
              </Link>{' '}
              engine (license: <strong>AGPL-3.0</strong>) into this satellite&apos;s
              environment. Nothing is downloaded until you click.
            </Typography>
            <Box>
              <Button variant="contained" onClick={onInstall} disabled={busy}>
                Install YOLOE
              </Button>
            </Box>
            {status?.install_error && (
              <Alert severity="error">Install failed: {status.install_error}</Alert>
            )}
          </Stack>
        )}
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
      </CardContent>
    </Card>
  )
}

import { useCallback, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { IrisApi } from '../lib/api'
import type { LookResult, ScanResult } from '../types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const pct = (c: number) => `${Math.round(c * 100)}%`

// On-demand open-vocabulary scene tools (Scan room / Find), source-agnostic:
// they run off whatever source is active. The camera is auto-managed — if it
// was off it turns on for the shot and back off afterwards; a glance never
// leaves the eye open. Shown in the Watch tab once the YOLOE engine is ready;
// otherwise a hint points to Advanced where it is installed.
export function SceneTools({
  api,
  available,
  onOpenAdvanced,
}: {
  api: IrisApi
  available: boolean
  onOpenAdvanced?: () => void
}) {
  const [focus, setFocus] = useState('')
  const [tool, setTool] = useState<'scan' | 'look' | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [look, setLook] = useState<LookResult | null>(null)
  const [toolErr, setToolErr] = useState<string | null>(null)

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

  if (!available) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Scan room and Find need the open-vocabulary engine (YOLOE). Enable it once
          under Advanced — then these tools light up here.
        </Typography>
        {onOpenAdvanced && (
          <Box>
            <Button size="small" variant="outlined" onClick={onOpenAdvanced}>
              Open Advanced
            </Button>
          </Box>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Scan room lists everything visible; Find locates a specific thing. The camera
        turns on for the shot and back off if it was off.
      </Typography>

      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Button variant="outlined" onClick={runScan} disabled={!!tool} sx={{ minWidth: 116 }}>
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

      {phase && <Typography variant="caption" color="text.secondary">{phase}</Typography>}

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
  )
}

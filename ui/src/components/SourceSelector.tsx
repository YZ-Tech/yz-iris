import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ComputerIcon from '@mui/icons-material/Computer'
import VideocamIcon from '@mui/icons-material/Videocam'
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone'
import type { IrisApi } from '../lib/api'
import type { IrisState } from '../types'
import { BrowserSourceCard } from './BrowserSourceCard'

type SourceId = 'browser' | 'python' | 'mobile'

// The Source layer of the Watch (backend) tab: pick where pixels come from, then
// show only that source's controls. Backend compute consumes any source, so this
// is a free choice. Camera index + preview for the Python source live in Advanced;
// here it is just an on/off for the server-side capture loop.
export function SourceSelector({
  api,
  state,
  playState,
  onStateChange,
}: {
  api: IrisApi
  state: IrisState | null
  playState?: 'on' | 'paused' | 'off'
  onStateChange?: (s: IrisState) => void
}) {
  const locked = !!playState && playState !== 'on'
  const [source, setSource] = useState<SourceId>('browser')
  const [toggling, setToggling] = useState(false)
  const initRef = useRef(false)

  // Pick a sensible initial source from live state, once.
  useEffect(() => {
    if (initRef.current || !state) return
    initRef.current = true
    if (state.running) setSource('python')
    else if (state.mobile_connected) setSource('mobile')
    else setSource('browser')
  }, [state])

  const pythonRunning = state?.running ?? false

  const togglePython = async () => {
    setToggling(true)
    try {
      if (pythonRunning) await api.stop()
      else await api.start()
      const s = await api.state()
      onStateChange?.(s)
    } catch { /* surfaced by the page-level error path on next poll */ }
    finally { setToggling(false) }
  }

  return (
    <Stack spacing={1.5}>
      <ToggleButtonGroup
        exclusive
        size="small"
        color="primary"
        value={source}
        onChange={(_, v: SourceId | null) => { if (v) setSource(v) }}
        disabled={locked}
      >
        <ToggleButton value="browser">
          <VideocamIcon fontSize="small" sx={{ mr: 0.75 }} /> Browser cam
        </ToggleButton>
        <ToggleButton value="python">
          <ComputerIcon fontSize="small" sx={{ mr: 0.75 }} /> Python cam
        </ToggleButton>
        <ToggleButton value="mobile">
          <PhoneIphoneIcon fontSize="small" sx={{ mr: 0.75 }} /> Mobile
        </ToggleButton>
      </ToggleButtonGroup>

      {source === 'browser' && (
        <BrowserSourceCard
          wsUrl={api.sourceWsUrl('browser')}
          playState={playState}
          onStatusChange={(s) => {
            if (s === 'streaming' || s === 'ready') api.state().then((st) => onStateChange?.(st)).catch(() => {})
          }}
        />
      )}

      {source === 'python' && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {toggling && <CircularProgress size={16} />}
            <Button
              variant={pythonRunning ? 'outlined' : 'contained'}
              color={pythonRunning ? 'warning' : 'primary'}
              size="small"
              onClick={togglePython}
              disabled={toggling || locked}
            >
              {pythonRunning ? 'Stop Python camera' : 'Start Python camera'}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {pythonRunning
                ? `watching via ${state?.selected_label || `camera ${state?.selected_index ?? 0}`}`
                : 'server-side OpenCV capture'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Pick which camera and preview it under Advanced.
          </Typography>
        </Box>
      )}

      {source === 'mobile' && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
          <Typography variant="body2" color={state?.mobile_connected ? 'success.main' : 'text.secondary'}>
            {state?.mobile_connected
              ? 'A mobile camera is connected and streaming.'
              : 'No mobile camera connected.'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Open this satellite on your phone and start its camera to stream frames here.
          </Typography>
        </Box>
      )}
    </Stack>
  )
}

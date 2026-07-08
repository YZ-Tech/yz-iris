import { useState } from 'react'
import {
  Card,
  CardContent,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import PauseIcon from '@mui/icons-material/Pause'
import PowerOffIcon from '@mui/icons-material/PowerOff'

type PowerState = 'on' | 'paused' | 'off'

/** Per-state notice copy — iris power semantics (see the satellite README):
 *  on = sources run; paused = cams stopped, models resident; off = teardown. */
const NOTICE: Partial<Record<PowerState, string>> = {
  paused:
    'Paused — all camera sources stopped; browser MediaPipe models stay GPU-resident for instant resume.',
  off: 'Off — full teardown: Python camera loop stopped, browser WASM models closed.',
}

interface PowerStripProps {
  /** Host-injected live power state — reactive (the host store updates it on
   *  satellite_power events, so a POST below flows back in as a new prop). */
  value: PowerState
}

/** Eyes power control — the satellite-page twin of core's body-part
 *  SubsystemPowerControl (parity by imitation; core's component can't cross
 *  the IIFE boundary). Every body-part page shows its tri-state at the top
 *  except Eyes did not — and inside the Unreal CEF panel there is no navbar
 *  switch, so this strip is the ONLY in-game way to power Eyes (2026-07-08).
 *  Writes core's generic satellite-power endpoint (same-origin; the strip is
 *  only mounted in embedded mode, where the host supplies `playState`). */
export function PowerStrip({ value }: PowerStripProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notice = NOTICE[value]

  const set = async (next: PowerState) => {
    setPending(true)
    setError(null)
    try {
      const r = await fetch('/api/satellites/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'iris', state: next }),
      })
      if (!r.ok) throw new Error(`power change failed (${r.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Stack>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Eyes power
            </Typography>
            <Typography variant="caption" color="text.secondary">
              On · Pause (instant resume) · Off (full teardown, persists)
            </Typography>
          </Stack>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={value}
            disabled={pending}
            onChange={(_e, next: PowerState | null) => {
              // exclusive groups emit null when the active button is
              // re-clicked; ignore so the control never lands empty.
              if (next) void set(next)
            }}
            sx={{ '& .MuiToggleButton-root': { px: 0.9 } }}
          >
            <Tooltip title="On — sources run; auto-resumes the last active state">
              <ToggleButton value="on" color="success" aria-label="On">
                <PowerSettingsNewIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Paused — cameras stopped; models stay resident for instant resume">
              <ToggleButton value="paused" color="warning" aria-label="Pause">
                <PauseIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Off — full teardown; survives restart">
              <ToggleButton value="off" color="error" aria-label="Off">
                <PowerOffIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Stack>
        {(notice || error) && (
          <Typography
            variant="caption"
            color={error ? 'error' : 'text.secondary'}
            sx={{ display: 'block', mt: 1 }}
          >
            {error ?? notice}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

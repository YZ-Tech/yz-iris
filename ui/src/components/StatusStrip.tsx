import { useEffect, useState } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { GazeEvent, PresenceEvent } from '../types'
import { useSubscription } from '../lib/ws'

interface Props {
  anyRunning: boolean
  pythonRunning: boolean
  initialPresent: boolean
  initialPosition: string
  initialGaze: string
}

/** Slim always-on status strip — the host page's VRAM-strip sibling (same
 *  outlined one-row treatment): what the eyes are doing right now,
 *  source-agnostic. Replaced the old status CARD (2026-07-10): a readout
 *  doesn't earn card chrome — a two-line header plus a presence row of
 *  mostly air became one dense line. Live presence/gaze chips on the right
 *  (absorbed from the retired PresenceWidget). */
export function StatusStrip({
  anyRunning,
  pythonRunning,
  initialPresent,
  initialPosition,
  initialGaze,
}: Props) {
  const [present, setPresent] = useState(initialPresent)
  const [position, setPosition] = useState(initialPosition)
  const [gaze, setGaze] = useState(initialGaze)

  useEffect(() => {
    setPresent(initialPresent)
    setPosition(initialPosition)
    setGaze(initialGaze)
  }, [initialPresent, initialPosition, initialGaze])

  useSubscription<PresenceEvent>('presence', (d) => {
    setPresent(d.present)
    setPosition(d.position)
  })

  useSubscription<GazeEvent>('gaze', (d) => {
    setGaze(d.target)
  })

  const gazeLabel = { screen: 'at screen', away: 'looking away', unknown: 'unknown' }[gaze] ?? gaze
  const source = anyRunning ? (pythonRunning ? 'Python camera' : 'browser camera') : null

  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.25,
        py: 0.5,
        minHeight: 36,
        boxSizing: 'border-box',
      }}
    >
      {anyRunning ? (
        <VisibilityIcon color="success" fontSize="small" />
      ) : (
        <VisibilityOffIcon color="disabled" fontSize="small" />
      )}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {anyRunning ? 'Watching' : 'Idle'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {source ? `· ${source}` : '— pick a source below to begin'}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {anyRunning &&
        (present ? (
          <>
            <Chip size="small" variant="outlined" label={`position: ${position}`} />
            <Chip
              size="small"
              variant="outlined"
              color={gaze === 'screen' ? 'success' : gaze === 'away' ? 'warning' : 'default'}
              label={`gaze: ${gazeLabel}`}
            />
          </>
        ) : (
          <Chip size="small" variant="outlined" label="no one detected" />
        ))}
    </Stack>
  )
}

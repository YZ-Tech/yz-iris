import { useEffect, useState } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { GazeEvent, PresenceEvent } from '../types'
import { useSubscription } from '../lib/ws'

interface Props {
  initialPresent: boolean
  initialPosition: string
  initialGaze: string
}

export function PresenceWidget({ initialPresent, initialPosition, initialGaze }: Props) {
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

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        {present ? (
          <VisibilityIcon color="success" fontSize="small" />
        ) : (
          <VisibilityOffIcon color="disabled" fontSize="small" />
        )}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {present ? 'Person in frame' : 'No one detected'}
        </Typography>
      </Stack>
      {present && (
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Chip
            size="small"
            label={`position: ${position}`}
            variant="outlined"
            color="default"
          />
          <Chip
            size="small"
            label={`gaze: ${gazeLabel}`}
            variant="outlined"
            color={gaze === 'screen' ? 'success' : gaze === 'away' ? 'warning' : 'default'}
          />
        </Stack>
      )}
    </Box>
  )
}

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import type { UseYoloe } from '../lib/useYoloe'

// Install + status for the open-vocabulary engine (Ultralytics YOLOE, AGPL-3.0).
// The engine is NOT bundled — this card installs it into the satellite's venv on
// explicit user action (background install, polled). It lives under Advanced; the
// scene tools it powers (Scan room / Find) surface in the Watch tab via SceneTools.
export function YoloeSetupCard({ yoloe }: { yoloe: UseYoloe }) {
  const { status, available, installing, busy, error, install } = yoloe

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Scene detection engine (YOLOE)
        </Typography>
        {available ? (
          <Chip label="ready" color="success" size="small" />
        ) : installing ? (
          <Chip label="installing" color="warning" size="small" />
        ) : (
          <Chip label="not installed" size="small" />
        )}
      </Stack>

      {available ? (
        <Typography variant="body2" color="text.secondary">
          Engine ready. Scan room and Find are available in the Watch tab.
        </Typography>
      ) : installing ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Installing the engine into the satellite environment — this can take a
            minute or two. It will update when ready.
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
            <Button variant="contained" onClick={() => void install()} disabled={busy}>
              Install YOLOE
            </Button>
          </Box>
          {status?.install_error && (
            <Alert severity="error">Install failed: {status.install_error}</Alert>
          )}
        </Stack>
      )}
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
    </Box>
  )
}

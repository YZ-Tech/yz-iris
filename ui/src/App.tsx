// Standalone SPA entry — used by `vite dev` and `vite build --mode pages`.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { IrisPage } from './IrisPage'
import { createIrisApi } from './lib/api'

const api = createIrisApi({ apiBase: '' })

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c4dff' },
    background: { default: '#0d0d12', paper: '#15151c' },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <strong style={{ fontSize: '1.1rem' }}>Iris</strong>
          <span style={{ fontSize: '0.75rem', opacity: 0.5, marginLeft: 8 }}>
            visual awareness · standalone
          </span>
        </div>
        <IrisPage api={api} theme={theme} />
      </div>
    </ThemeProvider>
  </StrictMode>,
)

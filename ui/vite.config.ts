import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { makeLibConfig } from './scripts/vite-lib.mjs'

// The IIFE lib recipe is the CANONICAL shared one (slug + global name
// derived from ../manifest.json) — see satellites/_ui-tooling/README.md.
const libConfig: UserConfig = makeLibConfig(import.meta.url, react)

const SAT = process.env.VITE_SATELLITE_URL || 'http://127.0.0.1:9007'

const pagesConfig: UserConfig = {
  plugins: [react()],
  server: {
    port: 5187,
    host: '127.0.0.1',
    proxy: {
      '/health': SAT,
      '/cameras': SAT,
      '/state': SAT,
      '/start': { target: SAT, changeOrigin: true },
      '/stop': { target: SAT, changeOrigin: true },
      '/setup': SAT,
      '/tools': SAT,
      '/sources': { target: SAT, ws: true, changeOrigin: true },
      '/mp': { target: SAT, ws: true, changeOrigin: true },
      '/cam': SAT,
      '/events': { target: SAT, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../yz_iris/static', import.meta.url)),
    emptyOutDir: true,
  },
}

export default defineConfig(({ mode }) => (mode === 'lib' ? libConfig : pagesConfig))

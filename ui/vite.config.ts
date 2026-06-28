import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const libConfig: UserConfig = {
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'YzIris',
      formats: ['iife'],
      fileName: () => 'yz-iris.iife.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: { react: 'React', 'react-dom': 'ReactDOM' },
        exports: 'named',
        extend: true,
        banner:
          'var require = function(id) {' +
          ' if (id === "react") return window.React;' +
          ' if (id === "react-dom") return window.ReactDOM;' +
          ' throw new Error("require not handled: " + id);' +
          ' };',
      },
    },
  },
}

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

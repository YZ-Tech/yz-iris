#!/usr/bin/env node
import { copyFileSync, cpSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const projectRoot = resolve(root, '..', '..', '..')

const iife = resolve(root, 'dist-lib', 'yz-iris.iife.js')
const manifestSrc = resolve(root, '..', 'manifest.json')

try {
  statSync(iife)
} catch {
  console.error(`x ${iife} not found. Run \`npm run build:lib\` first.`)
  process.exit(1)
}

// Destinations
const modulesDirs = [
  resolve(projectRoot, 'frontend', 'public', 'modules'),
  resolve(projectRoot, 'backend', 'jarvyz', 'web', 'static', 'modules'),
]

// Copy IIFE + manifest
console.log(`+ ${iife}`)
for (const dst of modulesDirs.map((d) => join(d, 'yz-iris.iife.js'))) {
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(iife, dst)
  const { size } = statSync(dst)
  console.log(`  -> ${dst}`)
  console.log(`     ${(size / 1024).toFixed(1)} KB`)
}

console.log(`+ ${manifestSrc}`)
for (const dst of modulesDirs.map((d) => join(d, 'yz-iris.manifest.json'))) {
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(manifestSrc, dst)
  console.log(`  -> ${dst}`)
}

// Copy MediaPipe assets into modules/yz-iris-mp/
// so the IIFE can dynamic-import them at runtime.
const mpPkg = resolve(root, 'node_modules', '@mediapipe', 'tasks-vision')
const mpBundle = resolve(mpPkg, 'vision_bundle.mjs')
const mpWasm = resolve(mpPkg, 'wasm')
const mpModel = resolve(root, 'blaze_face_short_range.tflite')
const mpObjModel = resolve(root, 'efficientdet_lite0.tflite')

for (const modulesDir of modulesDirs) {
  const dst = resolve(modulesDir, 'yz-iris-mp')
  mkdirSync(resolve(dst, 'wasm'), { recursive: true })

  copyFileSync(mpBundle, resolve(dst, 'vision_bundle.mjs'))
  copyFileSync(mpModel, resolve(dst, 'blaze_face_short_range.tflite'))
  copyFileSync(mpObjModel, resolve(dst, 'efficientdet_lite0.tflite'))

  for (const f of readdirSync(mpWasm)) {
    copyFileSync(resolve(mpWasm, f), resolve(dst, 'wasm', f))
  }

  console.log(`+ yz-iris-mp/ -> ${dst}`)
  const sizes = ['vision_bundle.mjs', 'blaze_face_short_range.tflite',
    ...readdirSync(mpWasm)].map((f) => {
    const full = f.startsWith('vision') && !f.endsWith('.tflite')
      ? resolve(dst, 'wasm', f) : resolve(dst, f)
    try { return `${f}: ${(statSync(full).size / 1024).toFixed(0)} KB` } catch { return f }
  })
  console.log(`  ${sizes.join(', ')}`)
}

#!/usr/bin/env node
// Copies MediaPipe WASM assets into yz_iris/static/modules/yz-iris-mp/ so the
// standalone satellite SPA can load them at /modules/yz-iris-mp/*.
// Run after `vite build --mode pages` (the static dir must already exist).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')  // satellites/yz-iris/ui/

const mpPkg = resolve(root, 'node_modules', '@mediapipe', 'tasks-vision')
const mpWasm = resolve(mpPkg, 'wasm')
const mpModel = resolve(root, 'blaze_face_short_range.tflite')
const dst = resolve(root, '..', 'yz_iris', 'static', 'modules', 'yz-iris-mp')

mkdirSync(resolve(dst, 'wasm'), { recursive: true })
copyFileSync(resolve(mpPkg, 'vision_bundle.mjs'), resolve(dst, 'vision_bundle.mjs'))
copyFileSync(mpModel, resolve(dst, 'blaze_face_short_range.tflite'))
for (const f of readdirSync(mpWasm)) {
  copyFileSync(resolve(mpWasm, f), resolve(dst, 'wasm', f))
}
console.log(`+ yz-iris-mp/ -> ${dst}`)

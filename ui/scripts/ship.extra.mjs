// yz-iris ship extras — invoked by the CANONICAL install-to-frontend.mjs
// after the standard IIFE+manifest copy. This file is satellite-OWNED (not
// synced): copies the MediaPipe runtime (wasm bundle from the
// @mediapipe/tasks-vision npm package + the two bundled .tflite models from
// ui/) into modules/yz-iris-mp/ so the IIFE can dynamic-import them.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export default async function shipExtra({ uiRoot, modulesDirs }) {
  const mpPkg = resolve(uiRoot, 'node_modules', '@mediapipe', 'tasks-vision')
  const mpBundle = resolve(mpPkg, 'vision_bundle.mjs')
  const mpWasm = resolve(mpPkg, 'wasm')
  const mpModel = resolve(uiRoot, 'blaze_face_short_range.tflite')
  const mpObjModel = resolve(uiRoot, 'efficientdet_lite0.tflite')

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
}

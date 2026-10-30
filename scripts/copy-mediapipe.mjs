// Copies MediaPipe's vision wasm from node_modules into public/mediapipe/,
// so exo.cafe serves it itself instead of fetching it from a CDN. Only the
// SIMD build: every current browser has wasm SIMD. Runs before dev and build.
import fs from 'node:fs'

const from = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url)
const to = new URL('../public/mediapipe/', import.meta.url)
fs.mkdirSync(to, { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  fs.copyFileSync(new URL(f, from), new URL(f, to))
}

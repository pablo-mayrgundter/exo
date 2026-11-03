// Max's words: Kokoro-82M, a small neural text-to-speech model (Apache-2.0
// weights), run in this worker so synthesis never stutters the bar.
//
// It's loaded at runtime from a CDN, only when someone turns Max's words
// on, and never bundled: kokoro-js phonemizes with eSpeak NG, which is
// GPL-3.0, and exo's own code and build stay free of it.
//
// Speed: on WebGPU (fp32 weights, ~330 MB once) it's quick; on WebAssembly
// (8-bit weights, ~90 MB) it's single-threaded here, since GitHub Pages
// can't send the cross-origin-isolation headers threads need, so slow.
// WebGPU is tried first. A warm-up line right after loading keeps the
// first real one from paying for startup, and requests run one at a time
// (the model doesn't take two at once).

const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js'

// onnxruntime logs its warnings (graph nodes assigned to the CPU, and how to
// see which) through console.error: not errors, and nothing to act on.
const consoleError = console.error.bind(console)
console.error = (...args) => {
  if (typeof args[0] === 'string' && /\[W:onnxruntime/.test(args[0])) return console.debug(...args)
  consoleError(...args)
}
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let tts = null
let loading = null
let device = null
let chain = Promise.resolve() // one generation at a time

async function canWebGPU() {
  try { return !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter())) } catch { return false }
}

async function load() {
  const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO)
  const progress = (p) => {
    if (p?.status === 'progress' && p.total) postMessage({ type: 'progress', loaded: p.loaded, total: p.total, file: p.file })
  }
  const tries = (await canWebGPU()) ? [['webgpu', 'fp32'], ['wasm', 'q8']] : [['wasm', 'q8']]
  let last = null
  for (const [dev, dtype] of tries) {
    try {
      postMessage({ type: 'device', device: dev, mb: dtype === 'fp32' ? 330 : 90 })
      tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device: dev, progress_callback: progress })
      device = dev
      break
    } catch (e) { last = e }
  }
  if (!tts) throw last ?? new Error('no device')
  await tts.generate('Hm.', { voice: 'am_michael' }) // warm up: compile, allocate
}

onmessage = (e) => {
  const m = e.data ?? {}
  if (m.type === 'load') {
    ;(async () => {
      try {
        loading ??= load()
        await loading
        postMessage({ type: 'ready', device })
      } catch (err) {
        loading = null
        postMessage({ type: 'error', message: String(err?.message ?? err) })
      }
    })()
  } else if (m.type === 'say') {
    chain = chain.then(async () => {
      try {
        if (!loading) throw new Error('not loaded')
        await loading
        const t0 = performance.now()
        const out = await tts.generate(String(m.text).slice(0, 400), { voice: m.voice ?? 'am_michael', speed: m.speed ?? 1 })
        const samples = out.audio
        postMessage({ type: 'audio', id: m.id, samples, rate: out.sampling_rate, ms: performance.now() - t0 }, [samples.buffer])
      } catch (err) {
        postMessage({ type: 'error', id: m.id, message: String(err?.message ?? err) })
      }
    })
  }
}

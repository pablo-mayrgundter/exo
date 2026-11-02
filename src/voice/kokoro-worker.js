// Max's words: Kokoro-82M, a small neural text-to-speech model (Apache-2.0
// weights), run in this worker so synthesis never stutters the bar.
//
// It's loaded at runtime from a CDN, only when someone turns Max's words
// on, and never bundled: kokoro-js phonemizes with eSpeak NG, which is
// GPL-3.0, and exo's own code and build stay free of it. The weights (~90
// MB at 8 bits) come from Hugging Face the first time, then the browser's
// cache.

const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let tts = null
let loading = null

async function load() {
  const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO)
  tts = await KokoroTTS.from_pretrained(MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p?.status === 'progress' && p.total) postMessage({ type: 'progress', loaded: p.loaded, total: p.total, file: p.file })
    },
  })
}

onmessage = async (e) => {
  const m = e.data ?? {}
  if (m.type === 'load') {
    try {
      loading ??= load()
      await loading
      postMessage({ type: 'ready' })
    } catch (err) {
      loading = null
      postMessage({ type: 'error', message: String(err?.message ?? err) })
    }
  } else if (m.type === 'say') {
    try {
      if (!loading) throw new Error('not loaded')
      await loading
      const out = await tts.generate(String(m.text).slice(0, 400), { voice: m.voice ?? 'am_michael', speed: m.speed ?? 1 })
      const samples = out.audio
      postMessage({ type: 'audio', id: m.id, samples, rate: out.sampling_rate }, [samples.buffer])
    } catch (err) {
      postMessage({ type: 'error', id: m.id, message: String(err?.message ?? err) })
    }
  }
}

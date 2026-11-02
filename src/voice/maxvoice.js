// Max's voice: his lines, heard from behind the bar.
//
// Three ways: 'blips' (the default) sings each line as NES blips, a blip a
// syllable (babble.js); 'words' speaks it with Kokoro, a small neural
// text-to-speech model run in a worker (kokoro-worker.js), through the
// 8-bit voice with Max's own preset, deeper than yours; 'quiet' is the
// subtitles alone. Every browser makes his voice itself from the text it
// already gets, so there's no audio to send, and the blips are the same
// tune for everyone.
//
// Lines queue rather than talk over each other; when they pile up, his
// thinking aloud gives way to what he says to people.
import { renderBabble } from './babble.js'

export const MAX_MODES = ['blips', 'words', 'quiet']
const MAX_PRESET = { shift: -4, formant: -3 } // the 8-bit voice, a bit lower than a visitor's

/**
 * @param {{voice: {context: Function, chipNode: Function}, onStatus?: (text: string) => void}} o
 *   voice: the visitor voice module, for its audio context and 8-bit worklet.
 */
export function makeMaxVoice({ voice, onStatus = () => {} }) {
  let mode = 'blips'
  let out = null // the chain: [source] → gain → panner → speakers, and a meter
  const queue = []
  let playing = null
  let worker = null, ready = false, nextId = 1
  const pending = new Map() // request id → resolve
  const data = new Float32Array(512)

  function chain() {
    if (out) return out
    const c = voice.context()
    const gain = c.createGain()
    gain.gain.value = 0.9
    const panner = new PannerNode(c, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.6, maxDistance: 40, rolloffFactor: 1.4,
    })
    const meter = c.createAnalyser()
    meter.fftSize = 512
    gain.connect(panner).connect(c.destination)
    gain.connect(meter)
    out = { c, gain, panner, meter, chip: null }
    return out
  }

  function startWords() {
    if (worker) return
    worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') onStatus(`Fetching Max's voice: ${Math.round((100 * m.loaded) / m.total)}%`)
      else if (m.type === 'ready') { ready = true; onStatus('Max speaks.') }
      else if (m.type === 'audio') { pending.get(m.id)?.(m); pending.delete(m.id) }
      else if (m.type === 'error') {
        if (m.id) { pending.get(m.id)?.(null); pending.delete(m.id); return }
        // Couldn't load (offline, blocked, no WebAssembly): back to blips.
        onStatus(`Max's words couldn't load (${m.message}); he'll blip.`)
        worker.terminate()
        worker = null
        ready = false
        mode = 'blips'
      }
    }
    worker.onerror = (e) => {
      onStatus("Max's words couldn't start here; he'll blip.")
      worker?.terminate()
      worker = null
      mode = 'blips'
      e.preventDefault?.()
    }
    onStatus("Fetching Max's voice (about 90 MB, once)…")
    worker.postMessage({ type: 'load' })
  }

  /** Samples for a line, in the current mode (null: nothing to play). */
  async function render(line) {
    const c = chain().c
    if (mode === 'words' && worker && ready) {
      const id = nextId++
      const got = await new Promise((resolve) => {
        pending.set(id, resolve)
        worker.postMessage({ type: 'say', id, text: line.text })
      })
      if (got) return { samples: got.samples, rate: got.rate, words: true }
    }
    if (mode === 'quiet') return null
    return { samples: renderBabble(line.text, c.sampleRate, { base: 165 }), rate: c.sampleRate, words: false }
  }

  async function play() {
    if (playing || !queue.length) return
    const line = queue.shift()
    playing = line
    try {
      const r = await render(line)
      if (!r || !r.samples.length) return
      const { c, gain } = chain()
      const buf = c.createBuffer(1, r.samples.length, r.rate)
      buf.copyToChannel(r.samples, 0)
      const src = c.createBufferSource()
      src.buffer = buf
      // Words go through the 8-bit voice; blips are 8-bit already.
      if (r.words) {
        out.chip ??= await voice.chipNode(MAX_PRESET).catch(() => null)
        if (out.chip) { src.connect(out.chip); out.chip.connect(gain) } else src.connect(gain)
      } else src.connect(gain)
      await new Promise((resolve) => { src.onended = resolve; src.start() })
      try { out.chip?.disconnect() } catch { /* fine */ }
    } finally {
      playing = null
      play()
    }
  }

  return {
    get mode() { return mode },
    /** 'blips', 'words' (fetches the model the first time) or 'quiet'. */
    setMode(m) {
      if (!MAX_MODES.includes(m)) return
      mode = m
      if (m === 'words') startWords()
      if (m === 'quiet') queue.length = 0
    },
    get ready() { return ready },
    /** Max says a line. `aside`: thinking aloud, first to go when he's behind. */
    say(text, { aside = false } = {}) {
      if (mode === 'quiet' || !text) return
      if (queue.length >= 2) {
        // Behind: drop thinking aloud, then the oldest.
        const i = queue.findIndex((q) => q.aside)
        if (aside) return
        queue.splice(i >= 0 ? i : 0, 1)
      }
      queue.push({ text: String(text).replace(/[*_`#]/g, ''), aside })
      play()
    },
    /** Where his head is (metres, the listener's frame). */
    place(p) {
      if (!out) return
      const t = out.c.currentTime
      out.panner.positionX.setTargetAtTime(p.x, t, 0.05)
      out.panner.positionY.setTargetAtTime(p.y, t, 0.05)
      out.panner.positionZ.setTargetAtTime(p.z, t, 0.05)
    },
    /** How loud he is right now, for his visor's mouth. */
    level() {
      if (!out || !playing) return 0
      out.meter.getFloatTimeDomainData(data)
      let s = 0
      for (let i = 0; i < data.length; i++) s += data[i] * data[i]
      return Math.sqrt(s / data.length)
    },
    get speaking() { return !!playing },
  }
}

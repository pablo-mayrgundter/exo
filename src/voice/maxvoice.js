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
// thinking aloud gives way to what he says to people. In words mode he
// speaks sentence by sentence (the next one is made while this one plays),
// keeps thinking aloud to blips (it's long, and frequent), and a line whose
// words come later than STALE after he said it is dropped, not played late.
import { renderBabble } from './babble.js'

export const MAX_MODES = ['blips', 'words', 'quiet']
const STALE = 8 // seconds

/** A line in sentence-sized pieces (long sentences split at commas), to speak as they're made. */
export function chunks(text) {
  const out = []
  for (const s of String(text).match(/[^.!?]+[.!?]*\s*/g) ?? []) {
    if (s.length <= 140) { if (s.trim()) out.push(s.trim()); continue }
    let cur = ''
    for (const part of s.split(/(?<=[,;:])\s+/)) {
      if (cur && cur.length + part.length > 140) { out.push(cur.trim()); cur = '' }
      cur += (cur ? ' ' : '') + part
    }
    if (cur.trim()) out.push(cur.trim())
  }
  return out
}
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
      if (m.type === 'progress') onStatus(`Fetching Max's voice: ${Math.round((100 * m.loaded) / m.total)}% (blips until then)`)
      else if (m.type === 'device') onStatus(`Fetching Max's voice for ${m.device === 'webgpu' ? 'your GPU' : 'your CPU'} (about ${m.mb} MB, once)…`)
      else if (m.type === 'ready') { ready = true; onStatus(`Max speaks${m.device === 'wasm' ? ' (on your CPU: he takes a moment)' : ''}.`) }
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
    worker.postMessage({ type: 'load' })
  }

  /** Asks the worker for a piece of a line; resolves to {samples, rate} or null. */
  function synth(text) {
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, resolve)
      worker.postMessage({ type: 'say', id, text })
    })
  }

  /** Plays samples through his chain (words through the 8-bit voice); resolves when done. */
  async function sound(samples, rate, words) {
    if (!samples?.length) return
    const { c, gain } = chain()
    const buf = c.createBuffer(1, samples.length, rate)
    buf.copyToChannel(samples, 0)
    const src = c.createBufferSource()
    src.buffer = buf
    if (words) {
      out.chip ??= await voice.chipNode(MAX_PRESET).catch(() => null)
      if (out.chip) { src.connect(out.chip); out.chip.connect(gain) } else src.connect(gain)
    } else src.connect(gain) // blips are 8-bit already
    await new Promise((resolve) => { src.onended = resolve; src.start() })
  }

  async function play() {
    if (playing || !queue.length) return
    const line = queue.shift()
    playing = line
    try {
      if (mode === 'quiet') return
      const c = chain().c
      if (mode === 'words' && worker && ready && !line.aside) {
        // One piece ahead: the worker makes the next while this one plays,
        // and a line dropped as stale doesn't keep it busy.
        const texts = chunks(line.text)
        let next = synth(texts[0])
        for (let i = 0; i < texts.length; i++) {
          const got = await next
          if ((performance.now() - line.at) / 1000 > STALE && !line.started) return // too late to be an answer
          next = i + 1 < texts.length ? synth(texts[i + 1]) : null
          if (!got) continue
          line.started = true
          await sound(got.samples, got.rate, true)
        }
        return
      }
      await sound(renderBabble(line.text, c.sampleRate, { base: 165 }), c.sampleRate, false)
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
      queue.push({ text: String(text).replace(/[*_`#]/g, ''), aside, at: performance.now() })
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

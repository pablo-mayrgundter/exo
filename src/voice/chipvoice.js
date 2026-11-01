// An 8-bit voice: your words and your intonation, played on an NES.
//
// A channel vocoder with chiptune carriers. Your voice (the modulator) is
// split into 24 bands; each band's loudness, followed a few milliseconds
// at a time, shapes the same band of a carrier: a 25%-duty pulse wave at
// your pitch (tracked with YIN, snapped to semitones, so speech comes out
// as a little melody) for voiced sounds, and the NES's 15-bit noise
// channel for unvoiced ones (s, f, t, sh). The bands carry the formants,
// so the words stay legible; the pitch carries the tone. A sample-and-hold
// and a few bits of quantization give it the grit of the era.
//
// Shifting the pitch (`shift`) and the formants (`formant`: the band
// envelopes moved up or down the spectrum) changes who you sound like
// while keeping what you say. The pitch is held through short gaps in
// the tracking, so a vowel doesn't flip to noise halfway.
//
// Plain JS on Float32Array blocks: the AudioWorklet (worklet.js) runs it
// in the browser, and tests run it in Node.

const F_LO = 150, F_HI = 7000

export class ChipVoice {
  /**
   * @param {number} sampleRate
   * @param {{shift?: number, formant?: number, bands?: number, bits?: number, hold?: number, quantize?: boolean}} o
   *   shift: semitones to move the pitch; formant: semitones to move the
   *   formants; bands: vocoder bands; bits: output resolution; hold: output
   *   sample rate (Hz) of the sample-and-hold; quantize: snap pitch to semitones.
   */
  constructor(sampleRate = 48000, { shift = 0, formant = 0, bands = 24, bits = 8, hold = 22050, quantize = true } = {}) {
    this.sr = sampleRate
    this.shift = shift
    this.bands = bands
    this.quantize = quantize
    this.levels = 2 ** (bits - 1)
    this.holdEvery = Math.max(1, Math.round(sampleRate / hold))
    // Pitch analysis on a decimated copy (~16 kHz).
    this.dec = Math.max(1, Math.round(sampleRate / 16000))
    this.asr = sampleRate / this.dec
    this.W = Math.round(this.asr * 0.025) // 25 ms window
    this.tauMin = Math.floor(this.asr / 500)
    this.tauMax = Math.ceil(this.asr / 70)
    this.abuf = new Float32Array(2048)
    this.apos = 0
    this.acc = 0
    this.accN = 0
    this.hop = Math.round(this.asr * 0.01) // a pitch estimate every 10 ms
    this.sinceHop = 0
    this.dbuf = new Float32Array(this.tauMax + 1)
    this.unvoicedRun = 0
    this.recent = [0, 0, 0] // the last three pitch estimates, for a median
    // Bands: log-spaced band-passes, for the voice and for the carrier.
    this.mod = []
    this.car = []
    const r = (F_HI / F_LO) ** (1 / (bands - 1))
    this.bandSemitones = 12 * Math.log2(r)
    const q = 1 / (Math.sqrt(r) - 1 / Math.sqrt(r))
    // Two band-passes in a row per band (4th order): steep enough skirts
    // that a strong low vowel doesn't leak into the high bands.
    for (let i = 0; i < bands; i++) {
      const f = F_LO * r ** i
      this.mod.push([bandpass(f, q * 0.75, sampleRate), bandpass(f, q * 0.75, sampleRate)])
      this.car.push([bandpass(f, q * 0.75, sampleRate), bandpass(f, q * 0.75, sampleRate)])
    }
    this.envM = new Float32Array(bands)
    this.envC = new Float32Array(bands)
    this.formant = formant
    this.att = 1 - Math.exp(-1 / (0.004 * sampleRate))
    this.rel = 1 - Math.exp(-1 / (0.03 * sampleRate))
    // Carriers.
    this.phase = 0
    this.inc = 220 / sampleRate
    this.incWant = this.inc
    this.glide = 1 - Math.exp(-1 / (0.012 * sampleRate))
    this.lfsr = 1
    this.noiseEvery = Math.max(1, Math.round(sampleRate / 12000))
    this.noiseCount = 0
    this.noise = 1
    this.voiced = 0
    this.voicedWant = 0
    this.voiceGlide = 1 - Math.exp(-1 / (0.025 * sampleRate))
    // Output.
    this.held = 0
    this.holdCount = 0
    this.gain = 2.6 * Math.sqrt(16 / bands)
    /** The latest pitch (Hz, 0 when unvoiced) and level, for anyone watching. */
    this.f0 = 0
    this.level = 0
  }

  /** Semitones to move the formants: each output band takes the envelope from this far below. */
  get formant() { return this._formant }
  set formant(st) {
    this._formant = st
    const s = st / this.bandSemitones
    this.fromBand = Math.floor(s)
    this.fromFrac = s - this.fromBand
  }

  /** The voice's envelope for output band b, after the formant shift (interpolated). */
  envAt(b) {
    const i = b - this.fromBand - 1, f = this.fromFrac
    const lo = i >= 0 && i < this.bands ? this.envM[i] : 0
    const hi = i + 1 >= 0 && i + 1 < this.bands ? this.envM[i + 1] : 0
    return lo * f + hi * (1 - f)
  }

  /** Processes one block: input → output (same length; may be the same array). */
  process(input, output) {
    const n = input.length
    for (let i = 0; i < n; i++) {
      const x = input[i]
      // Pitch analysis, decimated.
      this.acc += x
      if (++this.accN === this.dec) {
        this.abuf[this.apos] = this.acc / this.dec
        this.apos = (this.apos + 1) & 2047
        this.acc = 0
        this.accN = 0
        if (++this.sinceHop >= this.hop) { this.sinceHop = 0; this.analyse() }
      }
      // Carriers: a 25% pulse at the pitch, and NES noise.
      this.inc += (this.incWant - this.inc) * this.glide
      this.phase += this.inc
      if (this.phase >= 1) this.phase -= 1
      const pulse = this.phase < 0.25 ? 0.75 : -0.25
      if (++this.noiseCount >= this.noiseEvery) {
        this.noiseCount = 0
        const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1
        this.lfsr = (this.lfsr >> 1) | (bit << 14)
        this.noise = this.lfsr & 1 ? 0.5 : -0.5
      }
      this.voiced += (this.voicedWant - this.voiced) * this.voiceGlide
      const c = pulse * this.voiced + this.noise * (1 - this.voiced)
      // The vocoder: each band of the carrier, flattened, times the voice's
      // envelope in that band (or, shifted, in the band it moves up from).
      const B = this.bands
      for (let b = 0; b < B; b++) {
        const m = run(this.mod[b][1], run(this.mod[b][0], x))
        const am = m < 0 ? -m : m
        this.envM[b] += (am - this.envM[b]) * (am > this.envM[b] ? this.att : this.rel)
      }
      let y = 0
      const shifted = this._formant !== 0
      for (let b = 0; b < B; b++) {
        const k = run(this.car[b][1], run(this.car[b][0], c))
        const ak = k < 0 ? -k : k
        this.envC[b] += (ak - this.envC[b]) * (ak > this.envC[b] ? this.att : this.rel)
        y += k * ((shifted ? this.envAt(b) : this.envM[b]) / (this.envC[b] + 1e-4))
      }
      // Sample-and-hold and a few bits: the grit.
      if (++this.holdCount >= this.holdEvery) {
        this.holdCount = 0
        const s = Math.tanh(y * this.gain)
        this.held = Math.round(s * this.levels) / this.levels
      }
      output[i] = this.held
    }
  }

  /** YIN on the last window: pitch, and whether it's voiced at all. */
  analyse() {
    const { W, tauMin, tauMax, abuf, dbuf } = this
    const start = (this.apos - W - tauMax + 2048) & 2047
    const at = (j) => abuf[(start + j) & 2047]
    let energy = 0
    for (let j = 0; j < W; j++) { const v = at(j); energy += v * v }
    this.level = Math.sqrt(energy / W)
    if (this.level < 0.004) { this.unvoiced(); return }
    // Difference function, cumulative-mean normalized.
    dbuf[0] = 1
    let sum = 0, best = -1
    for (let tau = 1; tau <= tauMax; tau++) {
      let d = 0
      for (let j = 0; j < W; j++) { const v = at(j) - at(j + tau); d += v * v }
      sum += d
      dbuf[tau] = sum > 0 ? (d * tau) / sum : 1
    }
    // The first dip under the threshold; failing that, the deepest, if deep enough.
    let deepest = tauMin
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (dbuf[tau] < dbuf[deepest]) deepest = tau
      if (dbuf[tau] < 0.25) {
        while (tau + 1 < tauMax && dbuf[tau + 1] < dbuf[tau]) tau++
        best = tau
        break
      }
    }
    if (best < 0 && dbuf[deepest] < 0.4) best = deepest
    if (best < 0) { this.unvoiced(); return } // unvoiced: noise carries it, if it lasts
    // Parabolic interpolation around the minimum.
    const a = dbuf[best - 1], b = dbuf[best], c = dbuf[best + 1]
    const den = a - 2 * b + c
    const tau = best + (den !== 0 ? (0.5 * (a - c)) / den : 0)
    // A median of the last three estimates: one octave slip doesn't jump the tune.
    this.recent.shift()
    this.recent.push(this.asr / tau)
    const [p, q, r] = this.recent
    let f = Math.max(Math.min(p, q), Math.min(Math.max(p, q), r))
    if (!f) f = this.asr / tau
    this.f0 = f
    this.unvoicedRun = 0
    f *= 2 ** (this.shift / 12)
    if (this.quantize) f = 440 * 2 ** (Math.round(12 * Math.log2(f / 440)) / 12)
    this.incWant = f / this.sr
    this.voicedWant = 1
  }
}

/**
 * A frame without a pitch: hold the last one through short gaps (40 ms),
 * and only then hand over to the noise carrier.
 */
ChipVoice.prototype.unvoiced = function () {
  if (++this.unvoicedRun >= 4) { this.voicedWant = 0; this.f0 = 0; this.recent.fill(0) }
}

/** A constant-peak band-pass biquad (RBJ), as a little state object. */
function bandpass(f, q, sr) {
  const w = (2 * Math.PI * f) / sr
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }
}

function run(s, x) {
  const y = s.b0 * x + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2
  s.x2 = s.x1; s.x1 = x
  s.y2 = s.y1; s.y1 = y
  return y
}

/** Pitch of a block by YIN, for tests and tools: Hz, or 0 if unvoiced. */
export function pitchOf(samples, sampleRate) {
  const v = new ChipVoice(sampleRate)
  v.process(samples, new Float32Array(samples.length))
  return v.f0
}

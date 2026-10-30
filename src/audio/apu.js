// A chiptune voice set in Web Audio, after the NES's APU: two pulse
// channels with four duties, a stepped triangle, and an LFSR noise channel
// with its long and short (metallic) modes. Each channel is a set of
// always-running nodes whose pitch, duty and volume are AudioParams, so a
// change can be scheduled at an exact AudioContext time:
//
//   apu.write('p1', { freq: 440, duty: 2, vol: 12 })     registers, NES-ish
//   apu.poke(0x4000, 0xbf)                                the NES's own map
//   apu.note('p1', { freq, dur, vol, duty, env }, time)   an enveloped note
//
// The Scheduler below feeds timed events (song.js's) to an APU from a
// lookahead window, the "tale of two clocks" pattern: a coarse timer pumps,
// and every note is placed on the audio clock, not on the timer.

export const CPU_HZ = 1789773 // NTSC NES CPU clock: the APU's timers count it
export const CHANNEL_NAMES = ['p1', 'p2', 'tri', 'noise']
export const DUTIES = [0.125, 0.25, 0.5, 0.75]
// The NES's 8-step duty sequences (pulse output high or low per step).
const DUTY_STEPS = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
]
// The triangle is a 32-step staircase, 15 down to 0 and back: its steps
// are what makes it buzz like an NES and not like a sine.
const TRI_STEPS = [...Array(32)].map((_, i) => (i < 16 ? 15 - i : i - 16))
// Noise timer periods, in CPU cycles: the LFSR clocks at CPU_HZ / period.
export const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068]
const ARP_STEP = 1 / 60 // an arpeggio changes pitch every video frame, like the NES drivers did

/** Volume envelopes: attack, decay, sustain level and release (seconds), and optional vibrato depth. */
export const ENVELOPES = {
  lead: { a: 0.01, d: 0.25, s: 0.75, r: 0.08, vib: 0.006 },
  pluck: { a: 0.003, d: 0.12, s: 0.35, r: 0.06 },
  stab: { a: 0.002, d: 0.09, s: 0.22, r: 0.05 },
  bass: { a: 0.004, d: 0.15, s: 0.85, r: 0.04 },
  organ: { a: 0.012, d: 0.1, s: 0.95, r: 0.1 },
  pad: { a: 0.12, d: 0.4, s: 0.8, r: 0.35, vib: 0.004 },
  bell: { a: 0.002, d: 0.5, s: 0.12, r: 0.4 },
  flat: { a: 0.003, d: 0.05, s: 1, r: 0.02 },
}
const DEFAULT_ENV = { p1: 'lead', p2: 'pluck', tri: 'bass', noise: 'pluck' }
const MIX = { p1: 0.5, p2: 0.42, tri: 0.62, noise: 0.32 } // NES-like balance

// Drum hits. On noise: an LFSR period (index), mode, and decay. On the
// triangle or a pulse: a fast pitch drop, the NES kick.
const NOISE_DRUMS = {
  K: { period: 9, to: 13, mode: 0, vol: 1, env: { a: 0.001, d: 0.09, s: 0, r: 0.03 } },
  S: { period: 6, mode: 0, vol: 0.9, env: { a: 0.001, d: 0.16, s: 0, r: 0.05 } },
  H: { period: 0, mode: 0, vol: 0.5, env: { a: 0.001, d: 0.035, s: 0, r: 0.02 } },
  X: { period: 1, mode: 0, vol: 0.6, env: { a: 0.001, d: 0.45, s: 0, r: 0.2 } },
  T: { period: 10, to: 12, mode: 1, vol: 0.8, env: { a: 0.001, d: 0.14, s: 0, r: 0.05 } },
}
const TONE_DRUMS = {
  K: { from: 180, to: 42, sweep: 0.09, vol: 1, env: { a: 0.001, d: 0.14, s: 0, r: 0.03 } },
  S: { from: 320, to: 160, sweep: 0.05, vol: 0.8, env: { a: 0.001, d: 0.08, s: 0, r: 0.03 } },
  H: { from: 2000, to: 1800, sweep: 0.02, vol: 0.3, env: { a: 0.001, d: 0.02, s: 0, r: 0.01 } },
  X: { from: 900, to: 300, sweep: 0.3, vol: 0.5, env: { a: 0.001, d: 0.3, s: 0, r: 0.1 } },
  T: { from: 240, to: 90, sweep: 0.16, vol: 0.9, env: { a: 0.001, d: 0.2, s: 0, r: 0.05 } },
}

/**
 * Fourier coefficients of a periodic staircase (equal steps, levels in any
 * range, centred and scaled to ±1), for createPeriodicWave.
 */
export function stepWaveCoefficients(levels, harmonics = 64) {
  const n = levels.length
  const lo = Math.min(...levels), hi = Math.max(...levels)
  const mid = (hi + lo) / 2, half = (hi - lo) / 2 || 1
  const v = levels.map((l) => (l - mid) / half)
  const real = new Float32Array(harmonics + 1), imag = new Float32Array(harmonics + 1)
  for (let h = 1; h <= harmonics; h++) {
    let a = 0, b = 0
    for (let k = 0; k < n; k++) {
      const p0 = (2 * Math.PI * h * k) / n, p1 = (2 * Math.PI * h * (k + 1)) / n
      a += v[k] * (Math.sin(p1) - Math.sin(p0))
      b += v[k] * (Math.cos(p0) - Math.cos(p1))
    }
    real[h] = a / (Math.PI * h)
    imag[h] = b / (Math.PI * h)
  }
  return { real, imag }
}

/** The noise channel's 15-bit LFSR, as ±1 per clock. Short mode taps bit 6: a 93-step metallic loop. */
export function lfsr(count, short = false) {
  const out = new Float32Array(count)
  let r = 1
  const tap = short ? 6 : 1
  for (let i = 0; i < count; i++) {
    const fb = (r ^ (r >> tap)) & 1
    r = (r >> 1) | (fb << 14)
    out[i] = r & 1 ? -1 : 1
  }
  return out
}

/** NES timer value to frequency: pulses divide by 16, the triangle by 32 (it has twice the steps). */
export function timerToFreq(channel, timer) {
  return CPU_HZ / ((channel === 'tri' ? 32 : 16) * (timer + 1))
}

export class APU {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{destination?: AudioNode}} [opts]
   */
  constructor(ctx, { destination = ctx.destination } = {}) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.connect(destination)
    this.ch = {}
    this.nodes = []
    const lfo = this.osc({ type: 'sine', frequency: 5.5 })
    const pulseWaves = DUTY_STEPS.map((s) => this.wave(s))
    for (const name of ['p1', 'p2']) this.ch[name] = this.tone(name, pulseWaves, lfo)
    this.ch.tri = this.tone('tri', [this.wave(TRI_STEPS)], lfo)
    this.ch.noise = this.noise()
    this.regs = new Uint8Array(0x18) // $4000–$4017, for poke()
    this.enabled = 0x0f
  }

  wave(levels) {
    const { real, imag } = stepWaveCoefficients(levels)
    return this.ctx.createPeriodicWave(real, imag)
  }

  osc(opts) {
    const o = new OscillatorNode(this.ctx, opts)
    o.start()
    this.nodes.push(o)
    return o
  }

  /** A pitched channel: one oscillator per duty behind selector gains, all driven by one frequency source. */
  tone(name, waves, lfo) {
    const ctx = this.ctx
    const mix = new GainNode(ctx, { gain: MIX[name] })
    mix.connect(this.out)
    const env = new GainNode(ctx, { gain: 0 })
    env.connect(mix)
    const freq = new ConstantSourceNode(ctx, { offset: 440 })
    freq.start()
    this.nodes.push(freq)
    const vib = new GainNode(ctx, { gain: 0 })
    lfo.connect(vib).connect(freq.offset)
    const sel = waves.map((w, i) => {
      const g = new GainNode(ctx, { gain: i === (waves.length > 1 ? 2 : 0) ? 1 : 0 })
      const o = this.osc({ frequency: 0 })
      o.setPeriodicWave(w)
      freq.connect(o.frequency)
      o.connect(g).connect(env)
      return g
    })
    return { name, env, freq, vib, sel: waves.length > 1 ? sel : null, duty: 2, mix }
  }

  noise() {
    const ctx = this.ctx
    const mix = new GainNode(ctx, { gain: MIX.noise })
    mix.connect(this.out)
    const env = new GainNode(ctx, { gain: 0 })
    env.connect(mix)
    const n = 32767
    const srcs = [false, true].map((short, i) => {
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      buf.copyToChannel(lfsr(n, short), 0)
      const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true })
      const g = new GainNode(ctx, { gain: i === 0 ? 1 : 0 })
      s.connect(g).connect(env)
      s.start()
      this.nodes.push(s)
      return { src: s, gain: g }
    })
    const ch = { name: 'noise', env, srcs, mix, mode: 0 }
    this.setNoise(ch, { period: 4 }, ctx.currentTime)
    return ch
  }

  noiseRate(period) {
    return CPU_HZ / NOISE_PERIODS[Math.max(0, Math.min(15, period | 0))] / this.ctx.sampleRate
  }

  setNoise(c, { period, mode, to, sweep = 0.06 }, t) {
    if (mode != null && mode !== c.mode) {
      c.mode = mode
      c.srcs.forEach((s, i) => s.gain.gain.setValueAtTime(i === mode ? 1 : 0, t))
    }
    if (period == null) return
    for (const { src } of c.srcs) {
      src.playbackRate.setValueAtTime(this.noiseRate(period), t)
      if (to != null) src.playbackRate.exponentialRampToValueAtTime(this.noiseRate(to), t + sweep)
    }
  }

  setDuty(c, duty, t) {
    if (!c.sel || duty === c.duty) return
    c.duty = duty & 3
    c.sel.forEach((g, i) => g.gain.setValueAtTime(i === c.duty ? 1 : 0, t))
  }

  /**
   * Registers, the way a program would set them: any of
   * freq (Hz) or timer (NES 11-bit), duty (0–3), vol (0–15, held: no
   * envelope), and on the noise channel period (0–15) and mode (0 long, 1 short).
   */
  write(name, regs, time = this.ctx.currentTime) {
    const c = this.ch[name]
    if (!c) throw new Error(`no channel ${name}`)
    let freq = regs.freq
    if (regs.timer != null) freq = timerToFreq(name, regs.timer)
    if (freq != null && c.freq) c.freq.offset.setValueAtTime(freq, time)
    if (regs.duty != null) this.setDuty(c, regs.duty, time)
    if (name === 'noise') this.setNoise(c, regs, time)
    if (regs.vol != null) {
      c.env.gain.cancelScheduledValues(time)
      c.env.gain.setTargetAtTime(Math.max(0, Math.min(15, regs.vol)) / 15, time, 0.003)
    }
  }

  /**
   * The NES's register map ($4000–$4017), for a 6502 program: duty and
   * constant volume, timers, the triangle's linear counter as on/off,
   * noise mode and period, and $4015's channel enables. Not emulated:
   * length counters, hardware envelopes, sweeps and the DMC.
   */
  poke(addr, value, time = this.ctx.currentTime) {
    const r = addr - 0x4000
    if (r < 0 || r >= this.regs.length) return
    this.regs[r] = value & 0xff
    const v = this.regs
    const on = (bit) => (this.enabled >> bit) & 1
    const pulse = (base, name, bit) => {
      const timer = v[base + 2] | ((v[base + 3] & 7) << 8)
      const vol = on(bit) && timer >= 8 ? v[base] & 15 : 0 // the NES mutes timers under 8
      this.write(name, { duty: v[base] >> 6, timer, vol }, time)
    }
    if (r === 0x15) this.enabled = value & 0x1f
    if (r < 4 || r === 0x15) pulse(0, 'p1', 0)
    if ((r >= 4 && r < 8) || r === 0x15) pulse(4, 'p2', 1)
    if ((r >= 8 && r < 0x0c) || r === 0x15) {
      const timer = v[0x0a] | ((v[0x0b] & 7) << 8)
      this.write('tri', { timer, vol: on(2) && v[0x08] & 0x7f && timer >= 2 ? 15 : 0 }, time)
    }
    if ((r >= 0x0c && r < 0x10) || r === 0x15) {
      this.write('noise', { mode: v[0x0e] >> 7, period: v[0x0e] & 15, vol: on(3) ? v[0x0c] & 15 : 0 }, time)
    }
  }

  /**
   * An enveloped note at `time`: {freq | freqs (arpeggio) | drum, dur (s), vol (0–1), duty, env}.
   */
  note(name, ev, time) {
    const c = this.ch[name]
    if (!c) throw new Error(`no channel ${name}`)
    const t = Math.max(time, this.ctx.currentTime)
    const env = ENVELOPES[ev.env] ?? ENVELOPES[DEFAULT_ENV[name]]
    if (ev.drum) return this.drum(c, ev, t)
    if (ev.duty != null) this.setDuty(c, ev.duty, t)
    if (name === 'noise') {
      // Pitched noise: higher notes, shorter periods.
      const m = 69 + 12 * Math.log2((ev.freq ?? ev.freqs[0]) / 440)
      this.setNoise(c, { period: Math.max(0, Math.min(15, Math.round((96 - m) / 4))) }, t)
    } else {
      const f = c.freq.offset
      if (ev.freqs) {
        const steps = Math.max(1, Math.ceil(ev.dur / ARP_STEP))
        for (let i = 0; i < steps; i++) f.setValueAtTime(ev.freqs[i % ev.freqs.length], t + i * ARP_STEP)
      } else f.setValueAtTime(ev.freq, t)
      c.vib.gain.setValueAtTime(0, t)
      if (env.vib && !ev.freqs && ev.dur > 0.3) c.vib.gain.setTargetAtTime(ev.freq * env.vib, t + 0.2, 0.08)
    }
    this.envelope(c, env, ev.vol ?? 0.67, t, ev.dur)
  }

  drum(c, ev, t) {
    const vol = ev.vol ?? 0.67
    if (c.name === 'noise') {
      const d = NOISE_DRUMS[ev.drum]
      this.setNoise(c, d, t)
      return this.envelope(c, d.env, vol * d.vol, t, ev.dur)
    }
    const d = TONE_DRUMS[ev.drum]
    if (c.sel) this.setDuty(c, 2, t)
    c.vib.gain.setValueAtTime(0, t)
    c.freq.offset.setValueAtTime(d.from, t)
    c.freq.offset.exponentialRampToValueAtTime(d.to, t + d.sweep)
    this.envelope(c, d.env, vol * d.vol, t, ev.dur)
  }

  /** Attack, decay to sustain, release at the end of the gate: all exponential approaches, so nothing clicks. */
  envelope(c, env, peak, t, dur) {
    const g = c.env.gain
    const a = Math.min(env.a, dur / 2)
    g.setTargetAtTime(0, Math.max(0, t - 0.005), 0.0015) // a breath between notes, so repeats articulate
    g.setTargetAtTime(peak, t, a / 3 + 1e-4)
    g.setTargetAtTime(peak * env.s, t + a, env.d / 3 + 1e-4)
    g.setTargetAtTime(0, t + dur, env.r / 3 + 1e-4)
  }

  /** Silences every channel from `time`, dropping what was scheduled after it. */
  silence(time = this.ctx.currentTime) {
    for (const c of Object.values(this.ch)) {
      c.env.gain.cancelScheduledValues(time)
      c.env.gain.setTargetAtTime(0, time, 0.01)
      if (c.freq) c.freq.offset.cancelScheduledValues(time)
      if (c.vib) { c.vib.gain.cancelScheduledValues(time); c.vib.gain.setValueAtTime(0, time) }
    }
  }

  dispose() {
    for (const n of this.nodes) { try { n.stop() } catch { /* already stopped */ } n.disconnect() }
    this.out.disconnect()
  }
}

/**
 * Feeds timed events to a callback from a lookahead window on an audio
 * clock. Call pump() from any coarse timer; each event fires once, with
 * its exact clock time. Events already later than `late` seconds (the
 * page stalled) are skipped rather than played in a burst.
 */
export class Scheduler {
  /** @param {{now: () => number, onEvent: (ev: object, time: number) => void, lookahead?: number, late?: number}} o */
  constructor({ now, onEvent, lookahead = 0.15, late = 0.05 }) {
    this.now = now
    this.onEvent = onEvent
    this.lookahead = lookahead
    this.late = late
    this.events = null
    this.i = 0
    this.t0 = 0
    this.skipped = 0
  }

  /** Starts `events` (sorted, with .time from the song's start) so that `offset` falls at clock time `at`. */
  start(events, { at = this.now(), offset = 0 } = {}) {
    this.events = events
    this.t0 = at - offset
    this.i = 0
    while (this.i < events.length && events[this.i].time < offset) this.i++
    this.skipped = 0
  }

  stop() { this.events = null }

  get running() { return !!this.events }
  get done() { return !this.events || this.i >= this.events.length }
  /** Seconds into the song. */
  get position() { return this.now() - this.t0 }

  /** Schedules everything due before now + lookahead. Returns how many it scheduled. */
  pump(lookahead = this.lookahead) {
    if (!this.events) return 0
    const now = this.now()
    const horizon = now + lookahead
    let n = 0
    while (this.i < this.events.length) {
      const ev = this.events[this.i]
      const at = this.t0 + ev.time
      if (at >= horizon) break
      this.i++
      if (at < now - this.late) { this.skipped++; continue }
      this.onEvent(ev, at)
      n++
    }
    return n
  }
}

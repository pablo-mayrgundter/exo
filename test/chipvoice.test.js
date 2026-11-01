import { describe, expect, it } from 'vitest'
import { ChipVoice, pitchOf } from '../src/voice/chipvoice.js'

const SR = 48000

/** A buzzy vowel-ish tone: a sawtooth at f, `s` seconds long. */
function saw(f, s, amp = 0.3) {
  const x = new Float32Array(Math.round(SR * s))
  for (let i = 0; i < x.length; i++) x[i] = amp * (2 * ((i * f / SR) % 1) - 1)
  return x
}
/** Noise, seeded, so the test is the same every time. */
function noise(s, amp = 0.3) {
  const x = new Float32Array(Math.round(SR * s))
  let seed = 12345
  for (let i = 0; i < x.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i] = amp * (seed / 0x3fffffff - 1) }
  return x
}
function rms(x, a = 0, b = x.length) {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / (b - a))
}
/** Energy of x around f (a narrow band-pass), relative. */
function bandEnergy(x, f) {
  const w = 2 * Math.PI * f / SR, q = 4, al = Math.sin(w) / (2 * q), a0 = 1 + al
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0
  for (const v of x) { const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; e += y * y }
  return e / x.length
}
function run(x, o) {
  const v = new ChipVoice(SR, o)
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i += 128) v.process(x.subarray(i, i + 128), y.subarray(i, i + 128))
  return { v, y }
}

describe('the 8-bit voice', () => {
  it('tracks the pitch of a voiced sound', () => {
    for (const f of [95, 150, 230, 340]) expect(Math.abs(pitchOf(saw(f, 0.3), SR) / f - 1)).toBeLessThan(0.03)
  })

  it('calls noise and silence unvoiced', () => {
    expect(pitchOf(noise(0.3), SR)).toBe(0)
    expect(pitchOf(new Float32Array(SR * 0.3), SR)).toBe(0)
  })

  it('plays the pitch snapped to the nearest semitone (and shifted, if asked)', () => {
    const { v } = run(saw(150, 0.3))
    expect(v.incWant * SR).toBeCloseTo(146.83, 1) // D3, the nearest semitone to 150 Hz
    const up = run(saw(150, 0.3), { shift: 12 }).v
    expect(up.incWant * SR).toBeCloseTo(293.66, 1) // an octave up
  })

  it('follows the loudness: sound in, sound out; silence in, silence out', () => {
    const on = saw(160, 0.25), off = new Float32Array(SR * 0.25)
    const x = new Float32Array(on.length * 4)
    x.set(on, 0); x.set(off, on.length); x.set(on, on.length * 2); x.set(off, on.length * 3)
    const { y } = run(x)
    const n = on.length
    const loud = rms(y, n * 0.3, n), quiet = rms(y, n * 1.3, n * 2)
    expect(loud).toBeGreaterThan(0.05)
    expect(quiet).toBeLessThan(loud / 20)
  })

  it('keeps where the sound sits in the spectrum, which is what carries the words', () => {
    // A low, dark vowel and a bright one (the same buzz, filtered differently).
    const buzz = saw(140, 0.5)
    const lowpass = (x, f) => { const a = Math.exp(-2 * Math.PI * f / SR); const y = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s } return y }
    const dark = lowpass(lowpass(buzz, 500), 500)
    const bright = buzz.map((v, i) => v - dark[i])
    const d = run(dark).y, b = run(bright).y
    const tilt = (y) => bandEnergy(y, 400) / bandEnergy(y, 3000)
    // The input's contrast is ~24×; the vocoder's bands and the 7-bit floor keep a clear 3× and more.
    expect(tilt(d)).toBeGreaterThan(tilt(b) * 3)
  })

  it('comes out on an 8-bit grid, held at 22 kHz', () => {
    const { y } = run(saw(200, 0.2))
    for (let i = 4800; i < 5000; i++) expect(Math.abs(y[i] * 128 - Math.round(y[i] * 128))).toBeLessThan(1e-4)
    let changes = 0
    for (let i = 4801; i < 9600; i++) if (y[i] !== y[i - 1]) changes++
    expect(changes).toBeLessThanOrEqual(4800 / 2 + 1)
  })

  it('moves the formants up or down when asked (who you sound like, not what you say)', () => {
    // Band by band from 600 Hz up: shifted up is louder there, shifted down quieter.
    const vowel = saw(140, 0.5)
    const dB = (y, f) => 10 * Math.log10(bandEnergy(y.subarray(12000), f))
    const plain = run(vowel).y, up = run(vowel, { formant: 12 }).y, down = run(vowel, { formant: -12 }).y
    for (const f of [600, 1200, 2400, 4800]) {
      expect(dB(up, f) - dB(plain, f)).toBeGreaterThan(2)
      expect(dB(plain, f) - dB(down, f)).toBeGreaterThan(1.5)
    }
  })

  it('holds the pitch through a short gap in the tracking, so a vowel does not flip to noise', () => {
    const v = new ChipVoice(SR)
    const out = new Float32Array(128)
    const feed = (x) => { for (let i = 0; i + 128 <= x.length; i += 128) v.process(x.subarray(i, i + 128), out) }
    feed(saw(150, 0.2))
    expect(v.voicedWant).toBe(1)
    feed(noise(0.025)) // 25 ms of hiss in the middle of the vowel
    expect(v.voicedWant).toBe(1)
    feed(noise(0.1)) // a real unvoiced sound: hand over to the noise carrier
    expect(v.voicedWant).toBe(0)
  })
})

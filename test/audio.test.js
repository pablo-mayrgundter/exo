// The jukebox's song format, its timing and the lookahead scheduler: pure
// functions, no AudioContext.
import { describe, it, expect } from 'vitest'
import { durationBeats, expandRepeats, tokenize, midi, midiToFreq, parseChannel, sequence, tempoMap } from '../src/audio/song.js'
import { Scheduler, stepWaveCoefficients, lfsr, timerToFreq } from '../src/audio/apu.js'
import { PLAYLIST } from '../src/audio/songs/index.js'

const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('song format', () => {
  it('names pitches in scientific notation', () => {
    expect(midi('C', '', 4)).toBe(60)
    expect(midi('A', '', 4)).toBe(69)
    expect(midi('F', '#', 5)).toBe(78)
    expect(midi('B', 'b', 3)).toBe(58)
    expect(midi('E', '#', 4)).toBe(midi('F', '', 4))
    close(midiToFreq(69), 440)
    close(midiToFreq(81), 880)
  })

  it('reads durations: dots and triplets', () => {
    expect(durationBeats('4')).toBe(1)
    expect(durationBeats('8')).toBe(0.5)
    expect(durationBeats('1')).toBe(4)
    expect(durationBeats('4.')).toBe(1.5)
    expect(durationBeats('2..')).toBe(3.5)
    close(durationBeats('8t'), 1 / 3)
    expect(() => durationBeats('3')).toThrow()
  })

  it('tokenizes, keeping arpeggios whole, and expands nested repeats', () => {
    expect(tokenize('C4 {C4 E4 G4}:8 | [ D ]2')).toEqual(['C4', '{C4 E4 G4}:8', '[', 'D', ']2'])
    expect(expandRepeats(tokenize('[a [b]3 ]2 c'))).toEqual(['a', 'b', 'b', 'b', 'a', 'b', 'b', 'b', 'c'])
    expect(expandRepeats(['[', 'x', ']'])).toEqual(['x', 'x'])
    expect(() => expandRepeats(['[', 'x'])).toThrow(/unmatched/)
    expect(() => expandRepeats([']'])).toThrow(/unmatched/)
  })

  it('parses notes, rests, ties and default lengths into beats', () => {
    const { events, beats } = parseChannel('@l8 C4 D E:4 r F:2 ~:4')
    expect(events.map((e) => [e.beat, e.beats, e.midi])).toEqual([
      [0, 0.5, 60], [0.5, 0.5, 62], [1, 1, 64], [2.5, 3, 65],
    ])
    expect(beats).toBe(5.5)
  })

  it('carries the octave from note to note, and shifts it with > and <', () => {
    const { events } = parseChannel('A3 B C5 D > E << F')
    expect(events.map((e) => e.midi)).toEqual([57, 59, 72, 74, 88, 65])
  })

  it('applies volume, duty, gate, envelope and transpose', () => {
    const { events } = parseChannel('@v15 @d1 @q4 @e:stab C4:4 @k2 @v0 @d3 @q8 C4:4')
    expect(events[0]).toMatchObject({ vol: 1, duty: 1, gate: 0.5, beats: 1, env: 'stab', midi: 60 })
    expect(events[1]).toMatchObject({ vol: 0, duty: 3, gate: 1, midi: 62 })
  })

  it('parses drums and arpeggios', () => {
    const { events } = parseChannel('K:8 S H:16 {A3 C4 E4}:2')
    expect(events.map((e) => e.drum ?? e.midis)).toEqual(['K', 'S', 'H', [57, 60, 64]])
    expect(events.map((e) => e.beat)).toEqual([0, 0.5, 1.5, 1.75])
  })

  it('says where a bad token is', () => {
    expect(() => parseChannel('C4 Q4', { channel: 'p1' })).toThrow(/p1: unknown token at "Q4"/)
    expect(() => parseChannel('C4:3')).toThrow(/bad duration/)
    expect(() => parseChannel('~')).toThrow(/tie/)
    expect(() => parseChannel('@z1')).toThrow(/unknown setting/)
    expect(() => parseChannel('@vloud')).toThrow(/not a number/)
  })
})

describe('sequencer timing', () => {
  it('times beats against a steady tempo', () => {
    const at = tempoMap(120)
    expect(at(0)).toBe(0)
    expect(at(1)).toBe(0.5)
    expect(at(8)).toBe(4)
  })

  it('times beats against a tempo map', () => {
    const at = tempoMap([[0, 60], [4, 120], [8, 240]])
    expect(at(4)).toBe(4)
    expect(at(6)).toBe(5)
    expect(at(8)).toBe(6)
    expect(at(12)).toBe(7)
  })

  it('merges channels in time order, with gates in seconds', () => {
    const song = { tempo: 120, channels: { p1: '@q4 C4 D4', tri: 'C3:2', noise: 'H:8 H:8 S:4' } }
    const { events, duration, beats } = sequence(song)
    expect(beats).toBe(2)
    expect(duration).toBe(1)
    expect(events.map((e) => [e.time, e.ch])).toEqual([
      [0, 'p1'], [0, 'tri'], [0, 'noise'], [0.25, 'noise'], [0.5, 'p1'], [0.5, 'noise'],
    ])
    expect(events[0].dur).toBe(0.25) // a quarter at 120 is 0.5 s; @q4 sounds half of it
    close(events[0].freq, midiToFreq(60))
    expect(events[1].dur).toBe(1)
  })

  it('keeps a long song in step: the 64th bar starts at 64 bars exactly', () => {
    const { events } = sequence({ tempo: 138, channels: { p1: '[C4:16]1024 D4' } })
    close(events.at(-1).time, 64 * 4 * 60 / 138, 1e-9)
  })
})

describe('scheduler', () => {
  const fake = (events, opts = {}) => {
    const clock = { t: 10 }
    const out = []
    const s = new Scheduler({ now: () => clock.t, onEvent: (ev, at) => out.push([ev.id, at]), lookahead: 0.1, ...opts })
    return { clock, out, s }
  }
  const evs = [0, 0.05, 0.1, 0.25, 0.5].map((time, id) => ({ id, time }))

  it('schedules only what falls inside the lookahead, at exact clock times, once', () => {
    const { clock, out, s } = fake(evs)
    s.start(evs, { at: 10 })
    expect(s.pump()).toBe(2)
    expect(out).toEqual([[0, 10], [1, 10.05]])
    expect(s.pump()).toBe(0)
    clock.t = 10.06
    s.pump()
    clock.t = 10.2
    s.pump()
    expect(out.map((o) => o[0])).toEqual([0, 1, 2, 3])
    close(out[3][1], 10.25)
    clock.t = 10.45
    s.pump()
    expect(s.done).toBe(true)
    expect(out).toHaveLength(5)
  })

  it('resumes from an offset into the song', () => {
    const { out, s } = fake(evs)
    s.start(evs, { at: 10, offset: 0.2 })
    s.pump(1)
    expect(out.map((o) => o[0])).toEqual([3, 4])
    close(out[0][1], 10.05)
    close(s.position, 0.2)
  })

  it('skips notes that are already late instead of playing them in a burst', () => {
    const { clock, out, s } = fake(evs)
    s.start(evs, { at: 10 })
    clock.t = 10.3 // the page stalled
    s.pump()
    expect(out.map((o) => o[0])).toEqual([3])
    expect(s.skipped).toBe(3)
  })
})

describe('voices', () => {
  it('builds a 50% pulse from odd harmonics only', () => {
    const { real, imag } = stepWaveCoefficients([0, 1, 1, 1, 1, 0, 0, 0], 8)
    const mag = (h) => Math.hypot(real[h], imag[h])
    close(mag(2), 0, 1e-6)
    close(mag(4), 0, 1e-6)
    close(mag(1), 4 / Math.PI, 1e-6) // a square wave's series: 4/(πh) on odd h
    close(mag(3), 4 / (3 * Math.PI), 1e-6)
  })

  it('runs the noise LFSR with the NES periods: 32767 long, 93 short', () => {
    const period = (short) => {
      const s = lfsr(70000, short)
      for (let p = 1; p < 40000; p++) {
        let same = true
        for (let i = 20000; i < 20200 && same; i++) same = s[i] === s[i + p]
        if (same) return p
      }
      return 0
    }
    expect(period(false)).toBe(32767)
    expect(period(true)).toBe(93)
  })

  it('maps NES timer values to pitch', () => {
    close(timerToFreq('p1', 253), 440.4, 0.1) // the usual A4 timer
    close(timerToFreq('tri', 126), 440.4, 0.1)
  })
})

describe('playlist', () => {
  it('has eight credited tracks that parse, with channels of equal length', () => {
    expect(PLAYLIST).toHaveLength(8)
    for (const song of PLAYLIST) {
      expect(song.title).toBeTruthy()
      expect(song.composer).toBeTruthy()
      expect(['public domain', 'original, MIT']).toContain(song.license)
      const lens = Object.entries(song.channels).map(([ch, t]) => parseChannel(t, { channel: ch }).beats)
      const { duration, events } = sequence(song)
      expect(duration).toBeGreaterThan(30)
      expect(duration).toBeLessThan(120)
      expect(events.length).toBeGreaterThan(100)
      // Every voice ends within a bar of the longest (an echo or a ringing crash may differ).
      for (const l of lens) expect(Math.max(...lens) - l).toBeLessThanOrEqual(2)
    }
  })
})

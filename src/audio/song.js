// The jukebox's song format: one line of text per channel, a small MML
// in scientific pitch, parsed into note events in beats and then timed in
// seconds against the song's tempo map. Pure functions: no Web Audio here,
// so the parser and the timing are testable in Node.
//
// A song is data:
//
//   { title, composer, arranger, license, tempo: 138 | [[beat, bpm], …],
//     channels: { p1: '…', p2: '…', tri: '…', noise: '…' } }
//
// Channel text, whitespace-separated (a beat is a quarter note):
//
//   C4 F#5 Bb3     a note; C4 is middle C. Without an octave (C, F#) it
//                  takes the current one. Each note sets the current octave.
//   C4:8  E:4.     a duration: 1 2 4 8 16 32, dots, `t` for a triplet
//                  (C:8t). Without one, the default from @l.
//   r  r:2         a rest
//   ~  ~:8         a tie: holds the previous note longer
//   {A3 C4 E4}:4   an arpeggio: one note that cycles its pitches fast,
//                  the chiptune way of playing a chord on one voice
//   K S H X T      drums: kick, snare, closed hat, open hat/crash, tom
//                  (K and T on the triangle are pitch drops, the NES kick)
//   > <  >>        octave up, down (repeat to move further)
//   [ … ]3         repeat the group three times (nests)
//   |              a bar line; ignored, for reading
//   @l8            default duration        @o4  octave
//   @v12           volume, 0–15            @d1  duty: 0 12.5%, 1 25%, 2 50%, 3 75%
//   @q6            gate: notes sound 6/8 of their length (staccato below 8)
//   @e:pluck       volume envelope, by name (see ENVELOPES in apu.js)
//   @k2            transpose the notes after it by 2 semitones (@k0 undoes it)

export const CHANNELS = ['p1', 'p2', 'tri', 'noise']
export const DRUMS = ['K', 'S', 'H', 'X', 'T']

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const DEFAULTS = { octave: 4, len: 1, vol: 10, duty: 2, q: 8, env: null, key: 0 }

/** MIDI note number: C4 = 60, A4 = 69. */
export function midi(letter, accidental = '', octave = 4) {
  const acc = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return 12 * (octave + 1) + LETTERS[letter] + acc
}

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12)

/** "8" → 0.5 beats, "4." → 1.5, "8t" → 1/3, "2.." → 3.5. */
export function durationBeats(spec) {
  const m = /^(1|2|4|8|16|32|64)(\.*)(t?)$/.exec(spec)
  if (!m) throw new Error(`bad duration "${spec}"`)
  const base = 4 / Number(m[1])
  const dots = m[2].length
  return base * (2 - 2 ** -dots) * (m[3] ? 2 / 3 : 1)
}

/** Splits channel text into tokens, keeping arpeggio braces whole. */
export function tokenize(text) {
  return text.match(/\{[^}]*\}(?::\S+)?|\[|\]\d*|[^\s[\]|{}]+/g) ?? []
}

/** Expands [ … ]n repeats into a flat token list. */
export function expandRepeats(tokens) {
  const stack = [[]]
  for (const t of tokens) {
    if (t === '[') stack.push([])
    else if (t[0] === ']') {
      if (stack.length === 1) throw new Error('unmatched ]')
      const body = stack.pop()
      const n = t.length > 1 ? Number(t.slice(1)) : 2
      for (let i = 0; i < n; i++) stack[stack.length - 1].push(...body)
    } else stack[stack.length - 1].push(t)
  }
  if (stack.length !== 1) throw new Error('unmatched [')
  return stack[0]
}

const NOTE = /^([A-G])(#|b)?(\d)?(?::(\S+))?$/
const DRUM = /^([KSHXT])(?::(\S+))?$/
const REST = /^([r~])(?::(\S+))?$/
const ARP = /^\{([^}]*)\}(?::(\S+))?$/

/**
 * Parses one channel's text into events in beats.
 * @returns {{events: Array<{beat: number, beats: number, gate: number, midi?: number, midis?: number[],
 *   drum?: string, vol: number, duty: number, env: string|null}>, beats: number}}
 */
export function parseChannel(text, { channel = '?' } = {}) {
  const s = { ...DEFAULTS }
  const events = []
  let beat = 0
  let last = null
  const fail = (tok, why) => { throw new Error(`${channel}: ${why} at "${tok}"`) }
  const len = (spec, tok) => {
    if (spec == null) return s.len
    try { return durationBeats(spec) } catch { return fail(tok, 'bad duration') }
  }
  const pitch = (tok) => {
    const m = NOTE.exec(tok)
    if (!m) fail(tok, 'not a note')
    if (m[3] != null) s.octave = Number(m[3])
    return { midi: midi(m[1], m[2], s.octave) + s.key, spec: m[4] }
  }
  const push = (ev, beats) => {
    last = { beat, beats, q: s.q, vol: s.vol / 15, duty: s.duty, env: s.env, ...ev }
    events.push(last)
    beat += beats
  }
  for (const tok of expandRepeats(tokenize(text))) {
    let m
    if (tok[0] === '@') {
      const key = tok[1], val = tok.slice(2).replace(/^:/, '')
      if (key === 'l') s.len = len(val, tok)
      else if (key === 'o') s.octave = Number(val)
      else if (key === 'v') s.vol = Math.max(0, Math.min(15, Number(val)))
      else if (key === 'd') s.duty = Number(val) & 3
      else if (key === 'q') s.q = Math.max(1, Math.min(8, Number(val)))
      else if (key === 'e') s.env = val
      else if (key === 'k') s.key = Number(val)
      else fail(tok, 'unknown setting')
      if ('ovdqk'.includes(key) && (val === '' || Number.isNaN(Number(val)))) fail(tok, 'not a number')
    } else if (/^[<>]+$/.test(tok)) {
      for (const c of tok) s.octave += c === '>' ? 1 : -1
    }
    else if ((m = REST.exec(tok))) {
      const b = len(m[2], tok)
      if (m[1] === '~') {
        if (!last) fail(tok, 'tie with nothing to hold')
        last.beats += b
        beat += b
      } else { beat += b; last = null }
    } else if ((m = DRUM.exec(tok))) push({ drum: m[1] }, len(m[2], tok))
    else if ((m = ARP.exec(tok))) {
      const midis = m[1].trim().split(/\s+/).map((n) => pitch(n).midi)
      if (!midis.length) fail(tok, 'empty arpeggio')
      push({ midis }, len(m[2], tok))
    } else if (NOTE.test(tok)) {
      const p = pitch(tok)
      push({ midi: p.midi }, len(p.spec, tok))
    } else fail(tok, 'unknown token')
  }
  for (const e of events) {
    // The gate shortens a note but never below a 64th, and a tie holds it.
    e.gate = Math.max(Math.min(e.beats, 1 / 16), e.beats * e.q / 8)
    delete e.q
  }
  return { events, beats: beat }
}

/** Seconds at a beat, for a tempo (bpm) or a map [[beat, bpm], …] of steps. */
export function tempoMap(tempo) {
  const steps = (Array.isArray(tempo) ? tempo : [[0, tempo]]).slice().sort((a, b) => a[0] - b[0])
  if (steps[0][0] !== 0) steps.unshift([0, steps[0][1]])
  const starts = [0] // seconds at each step's beat
  for (let i = 1; i < steps.length; i++) starts.push(starts[i - 1] + (steps[i][0] - steps[i - 1][0]) * 60 / steps[i - 1][1])
  return (beat) => {
    let i = steps.length - 1
    while (i > 0 && steps[i][0] > beat) i--
    return starts[i] + (beat - steps[i][0]) * 60 / steps[i][1]
  }
}

/**
 * Times a song: every channel's events in seconds, merged and sorted.
 * @returns {{events: Array<{time: number, dur: number, ch: string, freq?: number, freqs?: number[],
 *   drum?: string, vol: number, duty: number, env: string|null}>, duration: number, beats: number}}
 */
export function sequence(song) {
  const at = tempoMap(song.tempo ?? 120)
  const events = []
  let beats = 0
  for (const ch of CHANNELS) {
    const text = song.channels?.[ch]
    if (!text) continue
    const parsed = parseChannel(text, { channel: `${song.title ?? 'song'}/${ch}` })
    beats = Math.max(beats, parsed.beats)
    for (const e of parsed.events) {
      const time = at(e.beat)
      const ev = { time, dur: at(e.beat + e.gate) - time, ch, vol: e.vol, duty: e.duty, env: e.env }
      if (e.drum) ev.drum = e.drum
      else if (e.midis) ev.freqs = e.midis.map(midiToFreq)
      else ev.freq = midiToFreq(e.midi)
      events.push(ev)
    }
  }
  // Stable by time, then channel order, so simultaneous notes keep an order.
  events.sort((a, b) => a.time - b.time || CHANNELS.indexOf(a.ch) - CHANNELS.indexOf(b.ch))
  return { events, duration: at(beats), beats }
}

// Max's babble: his lines sung as NES blips, a blip per syllable, the way
// 8-bit games talked before they could speak.
//
// The text sets the tune: syllables from each word's vowel groups, a
// pentatonic melody that drifts down over a sentence (as speech does) and
// rises at a question, brighter at an exclamation, pauses at commas and
// full stops. Vowels pick the pulse's duty (a, o, u darker; e, i brighter).
// It's deterministic, so everyone in the room hears the same tune.

const PENTA = [0, 2, 4, 7, 9] // a major pentatonic: blips that never clash

/**
 * The score for a line: notes {t, dur, freq, duty, vol} (seconds, Hz).
 * @param {string} text
 * @param {{base?: number, rate?: number}} o base pitch (Hz), speed (1 = normal)
 */
export function babbleScore(text, { base = 196, rate = 1 } = {}) {
  const notes = []
  const syl = 0.075 / rate, gap = 0.022 / rate
  let t = 0
  // Sentences, each with its own contour.
  const sentences = String(text).match(/[^.!?]+[.!?]*/g) ?? []
  let seed = hash(text)
  for (const s of sentences) {
    const words = s.match(/[a-z0-9']+|[,;:]/gi) ?? []
    const question = /\?\s*$/.test(s), exclaim = /!\s*$/.test(s)
    const sylls = []
    for (const w of words) {
      if (/^[,;:]$/.test(w)) { sylls.push({ pause: 0.16 }); continue }
      for (const v of vowelGroups(w)) sylls.push({ v })
      sylls.push({ pause: 0.035 }) // between words
    }
    const n = sylls.filter((x) => x.v).length
    let k = 0
    for (const x of sylls) {
      if (x.pause) { t += x.pause / rate; continue }
      seed = next(seed)
      // Down a little over the sentence; a wander on the scale; up at the end of a question.
      const fall = n > 1 ? (-4 * k) / (n - 1) : 0
      const step = PENTA[seed % PENTA.length] - 4
      const rise = question && k >= n - 2 ? 5 + (k - (n - 2)) * 4 : 0
      const semis = Math.round(fall) + step + rise + (exclaim ? 3 : 0)
      const freq = base * 2 ** (snap(semis) / 12)
      const duty = /[aou]/.test(x.v) ? 0.5 : /[ei]/.test(x.v) ? 0.125 : 0.25
      const long = x.v.length > 1 ? 1.35 : 1
      notes.push({ t, dur: syl * long, freq, duty, vol: exclaim ? 0.3 : 0.24 })
      t += syl * long + gap
      k++
    }
    t += /[.!?]\s*$/.test(s) ? 0.26 / rate : 0.1 / rate
  }
  return notes
}

/**
 * Renders a line to samples: pulse waves with a quick attack and decay.
 * @returns {Float32Array}
 */
export function renderBabble(text, sampleRate = 48000, o = {}) {
  const notes = babbleScore(text, o)
  const end = notes.length ? notes.at(-1).t + notes.at(-1).dur + 0.05 : 0
  const out = new Float32Array(Math.ceil(end * sampleRate))
  for (const nt of notes) {
    const i0 = Math.floor(nt.t * sampleRate), len = Math.floor(nt.dur * sampleRate)
    const att = Math.floor(0.004 * sampleRate), rel = Math.floor(0.012 * sampleRate)
    let phase = 0
    const inc = nt.freq / sampleRate
    for (let j = 0; j < len && i0 + j < out.length; j++) {
      phase += inc
      if (phase >= 1) phase -= 1
      const s = phase < nt.duty ? 1 : -1
      // Attack, a little decay to 70%, release; and 4-bit volume steps, like the NES.
      let env = j < att ? j / att : 1 - 0.3 * Math.min(1, (j - att) / (len - att))
      if (j > len - rel) env *= (len - j) / rel
      env = Math.round(env * 15) / 15
      out[i0 + j] += s * env * nt.vol
    }
  }
  return out
}

/** Each run of vowels in a word (y counts after a consonant), at least one per word. */
export function vowelGroups(word) {
  const w = word.toLowerCase().replace(/e$/, '') || word.toLowerCase() // a silent final e
  const groups = w.match(/[aeiou]+|(?<=[^aeiou])y/g)
  return groups && groups.length ? groups.slice(0, 5) : ['a']
}

/** Nearest semitone that's on the pentatonic scale. */
function snap(semis) {
  const oct = Math.floor(semis / 12), r = ((semis % 12) + 12) % 12
  let best = PENTA[0], d = 99
  for (const p of [...PENTA, 12]) if (Math.abs(p - r) < d) { d = Math.abs(p - r); best = p }
  return oct * 12 + best
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function next(x) { return (Math.imul(x, 1664525) + 1013904223) >>> 0 }

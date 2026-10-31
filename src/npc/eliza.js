// ELIZA, after Weizenbaum's DOCTOR (1966) and Emacs's doctor.el: a
// keyword-and-template conversation engine. It doesn't understand a word;
// it notices them. The script (max-script.js for the bartender) holds the
// words; this file holds the machinery.
//
// How a reply is made:
//   1. Rewrites: regexes on the raw text (Max drops "Max," from the front).
//   2. Clauses: split on . , ; : ! ? and "but"; the first clause holding a
//      keyword is the one answered (later ones are tried if it fails).
//   3. Pre-substitution, word by word (dont → don't, i'm → i am, …).
//   4. Keywords: the clause's keywords, highest rank first, ties in the
//      order seen (Weizenbaum's keystack).
//   5. Decomposition: each of the keyword's rules is a pattern over words,
//      `*` for any run of words (shortest first), `@group` for one word of
//      a synonym group, `a|b` for one of those words. `*`, `@group` and
//      `a|b` each capture, numbered from 1 in order.
//   6. Reassembly: the rule's templates, used in turn (a cycle per rule,
//      from a random start), with (n) replaced by capture n, reflected
//      (my → your, I am → you are, …). A template whose captures are all
//      empty is skipped. `goto key` answers with another keyword's rules;
//      `newkey` gives up on this keyword and tries the next.
//   7. Memory: a keyword's `memory` rules (DOCTOR's MY) store a reflection
//      when that keyword is answered; when nothing matches, the oldest
//      memory comes back ("Earlier you said your boss never listens to
//      you."). Failing that, the `xnone` keyword answers.
//
// Script shape:
//   { pre: {word: 'replacement'}, synon: {group: [words]},
//     rewrite: [[RegExp, string]], keywords: [{ key: 'word' | [words],
//     name?, rank, rules: [{ decomp, reasmb: [templates] }], memory?: [rules],
//     goto?: key, bar?: true }], initial, empty, asides, asideChance }
// A keyword's name defaults to its first key; `goto` and `lastKey` use it,
// and an entry with a name and no keys is reachable only by goto.
// `bar: true` marks keywords that already talk shop, so they get no aside.

/** A seeded RNG (mulberry32): the same seed, the same conversation. */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Pronoun and verb reflection, from the speaker's side to the listener's.
const SWAP = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', myself: 'yourself',
  "i'm": "you're", "i've": "you've", "i'll": "you'll", "i'd": "you'd",
  your: 'my', yours: 'mine', yourself: 'myself', yourselves: 'ourselves',
  "you're": "I'm", "you've": "I've", "you'll": "I'll", "you'd": "I'd",
  am: 'are',
}
// After these, "you" is a subject (→ I); otherwise an object (→ me).
const SUBJECT_NEXT = new Set(('are were was have had do did don\'t didn\'t can can\'t could couldn\'t ' +
  'will won\'t would wouldn\'t should shouldn\'t must may might never always really just also still ' +
  'think thought feel felt know knew want wanted need needed like liked love loved hate hated say said ' +
  'seem seemed make made go went see saw look looked mean meant believe wish remind reminded get got ' +
  'keep kept tell told understand care sound sounded pour poured listen listened')
  .split(' '))
const INVERTING = new Set('are were do did can could will would should have had'.split(' '))

function reflectTokens(tokens) {
  return tokens.map((t, i) => {
    const w = t.w
    const prev = tokens[i - 1]?.w
    const next = tokens[i + 1]?.w
    if (w === 'you') {
      const subject = SUBJECT_NEXT.has(next) || INVERTING.has(prev) || (i === 0 && next !== undefined)
      return subject ? 'I' : 'me'
    }
    if (w === 'are') return prev === 'you' || next === 'you' ? 'am' : t.o
    if (w === 'were') return prev === 'you' || next === 'you' ? 'was' : t.o
    if (w === 'was') return prev === 'i' || next === 'i' ? 'were' : t.o
    return SWAP[w] ?? t.o
  }).join(' ')
}

const word = (o) => ({ w: o.toLowerCase(), o })

/** Reflects a fragment: "I am sad about my job" → "you are sad about your job". */
export function reflect(text) {
  return reflectTokens(String(text).split(/\s+/).filter(Boolean).map(word))
}

// Text → clauses → words ({w: lowercase, o: as typed}), pre-substituted.
function clausesOf(text, pre) {
  const clean = text.replace(/[’‘`´]/g, "'").replace(/[“”"]/g, ' ')
  return clean.split(/[.,;:!?]+|\s-+\s|\bbut\b/i).map((clause) => {
    const raw = clause.split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, '').replace(/^['-]+|['-]+$/g, ''))
      .filter(Boolean)
    // Sentence-initial capitals aren't names; acronyms and numbers are kept.
    if (raw.length && !/^[\p{Lu}\p{N}]{2,}$/u.test(raw[0])) raw[0] = raw[0].toLowerCase()
    const out = []
    for (const w of raw) {
      const sub = pre[w.toLowerCase()]
      if (sub === undefined) out.push(word(w))
      else for (const s of sub.split(/\s+/).filter(Boolean)) out.push(word(s))
    }
    return out.slice(0, 64)
  }).filter((c) => c.length)
}

function compilePattern(decomp, synon) {
  return decomp.trim().split(/\s+/).map((t) => {
    if (t === '*') return { star: true }
    if (t.startsWith('@')) {
      const group = synon[t.slice(1)]
      if (!group) throw new Error(`eliza: unknown synonym group ${t}`)
      return { set: new Set([t.slice(1), ...group].map((s) => s.toLowerCase())), capture: true }
    }
    const alts = t.toLowerCase().split('|')
    return { set: new Set(alts), capture: alts.length > 1 }
  })
}

// Matches a compiled pattern against a whole clause; returns the captures
// (arrays of words) or null. Stars are lazy, as in DOCTOR.
function match(parts, words, pi = 0, wi = 0, caps = []) {
  if (pi === parts.length) return wi === words.length ? caps : null
  const p = parts[pi]
  if (p.star) {
    for (let k = wi; k <= words.length; k++) {
      const r = match(parts, words, pi + 1, k, [...caps, words.slice(wi, k)])
      if (r) return r
    }
    return null
  }
  if (wi >= words.length || !p.set.has(words[wi].w)) return null
  return match(parts, words, pi + 1, wi + 1, p.capture ? [...caps, [words[wi]]] : caps)
}

// Fills (n) with reflected captures; null if every capture it uses is empty.
function assemble(template, caps) {
  let refs = 0
  let filled = 0
  const out = template.replace(/\((\d+)\)/g, (_, n) => {
    refs++
    const c = caps[n - 1] ?? []
    if (c.length) filled++
    return reflectTokens(c)
  })
  return refs && !filled ? null : out
}

function tidy(s) {
  const t = s.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Makes a conversation. `random` is an RNG (() => [0, 1)) or a numeric
 * seed; with a seed, the same inputs give the same replies.
 * @returns {{ respond(text: string): string, greet(): string, memory: string[], lastKey: string|null }}
 */
export function makeEliza(script, { random = Math.random, seed, asideChance, memoryLimit = 8 } = {}) {
  const rand = typeof random === 'number' ? seeded(random)
    : seed !== undefined ? seeded(seed) : random
  const synon = script.synon ?? {}
  const pre = script.pre ?? {}
  const chance = asideChance ?? script.asideChance ?? 0

  // A list used in turn, from a random start.
  const cycle = (items) => ({ items, next: items.length ? Math.floor(rand() * items.length) : 0 })
  const take = (c) => { const x = c.items[c.next]; c.next = (c.next + 1) % c.items.length; return x }
  const compileRule = (r) => ({ parts: compilePattern(r.decomp, synon), reasmb: cycle(r.reasmb) })

  const byWord = new Map()
  const byName = new Map()
  for (const k of script.keywords) {
    const keys = [].concat(k.key ?? []).map((s) => s.toLowerCase())
    const entry = {
      name: k.name ?? keys[0], rank: k.rank ?? 0, goto: k.goto, bar: !!k.bar,
      rules: (k.rules ?? []).map(compileRule),
      memory: (k.memory ?? []).map((r) => ({ parts: compilePattern(r.decomp, synon), reasmb: r.reasmb })),
    }
    if (!entry.name) throw new Error('eliza: a keyword needs a key or a name')
    for (const w of keys) if (!byWord.has(w)) byWord.set(w, entry)
    if (!byName.has(entry.name)) byName.set(entry.name, entry)
  }
  const named = (n) => byName.get(n.trim().toLowerCase()) ?? byWord.get(n.trim().toLowerCase())
  const xnone = named('xnone')
  const initial = cycle(script.initial ?? [])
  const empty = cycle(script.empty ?? [])
  const asides = cycle(script.asides ?? [])

  const memory = []
  const self = { memory, lastKey: null, respond, greet }

  function keystack(words) {
    const seen = []
    for (const t of words) {
      const k = byWord.get(t.w)
      if (k && k !== xnone && !seen.includes(k)) seen.push(k)
    }
    return seen.sort((a, b) => b.rank - a.rank) // stable: ties stay in order seen
  }

  function tryKey(entry, words, depth = 0) {
    if (!entry || depth > 8) return null
    if (entry.goto) return tryKey(named(entry.goto), words, depth + 1)
    for (const m of entry.memory) {
      const caps = match(m.parts, words)
      if (!caps) continue
      const r = assemble(m.reasmb[Math.floor(rand() * m.reasmb.length)], caps)
      if (r) {
        memory.push(tidy(r))
        if (memory.length > memoryLimit) memory.shift()
      }
      break
    }
    for (const rule of entry.rules) {
      const caps = match(rule.parts, words)
      if (!caps) continue
      for (let n = 0; n < rule.reasmb.items.length; n++) {
        const r = take(rule.reasmb)
        if (r === 'newkey') return null
        if (r.startsWith('goto ')) return tryKey(named(r.slice(5)), words, depth + 1)
        const out = assemble(r, caps)
        if (out !== null) return { text: out, entry }
      }
    }
    return null
  }

  function respond(text) {
    let input = String(text ?? '')
    for (const [re, to] of script.rewrite ?? []) {
      const t = input.replace(re, to)
      if (t.trim()) input = t
    }
    const clauses = clausesOf(input, pre)
    let hit = null
    if (!clauses.length && empty.items.length) {
      self.lastKey = null
      return tidy(take(empty))
    }
    for (const words of clauses) {
      for (const k of keystack(words)) if ((hit = tryKey(k, words))) break
      if (hit) break
    }
    if (hit) {
      self.lastKey = hit.entry.name
      let out = hit.text
      if (!hit.entry.bar && asides.items.length && rand() < chance) out += ' ' + take(asides)
      return tidy(out)
    }
    if (memory.length) {
      self.lastKey = 'memory'
      return memory.shift()
    }
    hit = tryKey(xnone, clauses[0] ?? [])
    self.lastKey = 'xnone'
    return tidy(hit ? hit.text : '...')
  }

  function greet() {
    return initial.items.length ? tidy(take(initial)) : ''
  }

  return self
}

import { describe, expect, it } from 'vitest'
import { makeEliza, reflect, seeded } from '../src/npc/eliza.js'
import { MAX_SCRIPT, MENU, greetingFor } from '../src/npc/max-script.js'

const max = (seed = 1966) => makeEliza(MAX_SCRIPT, { random: seed, asideChance: 0 })
// Replies to the same line, said n times to one conversation.
const replies = (e, text, n) => Array.from({ length: n }, () => e.respond(text))

// A tiny script to test the machinery without Max's words.
const TINY = {
  pre: { dont: "don't" },
  synon: { belief: ['feel', 'think', 'believe', 'wish'] },
  keywords: [
    { key: 'apple', rank: 1, rules: [{ decomp: '*', reasmb: ['apple'] }] },
    { key: 'banana', rank: 5, rules: [{ decomp: '*', reasmb: ['banana'] }] },
    { key: 'cherry', rank: 5, rules: [{ decomp: '*', reasmb: ['cherry'] }] },
    { key: 'durian', rank: 9, rules: [{ decomp: '* durian pie *', reasmb: ['durian pie'] }] },
    { key: 'fig', rank: 0, goto: 'cherry' },
    { key: 'i', rank: 0, rules: [
      { decomp: '* i @belief *', reasmb: ['You (2) (3)?'] },
      { decomp: "* i don't *", reasmb: ["Why don't you (2)?"] },
      { decomp: '* i am *', reasmb: ['One: (2).', 'Two: (2).', 'Three: (2).'] },
    ] },
    { key: 'my', rank: 2, memory: [{ decomp: '* my *', reasmb: ['Earlier you said your (2).'] }],
      rules: [{ decomp: '* my *', reasmb: ['Your (2)?'] }] },
    { key: 'xnone', rules: [{ decomp: '*', reasmb: ['Go on.'] }] },
  ],
}

describe('reflect', () => {
  it('swaps pronouns and verbs', () => {
    expect(reflect('I am sad about my job')).toBe('you are sad about your job')
    expect(reflect('you are my friend')).toBe('I am your friend')
    expect(reflect('I love you')).toBe('you love me')
    expect(reflect('you know me')).toBe('I know you')
    expect(reflect('I was wrong and you were right')).toBe('you were wrong and I was right')
    expect(reflect('I told myself')).toBe('you told yourself')
    expect(reflect('yours or mine')).toBe('mine or yours')
    expect(reflect('they are here')).toBe('they are here')
  })
})

describe('the engine', () => {
  it('answers the highest-ranked keyword, the first seen on a tie', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('apple banana')).toBe('Banana')
    expect(e.respond('cherry banana apple')).toBe('Cherry')
    expect(e.respond('banana cherry')).toBe('Banana')
  })

  it('tries the next keyword when no decomposition matches', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('durian and apple')).toBe('Apple')
    expect(e.respond('durian pie and apple')).toBe('Durian pie')
  })

  it('follows goto links between keywords', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('fig')).toBe('Cherry')
    expect(e.lastKey).toBe('cherry')
  })

  it('captures wildcards and synonyms, reflected, and pre-substitutes', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('I feel that my cat hates me')).toBe('Your cat hates you?') // my outranks i
    expect(e.respond('I believe you')).toBe('You believe me?')
    expect(e.respond('I dont like mondays')).toBe("Why don't you like mondays?")
  })

  it('answers the first clause that has a keyword', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('Well, whatever. Apple, banana')).toBe('Apple')
    expect(e.respond('nothing here but banana')).toBe('Banana')
  })

  it('cycles reassemblies so a repeated line gets a new answer', () => {
    const e = makeEliza(TINY, { random: 1 })
    const r = replies(e, 'I am here', 6)
    expect(new Set(r.slice(0, 3)).size).toBe(3)
    expect(r.slice(3)).toEqual(r.slice(0, 3))
    expect(r.every((x) => x.endsWith(': here.'))).toBe(true)
  })

  it('remembers what you said about yours and brings it back when nothing matches', () => {
    const e = makeEliza(TINY, { random: 1 })
    expect(e.respond('My boss never listens to me.')).toBe('Your boss never listens to you?')
    expect(e.memory).toEqual(['Earlier you said your boss never listens to you.'])
    expect(e.respond('Hmm.')).toBe('Earlier you said your boss never listens to you.')
    expect(e.memory).toEqual([])
    expect(e.respond('Hmm.')).toBe('Go on.')
  })

  it('is deterministic for a seed, and takes an RNG', () => {
    const lines = ['Hello', 'I am tired', 'My dog ran off', 'Are you a robot?', 'whatever',
      'What do you recommend?', 'I need a holiday', 'ok', 'Why?', 'I want a beer']
    const a = makeEliza(MAX_SCRIPT, { random: 42 })
    const b = makeEliza(MAX_SCRIPT, { random: 42 })
    const c = makeEliza(MAX_SCRIPT, { random: seeded(42) })
    const ra = lines.map((l) => a.respond(l))
    expect(lines.map((l) => b.respond(l))).toEqual(ra)
    expect(lines.map((l) => c.respond(l))).toEqual(ra)
    const others = [1, 2, 3].map((s) => { const d = makeEliza(MAX_SCRIPT, { random: s }); return lines.map((l) => d.respond(l)) })
    expect(others.some((o) => o.join() !== ra.join())).toBe(true)
  })
})

describe('Max', () => {
  it('reflects "I am" statements through the am rule', () => {
    const e = max()
    const r = replies(e, 'I am sad about my job', 5)
    expect(e.lastKey).toBe('am')
    expect(r.some((x) => x.includes('you are sad about your job'))).toBe(true)
    expect(new Set(r).size).toBe(5)
    expect(max().respond('I am a little lost tonight')).toMatch(/a little lost tonight/)
  })

  it('takes "Max," and "hi Max" as address, not as the topic', () => {
    const e = max()
    e.respond('Max, I am lonely')
    expect(e.lastKey).toBe('am')
    e.respond('hi max')
    expect(e.lastKey).toBe('hello')
    expect(e.respond('Who are you?')).toMatch(/Max Pablo/)
    expect(e.respond("What's your name?")).toMatch(/Max Pablo/)
  })

  it('pours from the menu', () => {
    const e = max()
    for (const text of ["What's on the menu?", 'What do you recommend?']) {
      const r = e.respond(text)
      expect(e.lastKey).toBe('drink')
      for (const drink of MENU) expect(r).toContain(drink)
      expect(r).toMatch(/cycles/)
    }
    e.respond('I want a beer')
    expect(e.lastKey).toBe('drink') // outranks i
    expect(e.respond('A Stack Overflow, please')).toMatch(/Stack Overflow/)
    expect(e.lastKey).toBe('cocktail')
    e.respond('I did it in order to win')
    expect(e.lastKey).not.toBe('drink')
  })

  it('remembers, as DOCTOR did', () => {
    const e = max()
    e.respond('My sister never calls me.')
    expect(e.respond('Hmm.')).toMatch(/your sister never calls you/)
  })

  it('talks shop: the chip, the Mist, Pablo, the jukebox, goodbye', () => {
    const e = max()
    const keyOf = (t) => { e.respond(t); return e.lastKey }
    expect(keyOf('Does this bar really run on a 6502?')).toBe('chip')
    expect(keyOf('Who owns my data?')).toBe('mist')
    expect(keyOf('Is Pablo here?')).toBe('pablo')
    expect(keyOf('Put something on the jukebox')).toBe('jukebox')
    expect(keyOf('Is that the Game of Life on the wall?')).toBe('life-wall')
    expect(keyOf('My life is a mess')).toBe('my') // only Conway's Life is shop talk
    expect(keyOf('My computer hates me')).toBe('computer')
    expect(keyOf('You are a strange bartender')).toBe('you')
    expect(keyOf('ok, bye')).toBe('goodbye')
  })

  it('takes trouble seriously', () => {
    const e = max()
    expect(e.respond('I want to die')).toMatch(/crisis line/)
    expect(e.respond('the cells die on the wall')).not.toMatch(/crisis/)
  })

  it('always says something', () => {
    const e = max()
    for (const t of ['', '   ', '?!', 'xyzzy', 'I', 'my', 'you', 'am', 'if', '42']) {
      const r = e.respond(t)
      expect(typeof r).toBe('string')
      expect(r.length).toBeGreaterThan(0)
      expect(r).not.toMatch(/\(\d\)|undefined|\s[.?!]/)
    }
  })

  it('greets by name', () => {
    expect(greetingFor('Ann', () => 0)).toMatch(/Ann/)
    expect(greetingFor('', () => 0)).toBe(MAX_SCRIPT.initial[0])
    expect(max().greet()).toMatch(/\S/)
  })
})

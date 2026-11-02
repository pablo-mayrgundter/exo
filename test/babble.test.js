import { describe, expect, it } from 'vitest'
import { babbleScore, renderBabble, vowelGroups } from '../src/voice/babble.js'

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length

describe("Max's babble", () => {
  it('finds a blip per syllable', () => {
    expect(vowelGroups('cafe')).toEqual(['a']) // a silent final e
    expect(vowelGroups('interrupt')).toEqual(['i', 'e', 'u'])
    expect(vowelGroups('rhythm')).toEqual(['y'])
    expect(vowelGroups('pour')).toEqual(['ou'])
    expect(vowelGroups('nth')).toEqual(['a']) // every word gets one
    expect(babbleScore('Zero Page').length).toBe(3)
  })

  it('is the same tune every time, for everyone', () => {
    const a = babbleScore('One Carry Flag, coming up.'), b = babbleScore('One Carry Flag, coming up.')
    expect(a).toEqual(b)
    expect(babbleScore('One Zero Page, coming up.')).not.toEqual(a)
  })

  it('rises at a question, brightens at an exclamation, pauses at a comma', () => {
    const q = babbleScore('Another Carry Flag tonight?')
    expect(q.at(-1).freq).toBeGreaterThan(mean(q.slice(0, -2).map((n) => n.freq)) * 1.2)
    const plain = babbleScore('The one you can not ignore.'), loud = babbleScore('The one you can not ignore!')
    expect(mean(loud.map((n) => n.freq))).toBeGreaterThan(mean(plain.map((n) => n.freq)))
    const c = babbleScore('Evening, stranger')
    const gaps = c.slice(1).map((n, i) => n.t - (c[i].t + c[i].dur))
    expect(Math.max(...gaps)).toBeGreaterThan(0.15)
  })

  it('renders pulse blips that fit in range, as long as the score', () => {
    const y = renderBabble('Welcome to Exo Cafe.', 48000)
    const s = babbleScore('Welcome to Exo Cafe.')
    expect(y.length / 48000).toBeCloseTo(s.at(-1).t + s.at(-1).dur + 0.05, 2)
    let peak = 0
    for (const v of y) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.2)
    expect(peak).toBeLessThanOrEqual(0.31)
    expect(renderBabble('', 48000).length).toBe(0)
  })
})

describe("Max's words, in pieces", () => {
  it('splits a line into sentences, and long sentences at commas', async () => {
    const { chunks } = await import('../src/voice/maxvoice.js')
    expect(chunks('Evening. Have a seat! What will it be?')).toEqual(['Evening.', 'Have a seat!', 'What will it be?'])
    const long = 'I am the source, the owner and controller of my cybernetic self, my data and my compute, and my cycles, and every byte I give away, and every frame I render for strangers.'
    const parts = chunks(long)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(140)
    expect(parts.join(' ')).toBe(long)
    expect(chunks('')).toEqual([])
  })
})

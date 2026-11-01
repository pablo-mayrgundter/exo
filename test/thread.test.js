import { describe, expect, it } from 'vitest'
import { Thread, timeOf } from '../src/chat/thread.js'

describe('chat thread', () => {
  it('keeps lines in order, the last max of them, and saves them', () => {
    let saved = null
    const t = new Thread({ max: 3, save: (e) => { saved = e } })
    for (let i = 0; i < 5; i++) t.add({ kind: 'other', who: 'ana', text: `line ${i}`, t: 1000 * i * 10 })
    expect(t.entries.map((e) => e.text)).toEqual(['line 2', 'line 3', 'line 4'])
    expect(saved).toBe(t.entries)
  })

  it('counts unread words from others and Max while closed, not yours or notes', () => {
    const t = new Thread()
    t.add({ kind: 'other', who: 'ana', text: 'hi' })
    t.add({ kind: 'max', who: 'Max Pablo', text: 'Evening.' })
    t.add({ kind: 'me', who: 'me', text: 'hello' })
    t.add({ kind: 'note', who: 'bo', text: 'bo came in.' })
    expect(t.unread).toBe(2)
    t.setOpen(true)
    expect(t.unread).toBe(0)
    t.add({ kind: 'other', who: 'ana', text: 'still here?' })
    expect(t.unread).toBe(0) // open: read as it comes
  })

  it('drops junk and the same line twice in a row', () => {
    const t = new Thread()
    expect(t.add({ kind: 'shout', text: 'x' })).toBe(null)
    expect(t.add({ kind: 'other', who: 'ana', text: '' })).toBe(null)
    expect(t.add({ kind: 'other', who: 'ana', text: 'hi', t: 1000 })).not.toBe(null)
    expect(t.add({ kind: 'other', who: 'ana', text: 'hi', t: 2000 })).toBe(null) // a repeat (two transports, a resend)
    expect(t.add({ kind: 'other', who: 'ana', text: 'hi', t: 9000 })).not.toBe(null) // said again later: a new line
    expect(t.add({ kind: 'other', who: 'ana', text: 'x'.repeat(500) }).text).toHaveLength(300)
  })

  it('loads what was saved, skipping anything malformed', () => {
    const t = new Thread({ load: () => [{ kind: 'me', who: 'me', text: 'kept', t: 1 }, { kind: 'me', text: 5, t: 2 }, null, 'junk'] })
    expect(t.entries.map((e) => e.text)).toEqual(['kept'])
    expect(new Thread({ load: () => { throw new Error('bad json') } }).entries).toEqual([])
  })

  it('tells the time as HH:MM', () => {
    expect(timeOf(new Date(2026, 10, 1, 9, 5).getTime())).toBe('09:05')
  })
})

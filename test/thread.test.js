import { describe, expect, it } from 'vitest'
import { Thread, timeOf } from '../src/chat/thread.js'
import { titleFor, badgeText } from '../src/notify.js'

describe('chat thread', () => {
  it('keeps lines in order, the last max of them, and saves them', () => {
    let saved = null
    const t = new Thread({ max: 3, save: (e) => { saved = e } })
    for (let i = 0; i < 5; i++) t.add({ kind: 'other', who: 'ana', text: `line ${i}`, t: 1000 * i * 10 })
    expect(t.entries.map((e) => e.text)).toEqual(['line 2', 'line 3', 'line 4'])
    expect(saved).toBe(t.entries)
  })

  it('counts what came after you last read: others, and Max talking to you', () => {
    const t = new Thread()
    t.add({ kind: 'other', who: 'ana', text: 'hi', t: 10 })
    t.add({ kind: 'max', who: 'Max Pablo', text: 'Evening.', t: 20 })
    t.add({ kind: 'max', who: 'Max Pablo', text: 'Proximity is everything.', t: 25, aside: true }) // thinking aloud
    t.add({ kind: 'note', who: 'bo', text: 'bo came in.', t: 30 })
    expect(t.unread).toBe(2)
    expect(t.firstUnread()).toBe(0)
    t.markRead()
    expect(t.unread).toBe(0)
    expect(t.firstUnread()).toBe(-1)
    t.add({ kind: 'other', who: 'ana', text: 'still here?', t: 40 })
    expect([t.unread, t.firstUnread()]).toEqual([1, 4])
    t.add({ kind: 'me', who: 'me', text: 'yes', t: 50 }) // answering means you read it
    expect(t.unread).toBe(0)
  })

  it('remembers where you last read across a reload, and starts a new thread read', () => {
    let read = null
    const entries = [{ kind: 'other', who: 'ana', text: 'one', t: 10 }, { kind: 'other', who: 'ana', text: 'two', t: 20 }]
    const fresh = new Thread({ load: () => entries, loadRead: () => null, saveRead: (v) => { read = v } })
    expect(fresh.unread).toBe(0) // never read before: what's there counts as read
    const back = new Thread({ load: () => entries, loadRead: () => 10, saveRead: (v) => { read = v } })
    expect(back.unread).toBe(1) // 'two' came after you last read
    back.markRead()
    expect(read).toBe(20)
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

  it('puts the count of what is waiting in the tab title and badge', () => {
    expect(titleFor('Exo Cafe', 0)).toBe('Exo Cafe')
    expect(titleFor('Exo Cafe', 3)).toBe('(3) Exo Cafe')
    expect(titleFor('Exo Cafe', 250)).toBe('(99+) Exo Cafe')
    expect([badgeText(4), badgeText(12)]).toEqual(['4', '9+'])
  })
})

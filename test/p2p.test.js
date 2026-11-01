import { describe, expect, it } from 'vitest'
import { P2PTransport, MultiTransport } from '../src/net/p2p.js'

/** A fake Trystero: rooms whose members' actions reach each other. */
function fakeNet() {
  const members = []
  let next = 0
  const join = () => {
    const peerId = `peer${next++}`
    const room = {
      peerId,
      makeAction() {
        const action = {
          onMessage: null,
          send: (m) => {
            for (const r of members) if (r !== room) r.action.onMessage?.(structuredClone(m), { peerId })
          },
        }
        room.action = action
        return action
      },
      leave() {
        members.splice(members.indexOf(room), 1)
        for (const r of members) r.onPeerLeave?.(peerId)
      },
    }
    for (const r of members) { r.onPeerJoin?.(peerId); queueMicrotask(() => room.onPeerJoin?.(r.peerId)) }
    members.push(room)
    return room
  }
  return { join }
}

function hearAll(t) {
  const got = []
  t.onMessage((m) => got.push(m))
  return got
}

describe('peer-to-peer presence', () => {
  it('carries messages between peers, and says bye for a peer that drops', async () => {
    const net = fakeNet()
    const a = new P2PTransport({ join: net.join })
    const b = new P2PTransport({ join: net.join })
    await Promise.all([a.ready, b.ready])
    await Promise.resolve()
    expect(a.peers).toBe(1)
    expect(b.peers).toBe(1)
    const atB = hearAll(b)
    a.send({ t: 'state', id: 'alice', n: 1, p: [1, 2, 3] })
    expect(atB).toEqual([{ t: 'state', id: 'alice', n: 1, p: [1, 2, 3] }])
    a.close() // the connection drops: b hears alice leave
    expect(atB.at(-1)).toEqual({ t: 'bye', id: 'alice' })
    expect(b.peers).toBe(0)
  })

  it('ignores junk from peers', async () => {
    const net = fakeNet()
    const a = new P2PTransport({ join: net.join })
    const b = new P2PTransport({ join: net.join })
    await Promise.all([a.ready, b.ready])
    const atB = hearAll(b)
    a.send('hello')
    a.send({ t: 'state' })
    a.send(null)
    expect(atB).toEqual([])
  })

  it('passes each message on once across transports, newest first wins', () => {
    const fake = () => {
      const t = { hs: [], sent: [], onMessage(h) { t.hs.push(h) }, send(m) { t.sent.push(m) }, emit(m) { t.hs.forEach((h) => h(m)) } }
      return t
    }
    const x = fake(), y = fake()
    const multi = new MultiTransport([x, y])
    const got = hearAll(multi)
    x.emit({ t: 'say', id: 'a', n: 10, text: 'hi' })
    y.emit({ t: 'say', id: 'a', n: 10, text: 'hi' }) // the same, over the other transport
    y.emit({ t: 'state', id: 'a', n: 12 })
    x.emit({ t: 'state', id: 'a', n: 11 }) // older than one already passed on
    expect(got.map((m) => m.n)).toEqual([10, 12])
    // A reload starts its count from the clock, above where it was.
    x.emit({ t: 'bye', id: 'a' })
    x.emit({ t: 'state', id: 'a', n: 5 })
    expect(got.map((m) => m.t)).toEqual(['say', 'state', 'bye', 'state'])
    multi.send({ t: 'say', id: 'me', n: 1 })
    expect(x.sent.length + y.sent.length).toBe(2)
  })
})

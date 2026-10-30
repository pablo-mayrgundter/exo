// Presence: who's here, where they stand, what they say.
//
// The transport is an interface so the Synchronizer can replace it (a
// Matrix room for state and chat, murmur for voice; docs/PLAN.md track T5).
// This first one is a BroadcastChannel: every tab of exo.cafe in the same
// browser shares a room. It's enough to build and test the protocol on.
//
// Messages: {t: 'state', id, name, hue, tier, scene, p: [x, y, z], yaw, head: [x, y, z], speed}
//           {t: 'say', id, text}
//           {t: 'bye', id}

export class BroadcastTransport {
  constructor(room = 'exo.cafe/main') {
    this.ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(room) : null
    this.handlers = []
    if (this.ch) this.ch.onmessage = (e) => this.handlers.forEach((h) => h(e.data))
  }
  send(msg) { this.ch?.postMessage(msg) }
  onMessage(h) { this.handlers.push(h) }
  close() { this.ch?.close() }
}

export class Presence {
  /** @param {{send: (m: object) => void, onMessage: (h: (m: object) => void) => void}} transport */
  constructor(transport, self) {
    this.transport = transport
    this.self = self
    /** @type {Map<string, {state: object, seen: number}>} */
    this.peers = new Map()
    this.listeners = { join: [], leave: [], say: [] }
    transport.onMessage((m) => this.receive(m))
    addEventListener('pagehide', () => transport.send({ t: 'bye', id: self.id }))
  }

  on(ev, fn) { this.listeners[ev].push(fn) }

  receive(m) {
    if (!m || m.id === this.self.id) return
    if (m.t === 'state') {
      const known = this.peers.get(m.id)
      this.peers.set(m.id, { state: m, seen: performance.now() })
      if (!known) this.listeners.join.forEach((f) => f(m))
    } else if (m.t === 'say') {
      this.listeners.say.forEach((f) => f(m))
    } else if (m.t === 'bye') {
      if (this.peers.delete(m.id)) this.listeners.leave.forEach((f) => f(m))
    }
  }

  publish(state) { this.transport.send({ t: 'state', id: this.self.id, ...state }) }

  say(text) { this.transport.send({ t: 'say', id: this.self.id, text }) }

  /** Forgets peers not heard from in a while. */
  sweep(timeoutMs = 5000) {
    const now = performance.now()
    for (const [id, p] of this.peers) {
      if (now - p.seen > timeoutMs) {
        this.peers.delete(id)
        this.listeners.leave.forEach((f) => f({ id }))
      }
    }
  }
}

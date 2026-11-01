// Presence: who's here, where they stand, what they say.
//
// The transport is an interface so the Synchronizer can replace it (a
// Matrix room for state and chat, murmur for voice; docs/PLAN.md track T5).
// BroadcastTransport links the tabs of one browser; P2PTransport (p2p.js)
// links browsers over WebRTC; MultiTransport runs both.
//
// Messages: {t: 'state', id, n, name, hue, tier, scene, p: [x, y, z], yaw, head: [x, y, z], …}
//           {t: 'say', id, n, text}
//           {t: 'bye', id, n}
//           {t: <anything else>, id, n, …}: passed to 'msg' listeners (the shared bar)
// `n` counts up from the sender's clock at page load (so a reload, with
// the same id, starts above where it left off), for dropping duplicates.

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
    this.listeners = { join: [], leave: [], say: [], msg: [] }
    this.n = Date.now()
    transport.onMessage((m) => this.receive(m))
    addEventListener('pagehide', () => transport.send({ t: 'bye', id: self.id, n: this.n++ }))
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
    } else if (typeof m.t === 'string') {
      this.listeners.msg.forEach((f) => f(m))
    }
  }

  publish(state) { this.transport.send({ t: 'state', id: this.self.id, n: this.n++, ...state }) }

  /** Sends any other message to the room ({t, …}). */
  send(t, data = {}) { this.transport.send({ ...data, t, id: this.self.id, n: this.n++ }) }

  say(text) { this.transport.send({ t: 'say', id: this.self.id, n: this.n++, text }) }

  /**
   * Forgets peers not heard from in a while: a few seconds, or a couple of
   * minutes for one whose tab is in the background (`away`), which sends a
   * slow heartbeat instead of its usual ten states a second.
   */
  sweep(timeoutMs = 5000, awayMs = 150000) {
    const now = performance.now()
    for (const [id, p] of this.peers) {
      if (now - p.seen > (p.state.away ? awayMs : timeoutMs)) {
        this.peers.delete(id)
        this.listeners.leave.forEach((f) => f({ id }))
      }
    }
  }
}

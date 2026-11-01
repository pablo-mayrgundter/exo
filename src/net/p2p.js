// Presence between browsers, peer to peer over WebRTC, with Trystero.
//
// Trystero finds the other people in a room through a public signalling
// medium (Nostr relays, by default), then every pair of browsers talks
// directly over a WebRTC data channel, end-to-end encrypted. Nothing to
// deploy. Peers do see each other's IP addresses, as in any P2P mesh; a
// TURN relay (`turn`) hides them, and connects networks that block direct
// connections.
//
// `relay` swaps the public medium for a self-hosted WebSocket relay
// (@trystero-p2p/ws-relay), for tests and private deployments.
//
// The transport carries Presence's messages unchanged, and turns a peer's
// connection dropping into a 'bye' for whoever that peer said they were.

const APP_ID = 'exo.cafe'

export class P2PTransport {
  /**
   * @param {{room?: string, relay?: string | null, turn?: RTCIceServer[] | null,
   *   join?: (config: object, room: string, callbacks: object) => object}} o
   *   `join` stands in for Trystero's joinRoom (tests).
   */
  constructor({ room = 'bar', relay = null, turn = null, join = null } = {}) {
    this.handlers = []
    this.peerIds = new Map() // Trystero peer id → the presence id it speaks for
    this.peers = 0
    this.error = null
    this.room = null
    this.ready = this.connect(room, relay, turn, join).catch((e) => {
      this.error = e
      console.warn('exo: peer-to-peer presence unavailable', e)
    })
  }

  async connect(room, relay, turn, join) {
    if (!join) {
      const mod = relay ? await import('@trystero-p2p/ws-relay') : await import('trystero')
      join = mod.joinRoom
    }
    const config = { appId: APP_ID }
    if (relay) config.relayConfig = { urls: [relay] }
    if (turn) config.turnConfig = turn
    this.room = join(config, room, {
      onJoinError: (d) => console.warn('exo: a peer could not connect', d?.error ?? d),
    })
    this.action = this.room.makeAction('m')
    this.action.onMessage = (m, meta) => this.receive(m, meta?.peerId ?? meta)
    this.room.onPeerJoin = () => { this.peers++ }
    this.room.onPeerLeave = (peerId) => {
      this.peers = Math.max(0, this.peers - 1)
      const id = this.peerIds.get(peerId)
      this.peerIds.delete(peerId)
      if (id) this.handlers.forEach((h) => h({ t: 'bye', id }))
    }
    addEventListener('pagehide', () => this.close())
  }

  receive(m, peerId) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') return
    if (peerId) this.peerIds.set(peerId, m.id)
    this.handlers.forEach((h) => h(m))
  }

  send(msg) {
    try { this.action?.send(msg) } catch { /* a peer mid-teardown */ }
  }

  onMessage(h) { this.handlers.push(h) }

  close() {
    try { this.room?.leave() } catch { /* already gone */ }
    this.room = null
    this.action = null
  }
}

/**
 * Several transports as one: sends go out on all of them; each message is
 * passed on once, by its sender's sequence number (`n`), whichever
 * transport brings it first. Tabs of one browser hear each other over
 * BroadcastChannel and over WebRTC both.
 */
export class MultiTransport {
  constructor(transports) {
    this.transports = transports
    this.last = new Map() // presence id → highest sequence number seen
    this.handlers = []
    for (const t of transports) t.onMessage((m) => this.receive(m))
  }

  receive(m) {
    if (!m) return
    if (typeof m.n === 'number') {
      const last = this.last.get(m.id) ?? -1
      if (m.n <= last) return
      this.last.set(m.id, m.n)
    }
    if (m.t === 'bye') this.last.delete(m.id)
    this.handlers.forEach((h) => h(m))
  }

  send(msg) { for (const t of this.transports) t.send(msg) }
  onMessage(h) { this.handlers.push(h) }
  close() { for (const t of this.transports) t.close?.() }
}

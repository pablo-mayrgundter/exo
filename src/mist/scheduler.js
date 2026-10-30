// The Mist: a gift economy of compute.
//
// Being here already costs something (rendering, the connection, scripts):
// that's implicit, and so is the small baseline each simulation in the
// world runs for everyone. On top of that a visitor sets a budget, a share
// of one CPU core, and gives it to things by clicking their $ buttons. The
// budget is split among the things given to, in proportion to the gifts;
// there are only so many slots (cores to spare), and gifts beyond them
// queue. When nobody gives to a thing it drops back to its implicit rate.
//
// Every frame a simulation finishes comes with a receipt: the frame, its
// cycles, how many were given, and hashes of its input and output. A frame
// a visitor paid at least a quarter of carries their name.

const KEY = 'exo.cafe/mist'
const MAX_DUTY = 0.95
const DONOR_SHARE = 0.25

export class Sim {
  /**
   * @param {{id: string, name: string, place: string, implicit: number, worker: Worker,
   *   verify?: (r: object) => boolean, unit?: string}} o
   */
  constructor(o) {
    Object.assign(this, o)
    this.unit ??= 'frame'
    this.gifts = 0 // this visitor's shares
    this.explicit = 0 // duty given, 0..1 of a core
    this.state = 'implicit' // 'implicit' | 'running' | 'queued'
    this.tick = null
    this.hz = 0 // half-cycles per wall second, smoothed
    this.given = 0 // explicit half-cycles, all time this session
    this.receipts = []
    this.listeners = []
  }

  onMessage(fn) { this.listeners.push(fn) }
}

export class Mist {
  constructor({ donor }) {
    this.donor = donor // { name } of this visitor
    this.sims = new Map()
    this.budget = 0 // share of one core
    this.order = [] // gift order, for slots and the queue
    this.slots = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 2))
    this.implicitMain = 0 // measured: rendering and the rest, share of a core
    this.mine = [] // receipts this visitor powered, newest first
    try {
      const s = JSON.parse(localStorage.getItem(KEY))
      if (s) { this.budget = s.budget ?? 0; this.mine = s.mine ?? [] }
    } catch { /* storage may be blocked */ }
    this.changed = []
  }

  /** @param {Sim} sim */
  add(sim) {
    this.sims.set(sim.id, sim)
    sim.worker.addEventListener('message', (e) => this.receive(sim, e.data))
    this.allocate()
    return sim
  }

  receive(sim, m) {
    if (m.type === 'tick') {
      sim.tick = m
      const hz = m.ran / (m.wallMs / 1000)
      sim.hz = sim.hz ? sim.hz * 0.8 + hz * 0.2 : hz
      sim.given = m.given
    } else if (m.type === 'receipt') {
      const share = m.halfCycles ? m.given / m.halfCycles : 0
      const r = {
        sim: sim.id, name: sim.name, frame: m.frame, t: m.t,
        halfCycles: m.halfCycles, share,
        input: m.input, output: m.output, poked: m.poked,
        // A frame this visitor paid at least a quarter of carries their name.
        donor: share >= DONOR_SHARE ? this.donor.name : null,
        verified: sim.verify && !m.poked ? sim.verify(m) : null,
      }
      sim.receipts.unshift(r)
      sim.receipts.length = Math.min(sim.receipts.length, 20)
      if (r.donor) {
        this.mine.unshift(r)
        this.mine.length = Math.min(this.mine.length, 100)
        this.save()
      }
    }
    sim.listeners.forEach((f) => f(m))
  }

  /** Total explicit half-cycles given this session, across sims. */
  get given() {
    let g = 0
    for (const s of this.sims.values()) g += s.given
    return g
  }

  setBudget(b) {
    this.budget = Math.max(0, Math.min(1, b))
    this.allocate()
    this.save()
  }

  /** Gives one more share to a sim. Returns its state afterwards. */
  give(id) {
    const s = this.sims.get(id)
    if (!s) return null
    if (s.gifts === 0) this.order.push(id)
    s.gifts = Math.min(8, s.gifts + 1)
    this.allocate()
    return s.state
  }

  /** Takes back a share; at none, the sim drops to implicit. */
  take(id) {
    const s = this.sims.get(id)
    if (!s || s.gifts === 0) return
    s.gifts--
    if (s.gifts === 0) this.order = this.order.filter((x) => x !== id)
    this.allocate()
  }

  allocate() {
    const running = this.order.slice(0, this.slots).map((id) => this.sims.get(id))
    const shares = running.reduce((n, s) => n + s.gifts, 0)
    for (const s of this.sims.values()) {
      const on = running.includes(s) && this.budget > 0
      s.explicit = on ? Math.min(MAX_DUTY - s.implicit, this.budget * s.gifts / shares) : 0
      // Queued means waiting for a slot; with no budget there's nothing to wait for.
      s.state = on ? 'running' : this.budget > 0 && this.order.includes(s.id) ? 'queued' : 'implicit'
      s.worker.postMessage({ type: 'duty', implicit: s.implicit, explicit: s.explicit })
    }
    this.changed.forEach((f) => f())
  }

  onChange(fn) { this.changed.push(fn) }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ budget: this.budget, mine: this.mine.slice(0, 100) })) } catch { /* fine */ }
  }

  /** Everything this visitor's machine spends here, as shares of a core. */
  accounts() {
    let implicitSims = 0, explicit = 0
    for (const s of this.sims.values()) { implicitSims += s.implicit; explicit += s.explicit }
    return { main: this.implicitMain, implicitSims, explicit, total: this.implicitMain + implicitSims + explicit }
  }
}

// The Mist: a gift economy of compute, run as a time-sharing system.
//
// The bar's things are jobs on one vCPU, the 6502 under the street, whose
// kernel (chip/vcpu.js) gives each job its share of quanta per turn. Two
// kinds of compute pay for it:
//
//   - system: what the world runs for everyone, a share of the visitor's
//     core, split among the jobs by their system weights;
//   - donation: a budget the visitor sets, also a share of a core, given
//     to jobs by tapping their chip tokens. It splits among the jobs given
//     to, in proportion to the gifts; only so many get it at once (slots),
//     the rest queue. With nobody donating, a job runs on its system share.
//
// Both become kernel shares on the same scale, so a job's share of the
// vCPU is (system + donated) / total, and the vCPU's duty on the host core
// is system + donation. Every frame a job finishes comes with a receipt;
// frames a visitor paid a quarter or more of carry their name.

const KEY = 'exo.cafe/mist'
const MAX_DUTY = 0.95
const DONOR_SHARE = 0.25

export class Job {
  /**
   * @param {{id: string, name: string, place: string, weight: number, bytes?: number, unit?: string,
   *   verify?: (r: object) => boolean}} o
   */
  constructor(o) {
    Object.assign(this, o)
    this.unit ??= 'frame'
    this.bytes ??= 0
    this.gifts = 0 // this visitor's
    this.share = { system: 0, donated: 0 } // kernel shares
    this.core = { system: 0, donated: 0 } // shares of the host's core
    this.state = 'system' // 'system' | 'donated' | 'queued'
    this.tick = null
    this.hz = 0 // vCPU cycles per wall second this job gets, smoothed
    this.given = 0 // donated half-cycles, all time this session
    this.receipts = []
    this.listeners = []
  }

  onMessage(fn) { this.listeners.push(fn) }
}

export class Mist {
  /** @param {{donor: {name: string}, worker: Worker, system: number}} o system: the vCPU's system duty */
  constructor({ donor, worker, system = 0.35 }) {
    this.donor = donor
    this.worker = worker
    this.system = system
    this.jobs = [] // kernel order
    this.budget = 0 // share of one core
    this.order = [] // gift order, for slots and the queue
    this.slots = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 2))
    this.main = 0 // measured: the main thread's share of a core
    this.vcpuHz = 0 // vCPU cycles per wall second, smoothed
    this.mine = [] // receipts this visitor powered, newest first
    this.changed = []
    try {
      const s = JSON.parse(localStorage.getItem(KEY))
      if (s) { this.budget = s.budget ?? 0; this.mine = s.mine ?? [] }
    } catch { /* storage may be blocked */ }
    worker.addEventListener('message', (e) => this.receive(e.data))
  }

  /** @param {Job} job */
  add(job) {
    this.jobs.push(job)
    this.allocate()
    return job
  }

  get(id) { return this.jobs.find((j) => j.id === id) }

  receive(m) {
    if (m.type === 'tick') {
      const hz = m.ran / 2 / (m.wallMs / 1000)
      this.vcpuHz = this.vcpuHz ? this.vcpuHz * 0.8 + hz * 0.2 : hz
      for (const t of m.jobs) {
        const j = this.get(t.id)
        if (!j) continue
        j.tick = t
        // Averaged over ~5 s: a kernel round lasts seconds, and a job
        // between turns would otherwise read as stopped.
        const jhz = t.ran / 2 / (m.wallMs / 1000)
        const k = 1 - Math.exp(-(m.wallMs / 1000) / 5)
        j.hz = j.hz ? j.hz + (jhz - j.hz) * k : jhz
        j.given = t.given
        j.listeners.forEach((f) => f({ type: 'tick', ...t, levels: m.levels, regs: m.regs }))
      }
    } else if (m.type === 'receipt') {
      const j = this.get(m.job)
      if (!j) return
      const share = m.halfCycles ? m.given / m.halfCycles : 0
      const r = {
        job: j.id, name: j.name, frame: m.frame, t: m.t,
        halfCycles: m.halfCycles, share,
        input: m.input, output: m.output, poked: m.poked,
        donor: share >= DONOR_SHARE ? this.donor.name : null,
        verified: j.verify && !m.poked ? j.verify(m) : null,
      }
      j.receipts.unshift(r)
      j.receipts.length = Math.min(j.receipts.length, 20)
      if (r.donor) {
        this.mine.unshift(r)
        this.mine.length = Math.min(this.mine.length, 100)
        this.save()
      }
      j.listeners.forEach((f) => f({ type: 'receipt', ...m, receipt: r }))
    }
  }

  /** Donated half-cycles this session, across jobs. */
  get given() { return this.jobs.reduce((n, j) => n + j.given, 0) }

  setBudget(b) {
    this.budget = Math.max(0, Math.min(MAX_DUTY - this.system, b))
    this.allocate()
    this.save()
  }

  /** Gives one more share to a job. Returns its state afterwards. */
  give(id) {
    const j = this.get(id)
    if (!j) return null
    if (j.gifts === 0) this.order.push(id)
    j.gifts = Math.min(8, j.gifts + 1)
    this.allocate()
    return j.state
  }

  /** Takes back a gift; at none, the job runs on its system share alone. */
  take(id) {
    const j = this.get(id)
    if (!j || j.gifts === 0) return
    j.gifts--
    if (j.gifts === 0) this.order = this.order.filter((x) => x !== id)
    this.allocate()
  }

  allocate() {
    // Kernel shares per unit of core: the system weights sum to the system duty.
    const sys = this.jobs.reduce((n, j) => n + j.weight, 0)
    const k = sys / this.system
    const running = this.order.slice(0, this.slots).map((id) => this.get(id))
    const gifts = running.reduce((n, j) => n + j.gifts, 0)
    for (const j of this.jobs) {
      const on = running.includes(j) && this.budget > 0
      const core = on ? this.budget * j.gifts / gifts : 0
      j.core = { system: j.weight / k, donated: core }
      j.share = { system: j.weight, donated: core * k }
      // Queued means waiting for a slot; with no budget there's nothing to wait for.
      j.state = on ? 'donated' : this.budget > 0 && this.order.includes(j.id) ? 'queued' : 'system'
    }
    this.worker.postMessage({
      type: 'duty',
      duty: Math.min(MAX_DUTY, this.system + this.budget),
      shares: this.jobs.map((j) => j.share.system + j.share.donated),
      donated: this.jobs.map((j) => j.share.donated),
    })
    this.changed.forEach((f) => f())
  }

  onChange(fn) { this.changed.push(fn) }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ budget: this.budget, mine: this.mine.slice(0, 100) })) } catch { /* fine */ }
  }

  /** What this visitor's machine spends here, as shares of a core. */
  accounts() {
    const donated = this.jobs.reduce((n, j) => n + j.core.donated, 0)
    return { main: this.main, system: this.system, donated, total: this.main + this.system + donated }
  }
}

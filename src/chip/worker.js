// Runs the vCPU off the main thread: the 6502 under the street, with its
// kernel time-sharing the bar's jobs (chip/vcpu.js). Each slice of wall
// time it spends `duty` stepping the chip, raising the kernel's timer
// interrupt every QUANTUM cycles; the host sets duty (system plus
// donation) and the kernel's share table.
//
// It reports at ~20 Hz: each node's average voltage over the slice (so
// the street's lights fade instead of flickering at the clock rate), and
// per job its watched RAM and frame counter. Each time a job bumps its
// frame counter it issues a receipt: the frame, the cycles that job ran,
// how many of them were donated, and hashes of the frame's input and
// output, so anyone can check the work.
import { Chip6502 } from './sim.js'
import { makeTimer, KERNEL, QUANTUM } from './vcpu.js'

const SLICE_MS = 50
let init = null
let chip = null
let timer = null
let duty = 0.35
let shares = [], donated = []
let accum = null, samples = 0
let jobs = [] // per job: config and running state

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    init = m
    boot()
    loop()
  } else if (m.type === 'duty') {
    duty = m.duty
    shares = m.shares
    donated = m.donated
    writeShares()
  } else if (m.type === 'poke') {
    const j = jobs.find((x) => x.id === m.job)
    for (const a of m.addrs) chip.memory[a] = m.value
    if (j) {
      j.poked = true
      const i = m.addrs[0] - j.watch.from
      if (i >= 0) j.view[i % j.watch.size] = m.value
    }
  }
}

function writeShares() {
  if (!chip) return
  // Every job keeps a share of at least 1, or the kernel would skip it.
  shares.forEach((s, k) => { chip.memory[KERNEL.share + k] = Math.max(1, Math.min(255, Math.round(s))) })
}

function boot() {
  chip = new Chip6502(init.data)
  for (const [a, b] of init.program) chip.memory[a] = b
  timer = makeTimer(chip, init.quantum ?? QUANTUM)
  jobs = init.jobs.map((j) => ({
    ...j,
    view: new Uint8Array(j.watch.size),
    cursor: 0, last: -1, poked: false,
    cycles: 0, given: 0, frameStart: 0, frameGiven: 0,
    input: new Uint8Array(j.watch.size),
  }))
  chip.onWrite = (a, d) => {
    if (a === KERNEL.ack) { timer.ack(); return }
    for (const j of jobs) {
      if (a >= j.watch.from && a < j.watch.to) { j.view[(a - j.watch.from) % j.watch.size] = d; j.cursor = (a - j.watch.from) % j.watch.size }
      // INC writes the old value back before the new one: only a change of
      // value ends a frame. The first write is the job zeroing its counter.
      if (a === j.frameAddr && d !== j.last) {
        const first = j.last === -1
        j.last = d
        if (first) { j.frameStart = j.cycles; j.frameGiven = 0 } else receipt(j, d)
      }
    }
  }
  writeShares()
  chip.reset()
  accum = init.levels ? new Uint16Array(chip.nodeCount) : null
}

function receipt(j, frame) {
  let inBoard = j.input, outBoard = j.view.slice()
  const pp = j.pingpong
  if (pp) {
    // Double-buffered: the pointer names the page just finished; the other
    // page still holds exactly what the CPU read.
    const done = chip.memory[pp.ptr], other = done === pp.pages[0] ? pp.pages[1] : pp.pages[0]
    outBoard = chip.memory.slice(done << 8, (done << 8) + j.watch.size)
    inBoard = chip.memory.slice(other << 8, (other << 8) + j.watch.size)
  }
  self.postMessage({
    type: 'receipt', job: j.id, frame,
    halfCycles: Math.round(j.cycles - j.frameStart),
    given: Math.round(j.frameGiven),
    input: hash(inBoard), output: hash(outBoard),
    inputBoard: inBoard, outputBoard: outBoard,
    poked: j.poked, t: Date.now(),
  })
  j.input = outBoard
  j.frameStart = j.cycles
  j.frameGiven = 0
  j.poked = false
}

function loop() {
  try {
    slice()
  } catch (err) {
    // A chip that throws would otherwise go dark for good: say so, and
    // power-cycle it.
    self.postMessage({ type: 'halt', message: String(err?.message ?? err) })
    boot()
    setTimeout(loop, SLICE_MS)
  }
}

function slice() {
  const t0 = performance.now()
  const before = chip.halfCycles
  const ranBy = jobs.map((j) => j.cycles)
  while (performance.now() - t0 < SLICE_MS * duty) {
    // Charge each batch to the job the kernel says is running.
    const j = jobs[chip.memory[KERNEL.cur]] ?? null
    for (let k = 0; k < 8; k++) { chip.halfStep(); timer.halfStep() }
    if (j) {
      j.cycles += 8
      const s = shares[jobs.indexOf(j)] || 1
      const g = 8 * Math.min(1, (donated[jobs.indexOf(j)] || 0) / s)
      j.given += g
      j.frameGiven += g
    }
    if (accum) {
      const st = chip.state
      for (let i = 0; i < st.length; i++) accum[i] += st[i]
      samples++
    }
  }
  const elapsed = performance.now() - t0
  let levels = null
  if (accum) {
    levels = new Uint8Array(accum.length)
    for (let i = 0; i < accum.length; i++) levels[i] = samples ? Math.round(255 * accum[i] / samples) : 0
    accum.fill(0)
    samples = 0
  }
  self.postMessage({
    type: 'tick',
    levels,
    ran: chip.halfCycles - before,
    wallMs: SLICE_MS,
    busyMs: elapsed,
    cur: chip.memory[KERNEL.cur],
    regs: chip.registers(),
    jobs: jobs.map((j, k) => ({
      id: j.id, view: j.view.slice(), cursor: j.cursor, frame: chip.memory[j.frameAddr],
      ran: j.cycles - ranBy[k], given: j.given,
    })),
  }, levels ? [levels.buffer] : [])
  setTimeout(loop, Math.max(0, SLICE_MS - elapsed))
}

/** FNV-1a, 32-bit, as 8 hex digits. */
export function hash(bytes) {
  let h = 0x811c9dc5
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

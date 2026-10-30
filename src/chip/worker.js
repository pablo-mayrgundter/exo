// Runs one 6502 off the main thread: a program, a window of RAM to watch,
// and a frame counter. It spends a duty-cycled share of each slice of wall
// time stepping the chip, in two parts:
//
//   - implicit: the baseline the world runs for everyone;
//   - explicit: what visitors give through the Mist (mist/scheduler.js).
//
// It reports at ~20 Hz (the watched RAM as the CPU writes it, registers,
// and, for the chip under the street, each node's average voltage over the
// window), and each time the program bumps its frame counter it issues a
// receipt: the frame, the half-cycles it took, how many were given, and
// hashes of the frame's input and output, so anyone can check the work.
import { Chip6502 } from './sim.js'

const SLICE_MS = 50
let init = null
let chip = null
let implicit = 0.25
let explicit = 0
let accum = null
let samples = 0
let view = null // the watched window, as last written
let input = null // the window when the current frame began
let cursor = 0
let given = 0 // all explicit half-cycles, for the ledger
let frameStart = 0, frameGiven = 0

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    init = m
    implicit = m.implicit ?? implicit
    boot()
    loop()
  } else if (m.type === 'duty') {
    implicit = m.implicit ?? implicit
    explicit = m.explicit ?? explicit
  } else if (m.type === 'poke') {
    poked = true
    for (const a of m.addrs) chip.memory[a] = m.value
    const i = m.addrs[0] - init.watch.from
    if (i >= 0 && i < view.length) view[i % init.watch.size] = m.value
  }
}

function boot() {
  chip = new Chip6502(init.data)
  for (const [a, b] of init.program) chip.memory[a] = b
  const { from, to, size } = init.watch
  view = new Uint8Array(size)
  chip.onWrite = (a, d) => {
    if (a >= from && a < to) { view[(a - from) % size] = d; cursor = (a - from) % size }
    // INC is read-modify-write: the 6502 writes the old value back before
    // the new one. Only a change of value ends a frame.
    // The first write is the program zeroing its counter at boot.
    if (a === init.frameAddr && d !== lastFrame) {
      const first = lastFrame === -1
      lastFrame = d
      if (first) { frameStart = chip.halfCycles; frameGiven = 0 } else receipt(d)
    }
  }
  lastFrame = -1
  chip.reset()
  accum = init.levels ? new Uint16Array(chip.nodeCount) : null
  input = view.slice()
  frameStart = chip.halfCycles
  frameGiven = 0
}

let poked = false
let lastFrame = -1
function receipt(frame) {
  let inBoard = input, outBoard = view.slice()
  const pp = init.pingpong
  if (pp) {
    // Double-buffered: the pointer now names the page just finished; the
    // other page still holds exactly what the CPU read.
    const done = chip.memory[pp.ptr], other = done === pp.pages[0] ? pp.pages[1] : pp.pages[0]
    outBoard = chip.memory.slice(done << 8, (done << 8) + init.watch.size)
    inBoard = chip.memory.slice(other << 8, (other << 8) + init.watch.size)
  }
  self.postMessage({
    type: 'receipt',
    frame,
    halfCycles: chip.halfCycles - frameStart,
    given: Math.round(frameGiven),
    input: hash(inBoard), output: hash(outBoard),
    inputBoard: inBoard, outputBoard: outBoard,
    poked,
    t: Date.now(),
  })
  input = outBoard
  frameStart = chip.halfCycles
  frameGiven = 0
  poked = false
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
  const duty = Math.min(0.95, implicit + explicit)
  const budget = SLICE_MS * duty
  const before = chip.halfCycles
  while (performance.now() - t0 < budget) {
    const h0 = chip.halfCycles
    for (let k = 0; k < 8; k++) chip.halfStep()
    // Attribute as we go, so a frame that ends mid-slice gets its share.
    frameGiven += (chip.halfCycles - h0) * (duty > 0 ? Math.min(explicit, duty) / duty : 0)
    if (accum) {
      const s = chip.state
      for (let i = 0; i < s.length; i++) accum[i] += s[i]
      samples++
    }
  }
  const ran = chip.halfCycles - before
  given += duty > 0 ? ran * Math.min(explicit, duty) / duty : 0
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
    view: view.slice(),
    cursor,
    frame: chip.memory[init.frameAddr],
    regs: chip.registers(),
    ran,
    wallMs: SLICE_MS,
    busyMs: elapsed,
    given,
  }, levels ? [levels.buffer] : [])
  setTimeout(loop, Math.max(0, SLICE_MS - elapsed))
}

/** FNV-1a, 32-bit, as 8 hex digits. */
export function hash(bytes) {
  let h = 0x811c9dc5
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

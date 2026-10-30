// Runs the 6502 off the main thread. It spends a duty-cycled share of each
// slice of wall time stepping the chip, and reports at ~20 Hz: each node's
// average voltage over the window (so lights fade instead of flickering at
// the clock rate), the Life board as the CPU writes it, and the registers.
import { Chip6502 } from './sim.js'
import { BOARD, ZP } from './life.js'

const SLICE_MS = 50
let chip = null
let duty = 0.5
let accum = null
let samples = 0
const board = new Uint8Array(BOARD.size * BOARD.size)
let cursor = 0
let donated = 0 // half-cycles run above the guest share, for the Mist ledger
const GUEST_DUTY = 0.5 // keep in step with main.js

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    init = m
    boot()
    loop()
  } else if (m.type === 'duty') {
    duty = Math.max(0.02, Math.min(0.95, m.value))
  } else if (m.type === 'poke') {
    // A visitor toggles a cell: written to both pages, so it survives the swap.
    chip.memory[BOARD.a + m.cell] = m.value
    chip.memory[BOARD.b + m.cell] = m.value
    board[m.cell] = m.value
  }
}

let init = null
function boot() {
  chip = new Chip6502(init.data)
  for (const [a, b] of init.program) chip.memory[a] = b
  chip.onWrite = (a, d) => {
    if (a >= BOARD.a && a < BOARD.b + 256) { board[a & 0xff] = d; cursor = a & 0xff }
  }
  chip.reset()
  accum = new Uint16Array(chip.nodeCount)
  board.fill(0)
}

function loop() {
  try {
    slice()
  } catch (err) {
    // A chip that throws would otherwise leave the bar dark for good: say
    // so, and power-cycle it.
    self.postMessage({ type: 'halt', message: String(err?.message ?? err) })
    boot()
    setTimeout(loop, SLICE_MS)
  }
}

function slice() {
  const t0 = performance.now()
  const budget = SLICE_MS * duty
  const before = chip.halfCycles
  let n = 0
  while (performance.now() - t0 < budget) {
    for (let k = 0; k < 8; k++) chip.halfStep()
    n += 8
    const s = chip.state
    for (let i = 0; i < s.length; i++) accum[i] += s[i]
    samples++
  }
  const ran = chip.halfCycles - before
  if (duty > GUEST_DUTY) donated += ran * (duty - GUEST_DUTY) / duty
  const elapsed = performance.now() - t0
  const levels = new Uint8Array(accum.length)
  for (let i = 0; i < accum.length; i++) levels[i] = samples ? Math.round(255 * accum[i] / samples) : 0
  accum.fill(0)
  samples = 0
  self.postMessage({
    type: 'tick',
    levels,
    board: board.slice(),
    cursor,
    gen: chip.memory[ZP.gen],
    regs: chip.registers(),
    ran,
    wallMs: SLICE_MS,
    busyMs: elapsed,
    donated,
  }, [levels.buffer])
  setTimeout(loop, Math.max(0, SLICE_MS - elapsed))
}

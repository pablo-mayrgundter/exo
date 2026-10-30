import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chip6502 } from '../src/chip/sim.js'
import { assemble } from '../src/chip/asm.js'
import { source, BOARD, ZP } from '../src/chip/life.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/chip/6502.json', import.meta.url), 'utf8'))

/** Loads an assembled program into the chip's RAM. */
function load(chip, src) {
  for (const [a, b] of assemble(src).bytes) chip.memory[a] = b
}

describe('Chip6502', () => {
  it('runs visual6502\'s test program as the original does', () => {
    // Values from the original JSSim (chipsim.js + macros.js) after 400
    // half-steps of its testprogram.js; the port matched it node for node.
    const chip = new Chip6502(data)
    const prog = [0xa9, 0x00, 0x20, 0x10, 0x00, 0x4c, 0x02, 0x00, 0, 0, 0, 0, 0, 0, 0, 0x40,
      0xe8, 0x88, 0xe6, 0x0f, 0x38, 0x69, 0x02, 0x60]
    prog.forEach((b, i) => { chip.memory[i] = b })
    chip.reset()
    for (let i = 0; i < 400; i++) chip.halfStep()
    expect(chip.memory[0x0f]).toBe(71)
    const r = chip.registers()
    expect([r.a, r.x, r.y, r.s, r.p, r.pc, r.ab]).toEqual([21, 7, 249, 16, 20, 4, 509])
  })
})

/** One generation of Life on a 16×16 torus, in JS. */
function lifeStep(cells) {
  const out = new Uint8Array(256)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) n += cells[((y + dy) & 15) * 16 + ((x + dx) & 15)]
    }
    const c = cells[y * 16 + x]
    out[y * 16 + x] = n === 3 || (n === 2 && c) ? 1 : 0
  }
  return out
}

describe('life.js on the chip', () => {
  it('computes a generation of Life, transistor by transistor', () => {
    const chip = new Chip6502(data)
    load(chip, source)
    chip.reset()
    // Run past the seeding into the first generation.
    while (chip.memory[BOARD.a + 0x88] === 0) chip.halfStep()
    while (chip.registers().pc !== assemble(source).symbols.gen) chip.halfStep()
    const seed = chip.memory.slice(BOARD.a, BOARD.a + 256)
    expect([...seed].filter(Boolean).length).toBe(10)
    const start = chip.halfCycles
    let gens = 0
    chip.onWrite = (a) => { if (a === ZP.gen) gens++ }
    while (gens < 1) chip.halfStep()
    const cycles = (chip.halfCycles - start) / 2
    const next = chip.memory.slice(BOARD.b, BOARD.b + 256)
    expect([...next]).toEqual([...lifeStep(seed)])
    // About 73k cycles: what the bar's "generation" readout is made of.
    expect(cycles).toBeGreaterThan(30000)
    expect(cycles).toBeLessThan(100000)
  }, 120000)
})

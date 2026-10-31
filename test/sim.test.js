import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chip6502 } from '../src/chip/sim.js'
import { assemble } from '../src/chip/asm.js'
import { source, BOARD, ZP, lifeStep } from '../src/chip/life.js'
import { source as showSource, lightshowFrame, LEDS, ZP as SHOW } from '../src/chip/lightshow.js'

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

describe('Chip6502 over long runs', () => {
  it('keeps working when its generation marks wrap past 2^32', () => {
    const run = (gen) => {
      const chip = new Chip6502(data)
      load(chip, source)
      chip.groupGen = gen
      chip.queueGen = gen
      chip.reset()
      for (let i = 0; i < 2000; i++) chip.halfStep()
      return chip.stateString() + chip.memory.slice(0, 0x400).join()
    }
    // Starting just short of the limit, the marks wrap during the run; the
    // chip must end up exactly where a fresh one does.
    expect(run(0xffffffff - 300)).toBe(run(0))
  })
})

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

describe('lightshow.js on the chip', () => {
  it('plays the frames its JS reference predicts', () => {
    const chip = new Chip6502(data)
    load(chip, showSource)
    chip.reset()
    let lfsr = 1
    let checked = 0
    let pending = null
    let last = 0
    chip.onWrite = (a, d) => {
      // INC writes the old value back before the new one; only a change counts.
      if (a !== SHOW.frame || d === last) return
      last = d
      // FRAME was just bumped from d - 1: compare that frame's LEDs.
      pending = { f: d - 1 }
    }
    while (checked < 3) {
      chip.halfStep()
      if (pending) {
        const { leds, lfsr: next } = lightshowFrame(pending.f, lfsr)
        expect([...chip.memory.slice(LEDS.a, LEDS.a + LEDS.count)]).toEqual([...leds])
        expect(chip.memory[SHOW.lfsr]).toBe(next)
        lfsr = next
        pending = null
        checked++
      }
    }
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chip6502 } from '../src/chip/sim.js'
import { switched, switchingSites } from '../src/chip/switching.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/chip/6502.json', import.meta.url), 'utf8'))

/** Whether (x, y) is inside any of a node's polygons. */
function onNode(node, x, y) {
  return data.segdefs.some((s) => {
    if (s[0] !== node) return false
    const c = s.slice(3)
    let ins = false
    for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
      if ((c[i + 1] > y) !== (c[j + 1] > y) && x < ((c[j] - c[i]) * (y - c[i + 1])) / (c[j + 1] - c[i + 1]) + c[i]) ins = !ins
    }
    return ins
  })
}

describe('where the switching happens', () => {
  const sites = switchingSites(data)
  it('puts every transistor on its gate, between its terminals', () => {
    expect(sites.transistors.length).toBe(2 * data.transdefs.length)
    // A sample: every 37th transistor's site is on its gate's polysilicon.
    for (let t = 0; t < data.transdefs.length; t += 37) {
      expect(onNode(data.transdefs[t][0], sites.transistors[2 * t], sites.transistors[2 * t + 1]), `transistor ${t}`).toBe(true)
    }
  })
  it("puts a pin's pad at the die's edge", () => {
    const clk = data.nodenames.clk0
    const [x, y] = [sites.pads[2 * clk], sites.pads[2 * clk + 1]]
    expect(Math.min(x, y, data.chipSize - x, data.chipSize - y)).toBeLessThan(300)
  })
})

describe('what switched', () => {
  it('lists each node that changed, with its cause and wave, and starts the counts again', () => {
    const chip = new Chip6502(data)
    chip.traceSwitching()
    chip.reset()
    switched(chip.trace) // reset's own changes
    for (let i = 0; i < 40; i++) chip.halfStep()
    const s = switched(chip.trace)
    expect(s.nodes.length).toBeGreaterThan(100)
    expect(s.nodes).toContain(data.nodenames.clk0)
    const k = [...s.nodes].indexOf(data.nodenames.clk0)
    expect([s.cause[k], s.wave[k], s.count[k]]).toEqual([-1, 0, 40])
    expect(switched(chip.trace).nodes.length).toBe(0)
  })
})

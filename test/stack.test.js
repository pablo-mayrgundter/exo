import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STACK_UM, STREET_Y, SILICON_Y, DIE_BASE_Y, layerY, yOf } from '../src/chip/stack.js'
import { BODY_UM } from '../src/cosmic/units.js'
import { makeChipFloor } from '../src/world/chipfloor.js'
import { Frame } from '../src/cosmic/frames.js'

describe("the die's layers in depth", () => {
  it('puts the street on the metal, and the silicon 3 µm (a third of a visitor) below', () => {
    expect(layerY(0)[1]).toBeCloseTo(STREET_Y, 9)
    expect((STREET_Y - SILICON_Y) * BODY_UM).toBeCloseTo(3, 9)
    expect(STREET_Y - SILICON_Y).toBeGreaterThan(1.84 / 4)
    expect(STREET_Y - SILICON_Y).toBeLessThan(1.84 / 2)
  })
  it('stacks diffusion, then poly, then metal, with clear oxide between', () => {
    const [metal, diff, , , , poly] = STACK_UM
    expect(diff[1]).toBe(0)
    expect(poly[0]).toBeGreaterThan(diff[1])
    expect(metal[0]).toBeGreaterThan(poly[1])
    expect(yOf(poly[1])).toBeLessThan(yOf(metal[0]))
  })
})

describe('standing on the floor', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/chip/6502.json', import.meta.url), 'utf8'))
  const frame = new Frame({ scale: 0.1, flipY: true })
  const floor = makeChipFloor(data, frame)
  it("is on the topmost layer's top, or the silicon", () => {
    // A metal polygon's first corner, nudged inside it.
    const seg = data.segdefs.find((s) => s[2] === 0 && s.length > 12)
    const xs = seg.slice(3).filter((_, i) => i % 2 === 0), ys = seg.slice(3).filter((_, i) => i % 2 === 1)
    const cx = xs.reduce((a, b) => a + b) / xs.length, cy = ys.reduce((a, b) => a + b) / ys.length
    const [x, , z] = frame.toParent([cx, cy, 0])
    const h = floor.heightAt(x, z)
    // The centroid may fall outside a bent polygon; either way it's a layer's top or the silicon.
    expect([STREET_Y, layerY(5)[1], layerY(1)[1], SILICON_Y].some((y) => Math.abs(y - h) < 1e-9)).toBe(true)
    // Off the die, the ground it stands on, 380 µm of silicon down.
    expect(floor.heightAt(-1e5, -1e5)).toBe(DIE_BASE_Y)
    expect((SILICON_Y - DIE_BASE_Y) * BODY_UM).toBeCloseTo(380, 6)
    // Just inside the die's sawn edge, clear of every trace: the silicon.
    expect(floor.heightAt(floor.slab.x0 + 1, floor.slab.z0 + 1)).toBe(SILICON_Y)
  })
})

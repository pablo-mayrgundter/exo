import { describe, expect, it } from 'vitest'
import { Frame, reproject, reprojectDuration, formatRate } from '../src/cosmic/frames.js'

describe('Frame', () => {
  const wall = new Frame('wall')
  const cafe = new Frame('cafe', { parent: wall, origin: [5, 0, -3], yaw: Math.PI / 2 })
  const chip = new Frame('chip', { parent: cafe, scale: 0.1, flipY: true, origin: [-41.35, 0, 961.25], rate: 1 / 250 })
  const abode = new Frame('abode', { parent: wall, rate: 600 })

  it('round-trips points through nested frames', () => {
    const p = [413.5, 9612.5, 0]
    const inWall = reproject(p, chip, wall)
    const back = reproject(inWall, wall, chip)
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 6))
  })

  it('puts the NMI pad at the cafe origin, with chip north along -z', () => {
    const [x, y, z] = chip.toParent([413.5, 9612.5, 0])
    expect([x, y, z].map((v) => +v.toFixed(6))).toEqual([0, 0, 0])
    expect(chip.toParent([413.5, 9622.5, 0])[2]).toBeCloseTo(-1, 6) // 10 units north is 1 m toward -z
  })

  it('reprojects durations by clock rate', () => {
    expect(reprojectDuration(1, wall, abode)).toBe(600)
    expect(reprojectDuration(250, cafe, chip)).toBeCloseTo(1, 9)
    expect(reprojectDuration(1, chip, abode)).toBeCloseTo(150000, 6)
  })

  it('takes live rates', () => {
    let hz = 2000
    const f = new Frame('live', { rate: () => hz / 1e6 })
    expect(f.absoluteRate).toBe(0.002)
    hz = 4000
    f.tick(10)
    expect(f.time).toBeCloseTo(0.04, 9)
  })

  it('formats rates for the HUD', () => {
    expect(formatRate(600)).toBe('×600')
    expect(formatRate(1)).toBe('×1.0')
    expect(formatRate(1 / 640)).toBe('1 : 640')
    expect(formatRate(0)).toBe('stopped')
  })
})

import { sceneToEcef, formatLength, BODY_UM, CHIP_UNIT_UM } from '../src/cosmic/units.js'

describe('real units', () => {
  it('puts the die at true size and a visitor at about the 6502 feature size', () => {
    expect(9628 * CHIP_UNIT_UM).toBeCloseTo(4300, 6) // die height, µm
    expect(formatLength(8769 * CHIP_UNIT_UM)).toBe('3.92 mm')
    expect(formatLength(1.84 * BODY_UM)).toBe('8.2 µm')
  })

  it('maps the street (µm, x east, y up, z south) to ECEF at 0° N 0° E', () => {
    const [x, y, z] = sceneToEcef([1e6, 2e6, -3e6]) // 1 m east, 2 m up, 3 m north
    expect(x).toBeCloseTo(6378137 + 2, 6)
    expect(y).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(3, 6)
  })
})

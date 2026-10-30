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

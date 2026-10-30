import { describe, expect, it } from 'vitest'
import { Ledger, allocation, THRESHOLDS } from '../src/mist/ledger.js'
import { voxelize, PARTS, TIERS } from '../src/avatar/avatar.js'

describe('Mist ledger', () => {
  it('climbs tiers with donated cycles', () => {
    const l = new Ledger()
    l.base = 0
    l.update(0)
    expect(l.tier).toBe(0)
    l.update(THRESHOLDS[1])
    expect(l.tier).toBe(1)
    l.update((THRESHOLDS[1] + THRESHOLDS[2]) / 2)
    expect(l.progress).toBeCloseTo(0.5, 6)
    l.update(1e9)
    expect([l.tier, l.progress]).toEqual([3, 1])
  })

  it('allocates a body region that grows eightfold per tier', () => {
    const [a, b, c, d] = [0, 1, 2, 3].map(allocation)
    expect(a.voxels).toBe(180) // 5 × 12 × 3 at 0.16 m: the minecrafty guest
    expect(b.voxels / a.voxels).toBeGreaterThan(5)
    expect(c.voxels / b.voxels).toBeGreaterThan(5)
    expect(d.smooth).toBe(true)
  })
})

describe('voxelize', () => {
  it('keeps limbs at guest rez and hollows out the inside at high rez', () => {
    for (const part of Object.values(PARTS)) expect(voxelize(part, TIERS[0].voxel).length).toBeGreaterThan(0)
    const torso = voxelize(PARTS.torso, TIERS[2].voxel)
    // A 0.15 m capsule at 4 cm: a shell, far fewer than the filled volume.
    expect(torso.length).toBeLessThan(600)
  })
})

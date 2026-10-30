// The Mist ledger: what a visitor gives, and the rez it buys.
//
// Material is limited by memory and motion by compute. A body's material
// is the voxels allocated for it at spawn; each tier halves the voxel
// size, so eight times the voxels. Compute donated to the shared
// simulation (for now, the visitor's own copy of the 6502 running at a
// higher duty cycle) earns credit toward the next tier.
import { TIERS, BODY_BOX } from '../avatar/avatar.js'

// Donated half-cycles needed for each tier.
export const THRESHOLDS = [0, 15000, 60000, 150000]
const KEY = 'exo.cafe/mist-credit'

export class Ledger {
  constructor() {
    this.credit = 0
    try { this.credit = Number(localStorage.getItem(KEY)) || 0 } catch { /* storage may be blocked */ }
    this.base = this.credit
  }

  /** @param {number} donatedThisSession half-cycles reported by the chip worker */
  update(donatedThisSession) {
    this.credit = this.base + donatedThisSession
    try { localStorage.setItem(KEY, String(Math.round(this.credit))) } catch { /* fine */ }
  }

  get tier() {
    let t = 0
    for (let i = 0; i < THRESHOLDS.length; i++) if (this.credit >= THRESHOLDS[i]) t = i
    return t
  }

  /** 0..1 progress toward the next tier (1 at the top). */
  get progress() {
    const t = this.tier
    if (t === THRESHOLDS.length - 1) return 1
    return (this.credit - THRESHOLDS[t]) / (THRESHOLDS[t + 1] - THRESHOLDS[t])
  }
}

/** The body's bounding region at a tier: grid dims, voxel count, bytes. */
export function allocation(tier) {
  const s = TIERS[tier].voxel
  if (!s) return { smooth: true, label: 'smooth · ∞ rez' }
  const dims = BODY_BOX.max.map((m, i) => Math.ceil((m - BODY_BOX.min[i]) / s))
  const voxels = dims[0] * dims[1] * dims[2]
  // One byte of material per voxel in the region, as a budget.
  return { smooth: false, dims, voxels, bytes: voxels, label: `${dims.join('×')} @ ${s} m` }
}

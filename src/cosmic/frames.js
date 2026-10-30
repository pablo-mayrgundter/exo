// cosmic.js, first cut: frames of space and time.
//
// Every place in Cloud City is a Frame: an origin, a scale (metres per
// local unit), a yaw, and a clock that runs at its own rate against wall
// time. Reprojection maps a point or a duration from one frame to another,
// which is what lets a scene on one timescale be seen from another: the
// 6502 under the street runs at a few kHz against its native 1 MHz, the
// abode's sky turns hundreds of times faster than the bar's.
//
// Frames nest; the root is the visitor's wall clock and metres.

export class Frame {
  /**
   * @param {string} name
   * @param {{parent?: Frame, origin?: number[], scale?: number, yaw?: number, rate?: number | (() => number), flipY?: boolean}} [o]
   */
  constructor(name, o = {}) {
    this.name = name
    this.parent = o.parent ?? null
    this.origin = o.origin ?? [0, 0, 0]
    this.scale = o.scale ?? 1
    this.yaw = o.yaw ?? 0
    this.flipY = o.flipY ?? false
    this._rate = o.rate ?? 1
    this.time = 0 // local seconds since the frame was made
  }

  /** Local seconds per parent second. May be live (a function). */
  get rate() { return typeof this._rate === 'function' ? this._rate() : this._rate }
  set rate(r) { this._rate = r }

  /** Local seconds per root (wall) second. */
  get absoluteRate() { return this.rate * (this.parent ? this.parent.absoluteRate : 1) }

  /** Advances this frame's clock by a parent-time step. */
  tick(dtParent) { this.time += dtParent * this.rate }

  /** Local point → parent point. Local [x, y, z] with y up, or [x, y] chip-style if flipY (y north). */
  toParent([x, y, z = 0]) {
    const s = this.scale
    // flipY frames are 2D layouts whose y axis points north (-z in the parent).
    const lx = x * s
    const lz = this.flipY ? -y * s : z * s
    const ly = this.flipY ? z * s : y * s
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw)
    return [this.origin[0] + c * lx + sn * lz, this.origin[1] + ly, this.origin[2] - sn * lx + c * lz]
  }

  /** Parent point → local point; the inverse of toParent. */
  fromParent([x, y, z]) {
    const s = this.scale
    const dx = x - this.origin[0], dy = y - this.origin[1], dz = z - this.origin[2]
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw)
    const lx = (c * dx - sn * dz) / s
    const lz = (sn * dx + c * dz) / s
    const ly = dy / s
    return this.flipY ? [lx, -lz, ly] : [lx, ly, lz]
  }

  /** The chain of frames from this one up to the root. */
  path() {
    const p = []
    for (let f = this; f; f = f.parent) p.push(f)
    return p
  }
}

/** Maps a point in `from`'s coordinates to `to`'s, through their common ancestors. */
export function reproject(point, from, to) {
  let p = point
  for (const f of from.path()) {
    if (f.parent === null) break
    p = f.toParent(p)
  }
  const down = to.path().filter((f) => f.parent !== null).reverse()
  for (const f of down) p = f.fromParent(p)
  return p
}

/** How many seconds of `to`'s clock pass during `seconds` of `from`'s. */
export function reprojectDuration(seconds, from, to) {
  return seconds * to.absoluteRate / from.absoluteRate
}

/** "1 : 250", "×600", for HUD readouts of a rate against wall time. */
export function formatRate(r) {
  if (!isFinite(r) || r <= 0) return 'stopped'
  if (r >= 1) return `×${r >= 100 ? Math.round(r) : r.toFixed(r >= 10 ? 0 : 1)}`
  return `1 : ${Math.round(1 / r).toLocaleString()}`
}

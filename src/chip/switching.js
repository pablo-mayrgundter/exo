// Where the chip's switching happens: what the floor needs to run a pulse
// along a node's traces when it changes (chipfloor.js), from the sim's
// record of each change's cause (sim.js `trace`).
//
// A switch-level sim settles a node all at once, so it says nothing about
// how a change travels along a wire. What it does say is which transistor
// set the change off, and in which wave of the half-step's recalculation
// (each wave's changes caused by the last wave's): a real order. The pulse
// starts at that transistor and spreads through the node's own shapes; for
// a change from outside (the clock, the data bus), from the node's pad at
// the die's edge.

/**
 * The nodes that switched since the last call, each with its last change's
 * cause (a transistor, or -1 from outside) and wave, and how many times it
 * changed; the counts start again from zero.
 * @param {{cause: Int32Array, wave: Uint8Array, count: Uint16Array}} trace
 */
export function switched(trace) {
  const { cause, wave, count } = trace
  let n = 0
  for (let i = 0; i < count.length; i++) if (count[i]) n++
  const out = { nodes: new Uint16Array(n), cause: new Int32Array(n), wave: new Uint8Array(n), count: new Uint16Array(n) }
  for (let i = 0, k = 0; i < count.length; i++) {
    if (!count[i]) continue
    out.nodes[k] = i
    out.cause[k] = cause[i]
    out.wave[k] = wave[i]
    out.count[k] = count[i]
    k++
  }
  count.fill(0)
  return out
}

/** How far apart a transistor's two terminals' nearest corners may be, layout units. */
const REACH = 80
const CELL = 40

/**
 * Where each transistor is, in layout units: its channel, under the gate,
 * between the diffusion of its two terminals. Of the pairs of corners of
 * the two terminals' shapes within REACH of each other, the closest whose
 * midpoint lies on the gate's polysilicon; else the closest pair; else the
 * first terminal's corner nearest the gate's. (The nearest pair alone is
 * often at a neighbouring transistor between the same two nodes.) And
 * where each node meets the outside: its corner nearest the die's edge (a
 * pin's pad).
 * @param {{segdefs: number[][], transdefs: number[][], chipSize?: number}} data
 * @returns {{transistors: Float32Array, pads: Float32Array}} x, y pairs
 */
export function switchingSites(data) {
  let n = 0
  for (const s of data.segdefs) n = Math.max(n, s[0] + 1)
  // Every corner, by node, and in a grid.
  const corners = Array.from({ length: n }, () => [])
  const shapes = Array.from({ length: n }, () => []) // per node: {c, x0, y0, x1, y1}
  const grid = new Map()
  const key = (x, y) => Math.floor(x / CELL) * 100000 + Math.floor(y / CELL)
  for (const s of data.segdefs) {
    const node = s[0]
    const c = s.slice(3)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i + 1 < c.length; i += 2) {
      x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1])
    }
    shapes[node].push({ c, x0, y0, x1, y1 })
    for (let i = 3; i + 1 < s.length; i += 2) {
      const x = s[i], y = s[i + 1]
      corners[node].push(x, y)
      const k = key(x, y)
      let cell = grid.get(k)
      if (!cell) grid.set(k, (cell = []))
      cell.push(node, x, y)
    }
  }
  const onNode = (node, x, y) => shapes[node].some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && inside(p.c, x, y))
  /**
   * The corner of node `b` nearest a corner of node `a`, within REACH:
   * [ax, ay, bx, by] or null; with `on`, the nearest pair whose midpoint is
   * on that node, if any is.
   */
  const nearestPair = (a, b, on = -1) => {
    const ca = corners[a]
    let best = REACH * REACH, out = null, bestOn = REACH * REACH, outOn = null
    const r = Math.ceil(REACH / CELL)
    for (let i = 0; i < ca.length; i += 2) {
      const x = ca[i], y = ca[i + 1]
      const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL)
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const cell = grid.get((gx + dx) * 100000 + gy + dy)
          if (!cell) continue
          for (let k = 0; k < cell.length; k += 3) {
            if (cell[k] !== b) continue
            const d = (cell[k + 1] - x) ** 2 + (cell[k + 2] - y) ** 2
            if (d < best) { best = d; out = [x, y, cell[k + 1], cell[k + 2]] }
            if (on >= 0 && d < bestOn && onNode(on, (x + cell[k + 1]) / 2, (y + cell[k + 2]) / 2)) { bestOn = d; outOn = [x, y, cell[k + 1], cell[k + 2]] }
          }
        }
      }
    }
    return outOn ?? out
  }
  const centroid = (node) => {
    const c = corners[node]
    let x = 0, y = 0
    for (let i = 0; i < c.length; i += 2) { x += c[i]; y += c[i + 1] }
    return c.length ? [x / (c.length / 2), y / (c.length / 2)] : [0, 0]
  }

  const tc = data.transdefs.length
  const transistors = new Float32Array(2 * tc)
  data.transdefs.forEach(([gate, c1, c2], t) => {
    // From the smaller of the two terminals: power and ground are huge.
    const [a, b] = corners[c1].length <= corners[c2].length ? [c1, c2] : [c2, c1]
    let p = nearestPair(a, b, gate)
    if (p) {
      transistors[2 * t] = (p[0] + p[2]) / 2
      transistors[2 * t + 1] = (p[1] + p[3]) / 2
      return
    }
    p = nearestPair(a, gate)
    const [x, y] = p ? [p[0], p[1]] : centroid(a)
    transistors[2 * t] = x
    transistors[2 * t + 1] = y
  })

  const size = data.chipSize ?? 10000
  const pads = new Float32Array(2 * n)
  for (let node = 0; node < n; node++) {
    const c = corners[node]
    let best = Infinity
    for (let i = 0; i < c.length; i += 2) {
      const x = c[i], y = c[i + 1]
      const edge = Math.min(x, y, size - x, size - y)
      if (edge < best) { best = edge; pads[2 * node] = x; pads[2 * node + 1] = y }
    }
  }
  return { transistors, pads }
}

function inside(c, x, y) {
  let ins = false
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
    const xi = c[i], yi = c[i + 1], xj = c[j], yj = c[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}

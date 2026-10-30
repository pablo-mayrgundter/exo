/*
 A switch-level simulator of the NMOS 6502, ported from visual6502's
 chipsim.js and macros.js (https://github.com/trebonian/visual6502).

 Copyright (c) 2010 Brian Silverman, Barry Silverman, Ed Spittles
 Copyright (c) 2026 Freality Metaverse Construction, exo.cafe contributors

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

 The algorithm is the original's, step for step, so the two agree node for
 node (test/sim.test.js checks a golden trace). What changed is storage:
 typed arrays and CSR adjacency instead of objects and indexOf scans, which
 makes it several times faster.
*/

/** One 6502, its 64 KiB of RAM, and the clock. */
export class Chip6502 {
  /** @param {{segdefs: number[][], transdefs: number[][], nodenames: Record<string, number>}} data */
  constructor(data) {
    this.names = data.nodenames
    this.gnd = data.nodenames.vss
    this.pwr = data.nodenames.vcc

    let n = 0
    for (const s of data.segdefs) n = Math.max(n, s[0] + 1)
    for (const t of data.transdefs) n = Math.max(n, t[0] + 1, t[1] + 1, t[2] + 1)
    this.nodeCount = n
    this.exists = new Uint8Array(n)
    this.pullup = new Uint8Array(n)
    this.pulldown = new Uint8Array(n)
    this.state = new Uint8Array(n)
    for (const s of data.segdefs) {
      if (!this.exists[s[0]]) {
        this.exists[s[0]] = 1
        this.pullup[s[0]] = s[1]
      }
    }

    const tc = data.transdefs.length
    this.tGate = new Int32Array(tc)
    this.tC1 = new Int32Array(tc)
    this.tC2 = new Int32Array(tc)
    this.tOn = new Uint8Array(tc)
    data.transdefs.forEach(([gate, c1, c2], i) => {
      if (c1 === this.gnd) [c1, c2] = [c2, this.gnd]
      if (c1 === this.pwr) [c1, c2] = [c2, this.pwr]
      this.tGate[i] = gate
      this.tC1[i] = c1
      this.tC2[i] = c2
    })
    // Per node, in definition order: the transistors it gates, and the
    // ones it's a channel terminal of (c1c2s in the original).
    this.gatesStart = csr(n, tc, (emit) => { for (let i = 0; i < tc; i++) emit(this.tGate[i], i) })
    this.gates = this.gatesStart.items
    this.ccStart = csr(n, tc * 2, (emit) => {
      for (let i = 0; i < tc; i++) { emit(this.tC1[i], i); emit(this.tC2[i], i) }
    })
    this.c1c2s = this.ccStart.items

    this.group = new Int32Array(n)
    this.groupLen = 0
    this.inGroup = new Uint32Array(n)
    this.groupGen = 0
    this.queued = new Uint32Array(n)
    this.queueGen = 0
    this.next = []

    this.memory = new Uint8Array(65536)
    /** @type {((addr: number, value: number) => void) | null} */
    this.onWrite = null
    this.halfCycles = 0
    this.nClk0 = data.nodenames.clk0
    this.nRw = data.nodenames.rw
    this.ab = Array.from({ length: 16 }, (_, i) => data.nodenames['ab' + i])
    this.db = Array.from({ length: 8 }, (_, i) => data.nodenames['db' + i])
  }

  // --- chipsim.js ---

  recalcNodeList(list) {
    for (let j = 0; j < 100; j++) { // loop limiter, as in the original
      if (list.length === 0) return
      this.next = []
      this.queueGen++
      for (let i = 0; i < list.length; i++) this.recalcNode(list[i])
      list = this.next
    }
  }

  recalcNode(node) {
    if (node === this.gnd || node === this.pwr) return
    this.groupGen++
    this.groupLen = 0
    this.addNodeToGroup(node)
    const v = this.groupValue()
    const { group, state, gatesStart, gates } = this
    for (let g = 0; g < this.groupLen; g++) {
      const i = group[g]
      if (state[i] === v) continue
      state[i] = v
      for (let k = gatesStart[i]; k < gatesStart[i + 1]; k++) {
        const t = gates[k]
        if (v) {
          if (this.tOn[t]) continue
          this.tOn[t] = 1
          this.addRecalcNode(this.tC1[t])
        } else {
          if (!this.tOn[t]) continue
          this.tOn[t] = 0
          this.addRecalcNode(this.tC1[t])
          this.addRecalcNode(this.tC2[t])
        }
      }
    }
  }

  addRecalcNode(nn) {
    if (nn === this.gnd || nn === this.pwr) return
    if (this.queued[nn] === this.queueGen) return
    this.queued[nn] = this.queueGen
    this.next.push(nn)
  }

  addNodeToGroup(i) {
    if (this.inGroup[i] === this.groupGen) return
    this.inGroup[i] = this.groupGen
    this.group[this.groupLen++] = i
    if (i === this.gnd || i === this.pwr) return
    const { ccStart, c1c2s, tOn, tC1, tC2 } = this
    for (let k = ccStart[i]; k < ccStart[i + 1]; k++) {
      const t = c1c2s[k]
      if (!tOn[t]) continue
      this.addNodeToGroup(tC1[t] === i ? tC2[t] : tC1[t])
    }
  }

  groupValue() {
    const { group, groupLen, inGroup, groupGen } = this
    if (inGroup[this.gnd] === groupGen) return 0
    if (inGroup[this.pwr] === groupGen) return 1
    for (let g = 0; g < groupLen; g++) {
      const nn = group[g]
      if (this.pullup[nn]) return 1
      if (this.pulldown[nn]) return 0
      if (this.state[nn]) return 1
    }
    return 0
  }

  isHigh(nn) { return this.state[nn] === 1 }

  setHigh(name) {
    const nn = this.names[name]
    this.pullup[nn] = 1
    this.pulldown[nn] = 0
    this.recalcNodeList([nn])
  }

  setLow(name) {
    const nn = this.names[name]
    this.pullup[nn] = 0
    this.pulldown[nn] = 1
    this.recalcNodeList([nn])
  }

  // --- macros.js ---

  /** Power on and reset; the CPU then fetches the vector at $FFFC. */
  reset() {
    this.state.fill(0)
    this.state[this.pwr] = 1
    this.tOn.fill(0)
    this.setLow('res')
    this.setLow('clk0')
    this.setHigh('rdy'); this.setLow('so')
    this.setHigh('irq'); this.setHigh('nmi')
    const all = []
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.exists[i] && i !== this.pwr && i !== this.gnd) all.push(i)
    }
    this.recalcNodeList(all)
    for (let i = 0; i < 8; i++) { this.setHigh('clk0'); this.setLow('clk0') }
    this.setHigh('res')
    for (let i = 0; i < 18; i++) this.halfStep()
    this.halfCycles = 0
  }

  halfStep() {
    if (this.isHigh(this.nClk0)) {
      this.setLow('clk0')
      this.busRead()
    } else {
      this.setHigh('clk0')
      this.busWrite()
    }
    this.halfCycles++
  }

  busRead() {
    if (!this.isHigh(this.nRw)) return
    this.writeDataBus(this.memory[this.readBits(this.ab)])
  }

  busWrite() {
    if (this.isHigh(this.nRw)) return
    const a = this.readBits(this.ab)
    const d = this.readBits(this.db)
    this.memory[a] = d
    if (this.onWrite) this.onWrite(a, d)
  }

  readBits(nodes) {
    let v = 0
    for (let i = 0; i < nodes.length; i++) v |= this.state[nodes[i]] << i
    return v
  }

  writeDataBus(x) {
    for (let i = 0; i < 8; i++) {
      const nn = this.db[i]
      const bit = (x >> i) & 1
      this.pullup[nn] = bit
      this.pulldown[nn] = bit ^ 1
    }
    this.recalcNodeList(this.db.slice())
  }

  /** Register file and bus, for the HUD. */
  registers() {
    const r = (p, n = 8) => this.readBits(Array.from({ length: n }, (_, i) => this.names[p + i]))
    return {
      a: r('a'), x: r('x'), y: r('y'), s: r('s'), p: r('p'),
      pc: r('pcl') | (r('pch') << 8),
      ab: this.readBits(this.ab), db: this.readBits(this.db),
      rw: this.state[this.nRw], sync: this.state[this.names.sync],
      halfCycles: this.halfCycles,
    }
  }

  /** visual6502's stateString(): one char per node, for comparing runs. */
  stateString() {
    let s = ''
    for (let i = 0; i < this.nodeCount; i++) {
      if (!this.exists[i]) s += 'x'
      else if (i === this.gnd) s += 'g'
      else if (i === this.pwr) s += 'v'
      else s += this.state[i] ? 'h' : 'l'
    }
    return s
  }
}

/** Compressed sparse rows: start[i]..start[i+1] index items for row i. */
function csr(rows, cap, fill) {
  const count = new Int32Array(rows + 1)
  fill((r) => { count[r + 1]++ })
  for (let i = 0; i < rows; i++) count[i + 1] += count[i]
  const items = new Int32Array(count[rows])
  const at = count.slice(0, rows)
  fill((r, v) => { items[at[r]++] = v })
  count.items = items
  return count
}

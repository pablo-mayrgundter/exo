// Converts visual6502's chip data (segdefs.js, transdefs.js, nodenames.js)
// into public/chip/6502.json, the netlist and layout the browser loads.
//
//   git clone https://github.com/trebonian/visual6502 /tmp/visual6502
//   node scripts/import-visual6502.mjs /tmp/visual6502
//
// The layout and transistor data are © 2010 Greg James, Brian Silverman,
// Barry Silverman, under CC BY-NC-SA 3.0; see public/chip/LICENSE.md.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/import-visual6502.mjs <visual6502 checkout>')
  process.exit(1)
}
const ctx = {}
vm.createContext(ctx)
for (const f of ['nodenames.js', 'segdefs.js', 'transdefs.js']) {
  // `var x = ...` at the top of a script lands on the context.
  vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f })
}

// segdefs: [node, '+'|'-', layer, x0, y0, x1, y1, ...], chip units (0..10000)
const segs = ctx.segdefs.map((s) => [s[0], s[1] === '+' ? 1 : 0, s[2], ...s.slice(3)])
// transdefs: [name, gate, c1, c2, bbox, geometry]; the name is 't' + index
const trans = ctx.transdefs.map((t) => [t[1], t[2], t[3]])
const names = {}
for (const [k, v] of Object.entries(ctx.nodenames)) names[k] = v

const out = {
  source: 'https://github.com/trebonian/visual6502',
  license: 'CC BY-NC-SA 3.0, Greg James, Brian Silverman, Barry Silverman (www.visual6502.org)',
  chipSize: 10000,
  segdefs: segs,
  transdefs: trans,
  nodenames: names,
}
const dst = new URL('../public/chip/6502.json', import.meta.url)
fs.writeFileSync(dst, JSON.stringify(out))
console.log(`wrote ${segs.length} segments, ${trans.length} transistors, ${Object.keys(names).length} names`)

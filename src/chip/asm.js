// A small two-pass 6502 assembler, enough for the programs the bar's chip
// runs. Syntax:
//
//   NAME = $10          ; constant (define before use to get zero page)
//   .org $0400
//   label:  lda #<table  ; < low byte, > high byte, + - for offsets
//           sta (PTR),y
//   .byte 1, 2, $ff
//   .word label
//
// Numbers are $hex, %binary or decimal. Undefined (forward) symbols are
// sized as absolute, so define zero-page names before using them.

const ALU = ['imm', 'zp', 'zpx', 'abs', 'absx', 'absy', 'indx', 'indy']
const SHIFT = ['acc', 'zp', 'zpx', 'abs', 'absx']
const alu = (...ops) => Object.fromEntries(ops.map((op, i) => [ALU[i], op]).filter(([, op]) => op != null))
const shift = (...ops) => Object.fromEntries(ops.map((op, i) => [SHIFT[i], op]))

const OPS = {
  ADC: alu(0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71),
  AND: alu(0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31),
  CMP: alu(0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1),
  EOR: alu(0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51),
  LDA: alu(0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1),
  ORA: alu(0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11),
  SBC: alu(0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1),
  STA: alu(null, 0x85, 0x95, 0x8d, 0x9d, 0x99, 0x81, 0x91),
  ASL: shift(0x0a, 0x06, 0x16, 0x0e, 0x1e),
  LSR: shift(0x4a, 0x46, 0x56, 0x4e, 0x5e),
  ROL: shift(0x2a, 0x26, 0x36, 0x2e, 0x3e),
  ROR: shift(0x6a, 0x66, 0x76, 0x6e, 0x7e),
  INC: { zp: 0xe6, zpx: 0xf6, abs: 0xee, absx: 0xfe },
  DEC: { zp: 0xc6, zpx: 0xd6, abs: 0xce, absx: 0xde },
  BIT: { zp: 0x24, abs: 0x2c },
  CPX: { imm: 0xe0, zp: 0xe4, abs: 0xec },
  CPY: { imm: 0xc0, zp: 0xc4, abs: 0xcc },
  LDX: { imm: 0xa2, zp: 0xa6, zpy: 0xb6, abs: 0xae, absy: 0xbe },
  LDY: { imm: 0xa0, zp: 0xa4, zpx: 0xb4, abs: 0xac, absx: 0xbc },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8e },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8c },
  JMP: { abs: 0x4c, ind: 0x6c },
  JSR: { abs: 0x20 },
  BCC: { rel: 0x90 }, BCS: { rel: 0xb0 }, BEQ: { rel: 0xf0 }, BMI: { rel: 0x30 },
  BNE: { rel: 0xd0 }, BPL: { rel: 0x10 }, BVC: { rel: 0x50 }, BVS: { rel: 0x70 },
}
for (const [m, op] of Object.entries({
  BRK: 0x00, CLC: 0x18, CLD: 0xd8, CLI: 0x58, CLV: 0xb8, DEX: 0xca, DEY: 0x88,
  INX: 0xe8, INY: 0xc8, NOP: 0xea, PHA: 0x48, PHP: 0x08, PLA: 0x68, PLP: 0x28,
  RTI: 0x40, RTS: 0x60, SEC: 0x38, SED: 0xf8, SEI: 0x78, TAX: 0xaa, TAY: 0xa8,
  TSX: 0xba, TXA: 0x8a, TXS: 0x9a, TYA: 0x98,
})) OPS[m] = { imp: op }

const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, indx: 2, indy: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3 }

/**
 * @param {string} source
 * @returns {{bytes: Map<number, number>, symbols: Record<string, number>, listing: {addr: number, bytes: number[], line: string}[]}}
 */
export function assemble(source) {
  const lines = source.split('\n')
  const symbols = {}
  const sizes = []
  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0
    const bytes = new Map()
    const listing = []
    lines.forEach((raw, n) => {
      const fail = (msg) => { throw new Error(`line ${n + 1}: ${msg}: ${raw.trim()}`) }
      let line = raw.replace(/;.*/, '').trim()
      if (!line) return
      const label = line.match(/^([A-Za-z_]\w*):/)
      if (label) {
        if (pass === 1) {
          if (label[1] in symbols) fail(`duplicate label ${label[1]}`)
          symbols[label[1]] = pc
        }
        line = line.slice(label[0].length).trim()
        if (!line) return
      }
      const eq = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/)
      if (eq) {
        symbols[eq[1]] = evaluate(eq[2], symbols, pass, fail)
        return
      }
      const start = pc
      const out = []
      const emit = (b) => { out.push(b & 0xff); bytes.set(pc++ & 0xffff, b & 0xff) }
      const [word, ...rest] = line.split(/\s+/)
      const arg = rest.join(' ').trim()
      const dir = word.toLowerCase()
      if (dir === '.org') {
        pc = evaluate(arg, symbols, pass, fail)
        return
      } else if (dir === '.byte') {
        for (const e of splitArgs(arg)) emit(evaluate(e, symbols, pass, fail))
      } else if (dir === '.word') {
        for (const e of splitArgs(arg)) { const v = evaluate(e, symbols, pass, fail); emit(v); emit(v >> 8) }
      } else {
        const ops = OPS[word.toUpperCase()]
        if (!ops) fail(`unknown mnemonic ${word}`)
        let { mode, expr } = parseOperand(arg, ops)
        let value = expr == null ? 0 : evaluate(expr, symbols, pass, fail)
        if (pass === 1) {
          // Shrink to zero page when the value is known and the mode exists.
          const zp = { abs: 'zp', absx: 'zpx', absy: 'zpy' }[mode]
          if (zp && ops[zp] != null && value !== undefined && value < 256) mode = zp
          sizes[n] = mode
        } else {
          mode = sizes[n]
        }
        if (ops[mode] == null) fail(`${word} has no ${mode} mode`)
        emit(ops[mode])
        if (mode === 'rel') {
          const off = (value ?? pc) - (pc + 1)
          if (pass === 2 && (off < -128 || off > 127)) fail(`branch out of range (${off})`)
          emit(off)
        } else if (SIZE[mode] === 2) {
          if (pass === 2 && value > 0xff) fail(`operand ${value} doesn't fit a byte`)
          emit(value ?? 0)
        } else if (SIZE[mode] === 3) {
          emit(value ?? 0); emit((value ?? 0) >> 8)
        }
      }
      if (pass === 2) listing.push({ addr: start, bytes: out, line: raw })
    })
    if (pass === 2) return { bytes, symbols, listing }
  }
}

function parseOperand(arg, ops) {
  if (!arg) return { mode: ops.imp != null ? 'imp' : 'acc', expr: null }
  if (/^a$/i.test(arg)) return { mode: 'acc', expr: null }
  if (arg.startsWith('#')) return { mode: 'imm', expr: arg.slice(1) }
  let m
  if ((m = arg.match(/^\((.+)\)\s*,\s*y$/i))) return { mode: 'indy', expr: m[1] }
  if ((m = arg.match(/^\((.+)\s*,\s*x\)$/i))) return { mode: 'indx', expr: m[1] }
  if ((m = arg.match(/^\((.+)\)$/))) return { mode: 'ind', expr: m[1] }
  if ((m = arg.match(/^(.+?)\s*,\s*x$/i))) return { mode: 'absx', expr: m[1] }
  if ((m = arg.match(/^(.+?)\s*,\s*y$/i))) return { mode: 'absy', expr: m[1] }
  return { mode: ops.rel != null ? 'rel' : 'abs', expr: arg }
}

function splitArgs(s) { return s.split(',').map((x) => x.trim()).filter(Boolean) }

/** Evaluates `term ((+|-) term)*` with optional leading < or >. Undefined in pass 1 → undefined. */
function evaluate(expr, symbols, pass, fail) {
  expr = expr.trim()
  let part = null
  if (expr[0] === '<' || expr[0] === '>') { part = expr[0]; expr = expr.slice(1) }
  let total = 0
  let unknown = false
  const re = /\s*([+-]?)\s*(\$[0-9a-f]+|%[01]+|\d+|[A-Za-z_]\w*)/iy
  let m
  let at = 0
  while (at < expr.length && (m = re.exec(expr))) {
    at = re.lastIndex
    const tok = m[2]
    let v
    if (tok[0] === '$') v = parseInt(tok.slice(1), 16)
    else if (tok[0] === '%') v = parseInt(tok.slice(1), 2)
    else if (/^\d/.test(tok)) v = parseInt(tok, 10)
    else if (tok in symbols) v = symbols[tok]
    else if (pass === 1) { unknown = true; v = 0 }
    else fail(`undefined symbol ${tok}`)
    total += m[1] === '-' ? -v : v
  }
  if (at !== expr.length) fail(`can't parse expression "${expr}"`)
  if (unknown) return undefined
  if (part === '<') return total & 0xff
  if (part === '>') return (total >> 8) & 0xff
  return total & 0xffff
}

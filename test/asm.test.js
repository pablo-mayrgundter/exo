import { describe, expect, it } from 'vitest'
import { assemble } from '../src/chip/asm.js'

const bytesAt = (r, from, n) => Array.from({ length: n }, (_, i) => r.bytes.get(from + i))

describe('assemble', () => {
  it('encodes visual6502\'s test program', () => {
    const r = assemble(`
      .org 0
      lda #$00
      jsr sub
loop: jmp $0002
      .org $10
sub:  inx
      dey
      inc $0f
      sec
      adc #$02
      rts`)
    expect(bytesAt(r, 0, 8)).toEqual([0xa9, 0x00, 0x20, 0x10, 0x00, 0x4c, 0x02, 0x00])
    expect(bytesAt(r, 0x10, 8)).toEqual([0xe8, 0x88, 0xe6, 0x0f, 0x38, 0x69, 0x02, 0x60])
  })

  it('picks zero page for defined symbols and absolute for forward ones', () => {
    const r = assemble(`
ZP = $10
      .org $400
      lda ZP
      lda far
      lda (ZP),y
      sta ZP+1,x
far:  .byte 1`)
    expect(bytesAt(r, 0x400, 9)).toEqual([0xa5, 0x10, 0xad, 0x09, 0x04, 0xb1, 0x10, 0x95, 0x11])
  })

  it('assembles relative branches both ways, and < > byte selectors', () => {
    const r = assemble(`
      .org $400
back: dex
      bne back
      beq fwd
      lda #<back
      lda #>back
fwd:  rts`)
    expect(bytesAt(r, 0x400, 10)).toEqual([0xca, 0xd0, 0xfd, 0xf0, 0x04, 0xa9, 0x00, 0xa9, 0x04, 0x60])
  })

  it('reports unknown mnemonics and out-of-range branches', () => {
    expect(() => assemble('foo #1')).toThrow(/unknown mnemonic/)
    expect(() => assemble('x: bne y\n.org $200\ny: rts')).toThrow(/out of range/)
  })
})

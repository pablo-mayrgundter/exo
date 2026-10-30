// The Art Car's light show, in 6502 assembly: 32 LEDs on an arch, a
// rainbow chase that steps each frame, and one sparkle per frame picked by
// an 8-bit LFSR. About 700 cycles a frame, so the car glows and moves only
// as fast as someone gives it cycles.

import { standalone } from './vcpu.js'

export const LEDS = { a: 0x0700, count: 32 }
export const ZP = { frame: 0x20, lfsr: 0x21 }

// A job for the vCPU's kernel; `source` runs it on a chip of its own.
export const job = `
FRAME = $20
LFSR  = $21
LEDS  = $0700

        .org $0500
show:   lda #1
        sta LFSR
        lda #0
        sta FRAME
frame:  ldx #31                 ; colour i = ((i + frame) / 2) mod 8
chase:  txa
        clc
        adc FRAME
        lsr a
        and #$07
        sta LEDS,x
        dex
        bpl chase
        lda LFSR                ; Galois LFSR, taps $B8
        lsr a
        bcc keep
        eor #$b8
keep:   sta LFSR
        and #$1f                ; sparkle: colour 8 on LED (lfsr mod 32)
        tax
        lda #8
        sta LEDS,x
        inc FRAME
        jmp frame
`

export const source = standalone(job, 'show')

/** The LEDs the program shows after frame `f`'s pass, in JS. */
export function lightshowFrame(f, lfsrBefore) {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = ((i + f) & 0xff) >> 1 & 7
  let l = lfsrBefore >> 1
  if (lfsrBefore & 1) l ^= 0xb8
  out[l & 31] = 8
  return { leds: out, lfsr: l }
}

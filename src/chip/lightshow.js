// The Art Car's light show, in 6502 assembly: 32 LEDs on an arch, a
// rainbow chase that steps each frame, and one sparkle per frame picked by
// an 8-bit LFSR. About 700 cycles a frame, so the car glows and moves only
// as fast as someone gives it cycles.

export const LEDS = { a: 0x0200, count: 32 }
export const ZP = { frame: 0x1a, lfsr: 0x1b }

export const source = `
FRAME = $1a
LFSR  = $1b
LEDS  = $0200

        .org $0400
start:  ldx #$ff
        txs
        lda #1
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

        .org $fffc
        .word start, start
`

/** The LEDs the program shows after frame `f`'s pass, in JS. */
export function lightshowFrame(f, lfsrBefore) {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = ((i + f) & 0xff) >> 1 & 7
  let l = lfsrBefore >> 1
  if (lfsrBefore & 1) l ^= 0xb8
  out[l & 31] = 8
  return { leds: out, lfsr: l }
}

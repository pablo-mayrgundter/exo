// Max Pablo's mind, a job on the vCPU: each thought turns a 16-bit Galois
// LFSR 256 steps (about 5,600 cycles), then picks which line Max says next.
// He speaks as often as the CPU gives him time to think.
import { standalone } from './vcpu.js'

export const ZP = { frame: 0x28, line: 0x29, lo: 0x2a, hi: 0x2b }
export const LINES = 16

export const job = `
MFRAME = $28
MLINE  = $29
ML     = $2a
MH     = $2b

        .org $0580
max:    lda #$e1                ; any non-zero seed
        sta ML
        lda #$ac
        sta MH
think:  ldx #0                  ; 256 steps of x^16 Galois, taps $B400
step:   lsr MH
        ror ML
        bcc nofb
        lda MH
        eor #$b4
        sta MH
nofb:   dex
        bne step
        lda ML
        and #$0f                ; one of 16 lines
        sta MLINE
        inc MFRAME
        jmp think
`

export const source = standalone(job, 'max')

/** The line after a thought, in JS: [line, lfsr state after]. */
export function maxThought(state) {
  let s = state
  for (let i = 0; i < 256; i++) {
    const out = s & 1
    s >>>= 1
    if (out) s ^= 0xb400
  }
  return [s & 0x0f, s]
}

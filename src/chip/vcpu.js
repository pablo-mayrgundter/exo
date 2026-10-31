// The vCPU: the 6502 under the street, time-shared. A small preemptive
// kernel runs the bar's jobs (Life, the Art Car's light show, Max Pablo's
// mind) round-robin on a timer interrupt the host raises every QUANTUM
// cycles. Each job gets SHARE[j] quanta per turn: the host writes that
// table, a system share plus whatever visitors donate, so a donation is
// literally more time on the CPU.
//
// Memory map:
//   $00-$0F  kernel: CUR (job running), LEFT (quanta left), SHARE, SPS
//   $10-$1F  Life       $20-$27  light show       $28-$2F  Max
//   $0100    stack, a slice per job: $FF.., $BF.., $7F.. down
//   $0200-$03FF  Life's two boards
//   $0400 Life · $0500 light show · $0580 Max · $0600 kernel (code)
//   $0700-$071F  the Art Car's LEDs
//   $FFF0    write to acknowledge the timer
import { assemble } from './asm.js'

export const KERNEL = { cur: 0x00, left: 0x01, share: 0x08, sps: 0x0c, ack: 0xfff0 }
export const QUANTUM = 500 // cycles between timer interrupts

/** Wraps a job (code with an entry label, no vectors) to run on a chip alone. */
export function standalone(job, entry) {
  return `${job}
        .org $ff00
boot:   ldx #$ff
        txs
        jmp ${entry}
        .org $fffc
        .word boot, boot
`
}

/**
 * The kernel and jobs as one image.
 * @param {{name: string, entry: string, job: string}[]} jobs in kernel order
 */
export function kernelSource(jobs) {
  const tops = [0xff, 0xbf, 0x7f]
  // Each job starts as if it had just been interrupted at its entry point:
  // PCH, PCL, P (interrupts on), then A, X, Y, as the IRQ and isr push them.
  const frames = jobs.map((j, k) => {
    const t = tops[k]
    return `
        lda #>${j.entry}
        sta $0100+${t}
        lda #<${j.entry}
        sta $0100+${t - 1}
        lda #$20
        sta $0100+${t - 2}
        lda #${t - 6}
        sta SPS+${k}`
  }).join('')
  return `
CUR   = $00
LEFT  = $01
SHARE = $08
SPS   = $0c
ACK   = $fff0
NJOBS = ${jobs.length}

${jobs.map((j) => j.job).join('\n')}

        .org $0600
reset:  sei
        cld
        ldx #$ff
        txs
${frames}
        ldy #0                  ; start the first job with a share
        jmp pick

; The timer: save the job, and every SHARE[CUR] ticks switch to the next.
isr:    pha
        txa
        pha
        tya
        pha
        sta ACK                 ; acknowledge; the host releases the line
        dec LEFT
        bne resume
        tsx
        ldy CUR
        stx SPS,y
next:   iny
pick:   cpy #NJOBS
        bcc check
        ldy #0
check:  lda SHARE,y
        beq next                ; no share, no turn (the host keeps one > 0)
        sty CUR
        sta LEFT
        ldx SPS,y
        txs
resume: pla
        tay
        pla
        tax
        pla
        rti

nmi:    rti

        .org $fffa
        .word nmi, reset, isr
`
}

/** Assembles the kernel with its jobs. Returns bytes, symbols and each job's size. */
export function buildVcpu(jobs) {
  const r = assemble(kernelSource(jobs))
  // Code size per job: from its entry to the next code block.
  const starts = [...jobs.map((j) => r.symbols[j.entry]), r.symbols.reset].sort((a, b) => a - b)
  const sizes = {}
  for (const j of jobs) {
    const a = r.symbols[j.entry]
    const end = starts.find((s) => s > a) ?? 0x10000
    let n = 0
    for (const addr of r.bytes.keys()) if (addr >= a && addr < end) n++
    sizes[j.name] = n
  }
  let kernel = 0
  for (const addr of r.bytes.keys()) if (addr >= r.symbols.reset && addr < 0xff00) kernel++
  sizes.kernel = kernel
  return { bytes: [...r.bytes], symbols: r.symbols, sizes }
}

/**
 * The host's side of the timer: raise IRQ every `quantum` cycles, release
 * it when the kernel writes KERNEL.ack. Call `halfStep()` after each of
 * the chip's half-steps, and `ack()` from the chip's write hook.
 */
export function makeTimer(chip, quantum = QUANTUM) {
  let count = 0, raised = false
  return {
    halfStep() {
      if (++count < quantum * 2) return
      count = 0
      if (!raised) { chip.setLow('irq'); raised = true }
    },
    ack() {
      if (raised) { chip.setHigh('irq'); raised = false }
    },
  }
}

/** The bar's jobs, in kernel order: job k runs on stack slice k. */
export const JOBS = ['life', 'show', 'max']

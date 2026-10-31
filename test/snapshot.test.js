import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chip6502 } from '../src/chip/sim.js'
import { buildVcpu, makeTimer, KERNEL } from '../src/chip/vcpu.js'
import { encode, decode } from '../src/chip/snapshot.js'
import { job as lifeJob } from '../src/chip/life.js'
import { job as showJob } from '../src/chip/lightshow.js'
import { job as maxJob } from '../src/chip/max.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/chip/6502.json', import.meta.url), 'utf8'))
const { bytes } = buildVcpu([
  { name: 'life', entry: 'life', job: lifeJob },
  { name: 'show', entry: 'show', job: showJob },
  { name: 'max', entry: 'max', job: maxJob },
])

function boot() {
  const chip = new Chip6502(data)
  for (const [a, b] of bytes) chip.memory[a] = b
  ;[6, 1, 1].forEach((s, k) => { chip.memory[KERNEL.share + k] = s })
  const timer = makeTimer(chip)
  chip.onWrite = (a) => { if (a === KERNEL.ack) timer.ack() }
  return { chip, timer }
}
const run = ({ chip, timer }, n) => { for (let i = 0; i < n; i++) { chip.halfStep(); timer.halfStep() } }

describe('vCPU snapshots', () => {
  it('resume bit for bit, through encode and decode', () => {
    const a = boot()
    a.chip.reset()
    run(a, 5000)
    const buf = encode(a.chip.snapshot(), { timer: a.timer.state }, bytes)
    // A fresh chip restored from the blob, and the original, carry on alike.
    const b = boot()
    const got = decode(buf, bytes)
    b.chip.restore(got.snap)
    b.timer.state = got.host.timer
    run(a, 3000)
    run(b, 3000)
    expect(b.chip.stateString()).toBe(a.chip.stateString())
    expect(b.chip.halfCycles).toBe(a.chip.halfCycles)
    expect(b.chip.memory.slice(0, 0x800)).toEqual(a.chip.memory.slice(0, 0x800))
  })

  it('refuses a snapshot taken with another program', () => {
    const a = boot()
    a.chip.reset()
    const buf = encode(a.chip.snapshot(), {}, bytes)
    expect(decode(buf, [[0x400, 0xea]])).toBe(null)
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Chip6502 } from '../src/chip/sim.js'
import { buildVcpu, makeTimer, KERNEL } from '../src/chip/vcpu.js'
import { job as lifeJob, BOARD, ZP as LIFE, lifeStep } from '../src/chip/life.js'
import { job as showJob, ZP as SHOW, LEDS, lightshowFrame } from '../src/chip/lightshow.js'
import { job as maxJob, ZP as MAX, maxThought } from '../src/chip/max.js'

const data = JSON.parse(fs.readFileSync(new URL('../public/chip/6502.json', import.meta.url), 'utf8'))
const JOBS = [
  { name: 'life', entry: 'life', job: lifeJob },
  { name: 'show', entry: 'show', job: showJob },
  { name: 'max', entry: 'max', job: maxJob },
]

describe('the vCPU kernel', () => {
  it('time-shares Life, the light show and Max by their shares, and each still computes right', () => {
    const { bytes, sizes } = buildVcpu(JOBS)
    expect(sizes.kernel).toBeGreaterThan(40)
    const chip = new Chip6502(data)
    for (const [a, b] of bytes) chip.memory[a] = b
    const shares = [8, 1, 1]
    shares.forEach((s, k) => { chip.memory[KERNEL.share + k] = s })
    const timer = makeTimer(chip)
    const cycles = [0, 0, 0]
    const frames = { life: [], show: [], max: [] }
    const last = {}
    let lfsr = 1, maxState = 0xace1, showChecked = 0, maxChecked = 0, lifeOk = null
    chip.onWrite = (a, d) => {
      if (a === KERNEL.ack) timer.ack()
      // Frame counters: INC writes the old value back first, so act on change.
      for (const [name, addr] of [['life', LIFE.gen], ['show', SHOW.frame], ['max', MAX.frame]]) {
        if (a !== addr || d === last[name]) continue
        const first = last[name] === undefined
        last[name] = d
        if (!first) frames[name].push(d)
      }
    }
    chip.reset()
    let lifeInput = null
    while (lifeOk === null) {
      chip.halfStep()
      timer.halfStep()
      cycles[chip.memory[KERNEL.cur]] += 0.5
      if (frames.show.length > showChecked) {
        const { leds, lfsr: next } = lightshowFrame(frames.show[showChecked] - 1, lfsr)
        expect([...chip.memory.slice(LEDS.a, LEDS.a + LEDS.count)]).toEqual([...leds])
        lfsr = next
        showChecked++
      }
      if (frames.max.length > maxChecked) {
        const [line, next] = maxThought(maxState)
        expect(chip.memory[MAX.line]).toBe(line)
        maxState = next
        maxChecked++
      }
      // Life: snapshot the board when generation 0 starts, check gen 1.
      if (!lifeInput && chip.memory[BOARD.a + 0x88] === 1 && chip.memory[LIFE.i] > 0) {
        lifeInput = chip.memory.slice(BOARD.a, BOARD.a + 256)
      }
      if (frames.life.length) {
        lifeOk = [...chip.memory.slice(BOARD.b, BOARD.b + 256)].join() === [...lifeStep(lifeInput)].join()
      }
    }
    expect(lifeOk).toBe(true)
    expect(showChecked).toBeGreaterThan(3)
    expect(maxChecked).toBeGreaterThan(0)
    const total = cycles[0] + cycles[1] + cycles[2]
    // 8 : 1 : 1, give or take the kernel's own time and the last slice.
    expect(cycles[0] / total).toBeGreaterThan(0.72)
    expect(cycles[0] / total).toBeLessThan(0.86)
    expect(Math.abs(cycles[1] - cycles[2]) / total).toBeLessThan(0.05)
  }, 180000)
})

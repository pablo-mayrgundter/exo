import { describe, expect, it } from 'vitest'
import { Mist, Job } from '../src/mist/scheduler.js'
import { verifyLife, lifeStep } from '../src/chip/life.js'

/** A worker stand-in that records duty messages and can emit events. */
function fakeWorker() {
  const listeners = []
  return {
    duty: null,
    postMessage(m) { if (m.type === 'duty') this.duty = m },
    addEventListener(_, fn) { listeners.push(fn) },
    emit(data) { listeners.forEach((fn) => fn({ data })) },
  }
}

function setup(slots = 2) {
  const worker = fakeWorker()
  const mist = new Mist({ donor: { name: 'pmy' }, worker, system: 0.4 })
  mist.slots = slots
  const jobs = [['a', 6], ['b', 1], ['c', 1]].map(([id, weight]) => mist.add(new Job({ id, name: id, place: 'here', weight })))
  return { mist, worker, jobs }
}

describe('Mist on the vCPU', () => {
  it('runs on system shares alone with no donation', () => {
    const { worker, jobs: [a, b] } = setup()
    expect(worker.duty.duty).toBeCloseTo(0.4, 9)
    expect(worker.duty.shares).toEqual([6, 1, 1])
    expect(worker.duty.donated).toEqual([0, 0, 0])
    expect(a.core.system).toBeCloseTo(0.3, 9) // 6/8 of the system's 0.4
    expect(b.state).toBe('system')
  })

  it('turns a donation into kernel shares on the system scale', () => {
    const { mist, worker, jobs: [, b, c] } = setup()
    mist.setBudget(0.2)
    mist.give('b'); mist.give('b'); mist.give('c')
    expect(worker.duty.duty).toBeCloseTo(0.6, 9)
    // 8 system shares per 0.4 of a core: 0.2 donated is 4 more, split 2 : 1.
    expect(worker.duty.donated[1]).toBeCloseTo(8 / 3, 9)
    expect(worker.duty.donated[2]).toBeCloseTo(4 / 3, 9)
    expect(b.core.donated).toBeCloseTo(0.2 * 2 / 3, 9)
    expect([b.state, c.state]).toEqual(['donated', 'donated'])
  })

  it('queues donations beyond the slots, and runs them when a slot frees', () => {
    const { mist, jobs: [a, b, c] } = setup(2)
    mist.setBudget(0.3)
    mist.give('a'); mist.give('b'); mist.give('c')
    expect([a.state, b.state, c.state]).toEqual(['donated', 'donated', 'queued'])
    mist.take('a')
    expect([a.state, b.state, c.state]).toEqual(['system', 'donated', 'donated'])
  })

  it('never takes the vCPU past 95% of a core', () => {
    const { mist, worker } = setup()
    mist.setBudget(1)
    expect(mist.budget).toBeCloseTo(0.55, 9)
    expect(worker.duty.duty).toBeCloseTo(0.95, 9)
  })

  it('names the donor on frames they paid a quarter of, and verifies them', () => {
    const { mist, worker, jobs: [a] } = setup()
    a.verify = verifyLife
    const input = new Uint8Array(256)
    for (const i of [0x01, 0x12, 0x20, 0x21, 0x22]) input[i] = 1 // a glider
    const output = lifeStep(input)
    worker.emit({ type: 'receipt', job: 'a', frame: 7, halfCycles: 1000, given: 300, input: 'x', output: 'y', inputBoard: input, outputBoard: output, t: 1 })
    worker.emit({ type: 'receipt', job: 'a', frame: 8, halfCycles: 1000, given: 100, input: 'y', output: 'z', inputBoard: output, outputBoard: input, t: 2 })
    expect(a.receipts.map((r) => [r.frame, r.donor, r.verified])).toEqual([[8, null, false], [7, 'pmy', true]])
    expect(mist.mine.map((r) => r.frame)).toEqual([7])
  })
})

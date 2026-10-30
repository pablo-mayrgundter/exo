import { describe, expect, it } from 'vitest'
import { Mist, Sim } from '../src/mist/scheduler.js'
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
  const mist = new Mist({ donor: { name: 'pmy' } })
  mist.slots = slots
  const sims = ['a', 'b', 'c'].map((id) => mist.add(new Sim({ id, name: id, place: 'here', implicit: 0.1, worker: fakeWorker() })))
  return { mist, sims }
}

describe('Mist', () => {
  it('splits the budget among gifts, in proportion', () => {
    const { mist, sims: [a, b] } = setup()
    mist.setBudget(0.6)
    mist.give('a'); mist.give('a'); mist.give('b')
    expect(a.explicit).toBeCloseTo(0.4, 9)
    expect(b.explicit).toBeCloseTo(0.2, 9)
    expect(a.worker.duty).toEqual({ type: 'duty', implicit: 0.1, explicit: a.explicit })
  })

  it('queues gifts beyond the slots, and runs them when a slot frees', () => {
    const { mist, sims: [a, b, c] } = setup(2)
    mist.setBudget(0.5)
    mist.give('a'); mist.give('b'); mist.give('c')
    expect([a.state, b.state, c.state]).toEqual(['running', 'running', 'queued'])
    expect(c.explicit).toBe(0)
    mist.take('a')
    expect([a.state, b.state, c.state]).toEqual(['implicit', 'running', 'running'])
  })

  it('drops to implicit with no budget, and never asks for more than a core', () => {
    const { mist, sims: [a] } = setup()
    mist.give('a')
    expect(a.state).toBe('implicit')
    mist.setBudget(1)
    expect(a.explicit).toBeCloseTo(0.85, 9) // 0.95 cap less the implicit 0.1
  })

  it('names the giver on frames they paid a quarter of, and verifies them', () => {
    const { mist, sims: [a] } = setup()
    a.verify = verifyLife
    const input = new Uint8Array(256)
    for (const i of [0x01, 0x12, 0x20, 0x21, 0x22]) input[i] = 1 // a glider
    const output = lifeStep(input)
    a.worker.emit({ type: 'receipt', frame: 7, halfCycles: 1000, given: 300, input: 'x', output: 'y', inputBoard: input, outputBoard: output, t: 1 })
    a.worker.emit({ type: 'receipt', frame: 8, halfCycles: 1000, given: 100, input: 'y', output: 'z', inputBoard: output, outputBoard: input, t: 2 })
    expect(a.receipts.map((r) => [r.frame, r.donor, r.verified])).toEqual([[8, null, false], [7, 'pmy', true]])
    expect(mist.mine.map((r) => r.frame)).toEqual([7])
  })
})

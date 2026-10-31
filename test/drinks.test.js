import { describe, expect, it } from 'vitest'
import { BarState, DRINKS, DRINK_CYCLES, drinkIn } from '../src/world/drinks.js'

/** A bar with a shelf of bottles, without the 3D. */
function fakeBar() {
  const bottleInfo = []
  for (let i = 0; i < 14; i++) bottleInfo.push({ kind: i % 7, pos: { x: i - 7, y: 1, z: -6.6 }, color: 0xffffff })
  return { bottleInfo, bottles: { setMatrixAt() {}, instanceMatrix: {} } }
}

describe('drinks', () => {
  it('hears orders in free text', () => {
    expect(drinkIn('a carry flag please').id).toBe('carry-flag')
    expect(drinkIn('Zero Page!').id).toBe('zero-page')
    expect(drinkIn('gimme an NMI').id).toBe('nmi')
    expect(drinkIn('how is the weather')).toBe(null)
  })

  it('pours from a bottle of the right colour, four pours a bottle, and restocks', () => {
    const s = new BarState(fakeBar())
    const d = DRINKS.find((x) => x.id === 'zero-page') // kind 0: bottles 0 and 7
    const first = s.bottleFor(d, -7)
    expect(s.bar.bottleInfo[first].kind).toBe(0)
    for (let i = 0; i < 4; i++) s.pour(first, i, d, 'pmy')
    expect(s.pours[first]).toBe(0)
    expect(s.bottleFor(d, -7)).not.toBe(first) // the other one
    expect(s.restockOne()).toBe(true)
    expect(s.pours[first]).toBe(4)
    expect(s.tab.drinks).toBe(4)
  })

  it('empties a drink with donated cycles, and runs the tab', () => {
    const s = new BarState(fakeBar())
    s.pour(0, 3, DRINKS[0], 'pmy')
    expect(s.level(3)).toBe(1)
    expect(s.drink(3, DRINK_CYCLES / 2)).toBe(false)
    expect(s.level(3)).toBeCloseTo(0.5, 9)
    expect(s.drink(3, DRINK_CYCLES)).toBe(true) // the last of it
    expect(s.level(3)).toBe(0)
    expect(s.tab.cycles).toBe(DRINK_CYCLES / 2) // half-cycles in, cycles on the tab
  })
})

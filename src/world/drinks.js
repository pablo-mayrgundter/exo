// Drinks. Each is an 8-bit cocktail poured from a bottle on the back bar,
// set on the counter in front of a stool, and paid for in compute: a drink
// on the bar is a donation to Max's mind (his attention), and it empties
// as those donated cycles are spent. An empty glass is a cue for another
// round, or for Max to drift back to his chores.
//
// The bar's state (glasses on the counter, what's left in each bottle,
// your tab, what Max remembers of you) is kept in the browser between
// visits.
import * as THREE from 'three'
import { C } from '../theme.js'

/** The menu. `kind` is the bottle colour on the back bar (bar.js palette index). */
export const DRINKS = [
  { id: 'zero-page', name: 'Zero Page', color: C.cyan, kind: 0, note: 'fast, close at hand' },
  { id: 'nmi', name: 'Non-Maskable Interrupt', color: C.magenta, kind: 1, note: 'the one you can\'t ignore' },
  { id: 'stack-overflow', name: 'Stack Overflow', color: C.green, kind: 3, note: 'tall, and it keeps coming' },
  { id: 'carry-flag', name: 'Carry Flag', color: C.amber, kind: 6, note: 'one more than you meant' },
]
/** Donated half-cycles a drink holds: about two minutes at a quarter of a core. */
export const DRINK_CYCLES = 200000
const POURS_PER_BOTTLE = 4
const KEY = 'exo.cafe/bar'

export function drinkById(id) { return DRINKS.find((d) => d.id === id) }

/** Finds a drink named in free text ("a carry flag please"), or null. */
export function drinkIn(text) {
  const t = text.toLowerCase()
  return DRINKS.find((d) => t.includes(d.name.toLowerCase()) || t.includes(d.id.replace('-', ' '))) ??
    (/\bnmi\b/.test(t) ? drinkById('nmi') : null)
}

/** A glass: an outline and a column of glowing liquid that drops as it's drunk. */
export function makeGlass(drink) {
  const group = new THREE.Group()
  const h = 0.16, r = 0.045
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r * 0.8, h, 10)),
    new THREE.LineBasicMaterial({ color: C.text, toneMapped: false, transparent: true, opacity: 0.6 }))
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.72, 1, 10),
    new THREE.MeshBasicMaterial({ color: drink.color, toneMapped: false }))
  outline.position.y = h / 2
  group.add(outline, liquid)
  const setLevel = (l) => {
    const v = Math.max(0.001, Math.min(1, l)) * h * 0.9
    liquid.scale.y = v
    liquid.position.y = v / 2 + 0.005
    liquid.visible = l > 0.01
  }
  setLevel(1)
  return { group, setLevel }
}

/** The bar's saved state, and the shelf it's kept in sync with. */
export class BarState {
  constructor(bar) {
    this.bar = bar
    this.glasses = {} // seat index → { drink, consumed, by, poured }
    this.pours = bar.bottleInfo.map(() => POURS_PER_BOTTLE) // per bottle
    this.tab = { drinks: 0, cycles: 0 }
    this.max = { regulars: {} } // name → { visits, last, lastDrink, memory: [] }
    try {
      const s = JSON.parse(localStorage.getItem(KEY))
      if (s) {
        this.glasses = s.glasses ?? {}
        if (s.pours?.length === this.pours.length) this.pours = s.pours
        this.tab = s.tab ?? this.tab
        this.max = s.max ?? this.max
      }
    } catch { /* storage may be blocked */ }
    this.syncShelf()
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ glasses: this.glasses, pours: this.pours, tab: this.tab, max: this.max }))
    } catch { /* fine */ }
  }

  /** Hides empty bottles (and one being carried). */
  syncShelf(carried = -1) {
    const m = new THREE.Matrix4()
    this.bar.bottleInfo.forEach((b, i) => {
      const show = this.pours[i] > 0 && i !== carried
      this.bar.bottles.setMatrixAt(i, show ? m.makeTranslation(b.pos) : m.makeScale(0, 0, 0))
    })
    this.bar.bottles.instanceMatrix.needsUpdate = true
  }

  /** A bottle of the drink's colour with pours left, nearest to x. */
  bottleFor(drink, x = 0) {
    let best = -1
    this.bar.bottleInfo.forEach((b, i) => {
      if (b.kind !== drink.kind || this.pours[i] <= 0) return
      if (best < 0 || Math.abs(b.pos.x - x) < Math.abs(this.bar.bottleInfo[best].pos.x - x)) best = i
    })
    return best
  }

  /** An empty bottle slot to refill (Max restocks one per visit to the shelf). */
  restockOne() {
    const i = this.pours.findIndex((p) => p <= 0)
    if (i < 0) return false
    this.pours[i] = POURS_PER_BOTTLE
    this.syncShelf()
    this.save()
    return true
  }

  pour(bottle, seat, drink, by) {
    this.pours[bottle] = Math.max(0, this.pours[bottle] - 1)
    this.glasses[seat] = { drink: drink.id, consumed: 0, by, poured: Date.now() }
    this.tab.drinks++
    this.save()
  }

  level(seat) {
    const g = this.glasses[seat]
    return g ? Math.max(0, 1 - g.consumed / DRINK_CYCLES) : 0
  }

  /** Spends donated half-cycles on a seat's drink. Returns true when it empties. */
  drink(seat, halfCycles) {
    const g = this.glasses[seat]
    if (!g || g.consumed >= DRINK_CYCLES) return false
    const before = g.consumed
    g.consumed = Math.min(DRINK_CYCLES, g.consumed + halfCycles)
    this.tab.cycles += (g.consumed - before) / 2 // what was drunk, not what was offered
    return g.consumed >= DRINK_CYCLES
  }

  clear(seat) {
    delete this.glasses[seat]
    this.save()
  }

  /** Max's memory of a regular. */
  regular(name) {
    this.max.regulars[name] ??= { visits: 0, last: 0, lastDrink: null, memory: [] }
    return this.max.regulars[name]
  }
}

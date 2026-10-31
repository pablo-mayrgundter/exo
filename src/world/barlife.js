// Life at the bar: the stools, the glasses on the counter, orders, and
// talking with Max. main.js keeps the camera and the input; this keeps who
// sits where and what's in front of them.
//
// A drink is a donation to Max's mind (the 'max' job on the vCPU): pouring
// one gives that job a chip token from your budget, and the glass empties
// as those donated cycles are spent. While you're seated with a drink he
// stays for longer spells of conversation; with an empty glass he offers
// another, and drifts back to his chores.
import { BarState, DRINKS, drinkById, drinkIn, makeGlass, DRINK_CYCLES } from './drinks.js'
import { Bartender } from '../npc/bartender.js'

/**
 * @param {{bar: object, avatar: object, mist: object, me: {name: string}, say: (t: string) => void,
 *   note: (t: string) => void, respond: (text: string) => string}} o
 */
export function makeBarLife({ bar, avatar, mist, me, say, note, respond }) {
  const state = new BarState(bar)
  const glasses = {} // seat → { glass, drink }
  let remote = {} // seat → { drink, level, who }: other visitors' open drinks, from presence
  let seat = null
  let lastGiven = mist.get('max').given
  let saveAt = 0, offered = false, greeted = false
  const bartender = new Bartender({
    avatar: bar.max, bar, state, say,
    onPoured: (s, drink) => {
      placeGlass(s, drink)
      if (s === seat) startDrinking()
    },
  })
  // Glasses left on the counter last visit.
  for (const [s, g] of Object.entries(state.glasses)) placeGlass(Number(s), drinkById(g.drink))

  function placeGlass(s, drink) {
    if (glasses[s]) bar.group.remove(glasses[s].glass.group)
    const glass = makeGlass(drink)
    glass.group.position.copy(bar.glassAt(bar.seats[s]))
    bar.group.add(glass.group)
    glasses[s] = { glass, drink }
    glass.setLevel(state.level(s))
  }

  function mine(s) { return state.glasses[s]?.by === me.name && state.level(s) > 0 }

  /** The stool where you have an unfinished drink (your open tab), or null. */
  function openSeat() {
    for (const s of Object.keys(state.glasses)) if (mine(Number(s))) return Number(s)
    return null
  }

  function startDrinking() {
    if (mist.budget === 0) {
      mist.setBudget(0.25)
      note('A drink here is paid in compute: your donation budget is now 25% of a core (change it in vCPU).')
    }
    mist.give('max')
    avatar.seated && (avatar.seated.drink = true)
    offered = false
  }

  function stopDrinking() {
    mist.take('max')
    if (avatar.seated) avatar.seated.drink = false
  }

  return {
    state, bartender, DRINKS,
    get seat() { return seat },

    /**
     * The nearest free stool within reach of a bar-space point, or -1. A
     * stool with someone else's unfinished drink is theirs until it's done.
     */
    freeSeatNear(p, taken) {
      let best = -1, bd = 1.3
      for (const s of bar.seats) {
        if (taken.has(s.index) || remote[s.index]) continue
        const d = Math.hypot(p.x - s.x, p.z - s.z)
        if (d < bd) { bd = d; best = s.index }
      }
      return best
    },

    sit(i) {
      seat = i
      avatar.sit()
      const s = bar.seats[i]
      avatar.group.position.set(s.x, s.y - 0.88, s.z)
      if (mine(i)) startDrinking()
      bartender.heard(i, performance.now() / 1000)
      const r = state.regular(me.name)
      if (!greeted) {
        greeted = true
        r.visits++
        say(r.visits > 1 && r.lastDrink
          ? `Welcome back, ${me.name}. ${drinkById(r.lastDrink).name} again?`
          : `Evening, ${me.name}. Have a seat. Menu's ${DRINKS.map((d) => d.name).join(', ')}.`)
        state.save()
      }
    },

    stand() {
      if (seat !== null && mine(seat)) stopDrinking()
      seat = null
      avatar.stand()
    },

    /** Orders a drink to your stool. */
    order(id) {
      if (seat === null) return false
      const d = drinkById(id)
      if (mine(seat)) { say(`Finish that one first; it's still ${Math.round(state.level(seat) * 100)}% full.`); return false }
      if (!bartender.order(seat, id, me.name)) { say('Coming, coming.'); return false }
      state.regular(me.name).lastDrink = id
      state.save()
      say(`One ${d.name}, coming up.`)
      return true
    },

    /**
     * Something said at the bar. Orders and the menu are handled here; the
     * rest is conversation (ELIZA, via `respond`) if Max is attending.
     */
    hear(text, time) {
      if (seat === null) return false
      const d = drinkIn(text)
      if (d && /\b(a|an|one|another|get|have|order|want|like|please|gimme|give)\b|^[^ ]+( [^ ]+)?$/i.test(text)) {
        this.order(d.id)
        return true
      }
      if (/\bmenu\b|what (do you|have you got|drinks)|what's good/i.test(text)) {
        setTimeout(() => say(`Tonight: ${DRINKS.map((x) => `${x.name} (${x.note})`).join('; ')}. Each one's paid in donated cycles.`), 900)
        return true
      }
      bartender.heard(seat, time)
      const reply = respond(text)
      setTimeout(() => {
        if (bartender.attending(seat)) say(reply)
        else say('Hang on, I\'m pouring.')
      }, 900 + Math.random() * 900)
      return true
    },

    /** True when Max isn't in a conversation, so he can think aloud. */
    get idle() { return !bartender.talking },

    /**
     * @param {number} dt
     * @param {number} time seconds
     * @param {{seat: number, name: string}[]} others remote visitors on stools
     */
    update(dt, time, others) {
      const customers = others.map((o) => ({ seat: o.seat, name: o.name, drinking: state.level(o.seat) > 0 }))
      if (seat !== null) customers.push({ seat, name: me.name, drinking: state.level(seat) > 0 })
      bartender.update(dt, time, customers)
      // Your drink, emptied by the cycles you've donated to Max's mind.
      const given = mist.get('max').given
      const delta = given - lastGiven
      lastGiven = given
      if (seat !== null && delta > 0 && mine(seat)) {
        if (state.drink(seat, delta)) {
          stopDrinking()
          if (!offered) { offered = true; say(`That's the bottom of the glass. Another ${drinkById(state.glasses[seat].drink).name}?`) }
        }
      }
      for (const [s, g] of Object.entries(glasses)) if (!g.remote) g.glass.setLevel(state.level(Number(s)))
      if (time > saveAt) { saveAt = time + 5; state.save() }
    },

    /** Your open drink, for presence: { seat, drink, level }, or null. */
    openDrink() {
      const s = openSeat()
      return s === null ? null : { seat: s, drink: state.glasses[s].drink, level: +state.level(s).toFixed(3) }
    },

    /** Other visitors' open drinks, from presence: [{ seat, drink, level, who }]. */
    setRemote(list) {
      const next = {}
      for (const d of list) if (d && drinkById(d.drink) && !(state.glasses[d.seat] && mine(d.seat))) next[d.seat] = d
      // Their glasses on the counter, kept in step with what they publish.
      for (const s of Object.keys(remote)) if (!next[s] && glasses[s] && !state.glasses[s]) { bar.group.remove(glasses[s].glass.group); delete glasses[s] }
      for (const [s, d] of Object.entries(next)) {
        if (!glasses[s] || glasses[s].drink.id !== d.drink || glasses[s].remote !== true) { placeGlass(Number(s), drinkById(d.drink)); glasses[s].remote = true }
        glasses[s].glass.setLevel(d.level)
      }
      remote = next
    },

    /** What a stool's terminal shows: up while someone sits or a drink is open there. */
    terminal(s, occupiedBy) {
      const mineHere = s === seat || s === openSeat()
      const r = remote[s]
      const g = state.glasses[s]
      const glass = mineHere && g ? { name: drinkById(g.drink).name, level: state.level(s) }
        : r ? { name: drinkById(r.drink).name, level: r.level } : null
      return { up: mineHere || !!r || !!occupiedBy, mine: mineHere, who: r?.who ?? occupiedBy, glass }
    },

    /** The tab: drinks and the cycles they were paid with. */
    get tab() { return state.tab },
    level(s) { return state.level(s) },
    DRINK_CYCLES,
    mine,
  }
}

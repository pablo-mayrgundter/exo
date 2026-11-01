// Life at the bar: the stools, the glasses on the counter, orders, and
// talking with Max. main.js keeps the camera and the input; this keeps who
// sits where and what's in front of them.
//
// A drink is a donation to Max's mind (the 'max' job on the vCPU), paid a
// sip at a time: click your glass and you raise it and drink a sixth of it,
// and what you drank goes on your tab, which your budget pays to that job
// until it's settled. Nothing is drunk, or donated, unless you drink. While you're seated with a drink
// he stays for longer spells of conversation; with an empty glass he offers
// another, and drifts back to his chores.
import * as THREE from 'three'
import { BarState, DRINKS, drinkById, drinkIn, makeGlass, DRINK_CYCLES } from './drinks.js'
import { SIP, GRIP } from '../avatar/avatar.js'
import { Bartender } from '../npc/bartender.js'
import { makeRezPad } from './rezpad.js'

/**
 * @param {{bar: object, avatar: object, mist: object, me: {name: string}, say: (t: string) => void,
 *   note: (t: string) => void, respond: (text: string) => string}} o
 */
export function makeBarLife({ bar, avatar, mist, me, say, note, respond }) {
  const state = new BarState(bar)
  const glasses = {} // seat → { glass, drink }
  let remote = {} // seat → { drink, level, who, owner, age }: other visitors' glasses, from presence
  // With others in the room: is this browser running Max (the host)? If
  // not, `maxState` is the host's snapshot to show, orders and words for
  // him go out through `net`, and drinks come back from the host.
  let host = true
  let maxState = null
  const net = { order() {}, heard() {}, poured() {}, cleared() {}, maxSay() {} }
  let pending = null // { seat, drink, at }: an order sent to the host, not yet poured
  const orderedBy = {} // seat → the presence id of a remote customer (on the host)
  const clearedRemote = {} // seat → when Max took a remote visitor's empty (ms)
  let seat = null
  let lastGiven = null // Max's donated half-cycles at the last tick seen
  let saveAt = 0, offered = false, greeted = false
  let sip = null // { start, seat, gulped }: a sip under way
  let paying = false // while the tab is owed, your budget goes to Max's mind
  const shown = {} // seat → the level drawn, easing toward the real one
  const pad = makeRezPad(bar)
  const bartender = new Bartender({
    avatar: bar.max, bar, state,
    // What he says while working, everyone in the room hears.
    say: (t) => { say(t); net.maxSay(t) },
    onPoured: (s, drink, glass) => {
      if (glass) {
        if (glasses[s] && glasses[s].glass !== glass) glasses[s].glass.dispose()
        glasses[s] = { glass, drink }
        shown[s] = state.level(s)
        glass.setLevel(shown[s])
      } else placeGlass(s, drink)
      if (s === seat) offered = false
      // Poured for someone in another browser: it's theirs to keep (their
      // state, their tab); here it's a remote glass, kept up by presence.
      const g = state.glasses[s]
      if (g && g.by !== me.name) {
        state.clear(s)
        state.tab.drinks = Math.max(0, state.tab.drinks - 1)
        glasses[s].remote = true
        remote[s] = { seat: s, drink: drink.id, level: 1, who: g.by, owner: orderedBy[s], keep: Date.now() + 3000 }
        net.poured(s, drink.id, orderedBy[s])
        delete orderedBy[s]
      }
    },
    // The glasses Max handles: rezzed in on the pad, taken off the counter
    // (and out of the bar's state) to be de-rezzed, set down to be poured.
    glassware: {
      pad,
      make: (drink) => makeGlass(drink),
      take(s) {
        const g = glasses[s]
        if (!g) return null
        if (g.remote) {
          // Someone else's empty: tell them it's gone, and don't let their
          // presence put it back before they've heard.
          clearedRemote[s] = Date.now()
          net.cleared(s, remote[s]?.owner)
          delete glasses[s]
          delete remote[s]
          return g.glass
        }
        if (sip?.seat === s) sip = null
        delete glasses[s]
        delete shown[s]
        state.clear(s)
        return g.glass
      },
      place(s, glass) {
        glass.group.position.copy(bar.glassAt(bar.seats[s]))
        glass.group.quaternion.identity()
      },
      /** Is there a glass at that stool, anyone's? */
      at: (s) => !!glasses[s],
      /** Stools with an empty that's stood `ms`: ours, and other visitors'. */
      empties(ms) {
        const out = state.empties(ms)
        for (const r of Object.values(remote)) if (r.level <= 0 && (r.age ?? 0) * 1000 >= ms && glasses[r.seat]) out.push(r.seat)
        return out
      },
    },
  })
  // Glasses left on the counter last visit.
  for (const [s, g] of Object.entries(state.glasses)) placeGlass(Number(s), drinkById(g.drink))

  function placeGlass(s, drink) {
    if (glasses[s]) glasses[s].glass.dispose()
    const glass = makeGlass(drink)
    glass.group.position.copy(bar.glassAt(bar.seats[s]))
    bar.group.add(glass.group)
    glasses[s] = { glass, drink }
    shown[s] = state.level(s)
    glass.setLevel(shown[s])
  }

  // Where the glass is while you sip: from the counter into your hand, up
  // to your mouth, tipped, and back down.
  const HAND = new THREE.Vector3(), Q = new THREE.Quaternion(), QA = new THREE.Quaternion(), TIP = new THREE.Quaternion()
  const X = new THREE.Vector3(1, 0, 0)
  function holdGlass(s, time) {
    const g = glasses[s]?.glass.group
    if (!g) return
    const home = bar.glassAt(bar.seats[s])
    const hold = sip && sip.seat === s && avatar.seated ? avatar.sipHold(time) : null
    if (!hold || hold.attach <= 0) { g.position.copy(home); g.quaternion.identity(); return }
    // The glass's middle in the hand: its base a little below the wrist.
    bar.group.worldToLocal(avatar.hand('R', HAND, GRIP))
    g.position.lerpVectors(home, HAND, hold.attach)
    // Tipped toward the mouth, in the avatar's frame, then into the bar's.
    avatar.group.getWorldQuaternion(QA)
    bar.group.getWorldQuaternion(Q).invert().multiply(QA).multiply(TIP.setFromAxisAngle(X, -hold.tilt))
    g.quaternion.identity().slerp(Q, hold.attach)
  }


  function mine(s) { return state.glasses[s]?.by === me.name && state.level(s) > 0 }

  /** The stool where your glass stands, full or empty, or null. */
  function myGlassSeat() {
    for (const [s, g] of Object.entries(state.glasses)) if (g.by === me.name) return Number(s)
    return null
  }

  /** The stool where you have an unfinished drink (your open tab), or null. */
  function openSeat() {
    for (const s of Object.keys(state.glasses)) if (mine(Number(s))) return Number(s)
    return null
  }

  /** Pays the tab from Max's donated cycles, giving to his mind while anything is owed. */
  function settle() {
    const j = mist.get('max')
    if (!j.tick) return // no tick from the worker yet
    if (lastGiven === null) lastGiven = j.given
    const delta = j.given - lastGiven
    lastGiven = j.given
    if (paying && delta > 0) state.pay(delta)
    if (state.tab.owed > 0 && !paying) { mist.give('max'); paying = true }
    if (state.tab.owed <= 0 && paying) { mist.take('max'); paying = false; state.save() }
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
        if (taken.has(s.index) || remote[s.index]?.level > 0) continue
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
      if (host) bartender.heard(i, performance.now() / 1000)
      else net.heard(i)
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
      if (sip) { const s = sip.seat; sip = null; holdGlass(s, 0) } // put it down
      seat = null
      avatar.stand()
    },

    /** Orders a drink to your stool. */
    order(id) {
      if (seat === null) return false
      const d = drinkById(id)
      if (mine(seat)) { say(`Finish that one first; it's still ${Math.round(state.level(seat) * 100)}% full.`); return false }
      if (!host) {
        if (pending?.seat === seat) { say('Coming, coming.'); return false }
        pending = { seat, drink: id, at: performance.now() / 1000 }
        net.order(seat, id, me.name)
      } else if (!bartender.order(seat, id, me.name)) { say('Coming, coming.'); return false }
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
      if (host) bartender.heard(seat, time)
      else net.heard(seat)
      const reply = respond(text)
      setTimeout(() => {
        if (!host || bartender.attending(seat)) say(reply)
        else say('Hang on, I\'m pouring.')
      }, 900 + Math.random() * 900)
      return true
    },

    /** True when Max isn't in a conversation, so he can think aloud. */
    get idle() { return !host || !bartender.talking },

    /**
     * @param {number} dt
     * @param {number} time seconds
     * @param {{seat: number, name: string}[]} others remote visitors on stools
     */
    update(dt, time, others) {
      const customers = others.map((o) => ({ seat: o.seat, name: o.name, drinking: (remote[o.seat]?.level ?? state.level(o.seat)) > 0 }))
      if (seat !== null) customers.push({ seat, name: me.name, drinking: state.level(seat) > 0 })
      if (host) bartender.update(dt, time, customers)
      else bartender.puppet(dt, time, maxState)
      pad.update(dt, time)
      // An order the host hasn't poured yet goes again now and then (the host
      // may have changed, or not heard).
      if (!host && pending && time - pending.at > 10) {
        if (seat !== pending.seat) pending = null
        else { pending.at = time; net.order(pending.seat, pending.drink, me.name) }
      }
      settle()
      // A sip: the gulp when the glass reaches your mouth, and the glass back
      // on the counter at the end.
      if (sip) {
        const t = time - sip.start
        if (!sip.gulped && t > SIP.drink) {
          sip.gulped = true
          if (state.gulp(sip.seat) && !offered) {
            offered = true
            say(`That's the bottom of the glass. Another ${drinkById(state.glasses[sip.seat].drink).name}?`)
          }
        }
        if (t > SIP.end || sip.seat !== seat) { const s = sip.seat; sip = null; holdGlass(s, time) }
        else holdGlass(sip.seat, time)
      }
      // Levels drain as you drink, rather than jump.
      const e = 1 - Math.exp(-dt * 2.5)
      for (const [s, g] of Object.entries(glasses)) {
        if (g.remote) continue
        shown[s] += (state.level(Number(s)) - shown[s]) * e
        g.glass.setLevel(shown[s])
      }
      if (time > saveAt) { saveAt = time + 5; state.save() }
    },

    /**
     * A sip, from a click on your glass: the avatar raises it and drinks a
     * sixth of it, and what it drank goes on the tab, paid from your budget
     * to Max's mind. Returns false if there's nothing of yours to drink.
     */
    sip(time) {
      if (seat === null || !mine(seat) || sip) return false
      if (mist.budget === 0) {
        mist.setBudget(0.25)
        note('A drink here is paid in compute: each sip goes on your tab, paid from your budget, now 25% of a core (change it in vCPU).')
      }
      sip = { start: time, seat, gulped: false }
      if (avatar.seated) avatar.seated.sip = { start: time, glass: glasses[seat].glass.group.getWorldPosition(new THREE.Vector3()) }
      return true
    },

    /** The glass in front of a stool, for clicking. */
    glassAt(s) { return glasses[s]?.glass.group ?? null },

    get sipping() { return !!sip },

    /**
     * Your glass, for presence: { seat, drink, level }, and how long it's
     * stood empty (`age`, seconds), so the host's Max clears it; or null.
     */
    openDrink() {
      const s = myGlassSeat()
      if (s === null) return null
      const g = state.glasses[s], level = +state.level(s).toFixed(3)
      return { seat: s, drink: g.drink, level, ...(level <= 0 ? { age: Math.round((Date.now() - (g.emptied ?? 0)) / 1000) } : {}) }
    },

    // --- Sharing Max with the room (main.js wires `net` to presence) ---

    /** The hooks out to the room: order, heard, poured, cleared, maxSay. */
    net,
    get host() { return host },
    /** Becomes the host (runs Max) or a guest (shows the host's Max). */
    setHost(h) {
      if (h === host) return
      host = h
      bartender.release()
      maxState = null
      if (host && pending) { bartender.order(pending.seat, pending.drink, me.name); pending = null }
    },
    /** The host's Max, to show (a guest's). */
    setMax(s) { maxState = s },
    /** The host's Max, to send (the host's). */
    maxSnapshot() { return bartender.snapshot() },
    /** On the host: an order from someone in another browser. */
    remoteOrder(s, drink, by, from) {
      if (!host || !drinkById(drink)) return
      if (bartender.order(s, drink, by)) orderedBy[s] = from
    },
    /** On the host: someone in another browser spoke to Max from a stool. */
    remoteHeard(s) { if (host) bartender.heard(s, performance.now() / 1000) },
    /** On a guest: the host's Max poured your drink. */
    poured(s, drink) {
      const d = drinkById(drink)
      if (!d || (pending && pending.seat !== s)) return
      pending = null
      state.glasses[s] = { drink: d.id, consumed: 0, by: me.name, poured: Date.now() }
      state.tab.drinks++
      state.save()
      placeGlass(s, d)
      if (s === seat) offered = false
    },
    /** On a guest: the host's Max took your empty away. */
    cleared(s) {
      if (state.glasses[s]?.by !== me.name || state.level(s) > 0) return
      if (sip?.seat === s) sip = null
      glasses[s]?.glass.dispose()
      delete glasses[s]
      delete shown[s]
      state.clear(s)
    },

    /** Other visitors' open drinks, from presence: [{ seat, drink, level, who }]. */
    setRemote(list) {
      const next = {}
      const now = Date.now()
      for (const d of list) {
        if (!d || !drinkById(d.drink) || state.glasses[d.seat]?.by === me.name) continue
        if (now - (clearedRemote[d.seat] ?? 0) < 10000) continue // Max just took it
        next[d.seat] = d
      }
      // A glass just poured for someone stays while their presence catches up.
      for (const [s, r] of Object.entries(remote)) if (!next[s] && r.keep > now) next[s] = r
      // Their glasses on the counter, kept in step with what they publish.
      for (const s of Object.keys(remote)) if (!next[s] && glasses[s] && !state.glasses[s]) { glasses[s].glass.dispose(); delete glasses[s] }
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
      return { up: mineHere || r?.level > 0 || !!occupiedBy, mine: mineHere, who: r?.who ?? occupiedBy, glass }
    },

    /** The tab: drinks, the cycles paid for them, and the half-cycles still owed. */
    get tab() { return state.tab },
    level(s) { return state.level(s) },
    DRINK_CYCLES,
    mine,
  }
}

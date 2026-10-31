// Max Pablo tending bar: a small state machine.
//
//   - With nobody at the bar he works through his chores, shuffling along
//     the lane behind the counter to a station (the taps, the sink, the
//     till, the shelf) and leaning in to it for a while.
//   - With customers he splits his time: a spell of talking with one (longer
//     if they have a drink in front of them), then a chore, then another.
//   - An order beats everything: he walks to a bottle of the right colour,
//     takes it down, carries it to the customer, pours, and puts it back.
//
// Positions are in bar space (body units, the bar's floor centre at the
// origin; the lane is behind the counter at z ≈ -5.3, facing +z).
import * as THREE from 'three'
import { drinkById } from '../world/drinks.js'

const WALK = 0.9 // body units per second: a shuffle
const TALK_Z = -4.8 // close enough to lean on the counter
const rnd = (a, b) => a + Math.random() * (b - a)

export class Bartender {
  /**
   * @param {{avatar: import('../avatar/avatar.js').Avatar, bar: object, state: import('../world/drinks.js').BarState,
   *   say: (text: string) => void, onPoured?: (seat: number, drink: object) => void}} o
   */
  constructor({ avatar, bar, state, say, onPoured }) {
    this.avatar = avatar
    this.bar = bar
    this.state = state
    this.say = say
    this.onPoured = onPoured ?? (() => {})
    this.orders = []
    this.task = null
    this.lastTalk = -1 // seat
    this.talking = null // { seat, until }
    this.heading = 0
    this.carry = null // the bottle mesh in his hand
    this.speed = 0
  }

  get pos() { return this.avatar.group.position }

  /** True if Max is (or will shortly be) talking with whoever sits at `seat`. */
  attending(seat) {
    return this.talking?.seat === seat || (this.task?.seat === seat && this.task.kind === 'walk-talk')
  }

  /** Someone at a seat said something: come over, unless busy pouring. */
  heard(seat, time) {
    if (this.task && ['fetch', 'carry', 'pour', 'return'].includes(this.task.phase)) return
    if (this.talking?.seat === seat) { this.talking.until = Math.max(this.talking.until, time + 20); return }
    this.startTalk(seat, time, 20)
  }

  order(seat, drink, by) {
    if (this.orders.some((o) => o.seat === seat)) return false
    this.orders.push({ seat, drink, by })
    return true
  }

  /**
   * @param {number} dt
   * @param {number} time seconds
   * @param {{seat: number, name: string, drinking: boolean}[]} customers who's sitting at the bar
   */
  update(dt, time, customers) {
    this.customers = customers
    // An order interrupts talk and chores (not another order being poured).
    if (this.orders.length && this.task && this.task.kind !== 'serve') {
      this.task.done = true
      this.talking = null
    }
    if (!this.task || this.task.done) this.decide(time)
    this.step(dt, time)
    this.avatar.group.rotation.y += wrap(this.heading - this.avatar.group.rotation.y) * (1 - Math.exp(-dt * 6))
    this.avatar.update(dt, { speed: this.speed, time })
  }

  decide(time) {
    this.avatar.lean = 0
    this.avatar.armPose.L = this.avatar.armPose.R = null
    if (this.talking && time < this.talking.until && this.customers.some((c) => c.seat === this.talking.seat)) {
      this.task = { kind: 'talk', seat: this.talking.seat }
      return
    }
    this.talking = null
    const order = this.orders.shift()
    if (order) { this.startServe(order); return }
    const cs = this.customers
    if (cs.length && this.lastWasChore !== false) {
      // A spell with someone: whoever spoke last if still here, else the next stool along.
      const next = cs.find((c) => c.seat !== this.lastTalk) ?? cs[0]
      this.startTalk(next.seat, time, next.drinking ? rnd(25, 40) : rnd(8, 14))
      this.lastWasChore = false
      return
    }
    this.lastWasChore = true
    const st = this.bar.stations[Math.floor(Math.random() * this.bar.stations.length)]
    this.task = { kind: 'chore', station: st, phase: 'walk', x: st.x, until: 0, dur: cs.length ? rnd(8, 14) : rnd(10, 20) }
  }

  startTalk(seat, time, seconds) {
    this.talking = { seat, until: time + seconds }
    this.lastTalk = seat
    this.task = { kind: 'talk', seat, phase: 'walk', x: this.bar.seats[seat].x }
  }

  startServe({ seat, drink, by }) {
    const d = drinkById(drink)
    const bottle = this.state.bottleFor(d, this.pos.x)
    if (bottle < 0) {
      this.say(`Out of ${d.name}, I'm afraid. I'll restock; ask me again in a minute.`)
      this.task = { kind: 'chore', station: this.bar.stations.find((s) => s.name === 'shelf'), phase: 'walk', x: 2.2, dur: 6 }
      return
    }
    this.task = { kind: 'serve', seat, drink: d, by, bottle, phase: 'fetch', x: this.bar.bottleInfo[bottle].pos.x, t: 0 }
  }

  /** Walks along the lane toward x (and z); true when there. */
  walkTo(dt, x, z = this.bar.lane.z) {
    const p = this.pos
    const dx = x - p.x, dz = z - p.z
    const d = Math.hypot(dx, dz)
    if (d < 0.05) { this.speed = 0; return true }
    const s = Math.min(d, WALK * dt)
    p.x += (dx / d) * s
    p.z += (dz / d) * s
    this.speed = WALK
    this.heading = Math.atan2(dx, dz)
    return false
  }

  step(dt, time) {
    const t = this.task
    const av = this.avatar
    if (!t) return
    if (t.kind === 'chore') {
      if (t.phase === 'walk') {
        if (this.walkTo(dt, t.x)) { t.phase = 'work'; t.until = time + t.dur }
        return
      }
      // Leaning in to the work, hands busy.
      this.heading = t.station.facing
      av.lean = t.station.lean
      const w = Math.sin(time * 3.1) * 0.12
      if (t.station.reach) {
        av.armPose.L = [0.2, 0.25 + w, 0.9]
        av.armPose.R = [-0.2, 0.3 - w, 0.9]
      } else {
        av.armPose.L = [0.15, -0.55 + w, 0.78]
        av.armPose.R = [-0.15, -0.55 - w, 0.78]
      }
      if (time > t.until) {
        if (t.station.name === 'shelf') this.state.restockOne()
        t.done = true
      }
      return
    }
    if (t.kind === 'talk') {
      if (t.phase === 'walk') {
        if (this.walkTo(dt, this.bar.seats[t.seat].x, TALK_Z)) t.phase = 'lean'
        return
      }
      // Leaning on the counter, facing the customer, arms on the bar.
      this.heading = 0
      av.lean = 0.28
      av.armPose.L = [0.12, -0.25, 0.96]
      av.armPose.R = [-0.12, -0.25, 0.96]
      if (!this.talking || time > this.talking.until || !this.customers.some((c) => c.seat === t.seat)) t.done = true
      return
    }
    if (t.kind === 'serve') this.serve(dt, time, t)
  }

  serve(dt, time, t) {
    const av = this.avatar
    const info = this.bar.bottleInfo[t.bottle]
    if (t.phase === 'fetch') {
      if (!this.walkTo(dt, info.pos.x)) return
      this.heading = Math.PI // facing the shelf
      av.armPose.R = [0.0, (info.pos.y - 1.4) * 1.2, 0.95]
      t.t += dt
      if (t.t > 1.2) {
        this.takeBottle(info)
        this.state.syncShelf(t.bottle)
        t.phase = 'carry'
        t.t = 0
      }
      return
    }
    if (t.phase === 'carry') {
      av.armPose.R = [-0.1, -0.5, 0.86]
      if (!this.walkTo(dt, this.bar.seats[t.seat].x, TALK_Z)) return
      t.phase = 'pour'
      return
    }
    if (t.phase === 'pour') {
      this.heading = 0
      av.lean = 0.3
      av.armPose.R = [-0.15, -0.2, 0.97]
      if (this.carry) this.carry.rotation.z = -Math.min(1.9, t.t * 2)
      t.t += dt
      if (t.t > 2.2) {
        this.state.pour(t.bottle, t.seat, t.drink, t.by)
        this.onPoured(t.seat, t.drink)
        this.say(pick([
          `One ${t.drink.name}, ${t.drink.note}.`,
          `${t.drink.name}. Paid in cycles; drink slowly or don't.`,
          `There you go: a ${t.drink.name}.`,
        ]))
        t.phase = 'return'
        t.t = 0
      }
      return
    }
    if (t.phase === 'return') {
      if (this.carry) this.carry.rotation.z = 0
      if (!this.walkTo(dt, info.pos.x)) return
      this.heading = Math.PI
      av.armPose.R = [0.0, (info.pos.y - 1.4) * 1.2, 0.95]
      t.t += dt
      if (t.t > 0.8) {
        this.dropBottle()
        this.state.syncShelf()
        // Then a word with the customer while they drink.
        this.talking = { seat: t.seat, until: time + rnd(20, 35) }
        this.lastTalk = t.seat
        this.task = { kind: 'talk', seat: t.seat, phase: 'walk' }
      }
    }
  }

  takeBottle(info) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.38, 10),
      new THREE.MeshBasicMaterial({ color: info.color, toneMapped: false }))
    b.position.set(-0.02, -0.3, 0.03) // in the hand, past the wrist
    this.avatar.parts.foreR.pivot.add(b)
    this.carry = b
  }

  dropBottle() {
    if (!this.carry) return
    this.carry.removeFromParent()
    this.carry.geometry.dispose()
    this.carry = null
  }
}

function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)) }
function pick(a) { return a[Math.floor(Math.random() * a.length)] }

// The Art Car: a low Tron rig with an arch of 32 LEDs, parked on the
// street outside Exo Cafe. Its light show is a program on its own nested
// 6502 (chip/lightshow.js), and it drives a loop at a speed set by how many
// frames that chip finishes a second: idle on the implicit baseline, alive
// when someone gives it cycles. Step aboard with E.
import * as THREE from 'three'
import { C } from '../theme.js'

const PALETTE = [C.orange, C.amber, C.yellow, C.green, C.cyan, C.lavender, C.magenta, 0xff3c8c].map((c) => new THREE.Color(c))
const SPARK = new THREE.Color(0xffffff)

export function makeArtCar() {
  const group = new THREE.Group()
  group.name = 'art-car'
  const body = new THREE.Group()
  group.add(body)
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o })

  // Deck and chassis.
  const deckGeo = new THREE.BoxGeometry(3.2, 0.35, 6)
  const deck = new THREE.Mesh(deckGeo, basic({ color: 0x0a1438 }))
  deck.position.y = 0.75
  const trim = new THREE.LineSegments(new THREE.EdgesGeometry(deckGeo), new THREE.LineBasicMaterial({ color: C.magenta, toneMapped: false }))
  trim.position.copy(deck.position)
  body.add(deck, trim)
  // Wheels: glowing rings.
  const wheels = []
  for (const [x, z] of [[-1.7, -2], [1.7, -2], [-1.7, 2], [1.7, 2]]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 8, 28), basic({ color: C.cyan }))
    w.rotation.y = Math.PI / 2
    w.position.set(x, 0.5, z)
    body.add(w)
    wheels.push(w)
  }
  // The LED arch over the deck.
  const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), basic({ color: 0xffffff }), 32)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 32; i++) {
    const a = Math.PI * (i + 0.5) / 32
    m.makeTranslation(Math.cos(a) * 1.5, 0.95 + Math.sin(a) * 2.4, 0)
    leds.setMatrixAt(i, m)
    leds.setColorAt(i, PALETTE[0])
  }
  body.add(leds)
  const arch2 = leds.clone()
  arch2.position.z = 1.8
  const arch3 = leds.clone()
  arch3.position.z = -1.8
  body.add(arch2, arch3)

  // The loop it drives, round the block south-east of the bar.
  const centre = new THREE.Vector3(26, 0, 36)
  const rx = 14, rz = 9
  let s = 0 // position along the loop, radians
  const shown = Array.from({ length: 32 }, () => new THREE.Color(PALETTE[0]))
  const target = Array.from({ length: 32 }, () => new THREE.Color(PALETTE[0]))
  let fps = 0, lastReceipt = 0, lastT = performance.now()
  const place = () => {
    group.position.set(centre.x + Math.cos(s) * rx, 0, centre.z + Math.sin(s) * rz)
    // Face along the direction of travel.
    group.rotation.y = Math.atan2(-Math.sin(s) * rx, Math.cos(s) * rz)
  }
  place()

  return {
    group,
    deckHeight: 0.93,
    /** Frames per second its chip is finishing, smoothed. */
    get fps() { return fps },
    /** @param {Uint8Array} view the LED bytes as the chip last wrote them */
    setLeds(view) {
      for (let i = 0; i < 32; i++) target[i].copy(view[i] >= 8 ? SPARK : PALETTE[view[i] & 7])
    },
    /**
     * A frame finished, at worker time `t` (ms). Timed by the worker's
     * clock: messages can reach a busy main thread in bursts.
     */
    frameDone(t) {
      if (lastReceipt) fps = fps * 0.7 + (1000 / Math.max(1, t - lastReceipt)) * 0.3
      lastReceipt = t
      lastT = performance.now()
    },
    update(dt) {
      // Motion limited by compute: metres per second from frames per second.
      if (performance.now() - lastT > 3000) fps *= Math.exp(-dt)
      const speed = Math.min(7, fps * 0.9)
      s += (speed * dt) / ((rx + rz) / 2)
      place()
      for (const w of wheels) w.rotation.x += (speed * dt) / 0.45
      const k = 1 - Math.exp(-dt * 10)
      for (let i = 0; i < 32; i++) {
        shown[i].lerp(target[i], k)
        leds.setColorAt(i, shown[i])
        arch2.setColorAt(i, shown[(i + 8) % 32])
        arch3.setColorAt(i, shown[(i + 24) % 32])
      }
      leds.instanceColor.needsUpdate = arch2.instanceColor.needsUpdate = arch3.instanceColor.needsUpdate = true
      const glow = 0.35 + Math.min(1, fps / 3) * 0.65
      leds.material.color.setScalar(glow)
    },
    /** World position of a point on the deck, for a rider. */
    deckPoint(out = new THREE.Vector3()) {
      return out.set(0, 0.93, 1.2).applyMatrix4(group.matrixWorld)
    },
  }
}

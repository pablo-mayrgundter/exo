// A test fixture, not shipped: a stand-in for the sky mode proposed to
// celestiary (layer.html?sky=1), to check exo's host side end to end. Serve
// it on a second loopback origin and point exo at it with ?sky_src=:
//
//   npx vite test/fixtures/sky-guest --host 127.0.0.1 --port 5481
//   http://localhost:4173/?enter&debug&sky_src=http://127.0.0.1:5481/
//
// It draws, in the equator of date (x to the equinox, z to the pole):
// seeded stars, a cyan ring 5° round the north celestial pole, a red
// celestial equator, and a yellow "moon" whose right ascension follows the
// view's time (a turn per 27.3 days), so the host's clock shows.
import * as THREE from 'three'
import { makeNetGLThreeOverlayGuest, parentTransport } from '@pablo-mayrgundter/portal-netgl/core'

const host = location.ancestorOrigins?.[0] ?? new URL(document.referrer).origin
if (!['localhost', '127.0.0.1'].includes(new URL(host).hostname)) throw new Error(`fixture: ${host} isn't loopback`)

const R = 1000
const at = (ra, dec) => new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).multiplyScalar(R)
const points = (vs, color, size) => new THREE.Points(new THREE.BufferGeometry().setFromPoints(vs),
  new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthWrite: false, transparent: true }))

const scene = new THREE.Scene()
let s = 42
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
const stars = []
for (let i = 0; i < 4000; i++) stars.push(new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(R))
scene.add(points(stars, 0xffffff, 2))
const ring = [], equator = []
for (let a = 0; a < Math.PI * 2; a += 0.02) { ring.push(at(a, (85 * Math.PI) / 180)); equator.push(at(a, 0)) }
scene.add(points(ring, 0x40f0ff, 3), points(equator, 0xff4040, 3))
const moon = points([new THREE.Vector3()], 0xffe060, 24)
scene.add(moon)

const guest = makeNetGLThreeOverlayGuest({
  WebGLRenderer: THREE.WebGLRenderer,
  scene,
  camera: new THREE.PerspectiveCamera(),
  transport: parentTransport({ hostOrigins: [host] }),
  onView: (view) => {
    const ra = ((view.timeMs / 86400000) / 27.32) * Math.PI * 2
    moon.geometry.setFromPoints([at(ra, 0.2)])
    window.lastView = view
  },
})
guest.start()

// The proposed hello (see the header of src/world/celestiary-sky.js), until acked.
let acked = false
guest.core.transport.onMessage((msg) => { if (msg?.type === 'layer:hello-ack') acked = true })
const hello = () => {
  if (acked) return
  guest.core.transport.post({ type: 'layer:hello', version: 1, adapter: 'sky-fixture', capabilities: { kinds: ['sky'], frames: ['equator-of-date'], time: true } })
  setTimeout(hello, 500)
}
hello()

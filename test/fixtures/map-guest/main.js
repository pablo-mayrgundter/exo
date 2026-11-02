// A test fixture, not shipped: a stand-in for netmap's map.html (NetMap as a
// NetGL guest), to check exo's gate end to end without building netmap.
// Serve it on a second loopback origin and point exo at it with ?netmap_src=:
//
//   npx vite test/fixtures/map-guest --host 127.0.0.1 --port 5482
//   http://localhost:4173/?enter&debug&netmap_src=http://127.0.0.1:5482/
//
// It speaks map.html's protocol (netmap web/src/mapView.js): a hello with
// kinds ['map'] and views ['globe-camera'], and for each globe camera a
// whole frame: a cyan wireframe globe, turned so the camera's (lon, lat) faces
// us, `fit` of the frame high, a red equator and a dot at each mark.
import * as THREE from 'three'
import { makeNetGLGuestContext, parentTransport } from '@pablo-mayrgundter/portal-netgl/core'

const host = location.ancestorOrigins?.[0] ?? new URL(document.referrer).origin
if (!['localhost', '127.0.0.1'].includes(new URL(host).hostname)) throw new Error(`fixture: ${host} isn't loopback`)

const core = makeNetGLGuestContext({ transport: parentTransport({ hostOrigins: [host] }), messageChannel: 'all' })
const renderer = new THREE.WebGLRenderer({ context: core.gl, canvas: core.shadow.canvas, alpha: true, antialias: false })
renderer.setPixelRatio(1)
renderer.setClearColor(0x000000, 0)

const dir = (lon, lat) => {
  const l = THREE.MathUtils.degToRad(lon), p = THREE.MathUtils.degToRad(lat)
  return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p))
}
const scene = new THREE.Scene()
const globe = new THREE.Group()
globe.matrixAutoUpdate = false
scene.add(globe)
// A dark ocean that hides the far side.
globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 48, 24), new THREE.MeshBasicMaterial({ color: 0x04060b })))
const lines = (pts, color) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }))
for (let lon = -180; lon < 180; lon += 30) {
  const pts = []
  for (let lat = -90; lat <= 90; lat += 5) pts.push(dir(lon, lat))
  globe.add(lines(pts, 0x40f0ff))
}
for (let lat = -60; lat <= 60; lat += 30) {
  const pts = []
  for (let lon = -180; lon <= 180; lon += 5) pts.push(dir(lon, lat))
  globe.add(lines(pts, lat ? 0x40f0ff : 0xff4040))
}
const marks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffe060, size: 12, sizeAttenuation: false }))
globe.add(marks)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)

core.transport.onMessage((msg) => {
  if (msg?.type === 'layer:hello-ack') acked = true
  if (msg?.type !== 'layer:view' || msg.view?.kind !== 'globe-camera') return
  const v = msg.view
  renderer.setSize(v.width, v.height, false)
  // Rows east, north, toward the camera: (lon, lat) faces us, north up.
  const f = dir(v.lon, v.lat)
  const e = new THREE.Vector3(-Math.sin(THREE.MathUtils.degToRad(v.lon)), Math.cos(THREE.MathUtils.degToRad(v.lon)), 0)
  const n = f.clone().cross(e).normalize()
  const s = v.fit ?? 0.9
  globe.matrix.makeBasis(e, n, f).transpose().premultiply(new THREE.Matrix4().makeScale(s, s, s))
  globe.matrixWorldNeedsUpdate = true
  marks.geometry.setFromPoints((v.marks ?? []).map((m) => dir(m.lon, m.lat).multiplyScalar(1.01)))
  renderer.render(scene, camera)
  core.endFrame({ viewId: msg.viewId })
})
core.announce({ position: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0] })

let acked = false
const hello = () => {
  if (acked) return
  core.transport.post({ type: 'layer:hello', version: 1, adapter: 'map-fixture', capabilities: { kinds: ['map'], frames: ['ecef'], views: ['globe-camera'], time: true }, units: { meters: 1 } })
  setTimeout(hello, 500)
}
hello()

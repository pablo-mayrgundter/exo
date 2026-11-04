// NetMap in place, under the chip: the map the die sits on, at true scale,
// out to the horizon and over it. The die is at 0° N 0° E (DIE_GEO), so
// round it is the Gulf of Guinea, the equator and the prime meridian
// running off to the horizon from under it, and over the horizon the
// network's links, arcing up from the continents.
//
// netmap's own map.html draws it, an in-place guest (inplace-guest.js) as
// the abode's sky is: each frame that draws the street sends exo's camera
// as a matrix view in ECEF (portal RFC 0001 §6), on the sphere netmap's
// hello declares, and the frame drawn for it replays into the frame the
// street is drawn into, under the street, over its void. netmap writes it
// in linear colour (map.html?output=linear), premultiplied.
//
// It starts the first time you're out on the street (start), so entering
// isn't slowed by it, and until its first frame the street is over the
// void as it was; then the map fades in. ?netmap_ground=0 (or ?netmap=0)
// leaves it out; ?netmap_src= picks netmap's page as for the gate's window.
import * as THREE from 'three'
import { makeInPlaceGuest, summary } from './inplace-guest.js'
import { resolveNetMapSrc } from './netmap-window.js'
import { SCENE_UNIT_M } from '../cosmic/units.js'

export const GROUND_TIMEOUTS = { load: 30_000, hello: 20_000, frame: 120_000 }
/** deck's sphere, when a hello doesn't say (netmap's mapView.js DECK_EARTH_RADIUS). */
const DEFAULT_RADIUS = 6370972

/** Whether netmap's hello offers what this draws: a map, matrix views in ECEF, linear colour. */
export function isGroundHello(hello) {
  const c = hello?.capabilities
  return Array.isArray(c?.kinds) && c.kinds.includes('map') && Array.isArray(c?.views) && c.views.includes('matrix') &&
    Array.isArray(c?.frames) && c.frames.includes('ecef') && hello?.contracts?.color === 'linear'
}

/**
 * The street's frame (µm; x east, y up, z south; its origin, the NMI pad,
 * at 0° N 0° E on the ground) to ECEF metres on a sphere of `radius`: east
 * is ECEF +y there, up +x, south −z (cosmic/units.js sceneToEcef, on the
 * map's sphere rather than WGS84's).
 */
export function worldToEcef(radius = DEFAULT_RADIUS, m = SCENE_UNIT_M) {
  return new THREE.Matrix4().set(
    0, m, 0, radius,
    m, 0, 0, 0,
    0, 0, -m, 0,
    0, 0, 0, 1)
}

/**
 * A camera's view from ECEF metres (rigid, column-major): where it is in
 * the street, at true scale on the map's sphere, in float64.
 * @param {THREE.Matrix4} matrixWorld the camera's, in the street's units
 */
export function groundViewMatrix(matrixWorld, radius = DEFAULT_RADIUS) {
  const m = worldToEcef(radius).multiply(matrixWorld)
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  m.decompose(p, q, s)
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert().toArray()
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Color} o.background the street's void: what the map goes over
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeNetMapGround({ renderer, background, search = globalThis.location?.search ?? '' }) {
  const params = new URLSearchParams(search)
  const { src, origin, rejected } = resolveNetMapSrc({ param: params.get('netmap_src'), pageOrigin: globalThis.location?.origin, dev: !!import.meta.env?.DEV })
  if (rejected) console.warn(`[ground] ignoring netmap_src=${rejected}`)
  const url = new URL(src)
  url.searchParams.set('output', 'linear')
  const guest = makeInPlaceGuest({
    renderer, name: 'ground', title: 'NetMap renderer (draws the map under the chip)',
    src: url.href, origin, timeouts: GROUND_TIMEOUTS,
    // Over the street's void: netmap's frame is premultiplied, transparent over the horizon.
    screen: { clear: 'none', blend: 'premultiplied-over' },
    accepts: (hello) => (isGroundHello(hello) ? null : `has no map to draw in place (views ${JSON.stringify(hello.capabilities?.views ?? [])}, color ${hello.contracts?.color ?? '?'})`),
  })
  if (params.get('netmap_ground') === '0' || params.get('netmap') === '0') guest.fail('left out (?netmap_ground=0)')

  let camera = null // the last camera that drew the street
  const radius = () => guest.stats.hello?.earth?.radius ?? DEFAULT_RADIUS
  const body = () => ({
    kind: 'matrix', frame: 'ecef',
    viewMatrix: groundViewMatrix(camera.matrixWorld, radius()),
    projectionMatrix: camera.projectionMatrix.toArray(),
    timeMs: Date.now(),
  })

  return {
    stats: guest.stats,
    /** Start loading netmap (the first time you're out on the street). */
    start() { if (!guest.started && !guest.failed) guest.start() },
    /** The camera drawing the street this frame: its matrices, copied. */
    seen(cam) { camera = { matrixWorld: cam.matrixWorld.clone(), projectionMatrix: cam.projectionMatrix.clone() } },
    /** Each frame: until the first frame, a view at a time for the last camera. */
    update() {
      if (guest.started && !guest.failed && !guest.on && !guest.inFlight && camera && !document.hidden) guest.view(body())
    },
    /** Whether this frame should wait for the map drawn for its camera: it's on, and the street is drawn (`drawn`). */
    syncing(drawn = true) { return guest.on && drawn && !document.hidden },
    /** Ask for the map for this frame's camera (matrixWorld and projection, in the street's units). Returns its id. */
    request(matrixWorld, projectionMatrix) {
      camera = { matrixWorld: matrixWorld.clone(), projectionMatrix: projectionMatrix.clone() }
      return guest.view(body())
    },
    ready: guest.ready,
    /** Replay the map into the target the street is drawn into, over the void (inplace-guest.js). */
    drawInto: (target) => guest.drawInto(target, background),
    get on() { return guest.on },
    get pending() { return guest.pending },
    get shownAt() { return guest.shownAt },
    perf: () => ({ stats: { ...guest.stats, hello: guest.stats.hello?.adapter }, drainCpuMs: summary(guest.perf.drains), latencyMs: summary(guest.perf.latency) }),
    dispose: guest.dispose,
  }
}

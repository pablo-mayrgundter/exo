// NetMap in place, under the chip: the map the die sits on, at true scale,
// out to the horizon and over it. The die is at 0° N 0° E (DIE_GEO), so
// round it is the Gulf of Guinea, the equator and the prime meridian
// running off to the horizon from under it, and over the horizon the
// network's links, arcing up from the continents.
//
// netmap's own map.html draws it (netmap.js), an in-place guest
// (inplace-guest.js) as the abode's sky is: each frame that draws the street sends exo's camera
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
import { SCENE_UNIT_M } from '../cosmic/units.js'

export const GROUND_TIMEOUTS = { load: 30_000, hello: 20_000, frame: 120_000 }
/** deck's sphere, when a hello doesn't say (netmap's mapView.js DECK_EARTH_RADIUS). */
export const DEFAULT_RADIUS = 6370972

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

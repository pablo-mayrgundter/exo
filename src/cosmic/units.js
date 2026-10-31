// Real units. Every place declares how its numbers map to metres, so
// scenes can be linked with predictable projections (portal RFC 0001 §6.1:
// metres on both sides, or a declared scale).
//
// The street scene's unit is the micrometre: the 6502 is drawn at its
// true size, and the visitors and the bar are sized to it. A global scale
// like this keeps the numbers near 1 for float32 (the die is ~4,300 units,
// a visitor ~8); Earth-sized frames are reached by composing frames in
// doubles, never by putting metres-from-Earth's-centre into a vertex.

/** Metres per scene unit in the street (the chip, the bar). */
export const SCENE_UNIT_M = 1e-6

/**
 * Micrometres per visual6502 layout unit. The 6502 (rev D) die is about
 * 3.9 × 4.3 mm; the layout spans 8,769 × 9,628 units, so ~0.447 µm each.
 * Its smallest features, at the NMOS process's 8 µm design rule, are ~18
 * layout units.
 */
export const CHIP_UNIT_UM = 4300 / 9628

/** Body units (the bar, avatars) per layout unit: what the bar was built at. */
export const BODY_PER_LAYOUT = 0.1

/** Micrometres per body unit (≈4.47): a 1.84-unit visitor is ~8 µm tall. */
export const BODY_UM = CHIP_UNIT_UM / BODY_PER_LAYOUT

/** Where the die sits on Earth: 0° N, 0° E, sea level ("0,0,0"; Null Island). */
export const DIE_GEO = { lat: 0, lon: 0, alt: 0 }

const WGS84_A = 6378137

/**
 * A point in the street scene (µm; x east, y up, z south, origin at the
 * NMI pad) to ECEF metres. At 0° N 0° E east is ECEF +y, north +z and up
 * +x. (A sphere of WGS84's equatorial radius suffices at the equator.)
 */
export function sceneToEcef([x, y, z]) {
  const m = SCENE_UNIT_M
  return [WGS84_A + DIE_GEO.alt + y * m, x * m, -z * m]
}

/** A length in scene units, as a readable string in real units. */
export function formatLength(units) {
  const m = units * SCENE_UNIT_M
  const a = Math.abs(m)
  if (a >= 1e-3) return `${(m * 1e3).toFixed(a >= 1e-2 ? 1 : 2)} mm`
  if (a >= 1e-6) return `${(m * 1e6).toFixed(a >= 1e-5 ? 0 : 1)} µm`
  return `${(m * 1e9).toFixed(0)} nm`
}

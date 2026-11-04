// The 6502's layers in depth: how thick each is and how high it stands
// over the silicon, so the street is a city in three dimensions, not a
// map. The die was made on MOS's "019" process (N-channel, silicon gate,
// depletion load): diffusion in the silicon, polysilicon over a field of
// thick oxide, aluminium over a layer of glass, and glass over everything.
// What each was in the 6502 isn't published that we found; these are the
// typical thicknesses of an 8 µm silicon-gate NMOS process of its time:
//
//   aluminium (metal)     1.0 µm, on the glass over the poly      2.0 – 3.0
//   glass (PSG)           0.8 µm, between poly and metal           (clear)
//   polysilicon           0.5 µm, on the field oxide               1.0 – 1.5
//   field oxide           1.0 µm, round the diffusion              (clear)
//   diffusion             in the silicon, ~1 µm deep, its face at  0
//
// The oxides and glass are drawn as nothing: you see through them, and walk
// in them as in air. The poly dips to 0.1 µm over a transistor's gate, and
// the metal follows the steps under it; both are drawn flat here.
//
// Heights are body units from the street, the top of the metal (where the
// bar stands, on the NMI pad), so the silicon is 3 µm (0.67 body units,
// a third of a visitor's height) below it.
import { BODY_UM } from '../cosmic/units.js'

/** µm over the silicon's face: [bottom, top] per visual6502 layer (0 metal, 1–4 diffusion, 5 poly). */
export const STACK_UM = [
  [2.0, 3.0], // metal
  [-0.15, 0], [-0.15, 0], [-0.15, 0], [-0.15, 0], // diffusion: switched, input diode, grounded, powered
  [1.0, 1.5], // polysilicon
]
/** The top of the metal, µm over the silicon. */
const METAL_TOP_UM = STACK_UM[0][1]
/** The street's height, body units: the metal's top, just under the bar's floor (bar.js BAR.floor, 0.08). */
export const STREET_Y = 0.07

/** A height µm over the silicon, as body units in the street. */
export const yOf = (um) => STREET_Y + (um - METAL_TOP_UM) / BODY_UM

/** The silicon's face, body units. */
export const SILICON_Y = yOf(0)

/** A layer's [bottom, top], body units. */
export const layerY = (layer) => STACK_UM[layer].map(yOf)

// Phones and tablets. A touch screen has no E, Enter, V or J key, so on a
// coarse pointer the HUD grows buttons: one for whatever E would do, one to
// chat, and the jukebox's controls beside the cabinet. The pure parts live
// here, for tests; main.js wires them to the DOM.

/**
 * Whether to show the touch HUD: `?touch` (or `?touch=1`) forces it on,
 * `?touch=0` off; otherwise a coarse primary pointer (a phone or tablet,
 * not a laptop that happens to have a touch screen).
 * @param {URLSearchParams} params
 * @param {(q: string) => {matches: boolean}} [mq] matchMedia
 */
export function touchMode(params, mq = globalThis.matchMedia?.bind(globalThis)) {
  if (params.has('touch')) return params.get('touch') !== '0'
  return !!mq?.('(pointer: coarse)').matches
}

/**
 * The renderer's pixel ratio. Desktops keep up to 2; touch devices stop at
 * 1.5, since a phone's 3× screen would otherwise mean four times the pixels
 * through the bloom for little you can see at arm's length. `?dpr=` wins.
 */
export function pixelRatio(dpr, touch, override = null) {
  const o = Number(override)
  if (override !== null && override !== '' && o > 0) return Math.min(o, 4)
  return Math.min(dpr || 1, touch ? 1.5 : 2)
}

/**
 * What the HUD says about the nearest thing to do.
 * @param {{action?: string | null, tip?: string | null}} what
 *   action: what E (or the touch button) does, like "sit"; tip: a hint
 *   beside it, like "Click the glass to drink".
 * @param {boolean} touch
 * @returns {{text: string | null, button: string | null}} text: the prompt
 *   line (on desktop "tip · E · action", as before); button: the touch
 *   button's label, or null for none.
 */
export function promptFor({ action = null, tip = null }, touch) {
  if (!touch) {
    const text = [tip, action && `E · ${action}`].filter(Boolean).join(' · ')
    return { text: text || null, button: null }
  }
  return { text: tip ? tip.replace(/^Click\b/, 'Tap') : null, button: action ? action[0].toUpperCase() + action.slice(1) : null }
}

/**
 * Places a box of `size` (px) centred above a projected point, kept inside
 * `bounds`. `ndc` is the point after `Vector3.project(camera)`.
 * @param {{x: number, y: number, z: number}} ndc
 * @param {{w: number, h: number}} view the viewport, px
 * @param {{w: number, h: number}} size the box, px
 * @param {{top: number, right: number, bottom: number, left: number}} bounds
 *   margins to keep clear (the top bar, the panel, safe areas), px
 * @returns {{x: number, y: number, visible: boolean}} the box's top-left corner;
 *   not visible when the point is behind the camera or off screen.
 */
export function placeAbove(ndc, view, size, bounds = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const visible = ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1
  const px = (ndc.x + 1) / 2 * view.w, py = (1 - ndc.y) / 2 * view.h
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const x = clamp(px - size.w / 2, bounds.left, Math.max(bounds.left, view.w - bounds.right - size.w))
  const y = clamp(py - size.h - 8, bounds.top, Math.max(bounds.top, view.h - bounds.bottom - size.h))
  return { x: Math.round(x), y: Math.round(y), visible }
}

/**
 * The camera's vertical field of view, degrees. 60° on anything wider than
 * about 4:5, as before; on a phone held upright that leaves ~30° across,
 * too little to see your glass and the terminal from a stool, so a narrow
 * screen widens it until there are 50° across.
 */
export function fovFor(aspect, base = 60, minAcross = 50) {
  const across = (2 * Math.atan(Math.tan((base * Math.PI) / 360) * aspect) * 180) / Math.PI
  if (across >= minAcross) return base
  return (2 * Math.atan(Math.tan((minAcross * Math.PI) / 360) / aspect) * 180) / Math.PI
}

/** The status line for the jukebox's play button and its neighbours. */
export function jukeboxLabels({ playing, muted }) {
  return { play: playing ? 'Pause' : 'Play', mute: muted ? 'Unmute' : 'Mute' }
}

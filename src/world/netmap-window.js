// NetMap's window in the street's gate: a framed globe, the second of the
// two views of netmap's one guest (netmap.js; the first is the map under
// the chip, netmap-ground.js). Its frames are the guest's `window` part,
// replayed into a render target that the gate's screen shows, at its own
// pace. This is the view itself and its pace, pure:
//
//   layer:view {viewId, part: 'window', view: {kind: 'globe-camera', lon,
//     lat, fit, bearing, pitch, width, height, timeMs, marks}}
//                                          ──►  deck draws that camera, full frame
//   replayed into the window's target      ◄──  … frame-end {viewId, part: 'window'}
//
// The camera sweeps slowly to and fro over 0° N 0° E, where exo's die sits
// (cosmic/units.js DIE_GEO), and the guest marks that spot. A new view goes
// out when the last one's frame has come and the gate was drawn in our last
// frame, at most every MAP_FRAME_MS; the screen keeps the last frame.
//
// The guest's frame is drawn by our GPU, inside one of our frames: NetMap's
// globe is ~100k links and nodes, cheap on a desktop GPU but many seconds
// under SwiftShader. So the pace adapts: now and then (COST_SAMPLES) a
// replay is timed to the GPU's finish, with a 1-pixel read before and after
// it, and views go out no faster than keeps the window's share of the time
// near MAP_GPU_SHARE (paceMs, below). Timing whole frames instead doesn't
// work: the GPU's work lands in whichever later frame waits on it.
//
// If the guest can't come, the gate stays as it was: a ring and a link (E
// still jacks in). ?netmap_src= may name another pablo-mayrgundter.github.io
// page (netmap's PR previews) from any page, or a loopback guest from a page
// served from loopback (guest-src.js). ?netmap=0 keeps the plain gate.
import { DIE_GEO } from '../cosmic/units.js'
import { resolveGuestSrc } from './guest-src.js'

export const NETMAP_MAP_SRC = 'https://pablo-mayrgundter.github.io/netmap/map.html'
/** Origins the guest may come from in any build. */
export const NETMAP_ORIGINS = ['https://pablo-mayrgundter.github.io']
/** The window's size, pixels a side. */
export const MAP_SIZE = 512
/** How much of the frame's height the globe's disc spans. */
export const MAP_FIT = 0.9
/** ms: the page to load, then to say hello, then to draw the first frame. */
export const MAP_TIMEOUTS = { load: 30_000, hello: 20_000, frame: 60_000 }
/** The fastest a new view goes out, wall ms. */
export const MAP_FRAME_MS = 100
/** The share of our frame time the guest's frames may take. */
export const MAP_GPU_SHARE = 0.1
/** Which replays are timed: the 3rd and 6th (after the first ones compile the guest's shaders and upload its data), then every 30th. */
export const COST_SAMPLES = (drains) => drains === 3 || drains === 6 || drains % 30 === 0
/**
 * A view unanswered this long is sent again, ms. Long: the guest keeps a
 * view that comes before it's ready, and on a slow GPU each view it gets is
 * a frame to draw and replay.
 */
export const RESEND_MS = 30_000
/** Where the die sits, marked on the globe in the bar's yellow. */
export const DIE_MARK = { lon: DIE_GEO.lon, lat: DIE_GEO.lat, rgb: [245, 200, 66] }

/**
 * The guest page to load. `?netmap_src=` counts for a pablo-mayrgundter.github.io
 * page from any page (a PR preview), and for a loopback guest on a loopback page.
 * @returns {{src: string, origin: string, rejected: string|null}}
 */
export function resolveNetMapSrc({ param = null, pageOrigin, dev = false }) {
  return resolveGuestSrc({ src: NETMAP_MAP_SRC, origins: NETMAP_ORIGINS, param, pageOrigin, dev })
}

/** Whether a guest's `layer:hello` offers the map view this host asks for. */
export function isMapHello(hello) {
  const c = hello?.capabilities
  return Array.isArray(c?.kinds) && c.kinds.includes('map') && Array.isArray(c?.views) && c.views.includes('globe-camera')
}

/**
 * The gate's camera at wall time `t` (seconds): a slow sweep to and fro,
 * 35° either side of the die's meridian over two minutes, and a gentle nod
 * across the equator, looking straight down.
 */
export function gateCamera(t) {
  const tau = 2 * Math.PI
  return {
    lon: DIE_GEO.lon + 35 * Math.sin((tau * t) / 120),
    lat: DIE_GEO.lat + 4 + 10 * Math.sin((tau * t) / 170),
    bearing: 0,
    pitch: 0,
  }
}

/** The `layer:view` body for wall time `t` (s) and Unix ms `timeMs`. */
export function mapView(t, timeMs, size = MAP_SIZE) {
  return { kind: 'globe-camera', ...gateCamera(t), fit: MAP_FIT, width: size, height: size, pixelRatio: 1, timeMs, marks: [DIE_MARK] }
}

/**
 * Wall ms between views, when a guest frame costs `costMs` of our frame
 * time: at least MAP_FRAME_MS, and slow enough that the guest's frames take
 * about `share` of the time.
 */
export function paceMs(costMs, share = MAP_GPU_SHARE) {
  return Math.max(MAP_FRAME_MS, Number.isFinite(costMs) && costMs > 0 ? costMs / share : 0)
}

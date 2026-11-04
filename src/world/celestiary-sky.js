// The abode's sky is celestiary's, through NetGL (portal-netgl), drawn in
// place: celestiary's own frame in exo's.
//
// celestiary itself runs in a hidden cross-origin iframe (celestiary.org's
// sky.html: the whole app less its chrome, landed on Earth), and its WebGL
// calls replay into our context. Each exo frame sends the camera it draws
// the abode with (its own inside the abode, the doorway's virtual camera
// from the bar), as a rotation in Earth's equator of date with its field,
// the clock and the place, and waits for the sky drawn for that camera (at
// most SKY_HOLD_MS; then it draws with the last). The frame then replays
// straight into the framebuffer the abode is being drawn into, and the
// abode goes over it (drawInto): celestiary's own final pass, its air, its
// tone map and its eye, lands in exo's frame. celestiary writes it in
// linear colour for us (sky.html?output=linear), so exo's output pass gives
// its display values back.
//
//   exo (host)                               celestiary (guest)
//   netgl:ready-ack                     ◄──  netgl:ready
//   layer:hello-ack {accepted}          ◄──  layer:hello {kinds, contracts.color}
//   layer:view {camera, timeMs, site}   ──►  draws the sky there
//   drain into the abode's target       ◄──  netgl:batch … frame-end {viewId}
//
// Frame and clock: the views are in the equator of date (x to the
// equinox, z to the north pole), with no translation, at the abode's time
// as Unix ms, seen from the abode's site.
//
// A guest whose hello doesn't offer the 'sky' kind in 'equator-of-date', in
// linear colour, is let go, and exo's procedural dusk stays. So does a guest
// that doesn't load or answer in time, or a missing WebGL2. Each logs one
// line. The guest's page and origin are fixed here. ?sky_src= may name
// another celestiary.org page (its PR previews) from any page, or a
// loopback guest from a page served from loopback (guest-src.js). ?sky=0
// keeps the procedural sky without asking; ?sky_scale= sets the sky's
// pixels per CSS pixel (default 1), ?sky_meter=0 asks celestiary for its
// cheaper exposure (no metering).
import * as THREE from 'three'
import { isLocalOrigin, resolveGuestSrc } from './guest-src.js'
import { makeInPlaceGuest, summary } from './inplace-guest.js'

export const SKY_SRC = 'https://celestiary.org/sky.html'
/** Origins the guest may come from in any build. */
export const SKY_ORIGINS = ['https://celestiary.org']
/** ms: the page to load, then to say hello, then to draw a first frame (the whole app boots). */
export const SKY_TIMEOUTS = { load: 30_000, hello: 30_000, sky: 90_000 }
/** The sky's pixels per CSS pixel, by default; and the largest side, px. */
export const SKY_SCALE = 1
/** The longest exo holds a frame for the sky's, ms; then it draws with the last one. */
export const SKY_HOLD_MS = 250
const NEAR = 1, FAR = 1e8

export { isLocalOrigin }

/**
 * The guest page to load. `?sky_src=` counts for a celestiary.org page from
 * any page (a PR preview), and for a loopback guest on a loopback page.
 * @returns {{src: string, origin: string, rejected: string|null}}
 */
export function resolveSkySrc({ param = null, pageOrigin, dev = false }) {
  return resolveGuestSrc({ src: SKY_SRC, origins: SKY_ORIGINS, param, pageOrigin, dev })
}

/** Whether a guest's `layer:hello` offers the sky this host asks for: in the equator of date, in linear colour. */
export function isSkyHello(hello) {
  const c = hello?.capabilities
  return Array.isArray(c?.kinds) && c.kinds.includes('sky') && Array.isArray(c?.frames) && c.frames.includes('equator-of-date') &&
    hello?.contracts?.color === 'linear'
}

/** Greenwich mean sidereal time, radians, at Unix ms (IAU 1982, to well under a degree). */
export function gmstRad(timeMs) {
  const d = timeMs / 86400000 + 2440587.5 - 2451545.0
  const deg = 280.46061837 + 360.98564736629 * d
  return ((deg % 360) + 360) % 360 * Math.PI / 180
}

/**
 * The Sun's altitude at a site, degrees, from the low-precision almanac
 * formula (to about 0.01°): how much daylight the guest's sky has.
 */
export function sunAltitude(timeMs, { lat, lon }) {
  const D = Math.PI / 180
  const n = timeMs / 86400000 + 2440587.5 - 2451545.0
  const g = (357.528 + 0.9856003 * n) * D
  const lambda = (280.460 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D
  const eps = (23.439 - 4e-7 * n) * D
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const h = gmstRad(timeMs) + lon * D - ra
  const phi = lat * D
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / D
}

/**
 * The rotation from the equator of date to abode space (x east, y up, z
 * south) for a site at `lat`, `lon` degrees, at Unix ms: world = M · eq.
 */
export function eqToWorld(timeMs, { lat, lon }, out = new THREE.Matrix3()) {
  const phi = lat * Math.PI / 180
  const th = gmstRad(timeMs) + lon * Math.PI / 180 // local sidereal time
  const s = Math.sin(th), c = Math.cos(th), sp = Math.sin(phi), cp = Math.cos(phi)
  // Rows: east, up, and south (−north), as seen in the equator of date.
  return out.set(
    -s, c, 0,
    cp * c, cp * s, sp,
    sp * c, sp * s, -cp)
}

/**
 * A camera's view from the equator of date (column-major): its rotation
 * in abode space, after the sky's turn at the time. No translation: the
 * sky is at infinity.
 * @param {THREE.Matrix4} matrixWorld the camera's, as it draws the abode
 *   (a portal's virtual camera has only this: its position and rotation
 *   are never set, so updateMatrixWorld would lose it; its link's scale is
 *   taken out)
 * @param {THREE.Matrix3} worldFromEq eqToWorld's
 */
export function skyViewMatrix(matrixWorld, worldFromEq) {
  const eyeFromWorld = new THREE.Matrix4().extractRotation(matrixWorld).transpose()
  const m = new THREE.Matrix4().setFromMatrix3(worldFromEq)
  return eyeFromWorld.multiply(m).toArray()
}

/**
 * The guest's perspective (column-major): the camera's field, read off its
 * projection matrix (x and y scales; a portal's oblique near plane changes
 * only the depth row), with the sky's own near and far.
 * @param {THREE.Matrix4} projectionMatrix the camera's
 */
export function skyProjection(projectionMatrix) {
  const e = projectionMatrix.elements
  return [e[0], 0, 0, 0, 0, e[5], 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0]
}

/**
 * The celestiary sky for the abode, an in-place guest (inplace-guest.js).
 * Starts when the abode is first drawn (`seen(camera)`): on demand, so
 * entering exo isn't slowed by it. Until its first frame the abode's sky is
 * black (`pending`), and then fades in from black (`shownAt`); on any
 * failure it stands down to the procedural sky.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {{lat: number, lon: number}} o.site
 * @param {number} [o.epochMs] Unix ms at abode time 0
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeCelestiarySky({ renderer, site, epochMs = Date.now(), search = globalThis.location?.search ?? '' }) {
  const params = new URLSearchParams(search)
  const perfOn = params.get('sky_perf')
  const off = params.get('sky') === '0'
  const { src, origin, rejected } = resolveSkySrc({ param: params.get('sky_src'), pageOrigin: globalThis.location?.origin, dev: !!import.meta.env?.DEV })
  const url = new URL(src)
  url.searchParams.set('output', 'linear')
  if (params.get('sky_meter') === '0') url.searchParams.set('meter', '0')
  if (perfOn) url.searchParams.set('perf', perfOn === 'sync' ? 'sync' : '1')
  // The guest draws at a pixel per CSS pixel, as celestiary's own page does; 2 is a retina screen's own.
  const scale = Math.min(2, Math.max(0.25, Number(params.get('sky_scale')) || SKY_SCALE))
  // What the sky costs here and there (?sky_perf=1).
  const perf = { long: [], gpu: [], guestStats: [], since: performance.now() }
  const keep = (a, v, n = 300) => { a.push(v); if (a.length > n) a.shift() }
  let perfAsk = 0
  const perfWaiting = new Map()

  const guest = makeInPlaceGuest({
    renderer, name: 'sky', title: 'celestiary sky renderer (draws into the abode)',
    src: url.href, origin, scale,
    timeouts: { load: SKY_TIMEOUTS.load, hello: SKY_TIMEOUTS.hello, frame: SKY_TIMEOUTS.sky },
    accepts: (hello) => (isSkyHello(hello) ? null : `has no sky to draw in place (kinds ${JSON.stringify(hello.capabilities?.kinds ?? [])}, frames ${JSON.stringify(hello.capabilities?.frames ?? [])}, color ${hello.contracts?.color ?? '?'})`),
    onControl: (msg, g) => {
      if (msg?.type === 'layer:hello' && perfOn && isSkyHello(msg)) g.post({ type: 'layer:stats-subscribe', intervalMs: 1000 })
      else if (msg?.type === 'layer:stats') { const { type, ...rest } = msg; keep(perf.guestStats, rest, 60) }
      else if (msg?.type === 'sky:perf') { perfWaiting.get(msg.id)?.(msg.snapshot ?? null); perfWaiting.delete(msg.id) }
    },
  })
  const stats = guest.stats
  if (rejected) console.warn(`[sky] ignoring sky_src=${rejected}: not celestiary.org (a loopback guest needs a loopback page)`)
  if (off) guest.fail('?sky=0')

  // The last camera that drew the abode, as it was then.
  let camera = null
  const worldFromEq = new THREE.Matrix3()

  function body(timeMs) {
    stats.lastTimeMs = timeMs
    return {
      frame: 'equator-of-date',
      viewMatrix: skyViewMatrix(camera.matrixWorld, worldFromEq),
      projectionMatrix: skyProjection(camera.projectionMatrix),
      timeMs,
      observer: { lat: site.lat, lon: site.lon, alt: 0 },
    }
  }

  let daylight = 0, lastUpdate = 0
  function update(abodeTime) {
    const timeMs = epochMs + abodeTime * 1000
    daylight = THREE.MathUtils.smoothstep(sunAltitude(timeMs, site), -6, 6)
    eqToWorld(timeMs, site, worldFromEq)
    const now = performance.now()
    if (perfOn && lastUpdate && now - lastUpdate > 100) {
      keep(perf.long, { at: Math.round(now - perf.since), ms: Math.round(now - lastUpdate), sunAlt: Math.round(sunAltitude(timeMs, site) * 10) / 10 }, 100)
    }
    lastUpdate = now
    if (guest.failed) return
    if (!guest.started) { if (camera) guest.start(); return }
    // Once the sky is in, the frame loop asks (request) for each frame's
    // camera; until then, this does, one view at a time.
    if (!guest.on && !guest.inFlight && camera && !document.hidden) guest.view(body(timeMs))
  }

  function drawInto(target) {
    const t0 = performance.now()
    const drew = guest.drawInto(target)
    if (drew && perfOn) {
      // The replay's GPU work too: a 1-pixel read waits for it (perf only: it stalls).
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, new (target.texture.type === THREE.HalfFloatType ? Uint16Array : Uint8Array)(4))
      keep(perf.gpu, Math.round((performance.now() - t0) * 10) / 10)
    }
    return drew
  }

  // The guest's perf snapshot (?sky_perf=1), asked for and awaited.
  function guestPerf(timeoutMs = 4000) {
    if (!guest.on) return Promise.resolve(null)
    const id = ++perfAsk
    return new Promise((resolve) => {
      perfWaiting.set(id, resolve)
      guest.post({ type: 'sky:perf-request', id })
      setTimeout(() => { if (perfWaiting.delete(id)) resolve(null) }, timeoutMs)
    })
  }

  return {
    stats,
    /** Call when the abode is drawn, with the camera drawing it: the guest starts on the first. */
    seen(cam) { if (cam) camera = { matrixWorld: cam.matrixWorld.clone(), projectionMatrix: cam.projectionMatrix.clone() } },
    /** The abode's time as Unix ms. */
    timeMs: (abodeTime) => epochMs + abodeTime * 1000,
    /** Whether celestiary's sky is still to come: not in yet, and not given up on. */
    get pending() { return guest.pending },
    /** performance.now() when its first frame was drawn, or null. */
    get shownAt() { return guest.shownAt },
    /** Whether this frame should wait for the sky drawn for its camera: the sky on, and the abode drawn in it (`drawn`). */
    syncing(drawn = true) { return guest.on && drawn && !document.hidden },
    /** Ask for the sky for the camera this frame draws the abode with, at abode time t. Returns its id. */
    request(matrixWorld, projectionMatrix, abodeTime) {
      camera = { matrixWorld: matrixWorld.clone(), projectionMatrix: projectionMatrix.clone() }
      return guest.view(body(epochMs + abodeTime * 1000))
    },
    /** Whether the frame for view `id` has come in (or a later one). */
    ready: guest.ready,
    /** Replay the sky into the target being drawn, under the abode (inplace-guest.js). */
    drawInto,
    /**
     * What the sky costs (?sky_perf=1): here, the replay's CPU time (and with
     * its GPU work, which a 1-pixel read waits for), the frames' latency,
     * the frames longer than 100 ms; there, celestiary's own perf snapshot
     * (its passes, by its perf tool) and its per-frame cost (layer:stats).
     */
    async perf() {
      return {
        when: new Date().toISOString(),
        page: location.href,
        userAgent: navigator.userAgent,
        stats: { ...stats, hello: stats.hello?.adapter },
        host: {
          drainCpuMs: summary(guest.perf.drains), drainWithGpuMs: summary(perf.gpu), latencyMs: summary(guest.perf.latency),
          longFrames: perf.long.slice(-40),
        },
        guestFrames: perf.guestStats,
        guest: await guestPerf(),
      }
    },
    /** Each frame, before rendering, with the abode's clock (seconds). */
    update,
    /** Whether celestiary's sky is drawn. */
    get on() { return guest.on },
    /** 0 at night to 1 by day, by the Sun's altitude at the last update; 0 without celestiary's sky. */
    get daylight() { return guest.on ? daylight : 0 },
    dispose: guest.dispose,
  }
}

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

export const SKY_SRC = 'https://celestiary.org/sky.html'
/** Origins the guest may come from in any build. */
export const SKY_ORIGINS = ['https://celestiary.org']
/** ms: the page to load, then to say hello, then to draw a first frame (the whole app boots). */
export const SKY_TIMEOUTS = { load: 30_000, hello: 30_000, sky: 90_000 }
/** The sky's pixels per CSS pixel, by default; and the largest side, px. */
export const SKY_SCALE = 1
const SKY_MAX_SIDE = 4096
/** The longest exo holds a frame for the sky's, ms; then it draws with the last one. */
export const SKY_HOLD_MS = 250
/** A view unanswered this long is sent again, ms. */
const RESEND_MS = 5_000
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

/** Until the abode is seen, a view to draw a first frame for, so celestiary's first-frame work is done before you get there. */
const WARM_CAMERA = {
  matrixWorld: new THREE.Matrix4().makeRotationX(0.35),
  projectionMatrix: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100).projectionMatrix,
}

/**
 * The celestiary sky for the abode. Starts when exo is entered (`warm`), or
 * when the abode is first drawn (`seen(camera)`), whichever is first, and
 * stands down to the procedural sky on any failure.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {{lat: number, lon: number}} o.site
 * @param {number} [o.epochMs] Unix ms at abode time 0
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeCelestiarySky({ renderer, site, epochMs = Date.now(), search = globalThis.location?.search ?? '' }) {
  // What the sky costs here (?sky_perf=1): the replay's time, the frames' latency.
  const perf = { drains: [], latency: [], long: [], gpu: [], since: performance.now() }
  const keep = (a, v, n = 300) => { a.push(v); if (a.length > n) a.shift() }
  const params = new URLSearchParams(search)
  const perfOn = params.get('sky_perf')
  // The guest draws at a pixel per CSS pixel, as celestiary's own page does; 2 is a retina screen's own.
  const scale = Math.min(2, Math.max(0.25, Number(params.get('sky_scale')) || SKY_SCALE))
  const stats = { status: 'idle', reason: null, origin: null, hello: null, views: 0, frames: 0, lastTimeMs: 0, latencyMs: 0, size: [0, 0] }

  let started = false, failed = false
  // The last camera that drew the abode, as it was then.
  let camera = null
  let net = null // { receiver, iframe, timers }
  let inFlight = null // { viewId, sentAt }
  let viewId = 0
  const sentAt = new Map() // viewId → when it was sent
  let lastIn = 0 // the latest view whose frame has come in
  const worldFromEq = new THREE.Matrix3()
  // The target the guest's screen replays into (drawInto).
  let drawTarget = null
  const framebufferOf = (rt) => {
    const p = renderer.properties.get(rt)
    return (rt.samples > 0 ? p.__webglMultisampledFramebuffer : null) ?? p.__webglFramebuffer ?? null
  }

  const fail = (reason) => {
    if (failed) return
    failed = true
    stats.status = 'procedural'
    stats.reason = reason
    console.info(`[sky] ${reason}; keeping the procedural sky`)
    dispose()
  }

  async function start() {
    started = true
    if (params.get('sky') === '0') { stats.status = 'procedural'; stats.reason = '?sky=0'; return }
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return fail('no WebGL2')
    const { src, origin, rejected } = resolveSkySrc({
      param: params.get('sky_src'), pageOrigin: location.origin, dev: !!import.meta.env?.DEV,
    })
    if (rejected) console.warn(`[sky] ignoring sky_src=${rejected}: not celestiary.org (a loopback guest needs a loopback page)`)
    let core
    try { core = await import('@pablo-mayrgundter/portal-netgl/core') } catch (e) { return fail(`portal-netgl didn't load (${e?.message ?? e})`) }
    if (failed) return
    stats.origin = origin
    stats.status = 'connecting'

    const url = new URL(src)
    url.searchParams.set('host', location.origin)
    url.searchParams.set('output', 'linear')
    if (params.get('sky_meter') === '0') url.searchParams.set('meter', '0')
    if (perfOn) url.searchParams.set('perf', perfOn === 'sync' ? 'sync' : '1')
    const iframe = document.createElement('iframe')
    iframe.title = 'celestiary sky renderer (draws into the abode)'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.referrerPolicy = 'origin'
    // Hidden but live: not display:none, which may throttle the frame.
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0', pointerEvents: 'none' })
    iframe.src = url.href
    document.body.appendChild(iframe)

    const timers = new Set()
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }
    let helloTimer = later(SKY_TIMEOUTS.load, () => fail(`${url.host} didn't load in ${SKY_TIMEOUTS.load / 1000} s`))
    let loads = 0
    iframe.addEventListener('load', () => {
      if (++loads > 1) return fail('the sky guest navigated away')
      if (stats.hello) return
      clearTimeout(helloTimer)
      helloTimer = later(SKY_TIMEOUTS.hello, () => fail(`no hello from ${origin} ${SKY_TIMEOUTS.hello / 1000} s after it loaded`))
    })

    const receiver = core.makeNetGLHostReceiver({
      gl,
      transport: core.iframeTransport(iframe, { origin }),
      replay: {
        // The guest's screen is the target the abode is being drawn into.
        screenFramebuffer: () => (drawTarget ? framebufferOf(drawTarget) : null),
        screen: { clear: 'none' },
        // Its screen viewport (its frame's size) to the target's.
        remapScreenViewport: (x, y, w, h) => {
          if (!drawTarget || !stats.size[0]) return null
          const sx = drawTarget.width / stats.size[0], sy = drawTarget.height / stats.size[1]
          return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)]
        },
      },
      onControl: (msg) => {
        if (msg?.type === 'layer:hello') {
          const first = !stats.hello
          stats.hello = msg
          const ok = isSkyHello(msg)
          receiver.post({ type: 'layer:hello-ack', accepted: ok, ...(ok ? {} : { reason: 'this host draws a sky in place: kinds [sky], frames [equator-of-date], contracts.color linear' }) })
          if (!first) return
          clearTimeout(helloTimer)
          if (!ok) {
            const c = msg.capabilities ?? {}
            return fail(`${origin}'s guest (${msg.adapter ?? msg.kind ?? '?'}: kinds ${JSON.stringify(c.kinds ?? [])}, frames ${JSON.stringify(c.frames ?? [])}, color ${msg.contracts?.color ?? '?'}) has no sky to draw in place`)
          }
          stats.status = 'loading'
          if (perfOn) receiver.post({ type: 'layer:stats-subscribe', intervalMs: 1000 })
          later(SKY_TIMEOUTS.sky, () => { if (!stats.frames) fail(`no sky from ${origin} in ${SKY_TIMEOUTS.sky / 1000} s`) })
        } else if (msg?.type === 'layer:status' && msg.status === 'error') {
          fail(`${origin}: ${msg.message || 'error'}`)
        } else if (msg?.type === 'layer:stats') {
          perf.guestStats ??= []
          const { type, ...rest } = msg
          keep(perf.guestStats, rest, 60)
        } else if (msg?.type === 'sky:perf') {
          perfWaiting.get(msg.id)?.(msg.snapshot ?? null)
          perfWaiting.delete(msg.id)
        }
      },
      onError: (err) => console.debug('[sky] replay error', err),
    })
    receiver.onFrame((end) => arrived(end.viewId ?? inFlight?.viewId))
    net = { receiver, iframe, timers }
  }

  /** A frame has come in, for view `id`. */
  function arrived(id) {
    stats.frames += 1
    if (Number.isFinite(id)) {
      lastIn = Math.max(lastIn, id)
      const at = sentAt.get(id)
      if (at !== undefined) { stats.latencyMs = Math.round(performance.now() - at); keep(perf.latency, stats.latencyMs) }
    }
    if (inFlight && (!Number.isFinite(id) || id >= inFlight.viewId)) inFlight = null
    if (stats.status !== 'sky') {
      stats.status = 'sky'
      console.info(`[sky] celestiary sky from ${stats.origin}`)
    }
  }

  /** The frame's size: the canvas's CSS size × scale, held under SKY_MAX_SIDE. */
  function size() {
    // CSS pixels, not the drawing buffer's, as celestiary's own page draws.
    const buf = renderer.getSize(new THREE.Vector2())
    const f = Math.min(scale, SKY_MAX_SIDE / Math.max(buf.x, buf.y, 1))
    const w = Math.max(64, Math.round(buf.x * f)), h = Math.max(64, Math.round(buf.y * f))
    stats.size = [w, h]
    return [w, h]
  }

  function sendView(timeMs) {
    const [w, h] = size()
    viewId += 1
    sentAt.set(viewId, performance.now())
    if (sentAt.size > 8) sentAt.delete(sentAt.keys().next().value)
    net.receiver.post({
      type: 'layer:view',
      viewId,
      view: {
        frame: 'equator-of-date',
        viewMatrix: skyViewMatrix(camera.matrixWorld, worldFromEq),
        projectionMatrix: skyProjection(camera.projectionMatrix),
        viewport: [0, 0, w, h], pixelRatio: 1, timeMs,
        observer: { lat: site.lat, lon: site.lon, alt: 0 },
      },
    })
    inFlight = { viewId, sentAt: performance.now() }
    stats.views += 1
    stats.lastTimeMs = timeMs
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
    if (failed) return
    if (!started) { if (camera) start(); return }
    if (!net || stats.status === 'connecting' || !isSkyHello(stats.hello)) return
    if (inFlight && now - inFlight.sentAt > RESEND_MS) inFlight = null // lost: ask again
    // Once the sky is in, the frame loop asks (request) for each frame's
    // camera; until then, this does, one view at a time, for the abode's
    // camera if it has been seen and a stand-in if not: the first frame
    // (its shaders, its uploads) is then done before you reach the arch.
    if (stats.status === 'sky') return
    if (!inFlight && !document.hidden) { camera ??= WARM_CAMERA; sendView(timeMs) }
  }

  /**
   * Replays the guest's latest frame (or re-runs the last, if no new one
   * has come) into `target`, bound and cleared first, and leaves the
   * target bound. Then draw the scene over it after clearing depth: the
   * guest's final pass writes its own. Returns whether it drew.
   */
  function drawInto(target) {
    if (!on()) return false
    const t0 = performance.now()
    renderer.setRenderTarget(target) // its framebuffer exists, and is bound
    renderer.clear(true, true, true) // the guest's screen clears are dropped
    drawTarget = target
    renderer.resetState()
    try { net.receiver.drain() } finally {
      drawTarget = null
      renderer.resetState()
      renderer.setRenderTarget(target)
    }
    keep(perf.drains, Math.round((performance.now() - t0) * 10) / 10)
    if (perfOn) {
      // The replay's GPU work too: a 1-pixel read waits for it (perf only: it stalls).
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, new (target.texture.type === THREE.HalfFloatType ? Uint16Array : Uint8Array)(4))
      keep(perf.gpu, Math.round((performance.now() - t0) * 10) / 10)
    }
    return true
  }

  /** Whether celestiary's sky is drawn: a frame has come in from a guest we took. */
  function on() {
    return !failed && !!net && stats.status === 'sky'
  }

  /** Take the camera that draws the abode: a copy of its matrices. */
  function seen(cam) {
    if (cam) camera = { matrixWorld: cam.matrixWorld.clone(), projectionMatrix: cam.projectionMatrix.clone() }
  }

  // The guest's perf snapshot (?sky_perf=1), asked for and awaited.
  let perfAsk = 0
  const perfWaiting = new Map()
  function guestPerf(timeoutMs = 4000) {
    if (!net) return Promise.resolve(null)
    const id = ++perfAsk
    return new Promise((resolve) => {
      perfWaiting.set(id, resolve)
      net.receiver.post({ type: 'sky:perf-request', id })
      setTimeout(() => { if (perfWaiting.delete(id)) resolve(null) }, timeoutMs)
    })
  }
  const summary = (a) => {
    if (!a.length) return null
    const v = a.filter((x) => typeof x === 'number').slice().sort((x, y) => x - y)
    const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
    return { n: v.length, p50: at(0.5), p90: at(0.9), max: v[v.length - 1] }
  }

  function dispose() {
    if (!net) return
    try { net.receiver.post({ type: 'layer:dispose' }) } catch { /* the frame may be gone */ }
    for (const t of net.timers) clearTimeout(t)
    net.receiver.stop()
    net.iframe.remove()
    net = null
  }

  return {
    stats,
    /** Call when the abode is drawn, with the camera drawing it: the guest starts on the first. */
    seen,
    /** The abode's time as Unix ms. */
    timeMs: (abodeTime) => epochMs + abodeTime * 1000,
    /** Start loading celestiary now, ahead of the abode coming into view. */
    warm() { if (!started && !failed) start() },
    /**
     * Whether this frame should wait for the sky drawn for its camera: the
     * sky on, and the abode to be drawn this frame (`drawn`: the caller
     * knows, from the camera's side and whether the doorway is in view).
     */
    syncing(drawn = true) {
      return on() && drawn && !document.hidden
    },
    /**
     * Ask for the sky for the camera this frame draws the abode with (its
     * matrixWorld and projection), at abode time t. Returns its id.
     */
    request(matrixWorld, projectionMatrix, abodeTime) {
      camera = { matrixWorld: matrixWorld.clone(), projectionMatrix: projectionMatrix.clone() }
      sendView(epochMs + abodeTime * 1000)
      return viewId
    },
    /** Whether the frame for view `id` has come in (or a later one). */
    ready(id) { return lastIn >= id },
    /** Replay the sky into the target being drawn, under the abode (see above). */
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
          drainCpuMs: summary(perf.drains), drainWithGpuMs: summary(perf.gpu), latencyMs: summary(perf.latency),
          longFrames: perf.long.slice(-40),
        },
        guestFrames: perf.guestStats ?? [],
        guest: await guestPerf(),
      }
    },
    /** Each frame, before rendering, with the abode's clock (seconds). */
    update,
    /** Whether celestiary's sky is drawn. */
    get on() { return on() },
    /** 0 at night to 1 by day, by the Sun's altitude at the last update; 0 without celestiary's sky. */
    get daylight() { return on() ? daylight : 0 },
    dispose,
  }
}

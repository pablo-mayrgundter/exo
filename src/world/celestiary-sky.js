// The abode's sky is celestiary's, through NetGL (portal-netgl).
//
// celestiary itself runs in a hidden cross-origin iframe (celestiary.org's
// sky.html: the whole app less its chrome, landed on Earth), and its WebGL
// calls replay into our context. Each frame the host sends the camera that
// drew the abode's dome, as a rotation in Earth's equator of date with a
// wider field than its own, and the clock and the place; celestiary draws
// that view, its stars, Milky Way, planets, Moon, Sun, clouds and air, into
// a render target of ours.
//
//   exo (host)                               celestiary (guest)
//   netgl:ready-ack                     ◄──  netgl:ready
//   layer:hello-ack {accepted}          ◄──  layer:hello {capabilities.kinds}
//   layer:view {camera, timeMs, site}   ──►  draws the sky there
//   drain into the sky target           ◄──  netgl:batch … frame-end {viewId}
//
// One view is in flight: the next goes when a frame comes back. The sky is
// at infinity, so the dome looks each direction up through the view and
// projection the frame was drawn for: exact whatever the head has done
// since, so a late frame still has its stars in place. Where a turn has
// gone past what the frame covers, the dome shows exo's own dusk.
//
// Frame and clock: the views are in the equator of date (x to the
// equinox, z to the north pole), with no translation, at the abode's time
// as Unix ms (it runs ×600), seen from ABODE_SITE.
//
// A guest whose hello doesn't offer the 'sky' kind in 'equator-of-date' is
// let go, and the procedural sky stays. So does a guest that doesn't load
// or answer in time, or a missing WebGL2. Each logs one line. The guest's
// page and origin are fixed here. ?sky_src= may name another celestiary.org
// page (its PR previews) from any page, or a loopback guest from a page
// served from loopback (guest-src.js). ?sky=0
// keeps the procedural sky without asking; ?sky_scale= sets the sky's
// pixels per screen pixel (default 0.75), ?sky_meter=0 asks celestiary for
// its cheaper exposure (no metering).
import * as THREE from 'three'
import { isLocalOrigin, resolveGuestSrc } from './guest-src.js'

export const SKY_SRC = 'https://celestiary.org/sky.html'
/** Origins the guest may come from in any build. */
export const SKY_ORIGINS = ['https://celestiary.org']
/** ms: the page to load, then to say hello, then to draw a first frame (the whole app boots). */
export const SKY_TIMEOUTS = { load: 30_000, hello: 30_000, sky: 90_000 }
/** How much wider than the camera's the guest's view is, in the tangent of the half field. */
export const SKY_OVERSCAN = 1.3
/** The sky's pixels per screen pixel, by default; and the largest side, px. */
export const SKY_SCALE = 0.75
const SKY_MAX_SIDE = 2048
/** A view unanswered this long is sent again, ms. */
const RESEND_MS = 5_000
/** The dome unseen this long, no more views, ms. */
const IDLE_MS = 1_000
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

/** Whether a guest's `layer:hello` offers the sky this host asks for. */
export function isSkyHello(hello) {
  const c = hello?.capabilities
  return Array.isArray(c?.kinds) && c.kinds.includes('sky') && Array.isArray(c?.frames) && c.frames.includes('equator-of-date')
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
 * in abode space, after the sky's turn at the time. No translation.
 * @param {THREE.Camera} camera with its matrixWorld current
 * @param {THREE.Matrix3} worldFromEq eqToWorld's
 */
export function skyViewMatrix(camera, worldFromEq) {
  const eyeFromWorld = new THREE.Matrix4().extractRotation(camera.matrixWorld).transpose()
  const m = new THREE.Matrix4().setFromMatrix3(worldFromEq)
  return eyeFromWorld.multiply(m).toArray()
}

/**
 * The guest's perspective (column-major): the camera's, its field widened
 * by `overscan` in the tangent, the same aspect.
 */
export function skyProjection(camera, overscan = SKY_OVERSCAN) {
  const t = Math.tan((camera.fov * Math.PI) / 360) * overscan
  const f = 1 / t, aspect = camera.aspect
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0]
}

/**
 * Where a frame drawn with view V and projection P shows direction `d`
 * (equator of date): its texture coordinates, or null outside it. The
 * GLSL in SKY_GLSL does the same; the test holds them together.
 */
export function skyLookup(vp, d) {
  const c = new THREE.Vector4(d.x, d.y, d.z, 0).applyMatrix4(vp)
  if (c.w <= 0) return null
  const x = c.x / c.w, y = c.y / c.w
  if (Math.abs(x) > 1 || Math.abs(y) > 1) return null
  return [0.5 + 0.5 * x, 0.5 + 0.5 * y]
}

/** The dome's uniforms for the sky (abode.js reads them in its shader). */
function skyUniforms(target) {
  return {
    skyTex: { value: target.texture },
    skyEq: { value: new THREE.Matrix3() }, // equator of date ← world
    skyVP: { value: new THREE.Matrix4() }, // the shown frame's: clip ← equator of date
    skyOn: { value: 0 },
  }
}

/** GLSL for the dome's fragment shader: `skySample(dWorld)` → linear colour and coverage. */
export const SKY_GLSL = `
  uniform sampler2D skyTex; uniform mat3 skyEq; uniform mat4 skyVP; uniform float skyOn;
  vec3 skyLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec4 skySample(vec3 w){
    vec3 d = normalize(skyEq * w);
    vec4 c = skyVP * vec4(d, 0.0);
    if (c.w <= 0.0) return vec4(0.0);
    vec2 ndc = c.xy / c.w;
    // Fades out over the frame's last few percent, into the dusk.
    vec2 edge = smoothstep(vec2(1.0), vec2(0.94), abs(ndc));
    float a = edge.x * edge.y;
    if (a <= 0.0) return vec4(0.0);
    // The guest's frame is display-referred and opaque.
    return vec4(skyLinear(texture2D(skyTex, 0.5 + 0.5 * ndc).rgb), a);
  }`

/**
 * The celestiary sky for the abode. Starts when the abode is first drawn
 * (`seen(camera)`), and stands down to the procedural sky on any failure.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {{lat: number, lon: number}} o.site
 * @param {number} [o.epochMs] Unix ms at abode time 0
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeCelestiarySky({ renderer, site, epochMs = Date.now(), search = globalThis.location?.search ?? '' }) {
  const target = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: true, generateMipmaps: false })
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter
  const uniforms = skyUniforms(target)
  const params = new URLSearchParams(search)
  const scale = Math.min(2, Math.max(0.25, Number(params.get('sky_scale')) || SKY_SCALE))
  const stats = { status: 'idle', reason: null, origin: null, hello: null, views: 0, frames: 0, lastTimeMs: 0, latencyMs: 0, size: [0, 0] }

  let seenAt = -Infinity, camera = null, started = false, failed = false
  let net = null // { receiver, iframe, timers }
  let inFlight = null // { viewId, sentAt }
  let viewId = 0
  const views = new Map() // viewId → the frame's clip ← equator of date, and when it was sent
  const arrived = [] // viewIds of frames waiting to be drained
  const worldFromEq = new THREE.Matrix3()

  const fail = (reason) => {
    if (failed) return
    failed = true
    stats.status = 'procedural'
    stats.reason = reason
    uniforms.skyOn.value = 0
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
    if (params.get('sky_meter') === '0') url.searchParams.set('meter', '0')
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
        // The guest's screen is our sky target.
        screenFramebuffer: () => renderer.properties.get(target).__webglFramebuffer ?? null,
        screen: { clear: 'none' },
      },
      onControl: (msg) => {
        if (msg?.type === 'layer:hello') {
          const first = !stats.hello
          stats.hello = msg
          const ok = isSkyHello(msg)
          receiver.post({ type: 'layer:hello-ack', accepted: ok, ...(ok ? {} : { reason: 'this host draws a sky: kinds [sky], frames [equator-of-date]' }) })
          if (!first) return
          clearTimeout(helloTimer)
          if (!ok) {
            const c = msg.capabilities ?? {}
            return fail(`${origin}'s guest (${msg.adapter ?? msg.kind ?? '?'}: kinds ${JSON.stringify(c.kinds ?? [])}, frames ${JSON.stringify(c.frames ?? [])}) has no sky mode`)
          }
          stats.status = 'loading'
          later(SKY_TIMEOUTS.sky, () => { if (!stats.frames) fail(`no sky from ${origin} in ${SKY_TIMEOUTS.sky / 1000} s`) })
        } else if (msg?.type === 'layer:status' && msg.status === 'error') {
          fail(`${origin}: ${msg.message || 'error'}`)
        }
      },
      onError: (err) => console.debug('[sky] replay error', err),
    })
    receiver.onFrame((end) => arrived.push(end.viewId ?? inFlight?.viewId))
    net = { receiver, iframe, timers }
  }

  /** The sky target at the drawing buffer's size × scale, held under SKY_MAX_SIDE. */
  function size() {
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2())
    const k = Math.min(scale * SKY_OVERSCAN, SKY_MAX_SIDE / Math.max(buf.x, buf.y, 1))
    const w = Math.max(16, Math.round(buf.x * k)), h = Math.max(16, Math.round(buf.y * k))
    if (target.width !== w || target.height !== h) target.setSize(w, h)
    stats.size = [w, h]
    return [w, h]
  }

  function sendView(timeMs) {
    const [w, h] = size()
    camera.updateMatrixWorld()
    const viewMatrix = skyViewMatrix(camera, worldFromEq)
    const projectionMatrix = skyProjection(camera)
    viewId += 1
    views.set(viewId, {
      vp: new THREE.Matrix4().fromArray(projectionMatrix).multiply(new THREE.Matrix4().fromArray(viewMatrix)),
      sentAt: performance.now(),
    })
    if (views.size > 8) views.delete(views.keys().next().value)
    net.receiver.post({
      type: 'layer:view',
      viewId,
      view: {
        frame: 'equator-of-date', viewMatrix, projectionMatrix,
        viewport: [0, 0, w, h], pixelRatio: 1, timeMs,
        observer: { lat: site.lat, lon: site.lon, alt: 0 },
      },
    })
    inFlight = { viewId, sentAt: performance.now() }
    stats.views += 1
    stats.lastTimeMs = timeMs
  }

  /** Replays the frames that came into the sky target; the dome then looks through the last one's view. */
  function drain(ids) {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(target) // so its framebuffer exists for the replay
    renderer.resetState()
    net.receiver.drain()
    renderer.resetState()
    renderer.setRenderTarget(prev)
    const v = views.get(ids[ids.length - 1])
    if (v) {
      uniforms.skyVP.value.copy(v.vp)
      stats.latencyMs = Math.round(performance.now() - v.sentAt)
    }
  }

  let daylight = 0
  function update(abodeTime) {
    const timeMs = epochMs + abodeTime * 1000
    daylight = THREE.MathUtils.smoothstep(sunAltitude(timeMs, site), -6, 6)
    eqToWorld(timeMs, site, worldFromEq)
    uniforms.skyEq.value.copy(worldFromEq).transpose()
    if (!camera || failed) return
    if (!started) { start(); return }
    if (!net || stats.status === 'connecting' || !isSkyHello(stats.hello)) return
    const now = performance.now()
    if (arrived.length) {
      const ids = arrived.splice(0)
      drain(ids)
      stats.frames += ids.length
      if (!uniforms.skyOn.value) console.info(`[sky] celestiary sky from ${stats.origin}`)
      uniforms.skyOn.value = 1
      stats.status = 'sky'
      if (inFlight && ids.includes(inFlight.viewId)) inFlight = null
    }
    const watched = now - seenAt < IDLE_MS && !document.hidden
    if (inFlight && now - inFlight.sentAt > RESEND_MS) inFlight = null // lost: ask again
    if (!inFlight && watched) sendView(timeMs)
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
    uniforms, stats, target,
    /** Call when the abode's dome is drawn, with the camera drawing it: the guest starts on the first. */
    seen(cam) { seenAt = performance.now(); if (cam) camera = cam },
    /** Each frame, before rendering, with the abode's clock (seconds). */
    update,
    /** Whether the guest's sky is showing. */
    get on() { return uniforms.skyOn.value > 0 },
    /** 0 at night to 1 by day, by the Sun's altitude at the last update; 0 without the guest's sky. */
    get daylight() { return uniforms.skyOn.value > 0 ? daylight : 0 },
    dispose,
  }
}

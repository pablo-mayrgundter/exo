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
/** The most it widens while the head turns. */
export const SKY_MAX_OVERSCAN = 3
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
 * @param {THREE.Matrix4} matrixWorld the camera's, as it drew the dome
 *   (a portal's virtual camera has only this: its position and rotation
 *   are never set, so updateMatrixWorld would lose it)
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
 * only the depth row), widened by `overscan` in the tangent.
 * @param {THREE.Matrix4} projectionMatrix the camera's, as it drew the dome
 */
export function skyProjection(projectionMatrix, overscan = SKY_OVERSCAN) {
  const e = projectionMatrix.elements
  const fx = e[0] / overscan, fy = e[5] / overscan
  return [fx, 0, 0, 0, 0, fy, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0]
}

/**
 * How much wider than the camera to ask for: SKY_OVERSCAN, and room for the
 * turn the head makes while the frame is on its way (`turnRate` rad/s over
 * `latency` s), at a vertical field whose half-angle's tangent is `tanHalf`.
 */
export function skyOverscan(tanHalf, turnRate, latency) {
  const extra = Math.min(0.8, Math.max(0, turnRate * latency * 1.5))
  const k = Math.tan(Math.min(1.45, Math.atan(tanHalf) + extra)) / tanHalf
  return Math.min(SKY_MAX_OVERSCAN, Math.max(SKY_OVERSCAN, k))
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
function skyUniforms(targets) {
  return {
    skyTex: { value: targets[0].texture }, // the last frame
    skyTex2: { value: targets[1].texture }, // the one before, where the last doesn't reach
    skyEq: { value: new THREE.Matrix3() }, // equator of date ← world
    skyVP: { value: new THREE.Matrix4() }, // the last frame's: clip ← equator of date
    skyVP2: { value: new THREE.Matrix4() },
    skyOn: { value: 0 },
    skyOn2: { value: 0 },
  }
}

/** GLSL for the dome's fragment shader: `skySample(dWorld)` → linear colour and coverage. */
export const SKY_GLSL = `
  uniform sampler2D skyTex, skyTex2; uniform mat3 skyEq; uniform mat4 skyVP, skyVP2; uniform float skyOn, skyOn2;
  vec3 skyLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  // A frame's colour (rgb) and how well it covers direction d (a), fading over its last few percent.
  vec4 skyFrame(sampler2D tex, mat4 vp, vec3 d){
    vec4 c = vp * vec4(d, 0.0);
    if (c.w <= 0.0) return vec4(0.0);
    vec2 ndc = c.xy / c.w;
    vec2 edge = smoothstep(vec2(1.0), vec2(0.94), abs(ndc));
    float a = edge.x * edge.y;
    if (a <= 0.0) return vec4(0.0);
    return vec4(skyLinear(texture2D(tex, 0.5 + 0.5 * ndc).rgb), a);
  }
  vec4 skySample(vec3 w){
    vec3 d = normalize(skyEq * w);
    vec4 s = skyFrame(skyTex, skyVP, d);
    if (s.a < 1.0 && skyOn2 > 0.5) {
      // The frame before, where the last one doesn't reach (a head turning faster than frames come).
      vec4 t = skyFrame(skyTex2, skyVP2, d);
      s = vec4(mix(t.rgb, s.rgb, s.a / max(s.a + t.a * (1.0 - s.a), 1e-4)), s.a + t.a * (1.0 - s.a));
    }
    return s;
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
  // Two targets in turn: the frame being shown and the one before it.
  const targets = [0, 1].map(() => {
    const t = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: true, generateMipmaps: false })
    t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter
    return t
  })
  let front = 0 // the target the last frame is in
  const uniforms = skyUniforms(targets)
  // What the sky costs here (?sky_perf=1): the replay's time, the frames' latency, the bytes.
  const perf = { drains: [], latency: [], bytes: [], long: [], gpu: [], since: performance.now() }
  const keep = (a, v, n = 300) => { a.push(v); if (a.length > n) a.shift() }
  const params = new URLSearchParams(search)
  const perfOn = params.get('sky_perf')
  const scale = Math.min(2, Math.max(0.25, Number(params.get('sky_scale')) || SKY_SCALE))
  const stats = { status: 'idle', reason: null, origin: null, hello: null, views: 0, frames: 0, lastTimeMs: 0, latencyMs: 0, size: [0, 0], overscan: SKY_OVERSCAN }

  let seenAt = -Infinity, started = false, failed = false
  // The last camera that drew the dome, as it was then: its matrices, and how fast it turns.
  let camera = null
  const look = { dir: new THREE.Vector3(), at: 0, rate: 0 }
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
        // The guest's screen is our sky target.
        screenFramebuffer: () => renderer.properties.get(targets[1 - front]).__webglFramebuffer ?? null,
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
    receiver.onFrame((end) => arrived.push(end.viewId ?? inFlight?.viewId))
    net = { receiver, iframe, timers }
  }

  /**
   * The targets at the drawing buffer's size × scale × SKY_OVERSCAN, held
   * under SKY_MAX_SIDE. Not by the turn's wider overscan: a resize clears
   * the frame on show, so a turning head gets fewer pixels a degree instead.
   */
  function size() {
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2())
    const f = Math.min(scale * SKY_OVERSCAN, SKY_MAX_SIDE / Math.max(buf.x, buf.y, 1))
    const w = Math.max(64, Math.round(buf.x * f)), h = Math.max(64, Math.round(buf.y * f))
    if (targets[0].width !== w || targets[0].height !== h) {
      for (const t of targets) t.setSize(w, h)
      uniforms.skyOn2.value = 0 // the frame before is gone
    }
    stats.size = [w, h]
    return [w, h]
  }

  function sendView(timeMs) {
    const k = skyOverscan(1 / camera.projectionMatrix.elements[5], look.rate, stats.latencyMs / 1000)
    stats.overscan = Math.round(k * 100) / 100
    const [w, h] = size()
    const viewMatrix = skyViewMatrix(camera.matrixWorld, worldFromEq)
    const projectionMatrix = skyProjection(camera.projectionMatrix, k)
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

  /**
   * Replays the frames that came into the back target, then shows it: the
   * dome looks through the last frame's view, and through the one before
   * where the last doesn't reach.
   */
  function drain(ids) {
    const back = targets[1 - front]
    const prev = renderer.getRenderTarget()
    const t0 = performance.now()
    renderer.setRenderTarget(back) // so its framebuffer exists for the replay
    renderer.resetState()
    net.receiver.drain()
    renderer.resetState()
    const cpu = performance.now() - t0
    if (perfOn) {
      // The replay's GPU work too: a 1-pixel read waits for it (perf only: it stalls).
      renderer.readRenderTargetPixels(back, 0, 0, 1, 1, new Uint8Array(4))
      keep(perf.gpu, Math.round((performance.now() - t0) * 10) / 10)
    }
    keep(perf.drains, Math.round(cpu * 10) / 10)
    renderer.setRenderTarget(prev)
    const v = views.get(ids[ids.length - 1])
    if (!v) return
    // The shown frame becomes the one before.
    uniforms.skyVP2.value.copy(uniforms.skyVP.value)
    uniforms.skyTex2.value = targets[front].texture
    uniforms.skyOn2.value = uniforms.skyOn.value
    front = 1 - front
    uniforms.skyTex.value = targets[front].texture
    uniforms.skyVP.value.copy(v.vp)
    stats.latencyMs = Math.round(performance.now() - v.sentAt)
    keep(perf.latency, stats.latencyMs)
  }

  let daylight = 0, lastUpdate = 0
  function update(abodeTime) {
    const timeMs = epochMs + abodeTime * 1000
    daylight = THREE.MathUtils.smoothstep(sunAltitude(timeMs, site), -6, 6)
    eqToWorld(timeMs, site, worldFromEq)
    uniforms.skyEq.value.copy(worldFromEq).transpose()
    const now = performance.now()
    if (perfOn && lastUpdate && now - lastUpdate > 100) {
      keep(perf.long, { at: Math.round(now - perf.since), ms: Math.round(now - lastUpdate), sunAlt: Math.round(sunAltitude(timeMs, site) * 10) / 10, turn: Math.round(look.rate * 100) / 100 }, 100)
    }
    lastUpdate = now
    if (!camera || failed) return
    if (!started) { start(); return }
    if (!net || stats.status === 'connecting' || !isSkyHello(stats.hello)) return
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

  /** The cameras that drew the dome, by camera: where each looked last, for its turn rate. */
  const looks = new WeakMap()
  /** Take the camera as it drew the dome: a copy of its matrices, and how fast it turns. */
  function seen(cam) {
    const now = performance.now()
    seenAt = now
    if (!cam) return
    camera = { matrixWorld: cam.matrixWorld.clone(), projectionMatrix: cam.projectionMatrix.clone() }
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld)
    const last = looks.get(cam)
    if (last && now > last.at) {
      const dt = (now - last.at) / 1000
      const rate = dir.angleTo(last.dir) / dt
      // Quick to rise, slow to fall: the next frame should cover the turn.
      look.rate = Math.max(rate, look.rate * Math.exp(-dt / 0.4))
    }
    looks.set(cam, { dir, at: now })
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
    uniforms, stats, targets,
    /** Call when the abode's dome is drawn, with the camera drawing it: the guest starts on the first. */
    seen,
    /** The abode's time as Unix ms. */
    timeMs: (abodeTime) => epochMs + abodeTime * 1000,
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
    /** Whether the guest's sky is showing. */
    get on() { return uniforms.skyOn.value > 0 },
    /** 0 at night to 1 by day, by the Sun's altitude at the last update; 0 without the guest's sky. */
    get daylight() { return uniforms.skyOn.value > 0 ? daylight : 0 },
    dispose,
  }
}

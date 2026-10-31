// The abode's sky from celestiary, through NetGL (portal-netgl).
//
// celestiary (celestiary.org) runs in a hidden cross-origin iframe and
// draws the celestial sphere; its GL calls replay into our context. The
// sky is a background, so it isn't drawn into the frame at all: the host
// asks for six views, the faces of a cube, and the replay lands each in a
// tile of an atlas render target. The abode's sky dome samples the atlas
// by direction, under its dusk glow, and everything in the abode occludes
// it as it occludes the dome. Which camera draws the abode (the visitor's
// inside, or the portal's from the bar) doesn't matter, and turning the
// head costs the guest nothing.
//
//   exo (host)                               celestiary (guest)
//   netgl:ready-ack                     ◄──  netgl:ready
//   layer:hello-ack {accepted}          ◄──  layer:hello {capabilities.kinds}
//   layer:view {face k, timeMs}         ──►  draws the sky for that view
//   drain into atlas tile k             ◄──  netgl:batch … frame-end {viewId}
//
// Frame and clock: the views are in the equator of date (x to the equinox,
// z to the north pole), with no translation. The host owns the clock: each
// view carries the abode's time as Unix ms (it runs ×600), so what moves
// against the stars is where the guest puts it at that time. The turn of
// the sky is the host's: the dome rotates the atlas by local sidereal time
// every frame, so the ×600 wheel is smooth between the guest's refreshes.
//
// Today's celestiary layer (layer.html) draws orbits only; its hello says
// kinds ['overlay'] in frame 'ecef'. A guest whose hello doesn't offer the
// 'sky' kind in 'equator-of-date' is let go, and the procedural sky stays.
// So does a guest that doesn't load or answer in time, or a missing WebGL2.
// Each logs one line. The guest's page and origin are fixed here; only a
// page served from loopback may point elsewhere (?sky_src=, loopback or
// celestiary.org only). ?sky=0 keeps the procedural sky without asking.
import * as THREE from 'three'

export const SKY_SRC = 'https://celestiary.org/layer.html'
/** Origins the guest may come from in any build. */
export const SKY_ORIGINS = ['https://celestiary.org']
/** A cube face's size in the atlas, pixels. The atlas is 3 × 2 faces. */
export const SKY_FACE = 1024
/** ms: the page to load, then to say hello, then to draw the first whole sky. */
export const SKY_TIMEOUTS = { load: 30_000, hello: 20_000, sky: 60_000 }
/** Wall ms between redraws of the six faces (the guest's moving bodies). */
export const SKY_REFRESH_MS = 2_000
/** A view unanswered this long is sent again, ms. */
const RESEND_MS = 5_000
const NEAR = 1, FAR = 1e8

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether `origin` is a loopback origin, any port. */
export function isLocalOrigin(origin) {
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/**
 * The guest page to load. `?sky_src=` counts only on a loopback page (or a
 * dev server), and only for a loopback or built-in origin.
 * @returns {{src: string, origin: string, rejected: string|null}}
 */
export function resolveSkySrc({ param = null, pageOrigin, dev = false }) {
  if (param) {
    const local = dev || isLocalOrigin(pageOrigin)
    let u = null
    try { u = new URL(param) } catch { /* rejected below */ }
    const ok = local && u && !u.username && !u.password &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && isLocalOrigin(u.origin))) &&
      (SKY_ORIGINS.includes(u.origin) || isLocalOrigin(u.origin))
    if (ok) return { src: u.href, origin: u.origin, rejected: null }
    return { src: SKY_SRC, origin: new URL(SKY_SRC).origin, rejected: param }
  }
  return { src: SKY_SRC, origin: new URL(SKY_SRC).origin, rejected: null }
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
 * The cube's faces in the equator of date: each looks along `d` with `x`
 * to its right and `y` up, and lands in atlas tile (col, row).
 */
export const SKY_FACES = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
].map((d, k) => {
  const dir = new THREE.Vector3(...d)
  const up = Math.abs(dir.z) > 0.5 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  const z = dir.clone().negate() // the eye looks down −z
  const x = up.clone().cross(z).normalize()
  const y = z.clone().cross(x)
  return { d: dir, x, y, col: k % 3, row: Math.floor(k / 3) }
})

/** Face k's view matrix (equator of date → eye), column-major. */
export function faceViewMatrix(k) {
  const { x, y } = SKY_FACES[k]
  const z = SKY_FACES[k].d.clone().negate()
  return [x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1]
}

/** A 90° square perspective, column-major. */
export function faceProjection(near = NEAR, far = FAR) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
}

/**
 * Where the dome samples direction `d` (equator of date): the face, and the
 * face's NDC. The GLSL in abode.js does the same; the test holds them to
 * the view and projection the guest is sent.
 */
export function skyLookup(d) {
  let k = 0, best = -2
  SKY_FACES.forEach((f, i) => { const s = f.d.dot(d); if (s > best) { best = s; k = i } })
  return { face: k, ndc: [SKY_FACES[k].x.dot(d) / best, SKY_FACES[k].y.dot(d) / best] }
}

/** The dome's uniforms for the atlas (abode.js reads them in its shader). */
function skyUniforms(atlas) {
  return {
    skyAtlas: { value: atlas.texture },
    skyEq: { value: new THREE.Matrix3() }, // equator of date ← world
    skyOn: { value: 0 },
    skyFd: { value: SKY_FACES.map((f) => f.d) },
    skyFx: { value: SKY_FACES.map((f) => f.x) },
    skyFy: { value: SKY_FACES.map((f) => f.y) },
  }
}

/** GLSL for the dome's fragment shader: `skySample(dWorld)` → premultiplied linear colour and coverage. */
export const SKY_GLSL = `
  uniform sampler2D skyAtlas; uniform mat3 skyEq; uniform float skyOn;
  uniform vec3 skyFd[6]; uniform vec3 skyFx[6]; uniform vec3 skyFy[6];
  vec3 skyLinear(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec4 skySample(vec3 w){
    vec3 d = normalize(skyEq * w);
    int k = 0; float best = -2.0;
    for (int i = 0; i < 6; i++) { float s = dot(skyFd[i], d); if (s > best) { best = s; k = i; } }
    vec2 uv = 0.5 + 0.5 * vec2(dot(skyFx[k], d), dot(skyFy[k], d)) / best;
    uv = clamp(uv, 0.5 / ${SKY_FACE.toFixed(1)}, 1.0 - 0.5 / ${SKY_FACE.toFixed(1)});
    vec2 tile = vec2(float(k - (k / 3) * 3), float(k / 3));
    vec4 s = textureLod(skyAtlas, (tile + uv) / vec2(3.0, 2.0), 0.0);
    // The guest's colours are display-referred and premultiplied.
    return vec4(s.a > 0.0 ? skyLinear(s.rgb / s.a) * s.a : vec3(0.0), s.a);
  }`

/**
 * The celestiary sky for the abode. Starts when the abode is first drawn
 * (`seen()`), and stands down to the procedural sky on any failure.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {{lat: number, lon: number}} o.site
 * @param {number} [o.epochMs] Unix ms at abode time 0
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeCelestiarySky({ renderer, site, epochMs = Date.now(), search = globalThis.location?.search ?? '' }) {
  const atlas = new THREE.WebGLRenderTarget(SKY_FACE * 3, SKY_FACE * 2, { depthBuffer: true, generateMipmaps: false })
  atlas.texture.minFilter = atlas.texture.magFilter = THREE.LinearFilter
  const uniforms = skyUniforms(atlas)
  const params = new URLSearchParams(search)
  const stats = { status: 'idle', reason: null, origin: null, hello: null, views: 0, frames: 0, cycles: 0, lastTimeMs: 0 }

  let seen = false, started = false, failed = false
  let net = null // { receiver, iframe, timers }
  let face = -1 // the face whose view is in flight
  let sentAt = 0, viewId = 0, cycleAt = -Infinity
  const arrived = [] // the faces of frames waiting to be drained
  const viewFace = new Map()

  const fail = (reason) => {
    if (failed) return
    failed = true
    stats.status = 'procedural'
    stats.reason = reason
    uniforms.skyOn.value = 0
    console.warn(`[sky] ${reason}; keeping the procedural sky`)
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
    if (rejected) console.warn(`[sky] ignoring sky_src=${rejected}: not a loopback page, or not an allowed origin`)
    let core
    try { core = await import('@pablo-mayrgundter/portal-netgl/core') } catch (e) { return fail(`portal-netgl didn't load (${e?.message ?? e})`) }
    if (failed) return
    stats.origin = origin
    stats.status = 'connecting'

    const url = new URL(src)
    url.searchParams.set('host', location.origin)
    url.searchParams.set('sky', '1')
    // The orbits layer's overlays off: nothing but the sky is wanted here.
    url.searchParams.set('nets', '')
    url.searchParams.set('sats', '0')
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
        // The guest's screen is the atlas; its tiles are its views' viewports.
        screenFramebuffer: () => renderer.properties.get(atlas).__webglFramebuffer ?? null,
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
          later(SKY_TIMEOUTS.sky, () => { if (!stats.cycles) fail(`no whole sky from ${origin} in ${SKY_TIMEOUTS.sky / 1000} s`) })
        } else if (msg?.type === 'layer:status' && msg.status === 'error') {
          fail(`${origin}: ${msg.message || 'error'}`)
        } else if (msg?.type === 'layer:invalidate') {
          cycleAt = -Infinity // redraw the faces at the next chance
        }
      },
      onError: (err) => console.debug('[sky] replay error', err),
    })
    // Each frame-end names its view, so a late answer to a re-sent view lands in its own face.
    receiver.onFrame((end) => arrived.push(viewFace.get(end.viewId) ?? face))
    net = { receiver, iframe, timers }
  }

  function sendView(k, timeMs) {
    const f = SKY_FACES[k]
    viewId += 1
    viewFace.set(viewId, k)
    if (viewFace.size > 12) viewFace.delete(viewFace.keys().next().value)
    net.receiver.post({
      type: 'layer:view',
      viewId,
      view: {
        frame: 'equator-of-date',
        viewMatrix: faceViewMatrix(k),
        projectionMatrix: faceProjection(),
        viewport: [f.col * SKY_FACE, f.row * SKY_FACE, SKY_FACE, SKY_FACE],
        pixelRatio: 1,
        timeMs,
        observer: { lat: site.lat, lon: site.lon, alt: 0 },
      },
    })
    face = k
    sentAt = performance.now()
    stats.views += 1
    stats.lastTimeMs = timeMs
  }

  /** Replays the frames that arrived into their faces' tiles, cleared first. */
  function drainFaces(faces) {
    const prev = renderer.getRenderTarget()
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    for (const k of faces) {
      const f = SKY_FACES[k]
      if (!f) continue
      atlas.scissor.set(f.col * SKY_FACE, f.row * SKY_FACE, SKY_FACE, SKY_FACE)
      atlas.scissorTest = true
      renderer.setRenderTarget(atlas)
      renderer.clear(true, true, false)
    }
    atlas.scissorTest = false
    renderer.setRenderTarget(atlas) // so the atlas's framebuffer exists for the replay
    renderer.setClearColor(cc, ca)
    renderer.resetState()
    net.receiver.drain()
    renderer.resetState()
    renderer.setRenderTarget(prev)
  }

  function update(abodeTime) {
    const timeMs = epochMs + abodeTime * 1000
    uniforms.skyEq.value.copy(eqToWorld(timeMs, site)).transpose()
    if (!seen || failed) return
    if (!started) { start(); return }
    if (!net || stats.status === 'connecting' || !isSkyHello(stats.hello)) return
    const now = performance.now()
    if (arrived.length) {
      const faces = arrived.splice(0)
      drainFaces(new Set(faces))
      stats.frames += faces.length
      if (face < 0 || !faces.includes(face)) return
      if (face === SKY_FACES.length - 1) {
        stats.cycles += 1
        stats.status = 'sky'
        if (!uniforms.skyOn.value) console.info(`[sky] celestiary sky from ${stats.origin}`)
        uniforms.skyOn.value = 1
        face = -1
      } else sendView(face + 1, timeMs)
      return
    }
    if (face >= 0 && now - sentAt > RESEND_MS) sendView(face, timeMs)
    else if (face < 0 && now - cycleAt > SKY_REFRESH_MS && !document.hidden) {
      cycleAt = now
      sendView(0, timeMs)
    }
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
    uniforms, stats, atlas,
    /** Call when the abode is drawn: the guest starts on the first. */
    seen() { seen = true },
    /** Each frame, before rendering, with the abode's clock (seconds). */
    update,
    /** Whether the guest's sky is showing. */
    get on() { return uniforms.skyOn.value > 0 },
    dispose,
  }
}

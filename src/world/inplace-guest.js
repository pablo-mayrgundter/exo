// An app drawn in place in exo's frame, through NetGL (portal-netgl): what
// the abode's sky (celestiary-sky.js) and the map under the chip
// (netmap-ground.js) share.
//
// The app runs in a hidden cross-origin iframe, and its WebGL calls replay
// into exo's context. Each exo frame that draws its scene sends it the
// camera (`view`) and waits for the frame drawn for it (main.js holds the
// frame, at most SKY_HOLD_MS); `drawInto(target)` then replays that frame
// straight into the framebuffer the scene is being drawn into, and the
// scene goes over it with its depth cleared. So what's composited is the
// app's own drawing, in exo's frame, for exo's camera: no texture of it,
// no stand-in. Until its first frame the caller shows what it likes
// (`pending`); on any failure it stands down (`failed`, `reason`), with one
// console line.
//
//   exo (host)                                guest
//   netgl:ready-ack                      ◄──  netgl:ready
//   layer:hello-ack {accepted}           ◄──  layer:hello  (accepts(hello))
//   layer:view {viewId, view}            ──►  draws that view
//   drawInto: replay into the target     ◄──  netgl:batch … frame-end {viewId}
import * as THREE from 'three'

/** A view unanswered this long is sent again, ms. */
const RESEND_MS = 5_000
const SIZE_MAX = 4096

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {string} o.name the log's tag: '[name] …'
 * @param {string} o.title the iframe's title
 * @param {string} o.src the guest page (with its own query)
 * @param {string} o.origin the guest's origin, pinned both ways
 * @param {(hello: object) => string|null} o.accepts null if the hello is one this host draws, else why not
 * @param {{load: number, hello: number, frame: number}} o.timeouts ms: to load, to say hello, to draw a first frame
 * @param {number} [o.scale] the frame's pixels per CSS pixel
 * @param {object} [o.screen] portal-netgl's screen policy for its draws (default: its clears dropped)
 * @param {(msg: object, guest: object) => void} [o.onControl] any other message
 */
export function makeInPlaceGuest({ renderer, name, title, src, origin, accepts, timeouts, scale = 1, screen = { clear: 'none' }, onControl }) {
  const stats = { status: 'idle', reason: null, origin, hello: null, views: 0, frames: 0, latencyMs: 0, size: [0, 0] }
  const perf = { drains: [], latency: [] }
  const keep = (a, v, n = 300) => { a.push(v); if (a.length > n) a.shift() }
  let started = false, failed = false
  let shownAt = null // when its first frame was drawn
  let net = null // { receiver, iframe, timers }
  let inFlight = null // { viewId, sentAt }
  let viewId = 0
  const sentAt = new Map() // viewId → when it was sent
  let lastIn = 0 // the latest view whose frame has come in
  let drawTarget = null // the target its screen replays into (drawInto)
  const framebufferOf = (rt) => {
    const p = renderer.properties.get(rt)
    return (rt.samples > 0 ? p.__webglMultisampledFramebuffer : null) ?? p.__webglFramebuffer ?? null
  }

  const self = {
    stats,
    perf,
    get started() { return started },
    get failed() { return failed },
    /** Whether it's drawn: a frame has come in from a guest this host took. */
    get on() { return !failed && !!net && stats.status === 'live' },
    /** Whether it's still to come: not in yet, and not given up on. */
    get pending() { return !failed && !self.on },
    /** performance.now() when its first frame was drawn, or null. */
    get shownAt() { return shownAt },
    /** Whether a view is out, unanswered (one at a time until the first frame). */
    get inFlight() { return !!inFlight && performance.now() - inFlight.sentAt < RESEND_MS },
    start,
    fail,
    view,
    ready: (id) => lastIn >= id,
    drawInto,
    post: (msg) => net?.receiver.post(msg),
    dispose,
  }

  function fail(reason) {
    if (failed) return
    failed = true
    stats.status = 'failed'
    stats.reason = reason
    console.info(`[${name}] ${reason}`)
    dispose()
  }

  async function start() {
    if (started) return
    started = true
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return fail('no WebGL2')
    let core
    try { core = await import('@pablo-mayrgundter/portal-netgl/core') } catch (e) { return fail(`portal-netgl didn't load (${e?.message ?? e})`) }
    if (failed) return
    stats.status = 'connecting'
    const url = new URL(src)
    url.searchParams.set('host', location.origin)
    const iframe = document.createElement('iframe')
    iframe.title = title
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
    let helloTimer = later(timeouts.load, () => fail(`${url.host} didn't load in ${timeouts.load / 1000} s`))
    let loads = 0
    iframe.addEventListener('load', () => {
      if (++loads > 1) return fail('the guest page navigated away')
      if (stats.hello) return
      clearTimeout(helloTimer)
      helloTimer = later(timeouts.hello, () => fail(`no hello from ${origin} ${timeouts.hello / 1000} s after it loaded`))
    })

    const receiver = core.makeNetGLHostReceiver({
      gl,
      transport: core.iframeTransport(iframe, { origin }),
      replay: {
        // Its screen is the target the scene is being drawn into.
        screenFramebuffer: () => (drawTarget ? framebufferOf(drawTarget) : null),
        screen,
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
          const why = accepts(msg)
          receiver.post({ type: 'layer:hello-ack', accepted: !why, ...(why ? { reason: why } : {}) })
          if (!first) return
          clearTimeout(helloTimer)
          if (why) return fail(`${origin}'s guest (${msg.adapter ?? '?'}) ${why}`)
          stats.status = 'loading'
          later(timeouts.frame, () => { if (!stats.frames) fail(`no frame from ${origin} in ${timeouts.frame / 1000} s`) })
        } else if (msg?.type === 'layer:status' && msg.status === 'error') {
          fail(`${origin}: ${msg.message || 'error'}`)
        }
        onControl?.(msg, self)
      },
      onError: (err) => console.debug(`[${name}] replay error`, err),
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
    if (stats.status !== 'live') {
      stats.status = 'live'
      console.info(`[${name}] in from ${origin}`)
    }
  }

  /** The frame's size: the canvas's CSS size × scale. */
  function size() {
    const buf = renderer.getSize(new THREE.Vector2())
    const f = Math.min(scale, SIZE_MAX / Math.max(buf.x, buf.y, 1))
    const w = Math.max(64, Math.round(buf.x * f)), h = Math.max(64, Math.round(buf.y * f))
    stats.size = [w, h]
    return [w, h]
  }

  /**
   * Ask for a frame of `body` (the guest's view, less its size, which this
   * adds: `viewport` and `width`/`height`, the frame's pixels). Returns its id,
   * or 0 when there's no guest to ask.
   */
  function view(body) {
    if (!net || stats.status === 'connecting') return 0
    const [w, h] = size()
    viewId += 1
    sentAt.set(viewId, performance.now())
    if (sentAt.size > 8) sentAt.delete(sentAt.keys().next().value)
    net.receiver.post({ type: 'layer:view', viewId, view: { ...body, viewport: [0, 0, w, h], width: w, height: h, pixelRatio: 1 } })
    inFlight = { viewId, sentAt: performance.now() }
    stats.views += 1
    return viewId
  }

  /**
   * Replays the guest's latest frame (or re-runs the last, if no new one has
   * come) into `target`, bound and cleared first (to `clearColor`, else the
   * renderer's), and leaves the target bound. Then draw the scene over it
   * after clearing depth. Returns whether it drew.
   */
  function drawInto(target, clearColor = null) {
    if (!self.on) return false
    const t0 = performance.now()
    renderer.setRenderTarget(target) // its framebuffer exists, and is bound
    const was = clearColor && { c: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha() }
    if (clearColor) renderer.setClearColor(clearColor, 1)
    renderer.clear(true, true, true) // the guest's screen clears are dropped
    if (was) renderer.setClearColor(was.c, was.a)
    drawTarget = target
    renderer.resetState()
    try { net.receiver.drain() } finally {
      drawTarget = null
      renderer.resetState()
      renderer.setRenderTarget(target)
    }
    shownAt ??= performance.now()
    keep(perf.drains, Math.round((performance.now() - t0) * 10) / 10)
    return true
  }

  function dispose() {
    if (!net) return
    try { net.receiver.post({ type: 'layer:dispose' }) } catch { /* the frame may be gone */ }
    for (const t of net.timers) clearTimeout(t)
    net.receiver.stop()
    net.iframe.remove()
    net = null
  }

  return self
}

/** A summary of a series of ms: n, median, 90th percentile, max. */
export function summary(a) {
  const v = a.filter((x) => typeof x === 'number').slice().sort((x, y) => x - y)
  if (!v.length) return null
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  return { n: v.length, p50: at(0.5), p90: at(0.9), max: v[v.length - 1] }
}

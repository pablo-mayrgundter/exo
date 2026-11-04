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
//
// A guest can draw other views besides the scene's, as parts (portal-netgl's
// `part` on a frame-end): `view(body, part)` asks for one, and its frame
// replays into the part's own render target, cleared first, at its own size,
// in the same drain as the scene's (netmap's framed globe at the gate,
// netmap.js). Its frames don't count as the scene's: `ready`, `on` and the
// latency are the main view's.
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
 * @param {Record<string, {target: THREE.WebGLRenderTarget, arrived?: (end: object) => void}>} [o.parts]
 *   views besides the scene's, by part name: each part's frames replay into its target
 * @param {(parts: Set<string>) => boolean} [o.timeDrain] whether to time the next drain to the GPU's finish ('' in `parts` is the main view)
 * @param {(d: {parts: Set<string>, ms: number, timed: boolean}) => void} [o.onDrain] after each drain
 * @param {(msg: object, guest: object) => void} [o.onControl] any other message
 */
export function makeInPlaceGuest({ renderer, name, title, src, origin, accepts, timeouts, scale = 1, screen = { clear: 'none' }, parts = {}, timeDrain, onDrain, onControl }) {
  const stats = { status: 'idle', reason: null, origin, hello: null, views: 0, frames: 0, partFrames: 0, latencyMs: 0, size: [0, 0] }
  // Its screen draws test the stencil, so it can be drawn through a doorway
  // (portal.js): EQUAL 0 over a frame cleared for it, the door's value
  // (drawInto's `stencil`) through one. The ref is read at each frame's replay.
  const policy = { ...screen, stencil: { ref: 0, valueMask: 0xff } }
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
  let part = null // the part of the frame being replayed (beforeFrame), null for the main view
  const fresh = new Set() // the parts ('' the main view) of the frames in since the last drain
  let lastParts = new Set() // those of the last batch, which a drain with nothing new re-runs
  let sink = null // where a main frame drained with no scene to draw goes (drainParts)
  const px = new Uint8Array(4)
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
    drainParts,
    /** The parts ('' the main view) of the frames in and not yet drawn. */
    get fresh() { return fresh },
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
      // Each frame's part picks its target.
      beforeFrame: (end) => { part = end.part && parts[end.part] ? end.part : null },
      replay: {
        // Its screen is the target the scene is being drawn into, or its part's.
        screenFramebuffer: () => framebufferOf(part ? parts[part].target : drawTarget),
        screen: policy,
        // Its screen viewport (its frame's size) to the target's; a part's is drawn at its target's size.
        remapScreenViewport: (x, y, w, h) => {
          if (part || !drawTarget || !stats.size[0]) return null
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
          later(timeouts.frame, () => { if (!stats.frames && !stats.partFrames) fail(`no frame from ${origin} in ${timeouts.frame / 1000} s`) })
        } else if (msg?.type === 'layer:status' && msg.status === 'error') {
          fail(`${origin}: ${msg.message || 'error'}`)
        }
        onControl?.(msg, self)
      },
      onError: (err) => console.debug(`[${name}] replay error`, err),
    })
    receiver.onFrame((end) => {
      const p = end.part && parts[end.part] ? end.part : ''
      fresh.add(p)
      if (!p) return arrived(end.viewId ?? inFlight?.viewId)
      stats.partFrames += 1
      parts[p].arrived?.(end)
    })
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
  function view(body, partName = null) {
    if (!net || stats.status === 'connecting') return 0
    if (partName) {
      // A part's view, as the caller made it, size and all.
      viewId += 1
      net.receiver.post({ type: 'layer:view', viewId, part: partName, view: body })
      return viewId
    }
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
   * after clearing depth. With `stencil` (a doorway's value, portal.js) it
   * isn't cleared, and the guest draws only where the stencil holds that.
   * Returns whether it drew.
   */
  function drawInto(target, clearColor = null, { stencil = null } = {}) {
    if (!self.on) return false
    // Through a doorway: drawn where the stencil holds its value, over what's there.
    policy.stencil.ref = stencil ?? 0
    try { replayInto(target, stencil === null ? clearColor : null, stencil === null) } finally { policy.stencil.ref = 0 }
    shownAt ??= performance.now()
    return true
  }

  /**
   * Replays the frames in into their parts' targets when no scene is drawn
   * to take them (a main frame among them goes nowhere). Returns whether
   * there were parts' frames to replay.
   */
  function drainParts() {
    if (failed || !net || ![...fresh].some(Boolean)) return false
    sink ??= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
    replayInto(sink, null)
    return true
  }

  function clearTo(target, color, alpha) {
    renderer.setRenderTarget(target) // its framebuffer exists, and is bound
    const was = { c: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha() }
    renderer.setClearColor(color, alpha)
    renderer.clear(true, true, true) // the guest's screen clears are dropped
    renderer.setClearColor(was.c, was.a)
  }

  /** Waits for the GPU: a 1-pixel read of a target of bytes (the scene's may be half floats), then `target` bound again. */
  function sync(target) {
    sink ??= new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
    renderer.setRenderTarget(sink) // its framebuffer exists
    renderer.readRenderTargetPixels(sink, 0, 0, 1, 1, px)
    renderer.setRenderTarget(target)
  }

  function replayInto(target, clearColor, clear = true) {
    const t0 = performance.now()
    // What this drain replays: the frames in, else the last batch again.
    const will = fresh.size ? new Set(fresh) : lastParts
    for (const p of will) if (p) clearTo(parts[p].target, 0x000000, 0)
    if (!clear) renderer.setRenderTarget(target)
    else if (clearColor) clearTo(target, clearColor, 1)
    else clearTo(target, renderer.getClearColor(new THREE.Color()), renderer.getClearAlpha())
    const timed = !!timeDrain?.(will)
    if (timed) sync(target) // what was queued before, done
    const t1 = performance.now()
    drawTarget = target
    renderer.resetState()
    try { net.receiver.drain() } finally {
      drawTarget = null
      part = null
      renderer.resetState()
      renderer.setRenderTarget(target)
    }
    if (timed) sync(target)
    const ms = performance.now() - t1
    lastParts = will
    fresh.clear()
    keep(perf.drains, Math.round((performance.now() - t0) * 10) / 10)
    onDrain?.({ parts: will, ms, timed })
  }

  function dispose() {
    if (!net) return
    try { net.receiver.post({ type: 'layer:dispose' }) } catch { /* the frame may be gone */ }
    for (const t of net.timers) clearTimeout(t)
    net.receiver.stop()
    net.iframe.remove()
    net = null
    sink?.dispose()
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

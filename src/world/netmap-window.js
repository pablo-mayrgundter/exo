// A live window onto NetMap, in the street's gate, through NetGL (portal-netgl).
//
// NetMap's guest page (netmap's map.html) runs in a hidden cross-origin
// iframe and draws its deck.gl globe of the internet; its GL calls replay
// into our context, into a render target that the gate's screen shows. This
// first step is a window, not 3D compositing: we ask for a camera the guest
// can honour exactly, and it draws that view full frame. Placing NetMap's
// Earth in exo's own space (ECEF in metres against our µm street, RFC 0004
// §1–§2) comes later.
//
//   exo (host)                                   netmap (guest)
//   netgl:ready-ack                        ◄──  netgl:ready
//   layer:hello-ack {accepted}             ◄──  layer:hello {capabilities.kinds ['map'],
//                                                 views ['globe-camera'], units {meters: 1}}
//   layer:view {viewId, view: {kind: 'globe-camera', lon, lat, fit,
//     bearing, pitch, width, height, timeMs, marks}}
//                                          ──►  deck draws that camera, full frame
//   drain into the render target           ◄──  netgl:batch … frame-end {viewId}
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
// it, and views go out no faster than keeps the guest's share of the time
// near MAP_GPU_SHARE (paceMs, pure, below). Timing whole frames instead
// doesn't work: the GPU's work lands in whichever later frame waits on it.
//
// A guest that doesn't load, say hello (with the 'map' kind and the
// 'globe-camera' view) or draw in time, or a missing WebGL2, logs one line
// and the gate stays as it was: a ring and a link (E still jacks in). The
// guest's page and origin are fixed here. ?netmap_src= may name another
// pablo-mayrgundter.github.io page (netmap's PR previews) from any page, or
// a loopback guest from a page served from loopback (guest-src.js).
// ?netmap=0 keeps the plain gate without asking.
import * as THREE from 'three'
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
const COST_SAMPLES = (drains) => drains === 3 || drains === 6 || drains % 30 === 0
/**
 * A view unanswered this long is sent again, ms. Long: the guest keeps a
 * view that comes before it's ready, and on a slow GPU each view it gets is
 * a frame to draw and replay.
 */
const RESEND_MS = 30_000
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

/**
 * NetMap's window. Starts when the gate is first drawn (`seen()`), and
 * stands down to the plain gate on any failure.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {string} [o.search] the page's query (location.search)
 */
export function makeNetMapWindow({ renderer, search = globalThis.location?.search ?? '' }) {
  const target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, { depthBuffer: true, generateMipmaps: false })
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter
  const params = new URLSearchParams(search)
  const stats = { status: 'idle', reason: null, origin: null, hello: null, guest: null, views: 0, frames: 0, drains: 0, drainMs: [], latencyMs: [], costMs: null }

  let seen = false, started = false, failed = false, on = false
  let net = null // { receiver, iframe, timers }
  let inFlight = 0, sentAt = -Infinity, viewId = 0, arrived = 0
  const sentTimes = new Map()
  const px = new Uint8Array(4)
  let pending = false // a view is owed now, whatever the pace (the guest asked)

  const fail = (reason) => {
    if (failed) return
    failed = true
    on = false
    stats.status = 'plain'
    stats.reason = reason
    console.info(`[netmap] ${reason}; the gate stays a link`)
    dispose()
  }

  async function start() {
    started = true
    if (params.get('netmap') === '0') { stats.status = 'plain'; stats.reason = '?netmap=0'; return }
    const gl = renderer.getContext()
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return fail('no WebGL2')
    const { src, origin, rejected } = resolveNetMapSrc({
      param: params.get('netmap_src'), pageOrigin: location.origin, dev: !!import.meta.env?.DEV,
    })
    if (rejected) console.warn(`[netmap] ignoring netmap_src=${rejected}: not pablo-mayrgundter.github.io (a loopback guest needs a loopback page)`)
    let core
    try { core = await import('@pablo-mayrgundter/portal-netgl/core') } catch (e) { return fail(`portal-netgl didn't load (${e?.message ?? e})`) }
    if (failed) return
    stats.origin = origin
    stats.status = 'connecting'

    const url = new URL(src)
    url.searchParams.set('host', location.origin)
    const iframe = document.createElement('iframe')
    iframe.title = 'NetMap renderer (draws into the street\'s gate)'
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
    let helloTimer = later(MAP_TIMEOUTS.load, () => fail(`${url.host} didn't load in ${MAP_TIMEOUTS.load / 1000} s`))
    let loads = 0
    iframe.addEventListener('load', () => {
      if (++loads > 1) return fail('the NetMap guest navigated away')
      if (stats.hello) return
      clearTimeout(helloTimer)
      helloTimer = later(MAP_TIMEOUTS.hello, () => fail(`no hello from ${origin} ${MAP_TIMEOUTS.hello / 1000} s after it loaded`))
    })

    const receiver = core.makeNetGLHostReceiver({
      gl,
      transport: core.iframeTransport(iframe, { origin }),
      replay: {
        // The guest's screen is the render target, which its frame fills:
        // the guest clears and draws it whole.
        screenFramebuffer: () => renderer.properties.get(target).__webglFramebuffer ?? null,
        screen: { clear: 'pass' },
      },
      onControl: (msg) => {
        if (msg?.type === 'layer:hello') {
          const first = !stats.hello
          stats.hello = msg
          const ok = isMapHello(msg)
          receiver.post({ type: 'layer:hello-ack', accepted: ok, ...(ok ? {} : { reason: 'this host shows a map: kinds [map], views [globe-camera]' }) })
          if (!first) return
          clearTimeout(helloTimer)
          if (!ok) {
            const c = msg.capabilities ?? {}
            return fail(`${origin}'s guest (${msg.adapter ?? '?'}: kinds ${JSON.stringify(c.kinds ?? [])}, views ${JSON.stringify(c.views ?? [])}) draws no globe camera`)
          }
          stats.status = 'loading'
          later(MAP_TIMEOUTS.frame, () => { if (!stats.frames) fail(`no frame from ${origin} in ${MAP_TIMEOUTS.frame / 1000} s`) })
        } else if (msg?.type === 'layer:status') {
          stats.guest = msg.status
          if (msg.status === 'error') fail(`${origin}: ${msg.message || 'error'}`)
          else if (msg.status === 'degraded') console.info(`[netmap] ${origin}: ${msg.message || 'degraded'}`)
        } else if (msg?.type === 'layer:invalidate') {
          // Its data came: the next view goes out at once.
          stats.invalidated = msg.reason ?? true
          inFlight = 0
          pending = true
        }
      },
      onError: (err) => console.debug('[netmap] replay error', err),
    })
    receiver.onFrame((end) => {
      arrived += 1
      const at = sentTimes.get(end.viewId)
      if (at !== undefined) {
        stats.latencyMs.push(performance.now() - at)
        if (stats.latencyMs.length > 60) stats.latencyMs.shift()
        sentTimes.delete(end.viewId)
      }
      if (end.viewId >= inFlight) inFlight = 0
    })
    net = { receiver, iframe, timers }
  }

  function sendView(now) {
    viewId += 1
    net.receiver.post({ type: 'layer:view', viewId, view: mapView(now / 1000, Date.now()) })
    sentTimes.set(viewId, now)
    if (sentTimes.size > 16) sentTimes.delete(sentTimes.keys().next().value)
    inFlight = viewId
    sentAt = now
    pending = false
    stats.views += 1
  }

  /** Replays the frames that arrived into the render target; with `timed`, to the GPU's finish. */
  function drain(timed) {
    const gl = renderer.getContext()
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(target) // so the target's framebuffer exists for the replay
    if (timed) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) // what was queued before, done
    const t0 = performance.now()
    renderer.resetState()
    net.receiver.drain()
    renderer.resetState()
    if (timed) {
      renderer.setRenderTarget(target)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const ms = performance.now() - t0
      stats.costMs = stats.costMs === null ? ms : stats.costMs * 0.5 + ms * 0.5
    }
    renderer.setRenderTarget(prev)
    stats.drainMs.push(performance.now() - t0)
    if (stats.drainMs.length > 60) stats.drainMs.shift()
  }

  function update() {
    if (failed || !started || !net || !isMapHello(stats.hello)) return
    const now = performance.now()
    if (arrived) {
      stats.frames += arrived
      stats.drains += 1
      arrived = 0
      drain(COST_SAMPLES(stats.drains))
      if (!on) {
        on = true
        stats.status = 'live'
        console.info(`[netmap] live NetMap in the gate, from ${stats.origin}`)
      }
    }
    if (inFlight && now - sentAt > RESEND_MS) sendView(now)
    else if (!inFlight && seen && now - sentAt >= (pending ? MAP_FRAME_MS : paceMs(stats.costMs)) && !document.hidden) sendView(now)
    seen = false // until the gate is drawn again
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
    stats, target,
    /** The window's picture: the guest's colours, display-referred and premultiplied. */
    texture: target.texture,
    /** Call when the gate is drawn: the guest starts on the first. */
    seen() {
      seen = true
      if (!started) start()
    },
    /** Each frame, before rendering. */
    update,
    /** Whether NetMap is showing. */
    get on() { return on },
    dispose,
  }
}

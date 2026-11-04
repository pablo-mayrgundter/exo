// NetMap in exo: one guest, two views. netmap's map.html runs once, in one
// hidden cross-origin iframe, with one deck and one download of the map, and
// draws both of what exo shows of it:
//
// - the ground (netmap-ground.js): the map under the chip, in place, for
//   the camera drawing the street, every frame that draws it;
// - the window (netmap-window.js): the globe framed in the gate, at its own
//   pace, into a render target the gate's screen shows.
//
// The window's views are the guest's `window` part (inplace-guest.js
// parts): each is drawn as a frame of its own, tagged with it, and replays
// into the window's target in the same drain as the ground's frame, which
// is the one the street waits for. When the street isn't drawn (you're in
// the abode, or the ground is left out), the window's frames are replayed
// on their own at the start of the next frame.
//
//   exo (host)                                     netmap (guest)
//   layer:view {viewId, part: 'window', view}  ──►  a globe camera, 512²
//   layer:view {viewId, view: matrix, ECEF}    ──►  exo's camera
//   one drain: window → its target,            ◄──  frame-end {viewId, part: 'window'},
//              ground → the street's frame          frame-end {viewId}
//
// The guest writes linear colour (map.html?output=linear), premultiplied,
// for both. One guest also means the drop through the gate (to come) is into
// the same map you picked a spot on, with the same data and the same time.
//
// ?netmap=0 leaves both out (the gate stays a ring and a link);
// ?netmap_ground=0 only the ground; ?netmap_src= picks netmap's page.
import * as THREE from 'three'
import { makeInPlaceGuest, summary } from './inplace-guest.js'
import { resolveNetMapSrc, isMapHello, mapView, paceMs, MAP_SIZE, MAP_FRAME_MS, COST_SAMPLES, RESEND_MS } from './netmap-window.js'
import { isGroundHello, groundViewMatrix, GROUND_TIMEOUTS, DEFAULT_RADIUS } from './netmap-ground.js'

/** Which of the ground's own drains are timed, for the window's cost against them. */
const BASE_SAMPLES = (n) => n === 3 || n === 6 || n % 60 === 0

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Color} o.background the street's void: what the map goes over
 * @param {string} [o.search] the page's query (location.search)
 * @returns {{guest: object, ground: object, window: object}}
 */
export function makeNetMap({ renderer, background, search = globalThis.location?.search ?? '' }) {
  const params = new URLSearchParams(search)
  const { src, origin, rejected } = resolveNetMapSrc({ param: params.get('netmap_src'), pageOrigin: globalThis.location?.origin, dev: !!import.meta.env?.DEV })
  if (rejected) console.warn(`[netmap] ignoring netmap_src=${rejected}: not pablo-mayrgundter.github.io (a loopback guest needs a loopback page)`)
  const url = new URL(src)
  url.searchParams.set('output', 'linear')

  const target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, { depthBuffer: true, generateMipmaps: false })
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter

  // The window's own state: its views, their pace and its frames' cost.
  const ws = { status: 'idle', reason: null, views: 0, frames: 0, drains: 0, costMs: null, baseMs: null, latencyMs: [] }
  let seen = false, inFlight = 0, sentAt = -Infinity, owed = false, shown = false, drained = false
  let baseDrains = 0
  const sentTimes = new Map()

  const guest = makeInPlaceGuest({
    renderer, name: 'netmap', title: 'NetMap renderer (the map under the chip, and the gate\'s window)',
    src: url.href, origin, timeouts: GROUND_TIMEOUTS,
    // Over the street's void, and into the window's cleared target: premultiplied, transparent where there's no Earth.
    screen: { clear: 'none', blend: 'premultiplied-over' },
    accepts: (hello) => (isMapHello(hello) ? null : `draws no map (kinds ${JSON.stringify(hello.capabilities?.kinds ?? [])}, views ${JSON.stringify(hello.capabilities?.views ?? [])})`),
    parts: {
      window: {
        target,
        arrived(end) {
          ws.frames += 1
          const at = sentTimes.get(end.viewId)
          if (at !== undefined) {
            ws.latencyMs.push(Math.round(performance.now() - at))
            if (ws.latencyMs.length > 60) ws.latencyMs.shift()
            sentTimes.delete(end.viewId)
          }
          if (end.viewId >= inFlight) inFlight = 0
        },
      },
    },
    // Now and then a drain is timed: with the window in it, for its cost; without, for the ground's own.
    timeDrain: (parts) => (parts.has('window') ? COST_SAMPLES(ws.drains + 1) : parts.has('') && BASE_SAMPLES(baseDrains + 1)),
    onDrain({ parts, ms, timed }) {
      drained = true
      const ema = (a, v) => (a === null ? v : a * 0.5 + v * 0.5)
      if (parts.has('window')) {
        ws.drains += 1
        if (timed) ws.costMs = ema(ws.costMs, Math.max(0, parts.has('') ? ms - (ws.baseMs ?? 0) : ms))
        if (!shown) {
          shown = true
          ws.status = 'live'
          console.info(`[netmap] live NetMap in the gate, from ${origin}`)
        }
      } else if (parts.has('')) {
        baseDrains += 1
        if (timed) ws.baseMs = ema(ws.baseMs, ms)
      }
    },
    onControl(msg) {
      if (msg?.type === 'layer:invalidate') {
        // Its data came: the window's next view goes out at once (the ground asks every frame anyway).
        inFlight = 0
        owed = true
      } else if (msg?.type === 'layer:status' && msg.status === 'degraded') {
        console.info(`[netmap] ${origin}: ${msg.message || 'degraded'}`)
      }
    },
  })
  const off = params.get('netmap') === '0'
  if (off) guest.fail('left out (?netmap=0)')
  const groundOff = off || params.get('netmap_ground') === '0'
  if (groundOff && !off) console.info('[netmap] the ground left out (?netmap_ground=0)')

  const start = () => { if (!guest.started && !guest.failed) guest.start() }

  // ── the ground ──
  /** Whether the guest can draw the ground (once it has said hello: matrix views in ECEF, in linear colour). */
  const groundable = () => !groundOff && !guest.failed && (!guest.stats.hello || isGroundHello(guest.stats.hello))
  let camera = null // the last camera that drew the street
  const radius = () => guest.stats.hello?.earth?.radius ?? DEFAULT_RADIUS
  const body = () => ({
    kind: 'matrix', frame: 'ecef',
    viewMatrix: groundViewMatrix(camera.matrixWorld, radius()),
    projectionMatrix: camera.projectionMatrix.toArray(),
    timeMs: Date.now(),
  })
  let told = false
  const ground = {
    stats: guest.stats,
    /** Start loading netmap (the first time you're out on the street). */
    start() { if (!groundOff) start() },
    /** The camera drawing the street this frame: its matrices, copied. */
    seen(cam) { camera = { matrixWorld: cam.matrixWorld.clone(), projectionMatrix: cam.projectionMatrix.clone() } },
    /** Each frame: until the first frame, a view at a time for the last camera. */
    update() {
      if (guest.stats.hello && !groundable() && !groundOff && !told) {
        told = true
        console.info(`[netmap] ${origin}'s map can't be drawn in place (views ${JSON.stringify(guest.stats.hello.capabilities?.views ?? [])}, color ${guest.stats.hello.contracts?.color ?? '?'}); the gate's window only`)
      }
      if (groundable() && guest.started && !guest.on && !guest.inFlight && camera && !document.hidden) guest.view(body())
    },
    /** Whether this frame should wait for the map drawn for its camera: it's on, and the street is drawn (`drawn`). */
    syncing(drawn = true) { return ground.on && drawn && !document.hidden },
    /** Ask for the map for this frame's camera (matrixWorld and projection, in the street's units). Returns its id. */
    request(matrixWorld, projectionMatrix) {
      camera = { matrixWorld: matrixWorld.clone(), projectionMatrix: projectionMatrix.clone() }
      return guest.view(body())
    },
    ready: guest.ready,
    /** Replay the map into the target the street is drawn into, over the void (inplace-guest.js); the window's frames go to its own. */
    drawInto: (t, opts) => (ground.on ? guest.drawInto(t, background, opts) : false),
    get on() { return groundable() && guest.on },
    get pending() { return groundable() && !guest.on },
    get shownAt() { return guest.shownAt },
    perf: () => ({ stats: { ...guest.stats, hello: guest.stats.hello?.adapter }, drainCpuMs: summary(guest.perf.drains), latencyMs: summary(guest.perf.latency), window: { ...ws } }),
  }

  // ── the window ──
  function send(now) {
    const id = guest.view(mapView(now / 1000, Date.now()), 'window')
    if (!id) return
    sentTimes.set(id, now)
    if (sentTimes.size > 16) sentTimes.delete(sentTimes.keys().next().value)
    inFlight = id
    sentAt = now
    owed = false
    ws.views += 1
  }
  const win = {
    stats: ws, target,
    /** The window's picture: linear and premultiplied (map.html?output=linear), or display colours from an older guest. */
    texture: target.texture,
    /** Whether the texture is linear: what the guest's hello says. */
    get linear() { return guest.stats.hello?.contracts?.color === 'linear' },
    /** Call when the gate is drawn: the guest starts on the first. */
    seen() {
      seen = true
      start()
    },
    /** Each frame, before rendering. */
    update() {
      if (guest.failed) {
        if (ws.status !== 'plain') { ws.status = 'plain'; ws.reason = guest.stats.reason; console.info('[netmap] the gate stays a link') }
        seen = false
        return
      }
      if (!guest.started) return
      // The window's frames in, and no street drawn last frame to have replayed them: on their own.
      if (!drained && guest.fresh.has('window')) guest.drainParts()
      drained = false
      if (guest.stats.hello && isMapHello(guest.stats.hello)) {
        if (ws.status === 'idle') ws.status = 'loading'
        const now = performance.now()
        if (inFlight && now - sentAt > RESEND_MS) send(now)
        else if (!inFlight && seen && now - sentAt >= (owed ? MAP_FRAME_MS : paceMs(ws.costMs)) && !document.hidden) send(now)
      }
      seen = false // until the gate is drawn again
    },
    /** Whether NetMap is showing. */
    get on() { return shown && !guest.failed },
  }

  return {
    guest, ground, window: win,
    dispose() { guest.dispose(); target.dispose() },
  }
}

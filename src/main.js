// Exo Cafe: boots the chip, builds the world, the bar and the abode, and
// runs the visitor's avatar through them.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { C } from './theme.js'
import { Frame, reproject, formatRate } from './cosmic/frames.js'
import { job as lifeJob, BOARD, ZP as LIFE_ZP, verifyLife } from './chip/life.js'
import { job as showJob, LEDS, ZP as SHOW_ZP } from './chip/lightshow.js'
import { job as maxJob, ZP as MAX_ZP } from './chip/max.js'
import { buildVcpu } from './chip/vcpu.js'
import { makeChipFloor } from './world/chipfloor.js'
import { BODY_UM, BODY_PER_LAYOUT, CHIP_UNIT_UM, DIE_GEO, formatLength } from './cosmic/units.js'
import { makeBar } from './world/bar.js'
import { makeAbode, ABODE_RATE } from './world/abode.js'
import { PortalPair } from './world/portal.js'
import { neonTexture, FONT_MONO } from './world/textures.js'
import { Avatar, TIERS } from './avatar/avatar.js'
import { FaceTracker } from './avatar/face.js'
import { Ledger, allocation } from './mist/ledger.js'
import { Mist, Job } from './mist/scheduler.js'
import { makeMistPanel, makeChipToken } from './mist/panel.js'
import { makeArtCar } from './world/artcar.js'
import { makeBarLife } from './world/barlife.js'
import { makeTerminals } from './world/pos.js'
import { makeEliza } from './npc/eliza.js'
import { MAX_SCRIPT } from './npc/max-script.js'
import { makeJukebox } from './world/jukebox.js'
import { Presence, BroadcastTransport } from './net/presence.js'
import { Controls } from './controls.js'
import { MANIFESTO, MIST, MAX } from './content.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const NETMAP = 'https://pablo-mayrgundter.github.io/netmap/'

// --- Renderer ---
const canvas = $('view')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000)

// --- Frames (cosmic.js): wall time and metres at the root ---
const wall = new Frame('wall')
// The street's scene unit is the micrometre (cosmic/units.js); the bar and
// its visitors are built in body units of ~4.47 µm, sized to the chip.
const cafe = new Frame('Exo Cafe', { parent: wall, scale: BODY_UM })
// Exo Cafe sits on the NMI pad, the top-left corner of the die.
const NMI_PAD = [413.5, 9612.5]
let chipHz = 0 // half-cycles per wall second, as measured
const chipFrame = new Frame('6502', {
  parent: cafe,
  scale: BODY_PER_LAYOUT,
  flipY: true,
  origin: [-NMI_PAD[0] * BODY_PER_LAYOUT, 0, NMI_PAD[1] * BODY_PER_LAYOUT],
  rate: () => chipHz / 2 / 1e6, // chip seconds per bar second, against its native 1 MHz
})
const abodeFrame = new Frame('Abode', { parent: wall, rate: ABODE_RATE })

// --- Scenes ---
const world = new THREE.Scene()
world.name = 'world'
world.background = new THREE.Color(C.void)
world.fog = new THREE.FogExp2(C.void, 0.0009 / BODY_UM)
// Scene units are micrometres; everything in the street is built in body
// units, so the scene's root carries the scale.
world.scale.setScalar(BODY_UM)
world.add(makeGrid())

const data = await (await fetch(`${import.meta.env.BASE_URL}chip/6502.json`)).json()
const floor = makeChipFloor(data, chipFrame, { unit: BODY_UM })
world.add(floor.group)
const bar = makeBar({ names: data.nodenames })
world.add(bar.group)
const jukebox = makeJukebox({ position: [-7.9, -6.2], rotation: 0.35, note }) // the north-west corner, by the back bar
bar.group.add(jukebox.group)
bar.colliders.push(jukebox.collider)
const gate = makeGate()
world.add(gate.group)
const abode = makeAbode({ renderer })
const portal = new PortalPair(
  { scene: world, anchor: bar.portalAnchor },
  { scene: abode.scene, anchor: abode.portalAnchor },
  { width: 2.4, height: 3.2 })
const scenes = [world, abode.scene]
let side = 0 // 0: the world (bar and street), 1: the abode

// --- Post: bloom, the Tron glow ---
const composer = new EffectComposer(renderer)
const renderPass = new RenderPass(world, camera)
composer.addPass(renderPass)
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.22)
if (params.get('fx') !== '0') composer.addPass(bloom)
composer.addPass(new OutputPass())

// --- The vCPU, its jobs, and the Mist that pays for them ---
// One 6502, the chip under the street, time-shared by a kernel: Life,
// the Art Car's light show and Max Pablo's mind are jobs on it.
const ledger = new Ledger()
const me = loadSelf()
const vcpu = buildVcpu([
  { name: 'life', entry: 'life', job: lifeJob },
  { name: 'show', entry: 'show', job: showJob },
  { name: 'max', entry: 'max', job: maxJob },
])
const worker = new Worker(new URL('./chip/worker.js', import.meta.url), { type: 'module' })
worker.addEventListener('message', (e) => {
  if (e.data.type !== 'halt') return
  console.error('The vCPU halted and was reset:', e.data.message)
  note('The vCPU crashed and was power-cycled.')
})
worker.addEventListener('message', (e) => {
  if (e.data.type !== 'resumed') return
  const ago = Math.round((Date.now() - e.data.saved) / 60000)
  note(`The vCPU picked up where it left off ${ago < 1 ? 'moments' : ago < 120 ? `${ago} min` : `${Math.round(ago / 60)} h`} ago, at ${(e.data.halfCycles / 2e6).toFixed(2)} M cycles.`)
})
// Save the chip when the page goes away (it also saves every 20 s).
addEventListener('pagehide', () => { worker.postMessage({ type: 'save' }); barLife?.state.save() })
worker.postMessage({
  type: 'init', data, program: vcpu.bytes, levels: true, persist: params.get('fresh') === null,
  jobs: [
    { id: 'life', frameAddr: LIFE_ZP.gen, watch: { from: BOARD.a, to: BOARD.b + 256, size: 256 },
      pingpong: { ptr: LIFE_ZP.src + 1, pages: [BOARD.a >> 8, BOARD.b >> 8] } },
    { id: 'show', frameAddr: SHOW_ZP.frame, watch: { from: LEDS.a, to: LEDS.a + LEDS.count, size: LEDS.count } },
    { id: 'max', frameAddr: MAX_ZP.frame, watch: { from: MAX_ZP.line, to: MAX_ZP.line + 1, size: 1 } },
  ],
})
const mist = new Mist({ donor: me, worker, system: 0.35 })
// Memory: code, plus what each job reads and writes.
const life = mist.add(new Job({ id: 'life', name: 'Life', place: 'the bar wall', unit: 'generation', weight: 6,
  bytes: vcpu.sizes.life + 512 + 11, verify: verifyLife }))
const show = mist.add(new Job({ id: 'show', name: 'Art Car lights', place: 'the street', weight: 1,
  bytes: vcpu.sizes.show + LEDS.count + 2 }))
const mind = mist.add(new Job({ id: 'max', name: 'Max Pablo', place: 'behind the bar', unit: 'thought', weight: 1,
  bytes: vcpu.sizes.max + 4 }))
mist.kernelBytes = vcpu.sizes.kernel + 16 + 256
const car = makeArtCar()
world.add(car.group)
let tick = null
life.onMessage((m) => {
  if (m.type !== 'tick') return
  chipHz = mist.vcpuHz * 2
  tick = { board: m.view, cursor: m.cursor, gen: m.frame, regs: m.regs, hz: chipHz }
  floor.setLevels(m.levels)
  ledger.update(mist.given)
})
show.onMessage((m) => {
  if (m.type === 'tick') car.setLeds(m.view)
  if (m.type === 'receipt') car.frameDone(m.t)
})
// Max speaks when his mind finishes a thought, if you're near enough to hear.
mind.onMessage((m) => {
  if (m.type !== 'receipt' || !entered || side !== 0 || !barLife.idle) return
  if (avatar.group.position.distanceTo(bar.max.group.position) > 9) return
  maxSays(MAX.thoughts[m.outputBoard[0] % MAX.thoughts.length])
})

// --- You ---
const avatar = new Avatar({ hue: me.hue, name: me.name, tier: ledger.tier })
avatar.group.position.set(0, 0.08, 1)
avatar.group.rotation.y = Math.PI
world.add(avatar.group)
let heading = Math.PI // the avatar's facing, radians about +y; π faces -z (the counter)
// The stools, drinks and Max's tending (world/barlife.js). In conversation
// Max is ELIZA with a bartender's script (npc/eliza.js, npc/max-script.js).
const eliza = makeEliza(MAX_SCRIPT)
const respond = (text) => eliza.respond(text)
const barLife = makeBarLife({ bar, avatar, mist, me, say: (t) => maxSays(t), note: (t) => note(t), respond: (t) => respond(t) })
// What you told Max last time ("my ..." lines) comes back in conversation.
{
  const regular = barLife.state.regular(me.name)
  eliza.memory.push(...regular.memory)
  regular.memory = eliza.memory
}
const controls = new Controls(canvas)
controls.yaw = 0
const face = new FaceTracker()
let entered = false
let riding = false

// --- Others ---
const presence = new Presence(new BroadcastTransport(), { id: me.id })
const others = new Map()
// Social rez: you see others at the rez they share with you. Sharing
// (on by default) reaches people within SHARE_RADIUS; anyone not sharing,
// or too far away, is a guest to you, whatever they've earned.
const SHARE_RADIUS = 12
let sharing = true
try { sharing = localStorage.getItem('exo.cafe/share-rez') !== 'off' } catch { /* default on */ }
function tierFor(s, pos) {
  return s.shares && pos.distanceTo(new THREE.Vector3(...s.p)) <= SHARE_RADIUS ? s.tier : 0
}
presence.on('join', (m) => {
  const a = new Avatar({ hue: m.hue, name: m.name, tier: 0 })
  others.set(m.id, a)
  scenes[m.scene === 'abode' ? 1 : 0].add(a.group)
  a.group.position.fromArray(m.p)
})
presence.on('leave', (m) => {
  const a = others.get(m.id)
  if (!a) return
  a.group.removeFromParent()
  a.dispose()
  others.delete(m.id)
})
presence.on('say', (m) => others.get(m.id)?.say(m.text))

// --- HUD ---
$('handle').value = me.name
$('name').textContent = me.name
$('manifesto').textContent = MANIFESTO
$('mist').innerHTML = MIST.map((l) => `<li>${l}</li>`).join('')
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.open).hidden = false }))
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.close).hidden = true }))
$('enter').addEventListener('click', enter)
$('handle').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter() })
if (params.has('enter')) enter()

function enter() {
  if (entered) return
  entered = true
  const name = $('handle').value.trim().slice(0, 24) || me.name
  me.name = name
  saveSelf(me)
  avatar.setName(name)
  $('name').textContent = name
  $('intro').hidden = true
  avatar.showAllocation(true)
  const al = allocation(avatar.tier)
  avatar.say(al.smooth ? 'REZ: smooth' : `ALLOC ${al.label} · ${al.voxels} voxels`, 3)
  setTimeout(() => avatar.showAllocation(false), 2200)
  setTimeout(() => { $('hint').style.opacity = '0' }, 12000)
}

// A POS terminal per stool: up while someone sits there or has a drink open.
const terminals = makeTerminals(bar, barLife.DRINKS)

// First or third person, remembered separately for sitting and walking.
const view = { seated: 'first', walking: 'third' }
try { Object.assign(view, JSON.parse(localStorage.getItem('exo.cafe/view'))) } catch { /* defaults */ }
const viewKey = () => (barLife.seat !== null ? 'seated' : 'walking')
function setView(mode) {
  view[viewKey()] = mode
  try { localStorage.setItem('exo.cafe/view', JSON.stringify(view)) } catch { /* fine */ }
  if (mode === 'third') controls.dist = Math.max(controls.dist, barLife.seat !== null ? 3 : 5)
  $('viewmode').textContent = mode === 'first' ? 'View · 1st' : 'View · 3rd'
  $('viewmode').setAttribute('aria-pressed', String(mode === 'first'))
}
$('viewmode').addEventListener('click', () => setView(view[viewKey()] === 'first' ? 'third' : 'first'))
// Scrolling out of first person goes to third; all the way in comes back.
controls.onZoom = (f) => {
  const k = viewKey()
  if (view[k] === 'first') { if (f > 1) setView('third'); return false }
  if (f < 1 && controls.dist <= controls.minDist * 1.05) { setView('first'); return false }
}
setView(view[viewKey()])

// The Mist: a dashboard, and $ coins on the things you can give to.
const mistPanel = makeMistPanel(mist, $('mist'))
$('mist-open').addEventListener('click', () => toggleMist())
$('mist').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) toggleMist(false) })
function toggleMist(open = $('mist').hidden) {
  $('mist').hidden = !open
  $('mist-open').setAttribute('aria-expanded', String(open))
  if (open) mistPanel.render()
}
// Chip tokens: tap one to donate cycles to that job.
const coins = [makeChipToken('life'), makeChipToken('show', '#e35bde'), makeChipToken('max', '#ff7a5c')]
coins[0].position.set(3.1, 6.9, -6.75) // beside the Life wall's top corner, clear of its caption
bar.group.add(coins[0])
coins[1].position.set(0, 4.1, 0) // over the car's arch
car.group.children[0].add(coins[1])
coins[2].position.set(1.1, 2.6, -5.4) // at Max's shoulder
bar.group.add(coins[2])
const coinY = coins.map((c) => c.position.y)
function give(id) {
  if (mist.budget === 0) {
    mist.setBudget(0.25)
    note('Gift budget set to 25% of a core; change it in Mist $.')
  }
  const state = mist.give(id)
  const s = mist.get(id)
  if (state === 'queued') note(`${s.name}: queued, no free slot. Take a donation back from another job in Mist.`)
  else note(`Donating ${Math.round(s.core.donated * 100)}% of a core to ${s.name} (${s.gifts} token${s.gifts > 1 ? 's' : ''}).`)
  if (id === 'max') maxSays(pick(MAX.donate))
  mistPanel.render()
}

$('share').setAttribute('aria-pressed', String(sharing))
$('share').addEventListener('click', () => {
  sharing = !sharing
  $('share').setAttribute('aria-pressed', String(sharing))
  try { localStorage.setItem('exo.cafe/share-rez', sharing ? 'on' : 'off') } catch { /* fine */ }
  note(sharing
    ? `People within ${SHARE_RADIUS} m see you at your rez.`
    : 'Nobody sees your rez now: to everyone else you\'re a guest in voxels.')
})

$('cam').addEventListener('click', () => {
  const show = $('selfie').hidden
  $('selfie').hidden = !show
  $('cam').setAttribute('aria-pressed', String(show))
})

$('mirror').addEventListener('click', async () => {
  const btn = $('mirror')
  if (face.running) {
    face.stop()
    avatar.face = null
    $('selfie').hidden = true
    $('cam').hidden = true
    $('cam').setAttribute('aria-pressed', 'false')
    btn.setAttribute('aria-pressed', 'false')
    return
  }
  btn.disabled = true
  note('Loading the face tracker… the video stays in your browser.')
  try {
    const video = await face.start()
    const selfie = $('selfie')
    selfie.srcObject = video.srcObject
    selfie.play().catch(() => {})
    // No preview by default, for immersion: a CAM light says it's on, and
    // shows the video when clicked.
    $('cam').hidden = false
    btn.setAttribute('aria-pressed', 'true')
    note('Mirroring your face.')
    maxSays(pick(MAX.face))
  } catch (err) {
    note(`No face tracking: ${err.message ?? err}`)
    face.stop()
  } finally {
    btn.disabled = false
  }
})

$('chat').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('say').value.trim()
  if (!text) return
  $('say').value = ''
  $('say').blur()
  avatar.say(text)
  presence.say(text)
  // At a stool, Max listens: orders, the menu, or conversation.
  if (barLife.hear(text, clock.elapsedTime)) return
  if (/\bmax\b|drink|bar|hello|hi\b/i.test(text)) setTimeout(() => maxSays(pick(MAX.thoughts)), 1200)
})
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return
  if (e.key === 'Enter' && entered) { e.preventDefault(); $('say').focus() }
  if (e.code === 'KeyE') interact()
  if (e.code === 'KeyV' && entered) setView(view[viewKey()] === 'first' ? 'third' : 'first')
  // 1–4 on a stool orders from the terminal's menu.
  if (barLife.seat !== null && /^Digit[1-9]$/.test(e.code)) {
    const d = barLife.DRINKS[Number(e.code.slice(5)) - 1]
    if (d) barLife.order(d.id)
  }
  jukebox.key(e) // J play/pause, N next, M mute
  if (e.key === 'Escape') { $('menu').hidden = true }
})

function note(text) { $('note').textContent = text }
function pick(a) { return a[Math.floor(Math.random() * a.length)] }
let lastMax = 0
let captionTimer = 0
function maxSays(text) {
  bar.max.say(text, 8)
  lastMax = performance.now()
  // On a stool, in first person, his bubble is above the frame: subtitle it.
  if (barLife?.seat == null) return
  const c = $('caption')
  c.innerHTML = '<b>MAX PABLO</b> '
  c.append(text)
  c.hidden = false
  clearTimeout(captionTimer)
  captionTimer = setTimeout(() => { c.hidden = true }, 9000)
}

/** E: the nearest thing that does something. */
function interact() {
  if (!entered) return
  if (riding) { alight(); return }
  if (side !== 0) return
  if (barLife.seat !== null) { standUp(); return }
  const p = avatar.group.position
  const free = barLife.freeSeatNear(p, takenSeats())
  if (free >= 0) { sitDown(free); return }
  if (p.distanceTo(car.group.position) < 4.5) { board(); return }
  if (gate.near) { openNetMap(); return }
  if (p.distanceTo(bar.max.group.position) < 7) give('max')
}
/** Remote visitors sitting at the bar. */
function seatedOthers() {
  const out = []
  for (const [, peer] of presence.peers) if (peer.state.scene === 'world' && peer.state.seat != null) out.push({ seat: peer.state.seat, name: peer.state.name })
  return out
}
/** Stools other visitors are on. */
function takenSeats() {
  const t = new Set()
  for (const [, peer] of presence.peers) if (peer.state.scene === 'world' && peer.state.seat != null) t.add(peer.state.seat)
  return t
}
let standDist = 6
function sitDown(i) {
  barLife.sit(i)
  heading = Math.PI // facing the counter
  standDist = controls.dist
  controls.minDist = 2.2
  controls.dist = 3
  controls.yaw = 0
  controls.pitch = 0.08
  setView(view.seated)
  note('Seated. Look around with the mouse; order on the terminal (or press 1–4), or just ask Max. Click your glass to drink. E to stand.')
}
function standUp() {
  const s = bar.seats[barLife.seat]
  barLife.stand()
  avatar.group.position.set(s.x, 0.08, s.z + 1)
  controls.dist = Math.max(standDist, 4)
  controls.pitch = 0.3
  $('caption').hidden = true
  setView(view.walking)
}
function board() {
  riding = true
  note('Aboard the Art Car. It drives as fast as its 6502 runs: give it cycles ($) to speed up. E to get off.')
}
function alight() {
  riding = false
  const p = avatar.group.position
  p.add(new THREE.Vector3(2.4, 0, 0).applyQuaternion(car.group.quaternion))
  p.y = 0.08
}

function openNetMap() {
  note('Jacking into NetMap in a new tab…')
  open(NETMAP, '_blank', 'noopener')
}

// Clicking a Life cell pokes the 6502's RAM.
const ray = new THREE.Raycaster()
controls.onClick = (e) => {
  if (side !== 0 || !entered) return
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  // Your stool's terminal: a tap on a menu row orders it. Your glass: a sip.
  if (barLife.seat !== null) {
    const glass = barLife.glassAt(barLife.seat)
    if (glass && ray.intersectObject(glass, true)[0]) {
      if (!barLife.sip(clock.elapsedTime) && barLife.level(barLife.seat) <= 0) note('Empty. Order another on the terminal.')
      return
    }
    const t = ray.intersectObject(terminals.terminals[barLife.seat].screen)[0]
    const d = terminals.drinkAt(t)
    if (d) { barLife.order(d.id); return }
  }
  const hit = ray.intersectObjects(coins, true)[0]
  if (hit) {
    let o = hit.object
    while (o && !o.userData.job) o = o.parent
    if (o) { give(o.userData.job); return }
  }
  const cellHit = ray.intersectObject(bar.life)[0]
  if (cellHit?.instanceId == null) return
  const cell = cellHit.instanceId
  const value = bar.isAlive(cell) ? 0 : 1
  // Both pages, so the poke survives the board swap.
  worker.postMessage({ type: 'poke', job: 'life', addrs: [BOARD.a + cell, BOARD.b + cell], value })
  note(`Poked $${(BOARD.a + cell).toString(16).toUpperCase()} = ${value}`)
}

// A handle for tests and the console: ?debug
if (params.has('debug')) window.exo = { get clock() { return clock }, terminals, setView, barLife, sitDown, standUp, others, mist, vcpu, worker, car, life, show, mind, face, give, avatar, controls, bar, floor, abode, portal, camera, renderer, ledger, presence, chipFrame, cafe, get side() { return side }, get tick() { return tick } }
if (window.exo) window.exo.jukebox = jukebox

// --- Loop ---
const clock = new THREE.Clock()
let lastPublish = 0, lastHud = 0, greeted = false
let promptText = null, promptSince = 0
const prevPos = new THREE.Vector3()
const fwd = new THREE.Vector3(), right = new THREE.Vector3()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
})

// What being here costs the main thread, as a share of a core: the work
// of each frame over the time between frames.
let busy = 0, span = 0
renderer.setAnimationLoop(() => {
  const t0 = performance.now()
  frame()
  busy += performance.now() - t0
})
let lastFrameAt = performance.now()
setInterval(() => {
  const now = performance.now()
  span = now - lastFrameAt
  lastFrameAt = now
  mist.main = span ? Math.min(1, busy / span) : 0
  busy = 0
}, 2000)

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  const now = clock.elapsedTime
  wall.tick(dt)
  cafe.tick(dt)
  chipFrame.tick(dt)
  abodeFrame.tick(dt)

  // Walk, relative to where the camera looks. Faster when zoomed out:
  // you're flying over the die then, not strolling.
  const seatedNow = barLife.seat !== null
  const inp = entered && !riding && !seatedNow ? controls.input() : { x: 0, f: 0, run: false }
  fwd.set(-Math.sin(controls.yaw), 0, -Math.cos(controls.yaw))
  right.set(-fwd.z, 0, fwd.x)
  const speed = (inp.run ? 8 : 3.2) * Math.max(1, controls.dist / 25)
  const vel = fwd.clone().multiplyScalar(inp.f).addScaledVector(right, inp.x).multiplyScalar(speed)
  const pos = avatar.group.position
  prevPos.copy(pos)
  pos.addScaledVector(vel, dt)
  if (!seatedNow) collide(pos, side === 0 ? bar.colliders : abode.colliders)
  car.update(dt)
  if (seatedNow) {
    // Looking around from the stool: the head turns, the body follows a
    // little. The look follows the camera's: in first person it is the
    // camera; in third person, the camera's view, except when you come
    // round to the front (within 45°), where the avatar looks straight
    // ahead so you can see its face. A tracked neck adds its turn on top
    // (avatar.headTrack).
    const first = view.seated === 'first'
    const rel = wrapAngle(controls.yaw - (heading - Math.PI)) // 0: the camera behind, ±π: in front
    const w = first ? 1 : 1 - THREE.MathUtils.smoothstep(Math.abs(rel), Math.PI * 0.75 - 0.4, Math.PI * 0.75)
    avatar.look.yaw = THREE.MathUtils.clamp(rel, -1.3, 1.3) * w
    avatar.look.pitch = THREE.MathUtils.clamp(controls.pitch - (first ? 0.08 : 0.2), -0.5, 0.9) * w
  }
  const sitting = seatedOthers()
  barLife.update(dt, now, sitting)
  terminals.update(dt, (s) => barLife.terminal(s, sitting.find((o) => o.seat === s)?.name), { tab: barLife.tab, receipts: mist.mine }, now)
  if (riding) {
    car.group.updateMatrixWorld()
    car.deckPoint(pos)
    heading = car.group.rotation.y
  }
  const moving = vel.lengthSq() > 0.01
  if (moving) {
    const want = Math.atan2(vel.x, vel.z)
    heading += wrapAngle(want - heading) * (1 - Math.exp(-dt * 10))
  }
  avatar.group.rotation.y = heading

  // Through the arch? The link works in scene units: micrometres in the
  // street, metres in the abode, so it carries a real magnification
  // (~224,000×) along with its turn.
  const link = portal.crossing(side, prevPos.clone().multiplyScalar(unitOf(side)), pos.clone().multiplyScalar(unitOf(side)))
  if (link) {
    const q = new THREE.Quaternion()
    link.decompose(new THREE.Vector3(), q, new THREE.Vector3())
    pos.multiplyScalar(unitOf(side)).applyMatrix4(link)
    heading += new THREE.Euler().setFromQuaternion(q, 'YXZ').y
    controls.yaw += new THREE.Euler().setFromQuaternion(q, 'YXZ').y
    side = 1 - side
    pos.divideScalar(unitOf(side))
    pos.y = side === 0 ? 0.08 : 0
    scenes[side].add(avatar.group)
    renderPass.scene = scenes[side]
    note(side === 1 ? `Pablo's abode: time runs ${formatRate(abodeFrame.absoluteRate)}.` : 'Back in Exo Cafe.')
  }

  // The face, if mirrored.
  if (face.running) {
    face.poll()
    avatar.face = face.landmarks
    avatar.headAim.set(face.head.pitch, face.head.yaw, face.head.roll)
    avatar.headTrack = face.head
    avatar.armAim.L = face.arms.L
    avatar.armAim.R = face.arms.R
    avatar.handAim.L = face.hands.L
    avatar.handAim.R = face.hands.R
  } else {
    avatar.headAim.set(0, 0, 0)
    avatar.headTrack = null
    avatar.armAim.L = avatar.armAim.R = null
    avatar.handAim.L = avatar.handAim.R = null
  }
  if (avatar.tier !== ledger.tier) {
    avatar.setTier(ledger.tier)
    avatar.showAllocation(true)
    setTimeout(() => avatar.showAllocation(false), 1800)
    const al = allocation(ledger.tier)
    avatar.say(`REZ ${TIERS[ledger.tier].name}: ${al.label}`, 3)
  }
  avatar.update(dt, { speed: moving ? vel.length() : 0, time: now })

  // Inside the bar, hide the facades so the camera can see in.
  const inside = side === 0 && bar.contains(pos.x, pos.z)
  bar.exterior.visible = !inside
  floor.update(dt)
  bar.update(dt, floor, tick, now)
  jukebox.update(dt, side === 0 ? pos : null)
  abode.update(abodeFrame.time, now)
  gate.update(now, side === 0 ? pos : null)
  const nearCar = side === 0 && pos.distanceTo(car.group.position) < 4.5
  const nearSeat = side === 0 && !seatedNow && !riding && barLife.freeSeatNear(pos, takenSeats()) >= 0
  const prompt = riding ? 'E · step off the Art Car'
    : seatedNow ? (barLife.mine(barLife.seat) ? 'Click the glass to drink · E · stand up' : 'E · stand up') : nearSeat ? 'E · sit' : nearCar ? 'E · ride the Art Car' : gate.near ? 'E · jack into NetMap' : null
  // The prompt shows in the middle for a few seconds, then docks in the panel.
  if (prompt !== promptText) { promptText = prompt; promptSince = now }
  const centred = entered && prompt && now - promptSince < 3
  $('prompt').hidden = !centred
  if (prompt) $('prompt').textContent = prompt
  $('keyhint').hidden = !entered || !prompt || centred
  if (prompt) $('keyhint').textContent = prompt
  for (const c of coins) c.userData.setLit(mist.get(c.userData.job).state === 'donated')
  coins.forEach((c, i) => { c.position.y = coinY[i] + Math.sin(now * 2 + i) * 0.08; c.rotation.y = now })

  // Max: a hello when you first come near, then the odd remark.
  const nearMax = side === 0 && pos.distanceTo(bar.max.group.position) < 7
  if (entered && nearMax && !greeted) { greeted = true; maxSays(pick(MAX.greet)) }

  for (const [, a] of others) a.update(dt, { time: now })
  if (now - lastPublish > 0.1) {
    lastPublish = now
    presence.sweep()
    barLife.setRemote([...presence.peers.values()].filter((p) => p.state.scene === 'world' && p.state.drink)
      .map((p) => ({ ...p.state.drink, who: p.state.name })))
    for (const [id, p] of presence.peers) {
      const a = others.get(id)
      if (!a) continue
      const s = p.state
      const want = scenes[s.scene === 'abode' ? 1 : 0]
      if (a.group.parent !== want) want.add(a.group)
      a.group.position.lerp(new THREE.Vector3(...s.p), 0.5)
      a.group.rotation.y = s.yaw
      if (s.seat != null && !a.seated) a.sit()
      if (s.seat == null && a.seated) a.stand()
      if (s.look) { a.look.yaw = s.look[0]; a.look.pitch = s.look[1] }
      a.headAim.set(...s.head)
      a.armAim.L = s.arms?.[0] ?? null
      a.armAim.R = s.arms?.[1] ?? null
      a.handAim.L = s.hands?.[0]?.map((v) => v / 500) ?? null
      a.handAim.R = s.hands?.[1]?.map((v) => v / 500) ?? null
      const t = tierFor(s, avatar.group.position)
      if (a.tier !== t) a.setTier(t)
    }
    if (entered) {
      presence.publish({
        name: me.name, hue: me.hue, tier: avatar.tier, shares: sharing, scene: side ? 'abode' : 'world',
        p: pos.toArray(), yaw: heading, head: avatar.headAim.toArray().slice(0, 3),
        seat: barLife.seat, look: seatedNow ? [avatar.look.yaw, avatar.look.pitch] : null,
        drink: barLife.openDrink(),
        arms: [avatar.armAim.L, avatar.armAim.R],
        // Hands in 2 mm steps: 63 small integers each.
        hands: [avatar.handAim.L, avatar.handAim.R].map((h) => h && h.map((v) => Math.round(v * 500))),
      })
    }
  }
  if (now - lastHud > 0.25) { lastHud = now; hud() }

  // Camera: first person on a stool (until you zoom out); otherwise orbit
  // the avatar's head, out past the die when zoomed far.
  const unit = unitOf(side)
  const fpv = view[viewKey()] === 'first' && !riding
  if (fpv && !seatedNow && entered) heading = controls.yaw + Math.PI // walking in first person: face where you look
  avatar.parts.head.pivot.visible = !fpv
  // Your own forearm, a hand's breadth from your eyes while you drink,
  // would hide the glass: in first person the glass comes up on its own.
  const hold = avatar.sipHold(now)
  avatar.parts.armR.pivot.visible = avatar.parts.foreR.pivot.visible = !(fpv && hold.attach > 0.2)
  if (avatar.label) avatar.label.visible = !fpv
  if (fpv) {
    avatar.group.updateMatrixWorld(true)
    const eye = avatar.parts.head.pivot.localToWorld(new THREE.Vector3(0, 0.22, 0.14))
    // Drinking, you look down into the glass as it comes up.
    const yaw = controls.yaw, pitch = controls.pitch - 0.08 + hold.tilt * 0.45
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    camera.position.copy(eye)
    camera.lookAt(eye.clone().addScaledVector(dir, unit))
  } else {
    const target = pos.clone().add(new THREE.Vector3(0, seatedNow ? 1.2 : 1.5, 0))
    controls.place(camera, target)
    if (unit !== 1) {
      camera.position.multiplyScalar(unit)
      camera.lookAt(target.multiplyScalar(unit))
    }
  }
  camera.near = (fpv ? 0.02 : 0.05) * unit
  camera.far = Math.max(600, controls.dist * 4) * unit
  camera.updateProjectionMatrix()
  world.fog.density = (controls.dist > 60 ? 0.00008 : 0.0009) / BODY_UM

  portal.render(renderer, camera, side, now)
  composer.render(dt)
}

function hud() {
  const p = avatar.group.position
  let where
  if (side === 1) where = "Pablo's abode"
  else if (bar.contains(p.x, p.z)) where = 'Exo Cafe · NMI pad'
  else {
    const [cx, cy] = reproject([p.x, p.y, p.z], cafe, chipFrame)
    const hit = floor.probe(cx, cy)
    const layer = ['metal', 'diffusion', 'diode', 'ground', 'power', 'poly'][hit?.layer] ?? ''
    // Position on the die in real units, from its lower-left corner.
    const at = `${formatLength(cx * CHIP_UNIT_UM)}, ${formatLength(cy * CHIP_UNIT_UM)}`
    where = hit
      ? `${hit.name ? hit.name.toUpperCase() + ' St' : 'Node ' + hit.node} · ${layer} · ${at}`
      : cx > 0 && cx < 9000 && cy > 0 && cy < 10000 ? `The die · ${at}` : 'The Grid'
  }
  $('where').textContent = where
  if (tick) {
    $('chip').textContent = `${(chipHz / 2000).toFixed(2)} kHz (native 1 MHz)\nLife gen ${tick.gen} · cell ${tick.cursor} · ${(tick.regs.halfCycles / 2e6).toFixed(3)} M cycles`
    const r = life.receipts[0]
    bar.paintReadouts(tick, formatRate(chipFrame.absoluteRate), r?.donor ? `POWERED BY ${r.donor.toUpperCase()}` : 'SYSTEM')
  }
  // Space: you're ~8 µm tall on the die, 1.8 m in the abode. Time: each place's clock.
  const height = side === 0 ? formatLength(1.84 * BODY_UM) : '1.8 m'
  $('frames').textContent = `you ${height} tall · 1 unit = ${side === 0 ? '1 µm' : '1 m'} · die at ${DIE_GEO.lat}° N ${DIE_GEO.lon}° E\n` +
    `cafe ×1 · chip ${formatRate(chipFrame.absoluteRate)} · abode ${formatRate(abodeFrame.absoluteRate)}`
  $('tier').textContent = TIERS[avatar.tier].name
  $('rez').style.width = `${Math.round(ledger.progress * 100)}%`
  const al = allocation(avatar.tier)
  let near = 0
  for (const [, peer] of presence.peers) if (peer.state.scene === (side ? 'abode' : 'world') && avatar.group.position.distanceTo(new THREE.Vector3(...peer.state.p)) <= SHARE_RADIUS) near++
  const shared = sharing ? `shared with ${near} nearby` : 'not shared'
  $('alloc').textContent = al.smooth
    ? `Smooth body · full rez · ${shared}`
    : `Region ${al.label} · ${al.voxels} voxels · ${(ledger.credit / 2000).toFixed(1)}k cycles given · ${shared}`
}

// --- Helpers ---

function collide(p, boxes) {
  const r = 0.3
  for (const [x0, z0, x1, z1] of boxes) {
    const cx = THREE.MathUtils.clamp(p.x, x0, x1), cz = THREE.MathUtils.clamp(p.z, z0, z1)
    const dx = p.x - cx, dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) continue
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      p.x = cx + (dx / d) * r
      p.z = cz + (dz / d) * r
    } else {
      // Inside the box: out the nearest side.
      const opts = [[p.x - x0 + r, -1, 0], [x1 - p.x + r, 1, 0], [p.z - z0 + r, 0, -1], [z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0])
      p.x += opts[0][1] * opts[0][0]
      p.z += opts[0][2] * opts[0][0]
    }
  }
}

/** Scene units per body unit on a side: µm in the street, metres in the abode. */
function unitOf(sd) { return sd === 0 ? BODY_UM : 1 }

function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)) }

/** The Grid: an endless floor of lines under everything, centred on the camera. */
function makeGrid() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { color: { value: new THREE.Color(C.line) } },
    vertexShader: `varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vW;
      float lines(vec2 p, float s){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){
        float d = length(vW.xz - cameraPosition.xz);
        float a = lines(vW.xz, 10.0) * 0.5 + lines(vW.xz, 100.0) * 0.8;
        a *= exp(-d / max(${(400 * BODY_UM).toFixed(1)}, cameraPosition.y * 6.0));
        gl_FragColor = vec4(color * a, a);
      }`,
  }))
  m.rotation.x = -Math.PI / 2
  m.scale.setScalar(20000)
  m.renderOrder = -3
  return m
}

/** The gate to NetMap, on the street outside the door. */
function makeGate() {
  const group = new THREE.Group()
  group.position.set(9, 0, 22)
  group.rotation.y = -0.5
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: C.green, toneMapped: false }))
  ring.position.y = 2.7
  const inner = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: C.cyan, toneMapped: false }))
  inner.position.y = 2.7
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({
    map: neonTexture('NETMAP · JACK IN', { color: '#84f55c', font: FONT_MONO, size: 76, height: 160 }),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }))
  sign.position.y = 6.1
  group.add(ring, inner, sign)
  const g = { group, near: false }
  g.update = (t, p) => {
    inner.rotation.z = t * 0.8
    ring.rotation.y = Math.sin(t * 0.5) * 0.15
    g.near = !!p && p.distanceTo(group.position) < 4.5
  }
  return g
}

function loadSelf() {
  let s = null
  try { s = JSON.parse(localStorage.getItem('exo.cafe/self')) } catch { /* storage may be blocked */ }
  const hues = [C.cyan, C.magenta, C.yellow, C.green, C.lavender, C.amber]
  const id = crypto.randomUUID?.() ?? String(Math.random()).slice(2)
  return {
    id, // fresh each visit: two tabs are two bodies
    name: s?.name ?? `rez-${id.slice(0, 4).toUpperCase()}`,
    hue: s?.hue ?? hues[Math.floor(Math.random() * hues.length)],
  }
}

function saveSelf(s) {
  try { localStorage.setItem('exo.cafe/self', JSON.stringify({ name: s.name, hue: s.hue })) } catch { /* fine */ }
}

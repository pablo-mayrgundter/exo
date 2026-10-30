// Exo Cafe: boots the chip, builds the world, the bar and the abode, and
// runs the visitor's avatar through them.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { C } from './theme.js'
import { Frame, reproject, formatRate } from './cosmic/frames.js'
import { assemble } from './chip/asm.js'
import { source as lifeSource } from './chip/life.js'
import { makeChipFloor, CHIP_SCALE } from './world/chipfloor.js'
import { makeBar } from './world/bar.js'
import { makeAbode, ABODE_RATE } from './world/abode.js'
import { PortalPair } from './world/portal.js'
import { neonTexture, FONT_MONO } from './world/textures.js'
import { Avatar, TIERS } from './avatar/avatar.js'
import { FaceTracker } from './avatar/face.js'
import { Ledger, allocation } from './mist/ledger.js'
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
const cafe = new Frame('Exo Cafe', { parent: wall })
// Exo Cafe sits on the NMI pad, the top-left corner of the die.
const NMI_PAD = [413.5, 9612.5]
let chipHz = 0 // half-cycles per wall second, as measured
const chipFrame = new Frame('6502', {
  parent: cafe,
  scale: CHIP_SCALE,
  flipY: true,
  origin: [-NMI_PAD[0] * CHIP_SCALE, 0, NMI_PAD[1] * CHIP_SCALE],
  rate: () => chipHz / 2 / 1e6, // chip seconds per bar second, against its native 1 MHz
})
const abodeFrame = new Frame('Abode', { parent: wall, rate: ABODE_RATE })

// --- Scenes ---
const world = new THREE.Scene()
world.name = 'world'
world.background = new THREE.Color(C.void)
world.fog = new THREE.FogExp2(C.void, 0.0009)
world.add(makeGrid())

const data = await (await fetch(`${import.meta.env.BASE_URL}chip/6502.json`)).json()
const floor = makeChipFloor(data, chipFrame)
world.add(floor.group)
const bar = makeBar({ names: data.nodenames })
world.add(bar.group)
const gate = makeGate()
world.add(gate.group)
const abode = makeAbode()
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

// --- The chip, and the Mist ledger it pays into ---
const ledger = new Ledger()
const program = [...assemble(lifeSource).bytes]
const worker = new Worker(new URL('./chip/worker.js', import.meta.url), { type: 'module' })
let tick = null
worker.onmessage = (e) => {
  if (e.data.type !== 'tick') return
  tick = e.data
  // Smooth the measured rate a little; the slices jitter.
  const hz = tick.ran / (tick.wallMs / 1000)
  chipHz = chipHz ? chipHz * 0.8 + hz * 0.2 : hz
  tick.hz = chipHz
  floor.setLevels(tick.levels)
  ledger.update(tick.donated)
}
worker.postMessage({ type: 'init', data, program })
const GUEST_DUTY = 0.5, DONOR_DUTY = 0.95
worker.postMessage({ type: 'duty', value: GUEST_DUTY })

// --- You ---
const me = loadSelf()
const avatar = new Avatar({ hue: me.hue, name: me.name, tier: ledger.tier })
avatar.group.position.set(0, 0.08, 1)
avatar.group.rotation.y = Math.PI
world.add(avatar.group)
let heading = Math.PI // the avatar's facing, radians about +y; π faces -z (the counter)
const controls = new Controls(canvas)
controls.yaw = 0
const face = new FaceTracker()
let entered = false
let donating = false

// --- Others ---
const presence = new Presence(new BroadcastTransport(), { id: me.id })
const others = new Map()
presence.on('join', (m) => {
  const a = new Avatar({ hue: m.hue, name: m.name, tier: m.tier })
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

$('donate').addEventListener('click', () => {
  donating = !donating
  $('donate').setAttribute('aria-pressed', String(donating))
  worker.postMessage({ type: 'duty', value: donating ? DONOR_DUTY : GUEST_DUTY })
  note(donating
    ? 'Your CPU now runs the 6502 at 95% duty, up from 50%. Credit accrues toward rez.'
    : 'Back to the guest share of 50%.')
  if (donating) maxSays(pick(MAX.donate))
})

$('mirror').addEventListener('click', async () => {
  const btn = $('mirror')
  if (face.running) {
    face.stop()
    avatar.face = null
    $('selfie').hidden = true
    btn.setAttribute('aria-pressed', 'false')
    return
  }
  btn.disabled = true
  note('Loading the face tracker… the video stays in your browser.')
  try {
    const video = await face.start()
    const selfie = $('selfie')
    selfie.srcObject = video.srcObject
    selfie.hidden = false
    selfie.play().catch(() => {})
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
  if (/\bmax\b|drink|bar|hello|hi\b/i.test(text)) setTimeout(() => maxSays(pick(MAX.idle)), 1200)
})
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return
  if (e.key === 'Enter' && entered) { e.preventDefault(); $('say').focus() }
  if (e.code === 'KeyE' && gate.near) openNetMap()
  if (e.key === 'Escape') { $('menu').hidden = true }
})

function note(text) { $('note').textContent = text }
function pick(a) { return a[Math.floor(Math.random() * a.length)] }
let lastMax = 0
function maxSays(text) { bar.max.say(text, 8); lastMax = performance.now() }

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
  const hit = ray.intersectObject(bar.life)[0]
  if (hit?.instanceId == null) return
  const cell = hit.instanceId
  const value = bar.isAlive(cell) ? 0 : 1
  worker.postMessage({ type: 'poke', cell, value })
  note(`Poked $${(0x200 + cell).toString(16).toUpperCase()} = ${value}`)
}

// A handle for tests and the console: ?debug
if (params.has('debug')) window.exo = { avatar, controls, bar, floor, abode, portal, camera, renderer, ledger, presence, chipFrame, cafe, get side() { return side }, get tick() { return tick } }

// --- Loop ---
const clock = new THREE.Clock()
let lastPublish = 0, lastHud = 0, greeted = false
const prevPos = new THREE.Vector3()
const fwd = new THREE.Vector3(), right = new THREE.Vector3()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  const now = clock.elapsedTime
  wall.tick(dt)
  cafe.tick(dt)
  chipFrame.tick(dt)
  abodeFrame.tick(dt)

  // Walk, relative to where the camera looks. Faster when zoomed out:
  // you're flying over the die then, not strolling.
  const inp = entered ? controls.input() : { x: 0, f: 0, run: false }
  fwd.set(-Math.sin(controls.yaw), 0, -Math.cos(controls.yaw))
  right.set(-fwd.z, 0, fwd.x)
  const speed = (inp.run ? 8 : 3.2) * Math.max(1, controls.dist / 25)
  const vel = fwd.clone().multiplyScalar(inp.f).addScaledVector(right, inp.x).multiplyScalar(speed)
  const pos = avatar.group.position
  prevPos.copy(pos)
  pos.addScaledVector(vel, dt)
  collide(pos, side === 0 ? bar.colliders : abode.colliders)
  const moving = vel.lengthSq() > 0.01
  if (moving) {
    const want = Math.atan2(vel.x, vel.z)
    heading += wrapAngle(want - heading) * (1 - Math.exp(-dt * 10))
  }
  avatar.group.rotation.y = heading

  // Through the arch?
  const link = portal.crossing(side, prevPos, pos)
  if (link) {
    const q = new THREE.Quaternion().setFromRotationMatrix(link)
    pos.applyMatrix4(link)
    heading += new THREE.Euler().setFromQuaternion(q, 'YXZ').y
    controls.yaw += new THREE.Euler().setFromQuaternion(q, 'YXZ').y
    side = 1 - side
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
  } else {
    avatar.headAim.set(0, 0, 0)
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
  abode.update(abodeFrame.time, now)
  gate.update(now, side === 0 ? pos : null)
  $('prompt').hidden = !gate.near
  $('prompt').textContent = 'E · jack into NetMap'

  // Max: a hello when you first come near, then the odd remark.
  const nearMax = side === 0 && pos.distanceTo(bar.max.group.position) < 7
  if (entered && nearMax && !greeted) { greeted = true; maxSays(pick(MAX.greet)) }
  if (entered && nearMax && performance.now() - lastMax > 22000) maxSays(pick(MAX.idle))

  for (const [, a] of others) a.update(dt, { time: now })
  if (now - lastPublish > 0.1) {
    lastPublish = now
    presence.sweep()
    for (const [id, p] of presence.peers) {
      const a = others.get(id)
      if (!a) continue
      const s = p.state
      const want = scenes[s.scene === 'abode' ? 1 : 0]
      if (a.group.parent !== want) want.add(a.group)
      a.group.position.lerp(new THREE.Vector3(...s.p), 0.5)
      a.group.rotation.y = s.yaw
      a.headAim.set(...s.head)
      if (a.tier !== s.tier) a.setTier(s.tier)
    }
    if (entered) {
      presence.publish({
        name: me.name, hue: me.hue, tier: avatar.tier, scene: side ? 'abode' : 'world',
        p: pos.toArray(), yaw: heading, head: avatar.headAim.toArray().slice(0, 3),
      })
    }
  }
  if (now - lastHud > 0.25) { lastHud = now; hud() }

  // Camera: orbit the avatar's head; out past the die when zoomed far.
  const target = pos.clone().add(new THREE.Vector3(0, 1.5, 0))
  controls.place(camera, target)
  camera.far = Math.max(600, controls.dist * 4)
  camera.updateProjectionMatrix()
  world.fog.density = controls.dist > 60 ? 0.00008 : 0.0009

  portal.render(renderer, camera, side, now)
  composer.render(dt)
})

function hud() {
  const p = avatar.group.position
  let where
  if (side === 1) where = "Pablo's abode"
  else if (bar.contains(p.x, p.z)) where = 'Exo Cafe · NMI pad'
  else {
    const [cx, cy] = reproject([p.x, p.y, p.z], cafe, chipFrame)
    const hit = floor.probe(cx, cy)
    const layer = ['metal', 'diffusion', 'diode', 'ground', 'power', 'poly'][hit?.layer] ?? ''
    where = hit
      ? `${hit.name ? hit.name.toUpperCase() + ' St' : 'Node ' + hit.node} · ${layer} · ${Math.round(cx)}, ${Math.round(cy)}`
      : cx > 0 && cx < 9000 && cy > 0 && cy < 10000 ? `The die · ${Math.round(cx)}, ${Math.round(cy)}` : 'The Grid'
  }
  $('where').textContent = where
  if (tick) {
    $('chip').textContent = `${(chipHz / 2000).toFixed(2)} kHz (native 1 MHz)\nLife gen ${tick.gen} · cell ${tick.cursor} · ${(tick.regs.halfCycles / 2e6).toFixed(3)} M cycles`
    bar.paintReadouts(tick, formatRate(chipFrame.absoluteRate))
  }
  $('frames').textContent = `cafe ×1 · chip ${formatRate(chipFrame.absoluteRate)} · abode ${formatRate(abodeFrame.absoluteRate)}`
  $('tier').textContent = TIERS[avatar.tier].name
  $('rez').style.width = `${Math.round(ledger.progress * 100)}%`
  const al = allocation(avatar.tier)
  $('alloc').textContent = al.smooth ? 'Smooth body · full rez' : `Region ${al.label} · ${al.voxels} voxels · ${(ledger.credit / 1000).toFixed(1)}k cycles given`
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
        a *= exp(-d / max(400.0, cameraPosition.y * 6.0));
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

// The jukebox: a Tron cabinet in the bar's north-west corner, playing
// 8-bit arrangements of public-domain classics and the house's own
// chiptunes on a four-voice APU (audio/apu.js). Its screen shows the
// track and a spectrum from an AnalyserNode; its neon follows the level.
// J plays and pauses, N skips, M mutes. Sound starts only on a keypress:
// browsers don't allow it before a gesture.
import * as THREE from 'three'
import { C } from '../theme.js'
import { textPanel, neonTexture, FONT_MONO, FONT_DISPLAY, whenFontsLoad } from './textures.js'
import { Player } from '../audio/player.js'

const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o })
const line = (color) => new THREE.LineBasicMaterial({ color, toneMapped: false })
const W = 1.5, D = 0.7, BODY = 1.6, R = W / 2 // cabinet: width, depth, body height, dome radius
const HUES = [C.cyan, C.magenta, C.amber, C.green, C.lavender, C.orange, C.yellow, 0xff3c8c].map((c) => new THREE.Color(c))

/**
 * @param {{audio?: Player, position?: [number, number], rotation?: number, note?: (text: string) => void}} [opts]
 *   position is [x, z] in the parent's space (the bar's), rotation about +y; the front faces +z.
 */
export function makeJukebox({ audio = new Player(), position = [0, 0], rotation = 0, note = () => {} } = {}) {
  const group = new THREE.Group()
  group.name = 'jukebox'
  group.position.set(position[0], 0.08, position[1])
  group.rotation.y = rotation

  // Cabinet: a dark box under a half-cylinder dome, outlined in neon.
  const bodyGeo = new THREE.BoxGeometry(W, BODY, D)
  const body = new THREE.Mesh(bodyGeo, basic({ color: C.panel }))
  body.position.y = BODY / 2
  const bodyEdge = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), line(C.magenta))
  bodyEdge.position.copy(body.position)
  const domeGeo = new THREE.CylinderGeometry(R, R, D, 32, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2)
  const dome = new THREE.Mesh(domeGeo, basic({ color: C.panel }))
  dome.position.y = BODY
  const domeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(domeGeo, 20), line(C.magenta))
  domeEdge.position.copy(dome.position)
  group.add(body, bodyEdge, dome, domeEdge)

  // Neon arches across the dome's face, and tubes up the front corners.
  const front = D / 2 + 0.02
  const arches = [R - 0.05, R - 0.2].map((r, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, i ? 0.02 : 0.035, 8, 40, Math.PI), basic({ color: i ? C.magenta : C.cyan }))
    m.position.set(0, BODY, front)
    group.add(m)
    return m
  })
  const tubes = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, BODY, 8), basic({ color: C.cyan }))
    m.position.set(s * (W / 2 - 0.05), BODY / 2, front)
    group.add(m)
    return m
  })

  // The record, turning under the dome: grooves and a label stripe.
  const record = new THREE.Group()
  record.position.set(0, BODY + 0.02, front - 0.01)
  for (const r of [0.14, 0.24, 0.32, 0.4]) record.add(new THREE.LineLoop(circle(r, 40), line(r < 0.2 ? C.amber : C.line)))
  record.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.4, 0, 0), new THREE.Vector3(-0.15, 0, 0), new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(0.4, 0, 0)]), line(C.amber)))
  group.add(record)

  // The screen: track, state and spectrum.
  const screen = textPanel({ width: 512, height: 288, bg: 'rgba(5,10,31,0.96)', border: '#e35bde' })
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.675), basic({ map: screen.tex }))
  screenMesh.position.set(0, 1.18, front)
  group.add(screenMesh)

  // Speaker grille: rings that swell with the level.
  const grille = new THREE.Group()
  grille.position.set(0, 0.4, front)
  const rings = [0.12, 0.2, 0.28].map((r) => {
    const l = new THREE.LineLoop(circle(r, 36), line(C.cyan))
    grille.add(l)
    return l
  })
  group.add(grille)

  // Track buttons: one per song, lit for the one playing.
  const buttons = audio.songs.map((_, i) => {
    const n = audio.songs.length
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.04), basic({ color: C.line }))
    b.position.set((i - (n - 1) / 2) * 0.15, 0.8, front)
    group.add(b)
    return b
  })

  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4),
    basic({ map: neonTexture('JUKEBOX', { color: '#e35bde', size: 150 }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sign.position.set(0, BODY + R + 0.3, 0)
  group.add(sign)

  // Bar-space collision box around the rotated footprint.
  const collider = footprint(position, rotation, W / 2 + 0.05, D / 2 + 0.05)

  let shown = 0 // smoothed level
  let hue = 0
  let paintAt = 0
  let elapsed = 0
  const bars = new Float32Array(24)

  const paint = () => screen.redraw((g, w, h) => {
    const song = audio.song
    const n = audio.songs.length
    g.fillStyle = '#e35bde'
    g.font = `22px ${FONT_DISPLAY}`
    g.fillText('EXO JUKEBOX', 22, 40)
    g.textAlign = 'right'
    g.fillStyle = '#8fa6d6'
    g.font = `22px ${FONT_MONO}`
    g.fillText(`${audio.track + 1}/${n}`, w - 22, 40)
    g.textAlign = 'left'
    g.fillStyle = '#e8f6ff'
    g.font = `30px ${FONT_MONO}`
    g.fillText(fit(g, song.title.toUpperCase(), w - 44), 22, 84)
    g.fillStyle = '#8fa6d6'
    g.font = `19px ${FONT_MONO}`
    g.fillText(fit(g, `${song.composer} · ${song.license}`, w - 44), 22, 112)
    // Spectrum: 24 bars over the low two thirds of the bins.
    const spec = audio.spectrum()
    const top = 128, bottom = 236, bw = (w - 44) / bars.length
    for (let i = 0; i < bars.length; i++) {
      let v = 0
      if (spec && audio.playing) {
        const a = Math.floor((i / bars.length) ** 1.6 * spec.length * 0.6), b = Math.max(a + 1, Math.floor(((i + 1) / bars.length) ** 1.6 * spec.length * 0.6))
        for (let k = a; k < b; k++) v = Math.max(v, spec[k])
        v /= 255
      }
      bars[i] = Math.max(v, bars[i] * 0.8)
      const bh = Math.max(2, bars[i] * (bottom - top))
      g.fillStyle = i < 8 ? '#6beaf2' : i < 16 ? '#b99bf5' : '#e35bde'
      g.fillRect(22 + i * bw + 2, bottom - bh, bw - 4, bh)
    }
    // Progress and state.
    const p = audio.ctx ? Math.min(1, audio.position / audio.duration) : 0
    g.fillStyle = '#1f5c8c'
    g.fillRect(22, 246, w - 44, 4)
    g.fillStyle = '#ff5a3c'
    g.fillRect(22, 246, (w - 44) * p, 4)
    g.font = `18px ${FONT_MONO}`
    g.fillStyle = audio.playing ? '#84f55c' : '#f5c842'
    const state = !audio.ctx ? 'PRESS J TO PLAY' : audio.playing ? (audio.muted ? 'MUTED' : 'PLAYING') : 'PAUSED'
    g.fillText(state, 22, 276)
    g.textAlign = 'right'
    g.fillStyle = '#8fa6d6'
    g.fillText('J play · N next · M mute', w - 22, 276)
    g.textAlign = 'left'
  })
  paint()
  whenFontsLoad(paint)

  audio.onChange = (what) => {
    paint()
    const s = audio.song
    if (what === 'track') note(`Jukebox: ${s.title}, ${s.composer} (${s.license}). N next, M mute.`)
    else if (what === 'play') note(`Jukebox: ${s.title}.`)
    else if (what === 'pause') note('Jukebox paused. J to play.')
    else if (what === 'mute') note(audio.muted ? 'Jukebox muted. M to unmute.' : 'Jukebox unmuted.')
  }

  const world = new THREE.Vector3(), worldScale = new THREE.Vector3()
  /** Distance on the floor from a world-space point, in the cabinet's own units (the bar's body units). */
  const across = (pos) => {
    group.getWorldPosition(world)
    return Math.hypot(pos.x - world.x, pos.z - world.z) / group.getWorldScale(worldScale).x
  }
  const jb = {
    group, collider, audio,
    toggle() { tryAudio(() => audio.toggle()) },
    next() { tryAudio(() => audio.next()) },
    mute() { audio.setMuted() },
    /** Handles J, N and M from a keydown event (or a KeyboardEvent code); true if the key was the jukebox's. */
    key(e) {
      if (typeof e === 'object' && (e.repeat || e.ctrlKey || e.metaKey || e.altKey)) return false
      const code = typeof e === 'object' ? e.code : e
      if (code === 'KeyJ') jb.toggle()
      else if (code === 'KeyN') jb.next()
      else if (code === 'KeyM') jb.mute()
      else return false
      return true
    },
    /** True within reach of the cabinet (`pos` in world space, `reach` in the bar's units). */
    near(pos, reach = 2.5) { return across(pos) < reach },
    /**
     * @param {number} dt
     * @param {THREE.Vector3 | null} [listener] the listener's world position, to fade
     *   the music with distance; null when they're elsewhere (the abode).
     */
    update(dt, listener) {
      elapsed += dt
      if (listener !== undefined) {
        let g = 0.08 // elsewhere (the abode): faintly, through the arch
        if (listener) {
          const d = across(listener)
          g = d < 11 ? 1 : 1 / (1 + ((d - 11) / 10) ** 2) // the whole bar, then fading down the street
        }
        audio.setSpace(g)
      }
      const level = Math.min(1, audio.level() * 4)
      shown += (level - shown) * (1 - Math.exp(-dt * (level > shown ? 30 : 6)))
      if (audio.playing) {
        record.rotation.z -= dt * 3.5
        hue += dt * (0.4 + shown * 2)
      }
      const c = new THREE.Color()
      const k = Math.floor(hue) % HUES.length
      c.copy(HUES[k]).lerp(HUES[(k + 1) % HUES.length], hue % 1)
      const glow = 0.45 + 0.55 * (audio.playing ? Math.max(shown, 0.3) : 0.25 + 0.15 * Math.sin(elapsed * 2))
      for (const t of tubes) t.material.color.copy(c).multiplyScalar(glow)
      arches[0].material.color.set(C.cyan).multiplyScalar(0.4 + 0.6 * shown)
      arches[1].material.color.set(C.magenta).multiplyScalar(0.5 + 0.5 * glow)
      rings.forEach((r, i) => r.scale.setScalar(1 + shown * (0.12 + i * 0.06)))
      buttons.forEach((b, i) => b.material.color.set(i === audio.track && audio.ctx ? C.orange : C.line))
      // The screen at ~15 frames a second while playing.
      paintAt -= dt
      if (audio.playing && paintAt <= 0) { paintAt = 1 / 15; paint() }
    },
    dispose() { audio.dispose() },
  }

  function tryAudio(fn) {
    try { fn() } catch (err) { note(`No sound: ${err.message ?? err}`) }
  }

  return jb
}

function circle(r, n) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)) }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

/** Axis-aligned [x0, z0, x1, z1] around a box of half-sizes hw × hd at [x, z], turned by `rot` about +y. */
function footprint([x, z], rot, hw, hd) {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot))
  const ex = hw * c + hd * s, ez = hw * s + hd * c
  return [x - ex, z - ez, x + ex, z + ez]
}

/** Trims text with an ellipsis to fit a width. */
function fit(g, text, width) {
  if (g.measureText(text).width <= width) return text
  while (text.length > 1 && g.measureText(text + '…').width > width) text = text.slice(0, -1)
  return text + '…'
}

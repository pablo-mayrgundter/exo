// Exo Cafe: a bar on the 6502's NMI pad. Its walls are circuit board, its
// light strips follow the data bus (db0–db7) and the address bus
// (ab0–ab15), the counter's edge pulses with clk0, and the wall behind the
// bar is the Life board in the chip's RAM, drawn as the CPU writes it.
//
// Bar space: metres, origin at the floor's centre, door on +z (toward the
// die's interior), the arch to the abode in the west wall (-x).
import * as THREE from 'three'
import { C } from '../theme.js'
import { pcbTexture, neonTexture, textPanel, FONT_MONO, FONT_DISPLAY, whenFontsLoad } from './textures.js'
import { MANIFESTO } from '../content.js'
import { Avatar } from '../avatar/avatar.js'
import { BOARD } from '../chip/life.js'

export const BAR = { w: 20, d: 14, h: 8, door: 3.2, doorH: 3.6, arch: 2.4, archH: 3.2 }

const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o })

export function makeBar({ names }) {
  const group = new THREE.Group()
  group.name = 'exo-cafe'
  const exterior = new THREE.Group()
  exterior.name = 'facade'
  group.add(exterior)
  const colliders = [] // [x0, z0, x1, z1] boxes in bar space
  const { w, d, h } = BAR
  const hw = w / 2, hd = d / 2

  // Floor: dark glass over the pad, with a grid.
  const floorTex = pcbTexture({ seed: 1975, bg: '#040920', trace: '#0f2f55', hot: '#1f5c8c', density: 0.6 })
  floorTex.repeat.set(w / 6, d / 6)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), basic({ map: floorTex }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.08
  group.add(floor)
  const grid = new THREE.GridHelper(w, w, C.line, 0x123a66)
  grid.scale.z = d / w
  grid.position.y = 0.09
  grid.material.transparent = true
  grid.material.opacity = 0.5
  group.add(grid)

  // Walls: inward faces inside, PCB facades outside. Each face is one-sided,
  // so from outside you see in through the inner faces, and the facades
  // are hidden while you're inside (main.js toggles `exterior`).
  const inner = pcbTexture({ seed: 6502, bg: '#050b22', trace: '#123d66', hot: '#6beaf2' })
  const outer = pcbTexture({ seed: 1977, bg: '#071028', trace: '#1f5c8c', hot: '#ff7a5c', density: 1.4 })
  const panel = (tex, x0, x1, y0, y1, place) => {
    const t = tex.clone()
    t.needsUpdate = true
    t.repeat.set((x1 - x0) / 5, (y1 - y0) / 5)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), basic({ map: t }))
    place(m, (x0 + x1) / 2, (y0 + y1) / 2)
    return m
  }
  // A wall along one side, with an optional opening [a, b) up to height oh.
  const wall = (side, opening) => {
    const len = side === 'n' || side === 's' ? w : d
    const half = len / 2
    const spans = opening
      ? [[-half, opening[0], 0, h], [opening[1], half, 0, h], [opening[0], opening[1], opening[2], h]]
      : [[-half, half, 0, h]]
    for (const [a, b, y0, y1] of spans) {
      for (const [tex, out] of [[inner, false], [outer, true]]) {
        const m = panel(tex, a, b, y0, y1, (m, u, v) => {
          m.position.y = v
          const e = out ? 0.15 : -0.15
          if (side === 'n') { m.position.set(u, v, -hd - e); m.rotation.y = out ? Math.PI : 0 }
          if (side === 's') { m.position.set(-u, v, hd + e); m.rotation.y = out ? 0 : Math.PI }
          if (side === 'w') { m.position.set(-hw - e, v, -u); m.rotation.y = out ? -Math.PI / 2 : Math.PI / 2 }
          if (side === 'e') { m.position.set(hw + e, v, u); m.rotation.y = out ? Math.PI / 2 : -Math.PI / 2 }
        })
        ;(out ? exterior : group).add(m)
      }
      if (y0 === 0) {
        const t = 0.3
        if (side === 'n') colliders.push([a, -hd - t, b, -hd + t])
        if (side === 's') colliders.push([-b, hd - t, -a, hd + t])
        if (side === 'w') colliders.push([-hw - t, -b, -hw + t, -a])
        if (side === 'e') colliders.push([hw - t, a, hw + t, b])
      }
    }
  }
  wall('n')
  wall('e')
  wall('s', [-BAR.door / 2, BAR.door / 2, BAR.doorH])
  wall('w', [-BAR.arch / 2, BAR.arch / 2, BAR.archH])
  const trim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.3, h, d + 0.3)),
    new THREE.LineBasicMaterial({ color: C.cyan, toneMapped: false }))
  trim.position.y = h / 2
  group.add(trim)

  // Door frame and the sign over it.
  const frame = (wd, ht) => {
    const s = new THREE.Shape()
    s.moveTo(-wd / 2, 0); s.lineTo(-wd / 2, ht); s.lineTo(wd / 2, ht); s.lineTo(wd / 2, 0)
    const pts = s.getPoints().map((p) => new THREE.Vector3(p.x, p.y, 0))
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C.orange, toneMapped: false }))
  }
  const door = frame(BAR.door, BAR.doorH)
  door.position.set(0, 0, hd + 0.16)
  group.add(door)
  const doorIn = door.clone()
  doorIn.position.z = hd - 0.16
  group.add(doorIn)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25),
    basic({ map: neonTexture('EXO CAFE', { color: '#ff5a3c' }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sign.position.set(0, BAR.doorH + 1.8, hd + 0.3)
  exterior.add(sign)
  const sub = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9),
    basic({ map: neonTexture('NMI PAD · CLOUD CITY 01', { color: '#6beaf2', font: FONT_MONO, size: 70, height: 128 }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  sub.position.set(0, BAR.doorH + 0.55, hd + 0.3)
  exterior.add(sub)

  // The counter: a long block whose top edge pulses with clk0.
  const counterGeo = new THREE.BoxGeometry(11, 1.05, 1.0)
  const counter = new THREE.Mesh(counterGeo, basic({ color: 0x0a1438 }))
  counter.position.set(0, 0.6, -3.9)
  group.add(counter)
  colliders.push([-5.5, -4.5, 5.5, -3.3])
  const clkEdge = new THREE.LineSegments(new THREE.EdgesGeometry(counterGeo), new THREE.LineBasicMaterial({ color: C.orange, toneMapped: false }))
  clkEdge.position.copy(counter.position)
  group.add(clkEdge)
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.06, 1.2), basic({ color: C.orange }))
  counterTop.position.set(0, 1.15, -3.9)
  group.add(counterTop)

  // Back bar: shelves of bottles in the site's palette.
  const bottleGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.38, 10)
  const palette = [C.cyan, C.magenta, C.yellow, C.green, C.lavender, C.orange, C.amber]
  const bottles = new THREE.InstancedMesh(bottleGeo, basic({ color: 0xffffff }), 3 * 40)
  let bi = 0
  const m4 = new THREE.Matrix4()
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.9 + shelf * 0.62
    const plank = new THREE.Mesh(new THREE.BoxGeometry(10, 0.04, 0.5), basic({ color: C.line }))
    plank.position.set(0, y - 0.21, -6.6)
    group.add(plank)
    for (let k = 0; k < 40; k++) {
      const x = -4.8 + k * 0.245
      bottles.setMatrixAt(bi, m4.makeTranslation(x, y, -6.6 + ((k * 7) % 3) * 0.08))
      bottles.setColorAt(bi, new THREE.Color(palette[(k * 5 + shelf * 3) % palette.length]).multiplyScalar(0.55 + ((k * 13) % 5) * 0.1))
      bi++
    }
  }
  group.add(bottles)
  colliders.push([-5.2, -7, 5.2, -6.2])

  // Stools and tables.
  const stoolGeo = new THREE.CylinderGeometry(0.28, 0.2, 0.08, 20)
  const ringMat = new THREE.LineBasicMaterial({ color: C.cyan, toneMapped: false })
  for (let k = 0; k < 7; k++) {
    const x = -4.5 + k * 1.5
    const seat = new THREE.Mesh(stoolGeo, basic({ color: 0x0a1438 }))
    seat.position.set(x, 0.78, -2.9)
    const ring = new THREE.LineLoop(circle(0.29, 24), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, 0.83, -2.9)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.74), basic({ color: C.line }))
    post.position.set(x, 0.4, -2.9)
    group.add(seat, ring, post)
  }
  for (const [x, z] of [[-6.2, 2.6], [6.2, 2.6], [-4, 5], [4, 5]]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 32), basic({ color: 0x0a1438 }))
    top.position.set(x, 1.02, z)
    const rim = new THREE.LineLoop(circle(0.76, 40), new THREE.LineBasicMaterial({ color: C.magenta, toneMapped: false }))
    rim.rotation.x = -Math.PI / 2
    rim.position.set(x, 1.05, z)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.25, 1.0, 12), basic({ color: C.line }))
    stem.position.set(x, 0.5, z)
    group.add(top, rim, stem)
    colliders.push([x - 0.7, z - 0.7, x + 0.7, z + 0.7])
  }

  // The data bus: eight vertical light tubes, four on each side wall. The
  // address bus: sixteen tubes across the ceiling. Their colours fade
  // between dusk (low) and their bit's colour (high) with each line's
  // average voltage.
  const strips = []
  const tube = (len) => new THREE.CylinderGeometry(0.06, 0.06, len, 8)
  const zs = [-6.1, -3.7, 3.7, 6.1]
  for (let b = 0; b < 8; b++) {
    const side = b < 4 ? 1 : -1
    const m = new THREE.Mesh(tube(6.4), basic({ color: 0xffffff }))
    m.position.set(side * (hw - 0.25), 4, zs[b % 4])
    group.add(m)
    strips.push({ mesh: m, node: names['db' + b], hi: new THREE.Color(C.cyan), lo: new THREE.Color(C.dusk) })
  }
  for (let b = 0; b < 16; b++) {
    const m = new THREE.Mesh(tube(w - 1), basic({ color: 0xffffff }))
    m.rotation.z = Math.PI / 2
    m.position.set(0, h - 0.35, -hd + 0.6 + b * ((d - 1.2) / 15))
    group.add(m)
    strips.push({ mesh: m, node: names['ab' + b], hi: new THREE.Color(b < 8 ? C.amber : C.magenta), lo: new THREE.Color(0x14082e) })
  }
  const clk = { node: names.clk0, top: counterTop, edge: clkEdge }

  // The Life wall: the board in the 6502's RAM, behind the bar.
  const N = BOARD.size
  const cell = 0.3
  const lifeGeo = new THREE.PlaneGeometry(cell * 0.86, cell * 0.86)
  const life = new THREE.InstancedMesh(lifeGeo, basic({ color: 0xffffff }), N * N)
  life.name = 'life-wall'
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = Math.floor(i / N)
    life.setMatrixAt(i, m4.makeTranslation((x - (N - 1) / 2) * cell, 7.35 - y * cell, -hd + 0.2))
    life.setColorAt(i, new THREE.Color(0x0c2a4a))
  }
  group.add(life)
  const lifeFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(N * cell + 0.2, N * cell + 0.2)),
    new THREE.LineBasicMaterial({ color: C.cyan, toneMapped: false }))
  lifeFrame.position.set(0, 7.35 - (N - 1) / 2 * cell, -hd + 0.19)
  group.add(lifeFrame)
  const lifeShown = new Float32Array(N * N)
  const lifeAlive = new Uint8Array(N * N)
  let lifeCursor = 0
  const lifeLabel = textPanel({ width: 1024, height: 96, bg: 'rgba(5,10,31,0)', border: 'rgba(0,0,0,0)' })
  const lifeLabelMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 0.45), basic({ map: lifeLabel.tex, transparent: true }))
  lifeLabelMesh.position.set(0, 7.35 - N * cell - 0.1, -hd + 0.2)
  group.add(lifeLabelMesh)

  // The manifesto, on the east wall: the original exo.cafe TODO.
  const scroll = textPanel({ width: 1400, height: 1100 })
  const manifesto = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4.4), basic({ map: scroll.tex }))
  manifesto.position.set(hw - 0.2, 3.5, 0)
  manifesto.rotation.y = -Math.PI / 2
  group.add(manifesto)
  const manifestoLines = MANIFESTO.split('\n')
  let scrollY = 0
  const paintManifesto = () => scroll.redraw((g, W, H) => {
    g.font = `40px ${FONT_DISPLAY}`
    g.fillStyle = '#6beaf2'
    g.fillText('EXO CAFE // TODO', 40, 70)
    g.font = `25px ${FONT_MONO}`
    g.fillStyle = '#cfe2ff'
    const lh = 31
    const visible = Math.floor((H - 130) / lh)
    const start = Math.floor(scrollY) % manifestoLines.length
    for (let i = 0; i < visible; i++) {
      const line = manifestoLines[(start + i) % manifestoLines.length]
      g.globalAlpha = i < 2 ? 0.35 + i * 0.3 : 1
      g.fillText(line, 40, 130 + i * lh)
    }
    g.globalAlpha = 1
  })
  paintManifesto()
  whenFontsLoad(paintManifesto)

  // CPU readout over the counter's east end.
  const cpu = textPanel({ width: 900, height: 300 })
  const cpuMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.0), basic({ map: cpu.tex }))
  cpuMesh.position.set(hw - 0.2, 6.6, 0)
  cpuMesh.rotation.y = -Math.PI / 2
  group.add(cpuMesh)

  // The arch to Pablo's abode, in the west wall: main.js puts the portal in it.
  const arch = frame(BAR.arch, BAR.archH)
  arch.position.set(-hw + 0.16, 0, 0)
  arch.rotation.y = Math.PI / 2
  arch.material = new THREE.LineBasicMaterial({ color: C.cyan, toneMapped: false })
  group.add(arch)
  const archSign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6),
    basic({ map: neonTexture('PABLO’S ABODE  ×600', { color: '#6beaf2', font: FONT_MONO, size: 64, height: 128 }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  archSign.position.set(-hw + 0.25, BAR.archH + 0.5, 0)
  archSign.rotation.y = Math.PI / 2
  group.add(archSign)
  const portalAnchor = new THREE.Object3D()
  portalAnchor.position.set(-hw + 0.02, BAR.archH / 2, 0)
  portalAnchor.rotation.y = Math.PI / 2 // its +z faces into the bar
  group.add(portalAnchor)

  // Max Pablo, behind the bar.
  const max = new Avatar({ hue: C.orange, name: 'MAX PABLO', tier: 3 })
  max.group.position.set(0, 0.08, -5.4)
  group.add(max.group)

  return {
    group, exterior, colliders, portalAnchor, max, life,
    /** True if a bar-space point is inside the walls. */
    contains(x, z) { return Math.abs(x) < hw && Math.abs(z) < hd },
    isAlive(i) { return lifeAlive[i] === 1 },
    /**
     * @param {number} dt
     * @param {{level: (n: number) => number}} chip the floor's displayed levels
     * @param {{board: Uint8Array, cursor: number, gen: number, regs: object, hz: number} | null} tick
     */
    update(dt, chip, tick, time) {
      const c = new THREE.Color()
      for (const s of strips) {
        c.copy(s.lo).lerp(s.hi, chip.level(s.node))
        s.mesh.material.color.copy(c)
      }
      const k = chip.level(clk.node)
      clk.top.material.color.set(C.orange).multiplyScalar(0.35 + 0.65 * k)
      clk.edge.material.color.set(C.amber).multiplyScalar(0.4 + 0.6 * k)
      if (tick) {
        for (let i = 0; i < N * N; i++) lifeAlive[i] = tick.board[i] ? 1 : 0
        lifeCursor = tick.cursor
      }
      const e = 1 - Math.exp(-dt * 6)
      for (let i = 0; i < N * N; i++) {
        lifeShown[i] += (lifeAlive[i] - lifeShown[i]) * e
        c.set(0x0c2a4a).lerp(new THREE.Color(C.cyan), lifeShown[i])
        if (i === lifeCursor) c.set(C.orange)
        life.setColorAt(i, c)
      }
      life.instanceColor.needsUpdate = true
      scrollY += dt * 0.6
      if (Math.floor(scrollY) !== Math.floor(scrollY - dt * 0.6)) paintManifesto()
      max.update(dt, { time })
    },
    /** Redraws the CPU readout and the Life caption (a few times a second). */
    paintReadouts(tick, chipRate, powered = '') {
      if (!tick) return
      const r = tick.regs
      const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0')
      cpu.redraw((g) => {
        g.font = `34px ${FONT_DISPLAY}`
        g.fillStyle = '#ff7a5c'
        g.fillText('MOS 6502 · REV D', 30, 62)
        g.font = `40px ${FONT_MONO}`
        g.fillStyle = '#e8f6ff'
        g.fillText(`PC ${hex(r.pc, 4)}  A ${hex(r.a)}  X ${hex(r.x)}  Y ${hex(r.y)}`, 30, 140)
        g.fillStyle = '#8fa6d6'
        g.fillText(`AB ${hex(r.ab, 4)}  DB ${hex(r.db)}  ${r.rw ? 'READ ' : 'WRITE'}`, 30, 200)
        g.fillStyle = '#6beaf2'
        g.fillText(`${(tick.hz / 2000).toFixed(1)} kHz  τ ${chipRate}`, 30, 260)
      })
      lifeLabel.redraw((g, W) => {
        g.font = `44px ${FONT_MONO}`
        g.fillStyle = '#6beaf2'
        g.textAlign = 'center'
        g.fillText(`LIFE · GEN ${tick.gen}${powered ? ' · ' + powered : ''}`, W / 2, 62)
        g.textAlign = 'left'
      })
    },
  }
}

function circle(r, n) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)) }
  return new THREE.BufferGeometry().setFromPoints(pts)
}

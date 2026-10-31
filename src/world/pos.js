// Point-of-sale terminals: one per stool, rising out of the counter when
// someone sits and sinking back when they leave. A terminal stays up while
// a drink in front of its stool is unfinished, so a tab left open keeps its
// spot at the bar.
//
// The screen is a canvas: the menu (tap a row to order), the glass in
// front of you, your tab, and the latest receipts the drinks paid for.
import * as THREE from 'three'
import { FONT_MONO, FONT_DISPLAY } from './textures.js'

const W = 512, H = 400
const ROW0 = 74, ROW_H = 44 // menu rows on the canvas

export function makeTerminals(bar, drinks) {
  const terminals = bar.seats.map((seat) => makeTerminal(bar, seat))
  return {
    terminals,
    /** All the screens, for raycasting taps. */
    get screens() { return terminals.map((t) => t.screen) },
    /**
     * @param {number} dt
     * @param {(seat: number) => ({up: boolean, mine: boolean, who?: string, glass?: {name: string, level: number}} )} stateOf
     * @param {{tab: object, receipts: object[]}} account this visitor's tab and recent receipts
     */
    update(dt, stateOf, account, time) {
      for (const t of terminals) {
        const s = stateOf(t.seat.index)
        t.target = s.up ? 1 : 0
        t.rise += (t.target - t.rise) * (1 - Math.exp(-dt * 4))
        t.group.visible = t.rise > 0.01
        if (!t.group.visible) continue
        t.group.position.y = 0.92 + t.rise * 0.26 // out of the counter top (1.15)
        t.mat.opacity = t.edgeMat.opacity = Math.min(1, t.rise * 1.4)
        if (time > t.paintAt || s.mine !== t.wasMine) {
          t.paintAt = time + 0.5
          t.wasMine = s.mine
          paint(t, s, account, drinks)
        }
      }
    },
    /** A tap on a screen: the drink of the menu row hit, or null. */
    drinkAt(hit) {
      if (!hit?.uv) return null
      const y = (1 - hit.uv.y) * H
      const row = Math.floor((y - ROW0) / ROW_H)
      return row >= 0 && row < drinks.length ? drinks[row] : null
    },
  }
}

function makeTerminal(bar, seat) {
  const group = new THREE.Group()
  // To the right of where the glass stands, turned toward the stool.
  group.position.set(seat.x + 0.32, 0.92, -3.6)
  group.rotation.y = -0.4
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.28), mat)
  screen.position.set(0, 0.17, 0)
  screen.rotation.x = -0.45 // tilted back toward a seated drinker
  screen.userData.seat = seat.index
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6beaf2, toneMapped: false, transparent: true })
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.38, 0.3, 0.02)), edgeMat)
  edge.position.copy(screen.position)
  edge.rotation.copy(screen.rotation)
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), new THREE.MeshBasicMaterial({ color: 0x0a1438, toneMapped: false }))
  stand.position.y = 0.06
  group.add(stand, screen, edge)
  group.visible = false
  bar.group.add(group)
  return { seat, group, screen, mat, edgeMat, g: cv.getContext('2d'), tex, rise: 0, target: 0, paintAt: 0, wasMine: null }
}

function paint(t, s, account, drinks) {
  const g = t.g
  g.clearRect(0, 0, W, H)
  g.fillStyle = 'rgba(5,10,31,0.94)'
  g.fillRect(0, 0, W, H)
  g.strokeStyle = '#1f5c8c'
  g.lineWidth = 4
  g.strokeRect(2, 2, W - 4, H - 4)
  g.font = `22px ${FONT_DISPLAY}`
  g.fillStyle = '#ff7a5c'
  g.fillText('EXO CAFE · POS', 18, 38)
  g.font = `17px ${FONT_MONO}`
  g.fillStyle = '#8fa6d6'
  g.textAlign = 'right'
  g.fillText(s.mine ? `STOOL ${t.seat.index + 1}` : s.who ? s.who.toUpperCase() : `STOOL ${t.seat.index + 1}`, W - 18, 38)
  g.textAlign = 'left'
  // The menu: a row each; tap one to order.
  drinks.forEach((d, i) => {
    const y = ROW0 + i * ROW_H
    const c = '#' + new THREE.Color(d.color).getHexString()
    g.fillStyle = 'rgba(255,255,255,0.04)'
    g.fillRect(14, y, W - 28, ROW_H - 6)
    g.fillStyle = c
    g.fillRect(14, y, 8, ROW_H - 6)
    g.font = `22px ${FONT_MONO}`
    g.fillText(`${i + 1}  ${d.name}`, 32, y + 27)
    g.font = `16px ${FONT_MONO}`
    g.fillStyle = '#8fa6d6'
    g.textAlign = 'right'
    g.fillText('100k cycles', W - 24, y + 26)
    g.textAlign = 'left'
  })
  let y = ROW0 + drinks.length * ROW_H + 16
  g.font = `18px ${FONT_MONO}`
  if (s.glass) {
    g.fillStyle = '#e8f6ff'
    g.fillText(`GLASS  ${s.glass.name}`, 18, y)
    g.fillStyle = '#1f5c8c'
    g.fillRect(300, y - 14, 190, 14)
    g.fillStyle = '#6beaf2'
    g.fillRect(300, y - 14, 190 * s.glass.level, 14)
    y += 28
  }
  if (s.mine) {
    g.fillStyle = '#e8f6ff'
    // Cycles paid, and what's drunk and not yet paid (half-cycles owed).
    const owed = account.tab.owed > 1 ? ` · ${Math.ceil(account.tab.owed / 2000)}k owed` : ' cycles'
    g.fillText(`TAB    ${account.tab.drinks} drink${account.tab.drinks === 1 ? '' : 's'} · ${Math.round(account.tab.cycles / 1000)}k paid${owed}`, 18, y)
    y += 26
    g.fillStyle = '#8fa6d6'
    g.font = `15px ${FONT_MONO}`
    for (const r of account.receipts.slice(0, 2)) {
      g.fillText(`✓ ${r.name} #${r.frame} · ${Math.round(r.share * 100)}% yours · ${r.output}`, 18, y)
      y += 20
    }
  }
  t.tex.needsUpdate = true
}

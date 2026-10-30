// Procedural canvas textures: the PCB the building is made of, neon signs,
// and text panels.
import * as THREE from 'three'

export const FONT_MONO = "'Share Tech Mono', ui-monospace, monospace"
export const FONT_DISPLAY = "'Michroma', 'Eurostile', 'Arial Black', sans-serif"
export const FONT_BODY = "'Chakra Petch', system-ui, sans-serif"

/** Seeded PRNG, so the building looks the same for everyone. */
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A tileable circuit board: Manhattan and 45° traces, vias, pads. */
export function pcbTexture({ size = 512, seed = 6502, bg = '#060d26', trace = '#1f5c8c', hot = '#6beaf2', density = 1 } = {}) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  g.fillStyle = bg
  g.fillRect(0, 0, size, size)
  const r = rng(seed)
  const step = size / 32
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  g.lineCap = 'round'
  for (let n = 0; n < 70 * density; n++) {
    let x = Math.floor(r() * 32) * step, y = Math.floor(r() * 32) * step
    let d = Math.floor(r() * 4) * 2
    const isHot = r() < 0.12
    g.strokeStyle = isHot ? hot : trace
    g.lineWidth = isHot ? 2 : 1 + Math.floor(r() * 2)
    g.globalAlpha = isHot ? 0.9 : 0.55 + r() * 0.3
    g.beginPath()
    g.moveTo(x, y)
    const len = 3 + Math.floor(r() * 10)
    for (let k = 0; k < len; k++) {
      const run = (1 + Math.floor(r() * 4)) * step
      // Draw with wraparound so the tile repeats.
      const nx = x + dirs[d][0] * run, ny = y + dirs[d][1] * run
      g.lineTo(nx, ny)
      x = nx; y = ny
      if (r() < 0.5) d = (d + (r() < 0.5 ? 1 : 7)) % 8
    }
    g.stroke()
    g.fillStyle = isHot ? hot : trace
    g.beginPath()
    g.arc(((x % size) + size) % size, ((y % size) + size) % size, isHot ? 3 : 2.2, 0, Math.PI * 2)
    g.fill()
  }
  // Pads: rows of little rectangles, like an IC's footprint.
  g.globalAlpha = 0.7
  for (let n = 0; n < 6 * density; n++) {
    const x = Math.floor(r() * 28) * step, y = Math.floor(r() * 28) * step
    const count = 4 + Math.floor(r() * 6)
    g.fillStyle = trace
    for (let k = 0; k < count; k++) g.fillRect(x + k * step * 0.6, y, step * 0.3, step * 0.8)
  }
  g.globalAlpha = 1
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** A neon sign: glowing text on transparent black, for additive planes. */
export function neonTexture(text, { color = '#6beaf2', font = FONT_DISPLAY, size = 120, width = 1024, height = 256 } = {}) {
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const g = cv.getContext('2d')
  const draw = () => {
    g.clearRect(0, 0, width, height)
    g.font = `${size}px ${font}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const [blur, alpha] of [[40, 0.6], [16, 0.8], [4, 1]]) {
      g.shadowColor = color
      g.shadowBlur = blur
      g.globalAlpha = alpha
      g.fillStyle = blur === 4 ? '#ffffff' : color
      g.fillText(text, width / 2, height / 2)
    }
    g.globalAlpha = 1
    tex.needsUpdate = true
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  draw()
  whenFontsLoad(draw)
  return tex
}

/** A panel of monospace text. Returns the texture and a redraw function. */
export function textPanel({ width = 1024, height = 768, bg = 'rgba(5,10,31,0.92)', border = '#1f5c8c' } = {}) {
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const g = cv.getContext('2d')
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  /** @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} paint */
  const redraw = (paint) => {
    g.clearRect(0, 0, width, height)
    g.fillStyle = bg
    g.fillRect(0, 0, width, height)
    g.strokeStyle = border
    g.lineWidth = 4
    g.strokeRect(2, 2, width - 4, height - 4)
    paint(g, width, height)
    tex.needsUpdate = true
  }
  return { tex, redraw, canvas: cv }
}

let fontsReady = null
export function whenFontsLoad(fn) {
  if (typeof document === 'undefined' || !document.fonts) return
  fontsReady ??= Promise.all([
    document.fonts.load(`20px ${FONT_MONO}`),
    document.fonts.load(`20px ${FONT_DISPLAY}`),
    document.fonts.load(`20px ${FONT_BODY}`),
  ]).catch(() => {})
  fontsReady.then(fn)
}

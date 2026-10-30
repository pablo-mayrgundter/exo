// Walking and looking. WASD or arrows move, Shift runs, drag looks, the
// wheel (or a pinch) zooms from over-the-shoulder out to orbit over the
// whole die. On touch screens, drag on the left half to walk and on the
// right half to look.
import * as THREE from 'three'

export class Controls {
  constructor(dom) {
    this.dom = dom
    this.keys = new Set()
    this.yaw = 0 // camera heading, radians; 0 looks toward -z
    this.pitch = 0.32
    this.dist = 6
    this.minDist = 2.2
    this.maxDist = 2600
    this.move = new THREE.Vector2() // touch joystick, -1..1
    this.dragged = false
    this.enabled = true
    /** Called with a pointer event when the pointer is released without dragging. */
    this.onClick = null

    addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return
      this.keys.add(e.code)
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())

    const pointers = new Map()
    let pinch = 0
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, walk: e.pointerType === 'touch' && e.clientX < innerWidth / 2 })
      this.dragged = false
      if (pointers.size === 2) pinch = spread(pointers)
    })
    dom.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) this.dragged = true
      if (pointers.size === 2) {
        const s = spread(pointers)
        if (pinch) this.zoom(pinch / s)
        pinch = s
        return
      }
      if (p.walk) {
        this.move.set(THREE.MathUtils.clamp((p.x - p.x0) / 60, -1, 1), THREE.MathUtils.clamp((p.y - p.y0) / 60, -1, 1))
      } else {
        this.yaw -= dx * 0.005
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.35, 1.55)
      }
    })
    const end = (e) => {
      const p = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      if (p?.walk) this.move.set(0, 0)
      if (pointers.size < 2) pinch = 0
      if (p && !this.dragged && this.onClick) this.onClick(e)
    }
    dom.addEventListener('pointerup', end)
    dom.addEventListener('pointercancel', end)
    dom.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.zoom(Math.exp(e.deltaY * 0.0015))
    }, { passive: false })
  }

  zoom(f) {
    this.dist = THREE.MathUtils.clamp(this.dist * f, this.minDist, this.maxDist)
    // Look further down as you rise, so zooming out ends over the die.
    if (this.dist > 40) this.pitch = Math.max(this.pitch, Math.min(1.45, 0.32 + Math.log(this.dist / 40) * 0.45))
  }

  /** The walk input in the camera's frame: [right, forward], each -1..1. */
  input() {
    const k = this.keys
    let x = this.move.x, f = -this.move.y
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
    const len = Math.hypot(x, f)
    if (len > 1) { x /= len; f /= len }
    return { x, f, run: k.has('ShiftLeft') || k.has('ShiftRight') }
  }

  /** Places a camera looking at `target` from the current orbit. */
  place(camera, target) {
    const cp = Math.cos(this.pitch)
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist)
    camera.position.copy(target).add(off)
    if (camera.position.y < 0.3) camera.position.y = 0.3
    camera.lookAt(target)
  }
}

function spread(pointers) {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isTyping(e) {
  const t = e.target
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

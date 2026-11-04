// A pair of linked doorways between two scenes. Each side's doorway shows
// the other scene, drawn straight into the frame inside the doorway's
// shape, from a virtual camera carried through the link (with an oblique
// near plane, so nothing behind the far doorway shows), and an avatar
// crossing a surface is carried to the other scene.
//
// The doorway is a stencil, not a texture (docs/PORTALS.md): before the
// scene the camera is in is drawn, its door's silhouette is marked in the
// stencil buffer, and inside it the other side is drawn as it would be
// around you, its in-place apps (the abode's sky, the map under the
// street) first, then its scene; then the door's own depth is written
// there, so the scene drawn after hides the door where it's in front of
// it and is hidden by it behind. No second full-screen target, no
// resample, and the other side composes exactly as it does once you're
// through. The rim's shimmer is the surface the scene itself draws.
//
// This is a same-page, same-engine portal. Linking separate apps, or a
// different engine, is what NetGL is for (pablo-mayrgundter/portal); see
// docs/PLAN.md, track T4.
import * as THREE from 'three'

const FLIP = new THREE.Matrix4().makeRotationY(Math.PI)
/** The doorway's depth, metres: none to speak of, and this much with the camera this close. */
const FLAT = 1e-4
const NEAR_DOOR = 0.15
/** The stencil value inside the doorway. */
export const DOOR_STENCIL = 1
const BLACK = new THREE.Color(0, 0, 0)

/** Stencil settings for a material drawn only inside the doorway (and writing no stencil). */
const inDoor = {
  stencilWrite: true, stencilWriteMask: 0, stencilRef: DOOR_STENCIL, stencilFunc: THREE.EqualStencilFunc,
  stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
}

export class PortalPair {
  /**
   * @param {{scene: THREE.Scene, anchor: THREE.Object3D}} a
   * @param {{scene: THREE.Scene, anchor: THREE.Object3D}} b
   * @param {{width: number, height: number}} size
   */
  constructor(a, b, { width, height }) {
    this.sides = [a, b]
    this.width = width
    this.height = height
    this.virtual = new THREE.PerspectiveCamera()
    this.virtual.matrixAutoUpdate = false
    /**
     * Draws what's under side i's scene through the door, into a target,
     * inside the door's stencil (DOOR_STENCIL): whether it drew (the
     * abode's sky, the map). `backdrops[i]` is the colour it goes over.
     */
    this.underlay = null
    this.backdrops = [null, null]
    const time = { value: 0 }
    // The door's silhouette into the stencil, whatever is in front of it:
    // the scene drawn after hides it there by depth.
    const mask = new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: DOOR_STENCIL, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    })
    // The door's depth inside it, its nearest face's.
    const depth = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, ...inDoor })
    // What the scene draws of the door: a shimmer at the rim, so the doorway
    // reads as a doorway, over the other side.
    const rim = new THREE.ShaderMaterial({
      uniforms: { time },
      transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      // Once a pixel, inside the door: the box's faces meet at its edges, and would add up there.
      stencilWrite: true, stencilRef: DOOR_STENCIL, stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.IncrementStencilOp,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; varying vec2 vUv;
        void main(){
          float e = min(min(vUv.x, 1.0 - vUv.x), 1.0 - vUv.y);
          float rim = exp(-e * 40.0) * (0.6 + 0.4 * sin(time * 3.0 + vUv.y * 20.0));
          gl_FragColor = vec4(vec3(0.42, 0.92, 0.95) * rim, 1.0);
        }`,
    })
    this.time = time
    for (const s of this.sides) {
      // A box behind the doorway's plane, flat (scale.z) until the camera
      // comes within its near plane's reach of the door: then the front face
      // is clipped, and the back one, a little way behind, still marks the
      // door (update).
      const box = new THREE.BoxGeometry(width, height, 1)
      box.translate(0, 0, -0.5)
      s.surface = new THREE.Mesh(box, rim)
      s.surface.scale.z = FLAT
      s.surface.name = 'portal-surface'
      s.surface.renderOrder = 1e6 // over the rest of what's transparent: it's the door's face
      s.anchor.add(s.surface)
      s.mask = new THREE.Mesh(box, mask)
      s.depth = new THREE.Mesh(box, depth)
      for (const m of [s.mask, s.depth]) { m.matrixAutoUpdate = false; m.frustumCulled = false }
    }
    // A full-screen quad at the far plane, inside the door: its depth
    // cleared, and with `colorWrite`, its colour filled (a scene's background).
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() } },
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, ...inDoor,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
    }))
    this.fill.frustumCulled = false
    this.stage = new THREE.Scene() // where the door's own meshes are drawn, one at a time
    this.stage.matrixWorldAutoUpdate = false
  }

  /** The transform carrying side i's space through to the other side's. */
  link(i) {
    const from = this.sides[i].anchor, to = this.sides[1 - i].anchor
    from.updateWorldMatrix(true, false)
    to.updateWorldMatrix(true, false)
    return to.matrixWorld.clone().multiply(FLIP).multiply(from.matrixWorld.clone().invert())
  }

  /** Each frame, before drawing: the rim's time, and the door's depth with the camera close to it (side i the camera's). */
  update(camera, i, time) {
    this.time.value = time
    const here = this.sides[i]
    // Close to the door (in its own units: metres), the surface gets depth.
    here.anchor.updateWorldMatrix(true, false)
    const local = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(here.anchor.matrixWorld.clone().invert())
    const close = local.z < NEAR_DOOR && Math.abs(local.x) < this.width / 2 + NEAR_DOOR && Math.abs(local.y) < this.height / 2 + NEAR_DOOR
    here.surface.scale.z = close ? NEAR_DOOR : FLAT
    here.surface.updateMatrixWorld(true)
  }

  /** The virtual camera side i's doorway shows the other side through, with its oblique near plane. */
  virtualCamera(camera, i) {
    camera.updateMatrixWorld()
    const there = this.sides[1 - i]
    const v = this.virtual
    // The link carries a scale (the abode's metres against the street's
    // micrometres). The camera there is unscaled, so its view-space
    // distances are that scene's own (its fog, its lights' falloff), and
    // the scale goes to the projection's depth (near and far, in e[14]),
    // which is all it changes there.
    const { matrixWorld, scale } = this.viewFrom(camera, i, true)
    v.matrixWorld.copy(matrixWorld)
    v.matrixWorldInverse.copy(v.matrixWorld).invert()
    v.projectionMatrix.copy(camera.projectionMatrix)
    v.projectionMatrix.elements[14] *= scale
    // Oblique near plane on the far doorway, facing out of it.
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(there.anchor.getWorldQuaternion(new THREE.Quaternion()))
    const p = there.anchor.getWorldPosition(new THREE.Vector3())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p).applyMatrix4(v.matrixWorldInverse)
    obliqueNear(v.projectionMatrix, new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant))
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert()
    return v
  }

  /**
   * Draws the other side through side i's doorway into `target` (bound,
   * holding what's under side i's scene, or cleared), before side i's scene
   * is drawn over it with no clear. Returns whether the door was in view.
   */
  drawThrough(renderer, camera, i, target) {
    // Skip when the doorway is out of view, behind the camera or edge-on:
    // the other side isn't drawn at all (and its apps aren't asked for).
    if (!this.visible(camera, i)) return false
    const here = this.sides[i], there = this.sides[1 - i]
    const v = this.virtualCamera(camera, i)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(target)
    here.surface.updateWorldMatrix(true, false)
    const draw = (mesh, cam) => {
      mesh.matrixWorld.copy(here.surface.matrixWorld)
      this.stage.add(mesh)
      renderer.render(this.stage, cam)
      this.stage.remove(mesh)
    }
    const fill = (color) => {
      const m = this.fill.material
      m.colorWrite = !!color
      if (color) m.uniforms.color.value.copy(color)
      this.stage.add(this.fill)
      renderer.render(this.stage, camera)
      this.stage.remove(this.fill)
    }
    try {
      // 1. The door's silhouette.
      draw(here.mask, camera)
      // 2. Inside it, the other side: its apps drawn in place (they test the
      // stencil themselves: inplace-guest.js), over its depth cleared, or its
      // background; then its scene, over their depth cleared, for the
      // doorway's camera, with every draw kept to the door.
      const bg = there.scene.background?.isColor ? there.scene.background : this.backdrops[1 - i]
      fill(bg ?? BLACK)
      const under = !!this.underlay?.(1 - i, target, v)
      renderer.setRenderTarget(target)
      if (under) fill(null)
      const stencil = renderer.state.buffers.stencil
      stencil.setTest(true)
      stencil.setFunc(THREE.EqualStencilFunc, DOOR_STENCIL, 0xff)
      stencil.setOp(THREE.KeepStencilOp, THREE.KeepStencilOp, THREE.KeepStencilOp)
      stencil.setMask(0)
      stencil.setLocked(true)
      // A colour background would have three clear the whole frame (it does
      // whatever autoClear says): it's been filled, inside the door.
      const background = there.scene.background
      there.scene.background = null
      there.surface.visible = false
      try { renderer.render(there.scene, v) } finally {
        there.scene.background = background
        there.surface.visible = true
        stencil.setLocked(false)
        stencil.setMask(0xff)
      }
      // 3. The door's own depth there, for the scene drawn next.
      fill(null)
      draw(here.depth, camera)
    } finally {
      renderer.autoClear = autoClear
    }
    return true
  }

  /** Whether side i's doorway is in the camera's view this frame, facing it: the other side will be drawn through it. */
  visible(camera, i) {
    const here = this.sides[i]
    const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(here.anchor.getWorldPosition(new THREE.Vector3()))
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(here.anchor.getWorldQuaternion(new THREE.Quaternion()))
    if (toCam.dot(normal) <= 0) return false
    camera.updateMatrixWorld()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    here.surface.updateWorldMatrix(true, false)
    return frustum.intersectsBox(new THREE.Box3().setFromObject(here.surface))
  }

  /**
   * The camera side i's doorway shows the other side through: its world
   * matrix there, and its projection (the camera's; render adds the oblique
   * near plane, which only changes depth).
   */
  viewFrom(camera, i, withScale = false) {
    camera.updateMatrixWorld()
    const m = this.link(i).clone().multiply(camera.matrixWorld)
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    m.decompose(p, q, s)
    const matrixWorld = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1))
    return withScale ? { matrixWorld, scale: s.x } : { matrixWorld, projectionMatrix: camera.projectionMatrix }
  }

  /**
   * If the segment prev→next (world points in side i's scene) passes through
   * side i's doorway, returns the link matrix to carry things across.
   */
  crossing(i, prev, next) {
    const a = this.sides[i].anchor
    const inv = a.matrixWorld.clone().invert()
    const p0 = prev.clone().applyMatrix4(inv), p1 = next.clone().applyMatrix4(inv)
    if (!(p0.z >= 0 && p1.z < 0)) return null
    const t = p0.z / (p0.z - p1.z)
    const x = p0.x + (p1.x - p0.x) * t, y = p0.y + (p1.y - p0.y) * t
    if (Math.abs(x) > this.width / 2 || y < -this.height / 2 - 2 || y > this.height / 2) return null
    return this.link(i)
  }
}

/** Lengyel's oblique near-plane clipping, in place on a projection matrix. */
function obliqueNear(proj, clip) {
  const e = proj.elements
  const q = new THREE.Vector4(
    (Math.sign(clip.x) + e[8]) / e[0],
    (Math.sign(clip.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14])
  clip.multiplyScalar(2 / clip.dot(q))
  e[2] = clip.x
  e[6] = clip.y
  e[10] = clip.z + 1
  e[14] = clip.w
}

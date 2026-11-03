// A pair of linked doorways between two scenes. Each side's surface shows
// the other scene, rendered from a virtual camera carried through the link
// (with an oblique near plane, so nothing behind the far doorway shows),
// and an avatar crossing a surface is carried to the other scene.
//
// This is a same-page, same-engine portal. Linking separate apps, or a
// different engine, is what NetGL is for (pablo-mayrgundter/portal); see
// docs/PLAN.md, track T4.
import * as THREE from 'three'

const FLIP = new THREE.Matrix4().makeRotationY(Math.PI)
/** The doorway's depth, metres: none to speak of, and this much with the camera this close. */
const FLAT = 1e-4
const NEAR_DOOR = 0.15

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
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType })
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace
    this.virtual = new THREE.PerspectiveCamera()
    this.virtual.matrixAutoUpdate = false
    for (const s of this.sides) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.target.texture }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 } },
        // Its picture is looked up by screen position, so any face of it
        // shows the right one: the box behind the plane (below) too.
        side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform vec2 res; uniform float time; varying vec2 vUv;
          void main(){
            vec3 c = texture2D(map, gl_FragCoord.xy / res).rgb;
            // A shimmer at the rim, so the doorway reads as a doorway.
            float e = min(min(vUv.x, 1.0 - vUv.x), 1.0 - vUv.y);
            float rim = exp(-e * 40.0) * (0.6 + 0.4 * sin(time * 3.0 + vUv.y * 20.0));
            gl_FragColor = vec4(c + vec3(0.42, 0.92, 0.95) * rim, 1.0);
          }`,
      })
      // A box behind the doorway's plane, flat (scale.z) until the camera
      // comes within its near plane's reach of the door: then the front face
      // is clipped, and the back one, a little way behind, still shows the
      // other side (render).
      const box = new THREE.BoxGeometry(width, height, 1)
      box.translate(0, 0, -0.5)
      s.surface = new THREE.Mesh(box, mat)
      s.surface.scale.z = FLAT
      s.surface.name = 'portal-surface'
      s.anchor.add(s.surface)
    }
  }

  /** The transform carrying side i's space through to the other side's. */
  link(i) {
    const from = this.sides[i].anchor, to = this.sides[1 - i].anchor
    from.updateWorldMatrix(true, false)
    to.updateWorldMatrix(true, false)
    return to.matrixWorld.clone().multiply(FLIP).multiply(from.matrixWorld.clone().invert())
  }

  /** Renders what side i's surface shows, before the main render. */
  render(renderer, camera, i, time) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y)
    const here = this.sides[i], there = this.sides[1 - i]
    here.surface.material.uniforms.res.value.copy(size)
    here.surface.material.uniforms.time.value = time
    // Skip when the doorway is out of view, behind the camera or edge-on:
    // the other side isn't drawn at all (and the abode's sky isn't asked for).
    if (!this.visible(camera, i)) return
    // Close to the door (in its own units: metres), the surface gets depth.
    here.anchor.updateWorldMatrix(true, false)
    const local = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(here.anchor.matrixWorld.clone().invert())
    const close = local.z < NEAR_DOOR && Math.abs(local.x) < this.width / 2 + NEAR_DOOR && Math.abs(local.y) < this.height / 2 + NEAR_DOOR
    here.surface.scale.z = close ? NEAR_DOOR : FLAT

    camera.updateMatrixWorld()
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

    there.surface.visible = false
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    // Something drawn first, under the scene (the abode's sky, in place):
    // the scene goes over it with its depth cleared, and no clear of colour.
    if (this.underlay?.(1 - i, this.target, v)) {
      renderer.clear(false, true, true)
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.render(there.scene, v)
      renderer.autoClear = autoClear
    } else {
      renderer.render(there.scene, v)
    }
    renderer.setRenderTarget(prev)
    there.surface.visible = true
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

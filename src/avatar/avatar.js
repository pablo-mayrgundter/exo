// Tron-suited avatars. One body definition, a few capsules and spheres per
// limb, builds two kinds of avatar:
//
//   - voxels: the body's signed distance sampled on a grid at the visitor's
//     rez (0.16 m for a guest: the minecrafty one), inside the bounding
//     region allocated at spawn;
//   - smooth: the same primitives as real geometry, for full rez.
//
// The visor shows a face drawn on a canvas, at a resolution that follows
// the rez too; face.js draws the visitor's own face there when the camera
// is on.
import * as THREE from 'three'
import { FONT_MONO } from '../world/textures.js'

/** Rez tiers: voxel size in metres; 0 means smooth geometry. */
export const TIERS = [
  { name: 'GUEST', voxel: 0.16, face: 16 },
  { name: 'RESIDENT', voxel: 0.08, face: 32 },
  { name: 'BUILDER', voxel: 0.04, face: 64 },
  { name: 'MIST', voxel: 0, face: 160 },
]

const cap = (a, b, r) => ({ kind: 'capsule', a, b, r })
const ARM_TMP = new THREE.Quaternion()
const HAND_W = new THREE.Vector3(), HAND_A = new THREE.Vector3(), HAND_B = new THREE.Vector3(), HAND_D = new THREE.Vector3()
const HAND_S = new THREE.Vector3(), HAND_Q = new THREE.Quaternion(), HAND_M = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0)
const ARM_V = new THREE.Vector3(), ARM_W = new THREE.Vector3()
const ball = (c, r) => ({ kind: 'sphere', a: c, r })

// Pivots in avatar space (metres, feet at the origin, facing +z); prims in
// the part's own space, relative to its pivot.
export const PARTS = {
  torso: { pivot: [0, 0.92, 0], prims: [cap([0, 0.06, 0], [0, 0.34, 0], 0.15), cap([-0.15, 0.42, 0], [0.15, 0.42, 0], 0.09)] },
  head: { pivot: [0, 1.44, 0], prims: [cap([0, 0, 0], [0, 0.08, 0], 0.05), ball([0, 0.2, 0], 0.125)] },
  // Arms in two: the upper arm from the shoulder, the forearm from the elbow.
  armL: { pivot: [0.25, 1.36, 0], prims: [cap([0.02, 0, 0], [0.035, -0.29, 0], 0.052)] },
  armR: { pivot: [-0.25, 1.36, 0], prims: [cap([-0.02, 0, 0], [-0.035, -0.29, 0], 0.052)] },
  foreL: { pivot: [0.285, 1.07, 0], prims: [cap([0, 0, 0], [0.015, -0.26, 0], 0.048)] },
  foreR: { pivot: [-0.285, 1.07, 0], prims: [cap([0, 0, 0], [-0.015, -0.26, 0], 0.048)] },
  legL: { pivot: [0.095, 0.94, 0], prims: [cap([0, -0.02, 0], [0, -0.86, 0.01], 0.072)] },
  legR: { pivot: [-0.095, 0.94, 0], prims: [cap([0, -0.02, 0], [0, -0.86, 0.01], 0.072)] },
}
// The elbow in the upper arm's space, the wrist in the forearm's, and the
// directions each points at rest.
const ELBOW = { L: new THREE.Vector3(0.035, -0.29, 0), R: new THREE.Vector3(-0.035, -0.29, 0) }
const ARM_END = { L: new THREE.Vector3(0.015, -0.26, 0), R: new THREE.Vector3(-0.015, -0.26, 0) }
const REST = { L: ELBOW.L.clone().normalize(), R: ELBOW.R.clone().normalize() }
const REST_FORE = { L: ARM_END.L.clone().normalize(), R: ARM_END.R.clone().normalize() }
const UPPER_LEN = ELBOW.L.length(), FORE_LEN = ARM_END.L.length()
export const ARM_LEN = UPPER_LEN + FORE_LEN
const SHOULDER = { L: new THREE.Vector3(...PARTS.armL.pivot), R: new THREE.Vector3(...PARTS.armR.pivot) }
// Which way elbows point when an arm bends: down, out and a little back.
const POLE = { L: new THREE.Vector3(0.55, -1, -0.45).normalize(), R: new THREE.Vector3(-0.55, -1, -0.45).normalize() }
const IK_D = new THREE.Vector3(), IK_P = new THREE.Vector3(), IK_E = new THREE.Vector3(), IK_T = new THREE.Vector3()
const FORE_TMP = new THREE.Quaternion(), BEND = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25)

/**
 * An arm's aim as the upper arm's and forearm's directions (body space).
 * It may be: a direction, [x, y, z], for the whole arm, nearly straight;
 * both directions, [upper x, y, z, fore x, y, z] (tracked, with the elbow
 * seen); or `{hand: [x, y, z]}`, where the wrist should be.
 */
function armDirections(side, aim, upper, fore) {
  if (aim.hand) return solveArm(side, IK_T.fromArray(aim.hand), upper, fore)
  if (aim.length >= 6) {
    upper.set(aim[0], aim[1], aim[2]).normalize()
    fore.set(aim[3], aim[4], aim[5]).normalize()
    return
  }
  IK_T.set(aim[0], aim[1], aim[2]).normalize().multiplyScalar(ARM_LEN * 0.96).add(SHOULDER[side])
  solveArm(side, IK_T, upper, fore)
}

/**
 * Two-bone IK: the upper arm's and the forearm's directions (body space,
 * unit) that put an arm's wrist at `hand`, the elbow bent toward `pole`.
 * Out of reach, the arm points straight at it.
 */
export function solveArm(side, hand, upper, fore, pole = POLE[side]) {
  const S = SHOULDER[side]
  const a = UPPER_LEN, b = FORE_LEN
  IK_D.subVectors(hand, S)
  const d = THREE.MathUtils.clamp(IK_D.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4)
  IK_D.normalize()
  const cosA = (a * a + d * d - b * b) / (2 * a * d)
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  IK_P.copy(pole).addScaledVector(IK_D, -pole.dot(IK_D))
  if (IK_P.lengthSq() < 1e-8) IK_P.set(0, -1, 0).addScaledVector(IK_D, IK_D.y).normalize()
  else IK_P.normalize()
  IK_E.copy(IK_D).multiplyScalar(a * cosA).addScaledVector(IK_P, a * sinA) // the elbow, from the shoulder
  upper.copy(IK_E).normalize()
  fore.copy(IK_D).multiplyScalar(d).sub(IK_E).normalize()
}
// A sip, in seconds from the click: reach for the glass, lift it, drink
// (the gulp), lower it, set it down, and back to how you were sitting.
export const SIP = { reach: 0.5, lift: 1.1, drink: 1.3, lower: 2.5, set: 3.1, end: 3.5 }
// The right wrist at the mouth: the glass in it, tipped, puts its rim to the lips.
const AT_MOUTH = new THREE.Vector3(-0.03, 1.5, 0.27)
// The wrist holding the glass is this far above its base.
export const GRIP = new THREE.Vector3(0.035, -0.07, 0.04) // on the palm's side
const SIP_V = new THREE.Vector3(), SIP_W = new THREE.Vector3()
const ramp = (t, a, b) => THREE.MathUtils.smoothstep(t, a, b)
// MediaPipe's hand skeleton: 21 landmarks, these bones between them.
const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]
// The bounding region a body is allocated at spawn, in metres.
export const BODY_BOX = { min: [-0.36, 0, -0.2], max: [0.36, 1.84, 0.2] }

const V = (a) => new THREE.Vector3(...a)

function sdf(prims, p) {
  let d = Infinity
  for (const q of prims) {
    if (q.kind === 'sphere') d = Math.min(d, p.distanceTo(V(q.a)) - q.r)
    else {
      const a = V(q.a), b = V(q.b)
      const ba = b.clone().sub(a)
      const h = THREE.MathUtils.clamp(p.clone().sub(a).dot(ba) / ba.lengthSq(), 0, 1)
      d = Math.min(d, p.distanceTo(a.add(ba.multiplyScalar(h))) - q.r)
    }
  }
  return d
}

function primGeometry(q) {
  if (q.kind === 'sphere') return new THREE.SphereGeometry(q.r, 24, 16).translate(...q.a)
  const a = V(q.a), b = V(q.b)
  const len = a.distanceTo(b)
  const g = new THREE.CapsuleGeometry(q.r, len, 8, 20)
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  g.applyMatrix4(m)
  g.translate(...a.add(b).multiplyScalar(0.5).toArray())
  return g
}

const BANDS = '0.07, 0.5, 0.94, 1.22, 1.38, 1.5'
function suitMaterial(hue, voxel) {
  return new THREE.ShaderMaterial({
    uniforms: { hue: { value: hue }, glow: { value: 1 }, pivot: { value: new THREE.Vector3() } },
    vertexShader: `
      uniform vec3 pivot;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          vRest = pivot + (instanceMatrix * p).xyz;
          p = instanceMatrix * p;
        #else
          vRest = pivot + position;
        #endif
        vLocal = position;
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 hue;
      uniform float glow;
      varying vec3 vRest;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        float bands = 0.0;
        float ys[6] = float[6](${BANDS});
        for (int i = 0; i < 6; i++) bands += exp(-pow((vRest.y - ys[i]) / ${voxel ? '0.03' : '0.008'}, 2.0));
        bands += exp(-pow(abs(vRest.x) / 0.006, 2.0)) * step(0.9, vRest.y) * step(vRest.y, 1.4);
        float rim = pow(1.0 - abs(dot(normalize(vN), vView)), 2.5);
        float edge = 0.0;
        ${voxel ? `
        vec3 q = abs(vLocal) / ${voxel.toFixed(4)} * 2.0;
        vec3 s = step(vec3(0.88), q);
        edge = clamp(s.x * s.y + s.y * s.z + s.x * s.z, 0.0, 1.0);
        rim *= 0.25;` : ''}
        vec3 base = vec3(0.025, 0.04, 0.11);
        vec3 c = base + hue * (min(bands, 1.0) * 1.1 + rim * 0.7 + edge * 0.45) * glow;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
}

/** Builds the visor canvas and its texture. */
function makeVisor(px) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = px < 100 ? THREE.NearestFilter : THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return { cv, g: cv.getContext('2d'), tex }
}

export class Avatar {
  /** @param {{hue?: THREE.ColorRepresentation, name?: string, tier?: number}} [o] */
  constructor(o = {}) {
    this.hue = new THREE.Color(o.hue ?? 0x6beaf2)
    this.name = o.name ?? ''
    this.group = new THREE.Group()
    this.body = new THREE.Group()
    this.group.add(this.body)
    this.parts = {}
    this.tier = -1
    this.phase = 0
    this.blink = 0
    this.headAim = new THREE.Euler()
    /** Tracked arm directions (avatar space, unit), or null to swing. */
    this.armAim = { L: null, R: null }
    /** Tracked hands: 21 points relative to the wrist (avatar space, 63 numbers), or null. */
    this.handAim = { L: null, R: null }
    /** Arm directions a controller wants (seated, tending bar); tracked arms win. */
    this.armPose = { L: null, R: null }
    /** Forward lean of the torso, radians (tending bar, propped on the counter). */
    this.lean = 0
    /** Where a seated avatar looks, relative to its seat: yaw (+ = its left), pitch (+ = down). */
    this.look = { yaw: 0, pitch: 0 }
    /** The tracked head ({yaw, pitch, roll}, from the camera), or null; seated, it adds to the look. */
    this.headTrack = null
    /** Set by sit(): the seated controller's state. */
    this.seated = null
    /** Face landmarks (normalized, mirrored) to draw on the visor, or null. */
    this.face = null
    /** How open the mouth is, 0..1 (from the voice's level), on the default visor. */
    this.mouth = 0
    this.mouthShown = 0
    this.spawn = 1
    this.alloc = null
    this.label = null
    this.bubble = null
    this.bubbleUntil = 0
    this.setTier(o.tier ?? 0)
    if (this.name) this.setName(this.name)
  }

  setTier(t) {
    if (t === this.tier) return
    this.tier = t
    const tier = TIERS[t]
    for (const p of Object.values(this.parts)) {
      this.body.remove(p.pivot)
      p.pivot.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.() })
    }
    this.parts = {}
    this.visor = makeVisor(tier.face)
    this.voxelCount = 0
    for (const [name, def] of Object.entries(PARTS)) {
      const pivot = new THREE.Group()
      pivot.position.set(...def.pivot)
      const mat = suitMaterial(this.hue, tier.voxel)
      mat.uniforms.pivot.value.set(...def.pivot)
      let mesh
      if (tier.voxel) {
        const cells = voxelize(def, tier.voxel)
        const box = new THREE.BoxGeometry(tier.voxel * 0.94, tier.voxel * 0.94, tier.voxel * 0.94)
        mesh = new THREE.InstancedMesh(box, mat, cells.length)
        const m = new THREE.Matrix4()
        cells.forEach((c, i) => mesh.setMatrixAt(i, m.makeTranslation(c[0], c[1], c[2])))
        mesh.userData.cells = cells
        this.voxelCount += cells.length
      } else {
        const geoms = def.prims.map(primGeometry)
        mesh = new THREE.Group()
        for (const g of geoms) mesh.add(new THREE.Mesh(g, mat))
      }
      pivot.add(mesh)
      this.body.add(pivot)
      this.parts[name] = { pivot, mesh, mat }
    }
    // The visor: in front of the head, sized to the head at this rez.
    const r = 0.125 + (tier.voxel ? tier.voxel * 0.6 : 0.004)
    // A shell over the front of the helmet, ±65° round and from brow to chin.
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 12, Math.PI / 2 - 1.15, 2.3, 0.62, 1.55),
      new THREE.MeshBasicMaterial({ map: this.visor.tex, toneMapped: false }))
    visor.position.set(0, 0.2, 0)
    this.parts.head.pivot.add(visor)
    // Hands: a light skeleton at each wrist, shown while tracked, at any rez.
    this.hands = {}
    for (const side of ['L', 'R']) {
      const mat = new THREE.MeshBasicMaterial({ color: this.hue.clone().multiplyScalar(1.4), toneMapped: false })
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), mat, HAND_BONES.length)
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), mat, 21)
      const g = new THREE.Group()
      g.add(bones, joints)
      g.visible = false
      bones.frustumCulled = joints.frustumCulled = false
      this.body.add(g)
      this.hands[side] = { group: g, bones, joints }
    }
    this.spawn = 0
  }

  setName(name) {
    this.name = name
    if (this.label) this.group.remove(this.label)
    this.label = textSprite(name, '#' + this.hue.getHexString(), 0.16)
    this.label.position.set(0, 2.08, 0)
    this.group.add(this.label)
  }

  say(text, seconds = 6) {
    if (this.bubble) this.group.remove(this.bubble)
    this.bubble = textSprite(text, '#e8f6ff', 0.13, 34)
    this.bubble.position.set(0, 2.42, 0)
    this.group.add(this.bubble)
    this.bubbleUntil = performance.now() + seconds * 1000
  }

  /** @param {number} dt @param {{speed?: number, time?: number}} s */
  update(dt, { speed = 0, time = performance.now() / 1000 } = {}) {
    this.phase += dt * (2 + speed * 2.2)
    const swing = Math.min(1, speed / 2) * 0.6
    const s = Math.sin(this.phase)
    const { armL, armR, legL, legR, head, torso } = this.parts
    legL.pivot.rotation.x = s * swing
    legR.pivot.rotation.x = -s * swing
    armL.pivot.rotation.set(-s * swing * 0.8, 0, 0.08)
    armR.pivot.rotation.set(s * swing * 0.8, 0, -0.08)
    this.body.rotation.set(0, 0, 0)
    this.body.position.set(0, 0, 0)
    torso.pivot.rotation.set(this.lean, 0, 0)
    if (this.seated) this.updateSeated(dt, time)
    // Tracked arms override the swing and any pose: aim the upper arm and
    // the forearm each from its rest direction; the forearm hangs from the elbow.
    const ka = 1 - Math.exp(-dt * 14)
    for (const side of ['L', 'R']) {
      const up = this.parts['arm' + side], fo = this.parts['fore' + side]
      const aim = this.armAim[side] ?? this.armPose[side]
      if (!aim) {
        up.aimed = fo.aimed = null
        fo.pivot.quaternion.copy(up.pivot.quaternion).multiply(BEND) // swinging, a little bent
      } else {
        armDirections(side, aim, ARM_V, ARM_W)
        up.aimed = (up.aimed ?? up.pivot.quaternion.clone()).slerp(ARM_TMP.setFromUnitVectors(REST[side], ARM_V), ka)
        fo.aimed = (fo.aimed ?? fo.pivot.quaternion.clone()).slerp(FORE_TMP.setFromUnitVectors(REST_FORE[side], ARM_W), ka)
        up.pivot.quaternion.copy(up.aimed)
        fo.pivot.quaternion.copy(fo.aimed)
      }
      fo.pivot.position.copy(ELBOW[side]).applyQuaternion(up.pivot.quaternion).add(up.pivot.position)
      this.poseHand(side, fo)
    }
    torso.pivot.position.y = PARTS.torso.pivot[1] + Math.abs(Math.cos(this.phase)) * swing * 0.04 + Math.sin(time * 1.7) * 0.004
    const k = 1 - Math.exp(-dt * (this.seated ? 6 : 12))
    head.pivot.rotation.x += (this.headAim.x - head.pivot.rotation.x) * k
    head.pivot.rotation.y += (this.headAim.y - head.pivot.rotation.y) * k
    head.pivot.rotation.z += (this.headAim.z - head.pivot.rotation.z) * k

    // Rezzing in: voxels appear bottom up; smooth bodies fade their glow in.
    if (this.spawn < 1) {
      this.spawn = Math.min(1, this.spawn + dt / 1.4)
      for (const p of Object.values(this.parts)) {
        if (p.mesh.isInstancedMesh) {
          p.mesh.count = Math.ceil(p.mesh.userData.cells.length * this.spawn)
        }
        p.mat.uniforms.glow.value = 0.3 + this.spawn * 0.7
      }
    }
    if (this.bubble && performance.now() > this.bubbleUntil) {
      this.group.remove(this.bubble)
      this.bubble = null
    }
    this.drawVisor(time)
  }

  /**
   * Sits on a seat: legs down to the footrest, and a seated controller for
   * the rest. Setting `seated.sip` to `{start, glass}` (a click on the
   * glass, at its world position) reaches for it and raises it to the mouth.
   */
  sit() {
    this.seated = {
      support: 'both', mode: 'both', nextMode: 0,
      shift: { lean: 0.12, x: 0, tilt: 0 }, want: { lean: 0.12, x: 0, tilt: 0 }, nextShift: 0,
      sip: null, lean: 0.12, x: 0, tilt: 0,
    }
  }

  stand() {
    this.seated = null
    this.armPose.L = this.armPose.R = null
  }

  /**
   * The seated pose. Looking turns the head, with the torso and hips
   * following a little; the arms prop the body on the counter: looking
   * right, the left elbow takes the weight, and looking left the right;
   * looking ahead it shifts between one, the other and both. Every so
   * often the body shifts its weight on its own.
   */
  updateSeated(dt, time) {
    const st = this.seated
    const { legL, legR, torso } = this.parts
    // The look, and the tracked neck on top: the body follows a little of
    // the neck's turn, the head all of it.
    const tr = this.headTrack
    const yaw = THREE.MathUtils.clamp(this.look.yaw + (tr ? tr.yaw * 0.3 : 0), -1.3, 1.3)
    legL.pivot.rotation.set(-0.62, 0, 0.14)
    legR.pivot.rotation.set(-0.62, 0, -0.14)
    // Which arm takes the weight.
    if (yaw < -0.35) st.support = 'L'
    else if (yaw > 0.35) st.support = 'R'
    else {
      if (time > st.nextMode) {
        st.mode = ['L', 'R', 'both'][Math.floor(Math.random() * 3)]
        st.nextMode = time + 6 + Math.random() * 6
      }
      st.support = st.mode
    }
    // Shifting weight now and then: lean, hips, a slight tilt.
    if (time > st.nextShift) {
      st.want = { lean: 0.06 + Math.random() * 0.16, x: (Math.random() - 0.5) * 0.06, tilt: (Math.random() - 0.5) * 0.08 }
      st.nextShift = time + 7 + Math.random() * 7
    }
    const e = 1 - Math.exp(-dt * 1.5)
    for (const key of ['lean', 'x', 'tilt']) st[key] += (st.want[key] - st[key]) * e
    // Hips 10% of the look, torso another 20%, the head the rest.
    this.body.rotation.set(0, yaw * 0.1, st.tilt)
    this.body.position.x = st.x
    torso.pivot.rotation.set(st.lean + (st.support === 'both' ? 0.08 : 0), yaw * 0.2, 0)
    const hold = this.sipHold(time)
    const headYaw = THREE.MathUtils.clamp(yaw * 0.7 + (tr ? tr.yaw * 0.7 : 0), -1.4, 1.4)
    // Drinking tips the head back a little.
    this.headAim.set(this.look.pitch + (tr?.pitch ?? 0) - hold.tilt * 0.3, headYaw, -st.tilt * 0.5 + (tr?.roll ?? 0))
    // Arms: on the counter, or resting; the right hand brings the drink up.
    const onCounter = { L: [0.1, -0.3, 0.95], R: [-0.1, -0.3, 0.95] }
    const resting = { L: [0.06, -0.85, 0.5], R: [-0.06, -0.85, 0.5] }
    for (const side of ['L', 'R']) {
      const props = st.support === 'both' || st.support === side
      this.armPose[side] = props ? onCounter[side] : resting[side]
    }
    if (st.sip) {
      const t = time - st.sip.start
      if (t > SIP.end) st.sip = null
      else this.armPose.R = this.sipArm(t)
    }
  }

  /** Where the right wrist is at `t` seconds into a sip, as an arm aim: `{hand}` in body space. */
  sipArm(t) {
    const st = this.seated
    // At the glass on the counter (its base below the wrist), at the mouth,
    // and where the arm was sitting.
    const reach = this.body.worldToLocal(SIP_V.copy(st.sip.glass)).sub(GRIP)
    const sit = SIP_W.fromArray(this.armPose.R).normalize().multiplyScalar(ARM_LEN * 0.96).add(SHOULDER.R)
    const out = new THREE.Vector3()
    if (t < SIP.reach) out.lerpVectors(sit, reach, ramp(t, 0, SIP.reach))
    else if (t < SIP.lift) out.lerpVectors(reach, AT_MOUTH, ramp(t, SIP.reach, SIP.lift))
    else if (t < SIP.lower) out.copy(AT_MOUTH)
    else if (t < SIP.set) out.lerpVectors(AT_MOUTH, reach, ramp(t, SIP.lower, SIP.set))
    else out.lerpVectors(reach, sit, ramp(t, SIP.set, SIP.end))
    return { hand: out.toArray() }
  }

  /**
   * How a sip holds the glass at `time`: `attach` 0 (on the counter) to 1
   * (in the hand), and `tilt`, how far it's tipped toward the mouth (radians).
   */
  sipHold(time) {
    const sip = this.seated?.sip
    if (!sip) return { attach: 0, tilt: 0 }
    const t = time - sip.start
    const attach = t < SIP.lift ? ramp(t, SIP.reach - 0.1, SIP.reach + 0.15) : 1 - ramp(t, SIP.set - 0.15, SIP.set + 0.1)
    const tilt = 1.0 * (ramp(t, SIP.lift - 0.1, SIP.drink) - ramp(t, SIP.lower - 0.4, SIP.lower))
    return { attach, tilt }
  }

  /** The wrist of an arm in world space, plus an offset in the body's frame. */
  hand(side, out = new THREE.Vector3(), offset = null) {
    const arm = this.parts['fore' + side].pivot
    out.copy(ARM_END[side]).applyQuaternion(arm.quaternion).add(arm.position)
    if (offset) out.add(offset)
    return this.body.localToWorld(out)
  }

  /** Places a hand's skeleton at its arm's wrist, from tracked points. */
  poseHand(side, arm) {
    const h = this.hands[side], pts = this.handAim[side]
    h.group.visible = !!pts
    if (!pts) return
    const wrist = HAND_W.copy(ARM_END[side]).applyQuaternion(arm.pivot.quaternion).add(arm.pivot.position)
    const P = (i, out) => out.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).add(wrist)
    for (let i = 0; i < 21; i++) h.joints.setMatrixAt(i, HAND_M.makeTranslation(P(i, HAND_A)))
    HAND_BONES.forEach(([a, b], k) => {
      P(a, HAND_A); P(b, HAND_B)
      const len = HAND_A.distanceTo(HAND_B) || 1e-4
      HAND_Q.setFromUnitVectors(UP, HAND_D.subVectors(HAND_B, HAND_A).normalize())
      HAND_M.compose(HAND_A.add(HAND_B).multiplyScalar(0.5), HAND_Q, HAND_S.set(1, len, 1))
      h.bones.setMatrixAt(k, HAND_M)
    })
    h.bones.instanceMatrix.needsUpdate = h.joints.instanceMatrix.needsUpdate = true
  }

  drawVisor(time) {
    const { g, cv, tex } = this.visor
    const w = cv.width
    const hue = '#' + this.hue.getHexString()
    g.fillStyle = '#020616'
    g.fillRect(0, 0, w, w)
    if (this.face) {
      drawFace(g, w, this.face, hue)
    } else {
      // The default visor: two eye slits that blink, and a mouth line.
      const blink = (time % 4.3) < 0.12 ? 0.15 : 1
      g.fillStyle = hue
      const eh = Math.max(1, w * 0.09 * blink)
      g.fillRect(w * 0.18, w * 0.38 - eh / 2, w * 0.24, eh)
      g.fillRect(w * 0.58, w * 0.38 - eh / 2, w * 0.24, eh)
      // The mouth: a line, opening as the voice gets louder (fast to open, slower to close).
      this.mouthShown += (this.mouth - this.mouthShown) * (this.mouth > this.mouthShown ? 0.6 : 0.25)
      const open = Math.min(1, this.mouthShown)
      const mh = Math.max(1, w * (0.04 + open * 0.16))
      g.globalAlpha = 0.6 + open * 0.4
      g.fillRect(w * (0.32 + open * 0.04), w * 0.7 - mh / 2 + w * 0.02, w * (0.36 - open * 0.08), mh)
      g.globalAlpha = 1
    }
    tex.needsUpdate = true
  }

  /** The allocated region, as a wireframe box. Shown while spawning. */
  showAllocation(on) {
    if (on && !this.alloc) {
      const [x0, y0, z0] = BODY_BOX.min, [x1, y1, z1] = BODY_BOX.max
      const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1))
      this.alloc = new THREE.Box3Helper(box, this.hue)
      this.group.add(this.alloc)
    } else if (!on && this.alloc) {
      this.group.remove(this.alloc)
      this.alloc = null
    }
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.() })
  }
}

/** Grid cells of a part's body, in part space, keeping only surface voxels. */
export function voxelize(def, s) {
  const pad = s
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const q of def.prims) {
    for (const p of [q.a, q.b ?? q.a]) {
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i] - q.r - pad); max[i] = Math.max(max[i], p[i] + q.r + pad) }
    }
  }
  // Snap to the avatar-space grid so neighbouring parts' voxels line up.
  const off = def.pivot
  const lo = min.map((v, i) => Math.floor((v + off[i]) / s))
  const hi = max.map((v, i) => Math.ceil((v + off[i]) / s))
  const solid = new Set()
  const key = (i, j, k) => `${i},${j},${k}`
  const p = new THREE.Vector3()
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
    p.set((i + 0.5) * s - off[0], (j + 0.5) * s - off[1], (k + 0.5) * s - off[2])
    // Inflate a little at coarse rez so thin limbs still get voxels.
    if (sdf(def.prims, p) <= s * 0.35) solid.add(key(i, j, k))
  }
  const cells = []
  for (const kk of solid) {
    const [i, j, k] = kk.split(',').map(Number)
    const buried = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .every(([a, b, c]) => solid.has(key(i + a, j + b, k + c)))
    if (!buried) cells.push([(i + 0.5) * s - off[0], (j + 0.5) * s - off[1], (k + 0.5) * s - off[2]])
  }
  cells.sort((a, b) => a[1] - b[1])
  return cells
}

// MediaPipe face mesh contours (landmark index chains) worth drawing.
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10]
const LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61]
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78]
const EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33]
const EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263]
const BROW_L = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
const BROW_R = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
const NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2]

/** Draws tracked landmarks as glowing contours, framed on the face's bounds. */
export function drawFace(g, w, lm, hue) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const i of OVAL) { const p = lm[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
  const sz = Math.max(x1 - x0, y1 - y0) * 1.04
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  // Mirrored, like a mirror: your left is the avatar's left as you face it.
  const P = (i) => [(1 - ((lm[i].x - cx) / sz + 0.5)) * w, ((lm[i].y - cy) / sz + 0.5) * w]
  g.lineJoin = g.lineCap = 'round'
  const line = (chain, width, alpha, fill) => {
    g.beginPath()
    chain.forEach((i, n) => { const [x, y] = P(i); n ? g.lineTo(x, y) : g.moveTo(x, y) })
    g.globalAlpha = alpha
    if (fill) { g.fillStyle = fill; g.fill() }
    g.lineWidth = Math.max(1, width * w / 128)
    g.stroke()
  }
  g.strokeStyle = hue
  line(OVAL, 1.5, 0.55)
  line(LIPS_OUT, 2, 1, 'rgba(255,90,60,0.35)')
  line(LIPS_IN, 1.2, 0.9)
  line(EYE_L, 1.6, 1)
  line(EYE_R, 1.6, 1)
  line(BROW_L, 2.2, 0.9)
  line(BROW_R, 2.2, 0.9)
  line(NOSE, 1, 0.5)
  g.fillStyle = '#ffffff'
  g.globalAlpha = 1
  for (const i of [468, 473]) {
    if (!lm[i]) continue
    const [x, y] = P(i)
    g.beginPath(); g.arc(x, y, Math.max(1, w * 0.022), 0, Math.PI * 2); g.fill()
  }
}

/** A camera-facing text label. */
export function textSprite(text, color, height = 0.15, maxChars = 40) {
  const lines = wrap(text, maxChars)
  const fs = 44
  const cv = document.createElement('canvas')
  const g = cv.getContext('2d')
  g.font = `${fs}px ${FONT_MONO}`
  const width = Math.min(1600, Math.max(...lines.map((l) => g.measureText(l).width)) + 40)
  cv.width = width
  cv.height = lines.length * fs * 1.2 + 24
  g.font = `${fs}px ${FONT_MONO}`
  g.fillStyle = 'rgba(5,10,31,0.78)'
  g.fillRect(0, 0, cv.width, cv.height)
  g.strokeStyle = color
  g.lineWidth = 3
  g.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3)
  g.fillStyle = color
  g.textBaseline = 'top'
  lines.forEach((l, i) => g.fillText(l, 20, 12 + i * fs * 1.2))
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }))
  const h = height * lines.length * 1.2 + height * 0.5
  sp.scale.set(h * cv.width / cv.height, h, 1)
  sp.center.set(0.5, 0)
  sp.renderOrder = 10
  return sp
}

function wrap(text, n) {
  const words = text.split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines
}

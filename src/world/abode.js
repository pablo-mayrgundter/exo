// Pablo's abode: another place in cyberspace, reached through the arch in
// the bar's west wall. A temple pavilion with a glowing tree of life on its
// gable, a tree of cyan spirals inlaid in the plaza, candles along spiral
// paths, and a dusk sky. Its clock runs 600 times as fast as the bar's, so
// the stars wheel round about every two and a half minutes.
//
// Abode space: metres, the plaza's centre at the origin, the temple to -z,
// the arch back to the bar at +z facing the temple.
import * as THREE from 'three'
import { C } from '../theme.js'
import { rng, neonTexture, FONT_MONO } from './textures.js'

export const ABODE_RATE = 600

const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o })

export function makeAbode() {
  const scene = new THREE.Scene()
  scene.name = 'abode'
  scene.background = new THREE.Color(0x0b0a2a)
  scene.fog = new THREE.Fog(0x1a1240, 60, 220)
  const colliders = []
  const r = rng(1009)

  // Sky: a dusk gradient dome, and stars on a sphere that turns with the
  // abode's clock.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        // Linear colours: dusk orange at the horizon, violet, then night.
        vec3 horizon = vec3(0.55, 0.16, 0.05);
        vec3 mid = vec3(0.09, 0.03, 0.14);
        vec3 top = vec3(0.004, 0.006, 0.03);
        vec3 c = h < 0.12 ? mix(horizon, mid, smoothstep(-0.02, 0.12, h)) : mix(mid, top, smoothstep(0.12, 0.6, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }))
  scene.add(sky)
  const starPos = []
  for (let i = 0; i < 2500; i++) {
    const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(380)
    starPos.push(v.x, v.y, v.z)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }))
  // The celestial pole, tilted like a mid-northern latitude's.
  const pole = new THREE.Group()
  pole.rotation.x = -0.6
  pole.add(stars)
  scene.add(pole)

  // Ground: dark cobbles from a Voronoi shader.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: `varying vec2 vUv;
      ${THREE.ShaderChunk.fog_pars_vertex}
      void main(){
        vUv = position.xy;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        ${THREE.ShaderChunk.fog_vertex}
      }`,
    fragmentShader: `varying vec2 vUv;
      ${THREE.ShaderChunk.fog_pars_fragment}
      vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      void main(){
        vec2 p = vUv * 1.6;
        vec2 i = floor(p); vec2 f = fract(p);
        float d1 = 8.0, d2 = 8.0; vec2 id;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = h2(i + g);
          float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
        }
        float seam = smoothstep(0.02, 0.12, d2 - d1);
        float tone = 0.6 + 0.4 * h2(id).x;
        vec3 stone = vec3(0.035, 0.028, 0.04) * tone;
        gl_FragColor = vec4(mix(vec3(0.003, 0.003, 0.008), stone, seam), 1.0);
        ${THREE.ShaderChunk.fog_fragment}

      }`,
  }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  // The spiral tree inlaid in the plaza: a trunk from the arch toward the
  // temple, branching, each branch ending in a curl.
  const treeLines = []
  const curl = (x, z, a, len, depth) => {
    const ex = x + Math.sin(a) * len, ez = z - Math.cos(a) * len
    treeLines.push(segment(x, z, ex, ez))
    if (depth === 0) {
      treeLines.push(spiral(ex, ez, a, len * 0.45, r() < 0.5 ? 1 : -1))
      return
    }
    const spread = 0.55 + r() * 0.3
    curl(ex, ez, a - spread, len * 0.72, depth - 1)
    curl(ex, ez, a + spread, len * 0.72, depth - 1)
    if (depth > 1 && r() < 0.5) treeLines.push(spiral(ex, ez, a + (r() < 0.5 ? 1.6 : -1.6), len * 0.35, r() < 0.5 ? 1 : -1))
  }
  curl(0, 9, 0, 6, 4)
  const treeGeo = tubes(treeLines, 0.09)
  const tree = new THREE.Mesh(treeGeo, basic({ color: 0x2fc8d8 }))
  tree.position.y = 0.02
  scene.add(tree)

  // Candles along spirals in front of the temple's steps.
  const candlePos = []
  for (const [cx, cz, turns, sgn] of [[-9, -6, 2.2, 1], [9, -6, 2.2, -1], [-4, -10, 1.6, -1], [4, -10, 1.6, 1], [0, -2, 1.2, 1]]) {
    for (let t = 0.3; t < turns * Math.PI * 2; t += 0.32) {
      const rr = 0.35 * t
      candlePos.push(cx + Math.cos(t * sgn) * rr, 0.12, cz + Math.sin(t * sgn) * rr)
    }
  }
  const candleGeo = new THREE.BufferGeometry()
  candleGeo.setAttribute('position', new THREE.Float32BufferAttribute(candlePos, 3))
  const flicker = new Float32Array(candlePos.length / 3).map(() => r() * 10)
  candleGeo.setAttribute('seed', new THREE.BufferAttribute(flicker, 1))
  const candleMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float seed; uniform float t; varying float vF;
      void main(){ vF = 0.75 + 0.25 * sin(t * 9.0 + seed * 7.0) * sin(t * 5.3 + seed);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 260.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vF;
      void main(){ vec2 d = gl_PointCoord - 0.5; float a = exp(-dot(d, d) * 18.0) * vF;
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * a * 1.6, 1.0); }`,
  })
  scene.add(new THREE.Points(candleGeo, candleMat))

  // The temple: a platform, columns, and tiered gable roofs with swept
  // finials, outlined in gold; a glowing tree of life on the front gable.
  const temple = new THREE.Group()
  temple.position.set(0, 0, -24)
  scene.add(temple)
  const dark = basic({ color: 0x150c1c })
  const gold = new THREE.LineBasicMaterial({ color: 0xffb36b, toneMapped: false })
  const box = (wd, ht, dp, x, y, z, mat = dark) => {
    const g = new THREE.BoxGeometry(wd, ht, dp)
    const m = new THREE.Mesh(g, mat)
    m.position.set(x, y, z)
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), gold)
    e.position.copy(m.position)
    temple.add(m, e)
  }
  box(26, 1.2, 18, 0, 0.6, 0)
  box(20, 0.6, 2, 0, 0.3, 9.6)
  colliders.push([-13, -24 - 9, 13, -24 + 10.6])
  for (let i = -3; i <= 3; i++) box(0.5, 6, 0.5, i * 3.2, 4.2, 7.5)
  box(23, 6, 12, 0, 4.2, -1.5, basic({ color: 0x0d0818 }))
  // Glowing windows between the columns.
  for (let i = -3; i < 3; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.6), basic({ color: 0xb85a22 }))
    win.position.set(i * 3.2 + 1.6, 4, 4.55)
    temple.add(win)
  }
  // Tiered roofs: each a gable, smaller and higher than the last.
  const tiers = [[25, 8.5, 7.2], [19, 6.5, 9.4], [13, 4.5, 11.8]] // width, rise, eave height
  tiers.forEach(([wd, rise, y], k) => {
    const shape = new THREE.Shape()
    shape.moveTo(-wd / 2, 0); shape.lineTo(0, rise); shape.lineTo(wd / 2, 0); shape.lineTo(-wd / 2, 0)
    const g = new THREE.ExtrudeGeometry(shape, { depth: 14 - k * 2, bevelEnabled: false })
    g.translate(0, 0, -(14 - k * 2) / 2 + k * 1.6)
    const m = new THREE.Mesh(g, basic({ color: 0x2a0d14 }))
    m.position.y = y
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), gold)
    e.position.y = y
    temple.add(m, e)
    // Finials sweeping up from the gable's ends and peak.
    for (const sx of [-1, 1]) temple.add(finial(sx * wd / 2, y, 7 - k * 2 + k * 1.6, sx, gold))
    temple.add(finial(0, y + rise, 7 - k * 2 + k * 1.6, 0, gold))
  })
  // The tree of life on the front gable.
  const gable = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), basic({
    map: treeOfLifeTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  gable.position.set(0, 7.2 + 3.1, 7.05)
  temple.add(gable)

  // The arch back to the bar.
  const arch = new THREE.Group()
  arch.position.set(0, 0, 16)
  scene.add(arch)
  const archLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.2, 0, 0), new THREE.Vector3(-1.2, 3.2, 0), new THREE.Vector3(1.2, 3.2, 0), new THREE.Vector3(1.2, 0, 0)]),
  new THREE.LineBasicMaterial({ color: C.cyan, toneMapped: false }))
  arch.add(archLine)
  const archSign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6),
    basic({ map: neonTexture('EXO CAFE  ×1', { color: '#6beaf2', font: FONT_MONO, size: 64, height: 128 }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
  archSign.position.set(0, 3.7, 0)
  archSign.rotation.y = Math.PI
  arch.add(archSign)
  const portalAnchor = new THREE.Object3D()
  portalAnchor.position.set(0, 1.6, 16)
  portalAnchor.rotation.y = Math.PI // its +z faces the temple
  scene.add(portalAnchor)
  // Keep visitors from walking round behind the arch.
  colliders.push([-1.5, 16.05, 1.5, 17])

  return {
    scene, colliders, portalAnchor,
    spawn: new THREE.Vector3(0, 0, 13),
    /** @param {number} abodeTime seconds on the abode's clock */
    update(abodeTime, wallTime) {
      // One sidereal day is 86164 s; at ×600 that's ~144 s of wall time.
      pole.rotation.y = (abodeTime / 86164) * Math.PI * 2
      candleMat.uniforms.t.value = wallTime
    },
  }
}

function segment(x0, z0, x1, z1) { return [new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)] }

function spiral(x, z, a, size, dir) {
  const pts = []
  for (let t = 0; t < Math.PI * 3.2; t += 0.15) {
    const rr = size * (1 - t / (Math.PI * 3.6))
    const ang = a + dir * t
    pts.push(new THREE.Vector3(x + Math.sin(ang) * rr - Math.sin(a) * size, 0, z - Math.cos(ang) * rr + Math.cos(a) * size))
  }
  return pts
}

function tubes(polylines, radius) {
  const geos = []
  for (const pts of polylines) {
    if (pts.length < 2) continue
    const curve = new THREE.CatmullRomCurve3(pts)
    geos.push(new THREE.TubeGeometry(curve, Math.max(2, pts.length * 2), radius, 5, false))
  }
  return mergeGeometries(geos)
}

function mergeGeometries(geos) {
  let n = 0
  for (const g of geos) n += g.index ? g.index.count : g.attributes.position.count
  const pos = new Float32Array(n * 3)
  let o = 0
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g
    pos.set(ng.attributes.position.array, o)
    o += ng.attributes.position.array.length
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  return out
}

function finial(x, y, z, side, mat) {
  const pts = []
  for (let t = 0; t <= 1; t += 0.1) {
    pts.push(new THREE.Vector3(x + side * t * 0.9, y + t * 1.6 + (side ? 0 : 0.6 * t), z + 0.1))
  }
  pts.push(new THREE.Vector3(x + side * 0.6, y + 1.9 + (side ? 0 : 0.6), z + 0.1))
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)
}

/** A glowing tree of life, drawn branch by branch with curls. */
function treeOfLifeTexture() {
  const cv = document.createElement('canvas')
  cv.width = 768
  cv.height = 512
  const g = cv.getContext('2d')
  const r = rng(77)
  g.lineCap = 'round'
  g.shadowColor = '#4ff0ff'
  g.strokeStyle = '#7ff6ff'
  const branch = (x, y, a, len, w, depth) => {
    const ex = x + Math.sin(a) * len, ey = y - Math.cos(a) * len
    g.lineWidth = w
    g.shadowBlur = 18
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.sin(a + 0.3) * len * 0.5, y - Math.cos(a + 0.3) * len * 0.5, ex, ey); g.stroke()
    if (depth === 0) {
      g.lineWidth = Math.max(1.5, w * 0.7)
      g.beginPath()
      const dir = r() < 0.5 ? 1 : -1
      for (let t = 0; t < 9; t += 0.25) {
        const rr = 14 * (1 - t / 10)
        const px = ex + Math.sin(a + dir * t) * rr, py = ey - Math.cos(a + dir * t) * rr
        t ? g.lineTo(px, py) : g.moveTo(px, py)
      }
      g.stroke()
      return
    }
    branch(ex, ey, a - 0.5 - r() * 0.3, len * 0.74, w * 0.7, depth - 1)
    branch(ex, ey, a + 0.5 + r() * 0.3, len * 0.74, w * 0.7, depth - 1)
  }
  branch(384, 500, 0, 120, 14, 5)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

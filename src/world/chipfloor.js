// The street: the 6502's layout as a Tron city floor. Every polygon of
// every layer is drawn at its real position (0.1 m per layout unit, so the
// die is a ~900 m district) and lit by its node's average voltage over the
// last 50 ms of simulation, read from a texture the worker updates.
import * as THREE from 'three'
import { C } from '../theme.js'

export const CHIP_SCALE = 0.1 // metres per layout unit

// visual6502's layers: 0 metal, 1 switched diffusion, 2 input diode,
// 3 grounded diffusion, 4 powered diffusion, 5 polysilicon.
const LAYER_Y = [0.06, 0.02, 0.02, 0.02, 0.02, 0.04]
const LAYER_HI = [C.cyan, C.yellow, C.yellow, C.green, C.orange, C.magenta]
const LAYER_LO = [0x0c2a4a, 0x2a2208, 0x2a2208, 0x0b2a12, 0x2a0d08, 0x26082a]

/**
 * @param {{segdefs: number[][], nodenames: Record<string, number>}} data
 * @param {import('../cosmic/frames.js').Frame} frame chip layout → world
 */
export function makeChipFloor(data, frame) {
  let nodeCount = 0
  for (const s of data.segdefs) nodeCount = Math.max(nodeCount, s[0] + 1)
  const texW = 2048
  const levels = new Uint8Array(texW)
  const stateTex = new THREE.DataTexture(levels, texW, 1, THREE.RedFormat, THREE.UnsignedByteType)
  stateTex.needsUpdate = true

  const fillPos = [], fillNode = [], fillLayer = []
  const edgePos = [], edgeNode = [], edgeLayer = []
  // One draw call, painted in buffer order: diffusion, then poly, then
  // metal on top, as on the die.
  const ORDER = [6, 0, 1, 2, 3, 4] // per layer: metal last
  const segs = [...data.segdefs].sort((a, b) => ORDER[a[2]] - ORDER[b[2]])
  for (const s of segs) {
    const [node, , layer] = s
    const c = s.slice(3)
    const pts = []
    for (let i = 0; i < c.length; i += 2) {
      const [x, , z] = frame.toParent([c[i], c[i + 1], 0])
      pts.push(new THREE.Vector2(x, z))
    }
    if (pts.length < 3) continue
    const y = LAYER_Y[layer]
    for (const [a, b, d] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      for (const k of [a, b, d]) {
        fillPos.push(pts[k].x, y, pts[k].y)
        fillNode.push(node)
        fillLayer.push(layer)
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length]
      edgePos.push(p.x, y + 0.005, p.y, q.x, y + 0.005, q.y)
      edgeNode.push(node, node)
      edgeLayer.push(layer, layer)
    }
  }

  const uniforms = {
    states: { value: stateTex },
    texW: { value: texW },
    hi: { value: LAYER_HI.map((c) => new THREE.Color(c)) },
    lo: { value: LAYER_LO.map((c) => new THREE.Color(c)) },
    gain: { value: 1 },
  }
  const vertexShader = `
    attribute float node;
    attribute float layer;
    uniform sampler2D states;
    uniform float texW;
    varying float vLevel;
    varying float vLayer;
    varying float vFade;
    void main() {
      vLevel = texture2D(states, vec2((node + 0.5) / texW, 0.5)).r;
      vLayer = layer;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec4 mv = viewMatrix * wp;
      // Lines crowd together with distance and at grazing angles; dim them
      // so the die doesn't wash out into a white horizon.
      float graze = clamp(normalize(cameraPosition - wp.xyz).y * 2.5, 0.04, 1.0);
      vFade = clamp(40.0 / -mv.z, 0.1, 1.0) * graze;
      gl_Position = projectionMatrix * mv;
    }`
  const pick = `
      int l = int(vLayer + 0.5);
      vec3 h = hi[0]; vec3 d = lo[0];
      for (int i = 1; i < 6; i++) if (i == l) { h = hi[i]; d = lo[i]; }`
  const head = `
    uniform vec3 hi[6];
    uniform vec3 lo[6];
    uniform float gain;
    varying float vLevel;
    varying float vLayer;
    varying float vFade;`
  // Fills: translucent layers, low nodes dark, high nodes lit.
  const fillMat = new THREE.ShaderMaterial({
    uniforms, vertexShader,
    fragmentShader: `${head}
    void main() {
      ${pick}
      vec3 c = mix(d, h * 0.6, vLevel);
      gl_FragColor = vec4(c, l == 0 ? 0.6 : 0.75);
    }`,
    depthWrite: false, transparent: true,
  })
  // Edges: additive neon outlines, brighter on high nodes.
  const edgeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader,
    fragmentShader: `${head}
    void main() {
      ${pick}
      vec3 c = mix(d * 3.0, h, vLevel) * mix(0.45, 1.0, vLevel) * vFade * gain;
      gl_FragColor = vec4(c, 1.0);
    }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  })
  const geom = (pos, node, layer) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('node', new THREE.Float32BufferAttribute(node, 1))
    g.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1))
    g.computeBoundingSphere()
    return g
  }
  const group = new THREE.Group()
  group.name = 'chip-floor'
  const fills = new THREE.Mesh(geom(fillPos, fillNode, fillLayer), fillMat)
  const edges = new THREE.LineSegments(geom(edgePos, edgeNode, edgeLayer), edgeMat)
  fills.renderOrder = -2
  edges.renderOrder = -1
  group.add(fills, edges)

  // Street names: the node's name from the netlist, for the HUD.
  const nameOf = {}
  for (const [k, v] of Object.entries(data.nodenames)) {
    if (!(v in nameOf) || k.length < nameOf[v].length) nameOf[v] = k
  }
  const index = makeIndex(data.segdefs)

  // Displayed level eases toward the reported average, so changes fade.
  const shown = new Float32Array(texW)
  const target = new Float32Array(texW)
  return {
    group,
    nodeCount,
    /** @param {Uint8Array} lv average voltage per node, 0..255 */
    setLevels(lv) { for (let i = 0; i < lv.length && i < texW; i++) target[i] = lv[i] },
    /** The displayed level of a node, 0..1 (what the bar's lights follow). */
    level(n) { return shown[n] / 255 },
    update(dt) {
      const k = 1 - Math.exp(-dt * 8)
      for (let i = 0; i < nodeCount; i++) {
        shown[i] += (target[i] - shown[i]) * k
        levels[i] = shown[i]
      }
      stateTex.needsUpdate = true
    },
    /** What's under a layout point: the topmost layer's node, and its name. */
    probe(cx, cy) {
      const hit = index.at(cx, cy)
      if (!hit) return null
      return { node: hit.node, layer: hit.layer, name: nameOf[hit.node] ?? null }
    },
    uniforms,
  }
}

/** A grid of polygon bounding boxes, for point lookups. */
function makeIndex(segdefs) {
  const CELL = 200
  const cells = new Map()
  const polys = segdefs.map((s) => {
    const c = s.slice(3)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < c.length; i += 2) {
      x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i])
      y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1])
    }
    return { node: s[0], layer: s[2], c, x0, y0, x1, y1 }
  })
  polys.forEach((p, i) => {
    for (let gx = Math.floor(p.x0 / CELL); gx <= Math.floor(p.x1 / CELL); gx++) {
      for (let gy = Math.floor(p.y0 / CELL); gy <= Math.floor(p.y1 / CELL); gy++) {
        const k = gx * 1000 + gy
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(i)
      }
    }
  })
  // Metal is on top, then poly, then diffusion.
  const rank = [3, 1, 1, 1, 1, 2]
  return {
    at(x, y) {
      const list = cells.get(Math.floor(x / CELL) * 1000 + Math.floor(y / CELL)) ?? []
      let best = null
      for (const i of list) {
        const p = polys[i]
        if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1 || !inside(p.c, x, y)) continue
        if (!best || rank[p.layer] > rank[best.layer]) best = p
      }
      return best
    },
  }
}

function inside(c, x, y) {
  let ins = false
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
    const xi = c[i], yi = c[i + 1], xj = c[j], yj = c[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}

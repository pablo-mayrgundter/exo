// The street: the 6502's layout as a Tron city floor. Every polygon of
// every layer is drawn where it is on the die, in body units (0.1 per
// layout unit; the scene's root scales body units to micrometres, so the
// die is its true ~3.9 × 4.3 mm), and lit by its node's average voltage
// over the last 50 ms of simulation, read from a texture the worker
// updates.
//
// And pulses: when a node switches, a front runs out through its traces
// from where the change came in (the transistor that set it off, or its
// pad for a change from outside: chip/switching.js), later for a later
// wave of the half-step's recalculation. Where the front crosses the
// node's outlines it shows as points of light running along its traces.
// The sim settles a node at once, so the front's pace is chosen to read
// (PULSE), not physical: at the avatar's size, with time scaled to it, a
// real node settles in well under a millisecond.
import * as THREE from 'three'
import { C } from '../theme.js'


// visual6502's layers: 0 metal, 1 switched diffusion, 2 input diode,
// 3 grounded diffusion, 4 powered diffusion, 5 polysilicon.
const LAYER_Y = [0.06, 0.02, 0.02, 0.02, 0.02, 0.04]
const LAYER_HI = [C.cyan, C.yellow, C.yellow, C.green, C.orange, C.magenta]
const LAYER_LO = [0x0c2a4a, 0x2a2208, 0x2a2208, 0x0b2a12, 0x2a0d08, 0x26082a]
/**
 * Pulses: how fast a front runs (body units a second: the die is ~900
 * across, the avatar 1.84 tall), its width (body units), how long it lasts
 * (s), the delay per recalc wave (s), and its brightness.
 */
export const PULSE = { speed: 25, width: 1.6, life: 5, wave: 0.08, gain: 2.2 }

/**
 * @param {{segdefs: number[][], nodenames: Record<string, number>}} data
 * @param {import('../cosmic/frames.js').Frame} frame chip layout → world
 */
export function makeChipFloor(data, frame, { unit = 1 } = {}) {
  let nodeCount = 0
  for (const s of data.segdefs) nodeCount = Math.max(nodeCount, s[0] + 1)
  const texW = 2048
  const levels = new Uint8Array(texW)
  const stateTex = new THREE.DataTexture(levels, texW, 1, THREE.RedFormat, THREE.UnsignedByteType)
  stateTex.needsUpdate = true
  // Per node, its pulse: when it starts (s, floor time), where from (x, z),
  // and its strength (0: none).
  const pulses = new Float32Array(texW * 4)
  const pulseTex = new THREE.DataTexture(pulses, texW, 1, THREE.RGBAFormat, THREE.FloatType)
  pulseTex.needsUpdate = true

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
    unit: { value: unit }, // scene units per body unit, for distance fades
    pulses: { value: pulseTex },
    time: { value: 0 },
    pulse: { value: new THREE.Vector4(PULSE.speed, PULSE.width, PULSE.life, PULSE.gain) },
  }
  const vertexShader = `
    attribute float node;
    attribute float layer;
    uniform sampler2D states;
    uniform float texW;
    uniform float unit;
    uniform sampler2D pulses;
    varying float vLevel;
    varying float vLayer;
    varying float vFade;
    varying vec4 vPulse;
    varying vec2 vXZ;
    void main() {
      vLevel = texture2D(states, vec2((node + 0.5) / texW, 0.5)).r;
      vPulse = texture2D(pulses, vec2((node + 0.5) / texW, 0.5));
      vXZ = position.xz;
      vLayer = layer;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec4 mv = viewMatrix * wp;
      // Lines crowd together with distance and at grazing angles; dim them
      // so the die doesn't wash out into a white horizon.
      float graze = clamp(normalize(cameraPosition - wp.xyz).y * 2.5, 0.04, 1.0);
      vFade = clamp(40.0 * unit / -mv.z, 0.1, 1.0) * graze;
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
    uniform float time;
    uniform vec4 pulse;
    varying float vLevel;
    varying float vLayer;
    varying float vFade;
    varying vec4 vPulse;
    varying vec2 vXZ;
    // The node's pulse here: a front at speed·age from its source, fading over its life.
    float front() {
      float age = time - vPulse.x;
      if (vPulse.w <= 0.0 || age < 0.0 || age > pulse.z) return 0.0;
      float d = distance(vXZ, vPulse.yz) - age * pulse.x;
      return exp(-d * d / (pulse.y * pulse.y)) * (1.0 - age / pulse.z) * vPulse.w;
    }`
  // Fills: each trace filled with its layer's colour, solid while its node
  // is high, half-opaque and dimmer while low (normal blending, in layer
  // order: metal over poly over diffusion). Metal, on top and everywhere,
  // stays a little see-through, so what's under it shows. The pulse warms
  // the fill a little as it passes.
  const fillMat = new THREE.ShaderMaterial({
    uniforms, vertexShader,
    fragmentShader: `${head}
    void main() {
      ${pick}
      // Linear colour, under the bloom's threshold even when high: the neon is the outlines'.
      vec3 c = mix(h * 0.045, h * 0.16, vLevel) + h * front() * pulse.w * 0.08 * vFade;
      float a = l == 0 ? mix(0.35, 0.8, vLevel) : mix(0.5, 0.95, vLevel);
      gl_FragColor = vec4(c, a);
    }`,
    // The layout's y flips to the street's z, which turns the triangles' winding over: seen from above they face away.
    side: THREE.DoubleSide,
    depthWrite: false, transparent: true,
  })
  // Edges: additive neon outlines, brighter on high nodes.
  const edgeMat = new THREE.ShaderMaterial({
    uniforms, vertexShader,
    fragmentShader: `${head}
    void main() {
      ${pick}
      vec3 c = mix(d * 3.0, h, vLevel) * mix(0.45, 1.0, vLevel) * vFade * gain;
      // The pulse: the layer's colour, whitened, dimmed with distance and
      // grazing angle as the outlines are (or the die whitens from orbit).
      c += mix(h, vec3(1.0), 0.5) * front() * pulse.w * vFade * gain;
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
  let time = 0
  // When each node may pulse again: a front's life, and a random part of
  // another, or the nodes that keep switching would all pulse in step.
  const nextAt = new Float32Array(texW)
  let sites = null // { transistors, pads }: x, z pairs in the floor's units
  const toFloor = (xy) => {
    const out = new Float32Array(xy.length)
    for (let i = 0; i < xy.length; i += 2) {
      const [x, , z] = frame.toParent([xy[i], xy[i + 1], 0])
      out[i] = x
      out[i + 1] = z
    }
    return out
  }
  return {
    group,
    nodeCount,
    /** @param {Uint8Array} lv average voltage per node, 0..255 */
    setLevels(lv) { for (let i = 0; i < lv.length && i < texW; i++) target[i] = lv[i] },
    /** The displayed level of a node, 0..1 (what the bar's lights follow). */
    level(n) { return shown[n] / 255 },
    /** Where the switching happens (layout units, chip/switching.js): pulses start once these are in. */
    setSites({ transistors, pads }) { sites = { transistors: toFloor(transistors), pads: toFloor(pads) } },
    /**
     * The nodes that switched in the last slice (chip/switching.js
     * `switched`): each one not already pulsing starts a pulse from where its
     * last change came in, later for a later wave.
     */
    setPulses({ nodes, cause, wave }) {
      if (!sites) return
      let any = false
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k]
        if (n >= texW) continue
        const o = 4 * n
        if (time < nextAt[n]) continue // one front at a time
        const t = cause[k]
        const src = t >= 0 ? sites.transistors : sites.pads
        const i = 2 * (t >= 0 ? t : n)
        pulses[o] = time + wave[k] * PULSE.wave
        pulses[o + 1] = src[i]
        pulses[o + 2] = src[i + 1]
        pulses[o + 3] = 1
        nextAt[n] = pulses[o] + PULSE.life * (1 + Math.random())
        any = true
      }
      if (any) pulseTex.needsUpdate = true
    },
    /** Pulses off (0) or on. */
    set pulseGain(g) { uniforms.pulse.value.w = g },
    update(dt) {
      time += dt
      uniforms.time.value = time
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

// The gate to NetMap, on the street outside the bar's door: a green ring
// with a cyan one turning inside it, and a neon sign. E there jacks into
// NetMap in a new tab. Inside the ring is a window onto NetMap itself, live
// (netmap-window.js), once its guest draws; until then, or if it can't, the
// ring is empty, as it always was.
import * as THREE from 'three'
import { C } from '../theme.js'
import { neonTexture, FONT_MONO } from './textures.js'

/** The ring's centre height and the window's radius, body units. */
const RING_Y = 2.7
const SCREEN_R = 2.17

/**
 * @param {{netmap?: ReturnType<import('./netmap-window.js').makeNetMapWindow>}} [o]
 */
export function makeGate({ netmap = null } = {}) {
  const group = new THREE.Group()
  group.position.set(9, 0, 22)
  group.rotation.y = -0.5
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: C.green, toneMapped: false }))
  ring.position.y = RING_Y
  const inner = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: C.cyan, toneMapped: false }))
  inner.position.y = RING_Y
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({
    map: neonTexture('NETMAP · JACK IN', { color: '#84f55c', font: FONT_MONO, size: 76, height: 160 }),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }))
  sign.position.y = 6.1
  group.add(ring, inner, sign)
  const g = { group, near: false, screen: null, netmap }

  if (netmap) {
    // The globe fills the ring's disc; the window's square corners fall
    // outside it. The guest's pixels are display-referred and premultiplied
    // (deck blends onto a clear, transparent frame), so they're decoded to
    // linear here and laid over the street as they are.
    const screen = new THREE.Mesh(new THREE.CircleGeometry(SCREEN_R, 64), new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: netmap.texture } },
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        uniform sampler2D map;
        varying vec2 vUv;
        vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
        void main() {
          vec4 s = texture2D(map, vUv);
          gl_FragColor = vec4(s.a > 0.0 ? srgbToLinear(s.rgb / s.a) * s.a : vec3(0.0), s.a);
          #ifdef USE_FOG
            // three's fog_fragment, premultiplied: the clear corners stay clear.
            #ifdef FOG_EXP2
              float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor);
          #endif
        }`,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    }))
    screen.position.y = RING_Y
    screen.visible = false
    group.add(screen)
    g.screen = screen
    // The guest starts the first time the gate is drawn, and gets new views
    // only while it's being drawn.
    ring.onBeforeRender = () => netmap.seen()
  }

  g.update = (t, p) => {
    inner.rotation.z = t * 0.8
    ring.rotation.y = Math.sin(t * 0.5) * 0.15
    g.near = !!p && p.distanceTo(group.position) < 4.5
    if (netmap) {
      netmap.update()
      g.screen.visible = netmap.on
    }
  }
  return g
}

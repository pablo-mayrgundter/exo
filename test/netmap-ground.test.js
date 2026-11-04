import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { worldToEcef, groundViewMatrix, isGroundHello } from '../src/world/netmap-ground.js'
import { DIE_BASE_UM } from '../src/chip/stack.js'

// The map under the chip (netmap-ground.js): the street's frame on the
// map's sphere, and the camera as netmap's matrix view.
const R = 6370972

describe("the street on the map's sphere", () => {
  const M = worldToEcef(R, 1e-6, 0)
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray()
  it('puts the NMI pad at 0° N 0° E, on a ground at 0', () => expect(at(0, 0, 0)).toEqual([R, 0, 0]))
  it("stands the die on the ground: its base at the sphere, the street ~383 µm up", () => {
    const D = worldToEcef(R)
    const base = new THREE.Vector3(0, DIE_BASE_UM, 0).applyMatrix4(D)
    expect(base.x).toBeCloseTo(R, 9)
    const street = new THREE.Vector3(0, 0, 0).applyMatrix4(D)
    expect((street.x - R) * 1e6).toBeCloseTo(-DIE_BASE_UM, 2) // float64 at 6.4e6 m: ~1e-9 m
    expect(-DIE_BASE_UM).toBeGreaterThan(380)
    expect(-DIE_BASE_UM).toBeLessThan(390)
  })
  it('runs east to ECEF +y, up to +x, south to −z, in metres', () => {
    expect(at(1e6, 0, 0)).toEqual([R, 1, 0])
    expect(at(0, 1e6, 0)).toEqual([R + 1, 0, 0])
    expect(at(0, 0, 1e6)).toEqual([R, 0, -1])
  })
})

describe("the camera as netmap's matrix view", () => {
  it('is rigid, in metres, and puts what the camera looks at in front of it', () => {
    // 2 m up over the pad (2e6 µm), looking straight down.
    const cam = new THREE.PerspectiveCamera(60, 1.6, 1, 1e9)
    cam.position.set(0, 2e6, 0)
    cam.up.set(0, 0, -1) // north up: straight down, +y up would be degenerate
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const V = new THREE.Matrix4().fromArray(groundViewMatrix(cam.matrixWorld, R, 0))
    expect(V.determinant()).toBeCloseTo(1, 9)
    const pad = new THREE.Vector3(R, 0, 0).applyMatrix4(V)
    expect(pad.x).toBeCloseTo(0, 6)
    expect(pad.y).toBeCloseTo(0, 6)
    expect(pad.z).toBeCloseTo(-2, 6) // 2 m ahead
  })
})

describe("netmap's hello", () => {
  const hello = { capabilities: { kinds: ['map'], frames: ['ecef'], views: ['globe-camera', 'matrix'] }, contracts: { color: 'linear' } }
  it('takes a map with matrix views in ECEF, in linear colour', () => expect(isGroundHello(hello)).toBe(true))
  it("lets go of one that can't draw in place", () => {
    expect(isGroundHello({ ...hello, capabilities: { ...hello.capabilities, views: ['globe-camera'] } })).toBe(false)
    expect(isGroundHello({ ...hello, contracts: { color: 'display' } })).toBe(false)
  })
})

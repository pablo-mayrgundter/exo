import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  resolveSkySrc, isSkyHello, gmstRad, eqToWorld, SKY_FACES, faceViewMatrix, faceProjection, skyLookup, SKY_SRC,
} from '../src/world/celestiary-sky.js'

// celestiary.org/layer.html's hello as published (2026-10-30): orbits only.
const ORBITS_HELLO = {
  type: 'layer:hello', version: 1, adapter: 'celestiary-orbits',
  capabilities: { kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'], warp: false, anchors: true, time: true, labels: false },
}
const SKY_HELLO = { type: 'layer:hello', version: 1, adapter: 'celestiary-sky', capabilities: { kinds: ['sky'], frames: ['equator-of-date'], time: true } }

describe('the guest page', () => {
  const prod = 'https://pablo-mayrgundter.github.io'
  it('is celestiary.org by default', () => {
    expect(resolveSkySrc({ pageOrigin: prod })).toEqual({ src: SKY_SRC, origin: 'https://celestiary.org', rejected: null })
  })
  it('ignores ?sky_src= on a deployed page, whatever it names', () => {
    for (const p of ['http://localhost:5481/', 'https://celestiary.org/web/pr-preview/pr-1/layer.html', 'https://evil.example/layer.html']) {
      const r = resolveSkySrc({ param: p, pageOrigin: prod })
      expect(r.src).toBe(SKY_SRC)
      expect(r.rejected).toBe(p)
    }
  })
  it('takes a loopback or celestiary page on a loopback page', () => {
    expect(resolveSkySrc({ param: 'http://127.0.0.1:5481/', pageOrigin: 'http://localhost:4173' }).origin).toBe('http://127.0.0.1:5481')
    expect(resolveSkySrc({ param: 'https://celestiary.org/web/pr-preview/pr-9/layer.html', pageOrigin: 'http://localhost:4173' }).src)
      .toBe('https://celestiary.org/web/pr-preview/pr-9/layer.html')
  })
  it('refuses other origins, credentials and other schemes even on loopback', () => {
    for (const p of ['https://evil.example/', 'http://user:pw@localhost:1/', 'javascript:alert(1)', 'http://celestiary.org/', 'not a url']) {
      expect(resolveSkySrc({ param: p, pageOrigin: 'http://localhost:4173' }).src).toBe(SKY_SRC)
    }
  })
})

describe('the hello', () => {
  it("lets today's orbits layer go", () => expect(isSkyHello(ORBITS_HELLO)).toBe(false))
  it('takes a sky in the equator of date', () => expect(isSkyHello(SKY_HELLO)).toBe(true))
  it('needs the frame as well as the kind', () => {
    expect(isSkyHello({ capabilities: { kinds: ['sky'], frames: ['ecef'] } })).toBe(false)
    expect(isSkyHello(null)).toBe(false)
  })
})

describe('the turn of the sky', () => {
  it('has GMST 280.46° at J2000.0', () => {
    expect(gmstRad(Date.UTC(2000, 0, 1, 12)) * 180 / Math.PI).toBeCloseTo(280.46061837, 6)
  })
  it('gains a turn per sidereal day', () => {
    const t = Date.UTC(2026, 9, 30)
    expect(gmstRad(t + 86164090.5)).toBeCloseTo(gmstRad(t), 3)
  })
  it('puts the north celestial pole north, at the altitude of the latitude', () => {
    const site = { lat: 55.6, lon: 0 }
    const p = new THREE.Vector3(0, 0, 1).applyMatrix3(eqToWorld(Date.UTC(2026, 9, 30, 3), site))
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(Math.sin(site.lat * Math.PI / 180), 9) // up
    expect(-p.z).toBeCloseTo(Math.cos(site.lat * Math.PI / 180), 9) // north is −z
  })
  it('puts a star on the equator at the local sidereal time due south', () => {
    const site = { lat: 40, lon: -120 }, t = Date.UTC(2026, 9, 30, 3)
    const lst = gmstRad(t) + site.lon * Math.PI / 180
    const p = new THREE.Vector3(Math.cos(lst), Math.sin(lst), 0).applyMatrix3(eqToWorld(t, site))
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.z).toBeGreaterThan(0) // south
    expect(Math.asin(p.y) * 180 / Math.PI).toBeCloseTo(50, 6) // 90° − latitude
  })
  it('turns east to west', () => {
    const site = { lat: 40, lon: 0 }, t = Date.UTC(2026, 9, 30, 3)
    const lst = gmstRad(t)
    const star = new THREE.Vector3(Math.cos(lst), Math.sin(lst), 0)
    const later = star.clone().applyMatrix3(eqToWorld(t + 600_000, site))
    expect(later.x).toBeLessThan(0) // past the meridian, westward (−x)
  })
})

describe('the cube', () => {
  const P = new THREE.Matrix4().fromArray(faceProjection())
  it('has right-handed rigid faces', () => {
    for (let k = 0; k < 6; k++) {
      const V = new THREE.Matrix4().fromArray(faceViewMatrix(k))
      expect(V.determinant()).toBeCloseTo(1, 9)
      // The face looks along its direction: d lands at the centre, in front.
      const e = SKY_FACES[k].d.clone().applyMatrix4(V)
      expect(e.z).toBeCloseTo(-1, 9)
    }
  })
  it("samples each direction where the guest drew it", () => {
    const r = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1 })()
    for (let i = 0; i < 500; i++) {
      const d = new THREE.Vector3(r(), r(), r()).normalize()
      const { face, ndc } = skyLookup(d)
      const clip = new THREE.Vector4(d.x, d.y, d.z, 0).applyMatrix4(new THREE.Matrix4().fromArray(faceViewMatrix(face))).applyMatrix4(P)
      expect(clip.w).toBeGreaterThan(0)
      expect(clip.x / clip.w).toBeCloseTo(ndc[0], 9)
      expect(clip.y / clip.w).toBeCloseTo(ndc[1], 9)
      expect(Math.abs(ndc[0])).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(ndc[1])).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
  it('tiles the atlas 3 × 2', () => {
    expect(new Set(SKY_FACES.map((f) => `${f.col},${f.row}`)).size).toBe(6)
  })
})

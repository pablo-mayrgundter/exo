import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  resolveSkySrc, isSkyHello, gmstRad, eqToWorld, skyViewMatrix, skyProjection, skyLookup, sunAltitude, SKY_OVERSCAN, SKY_SRC,
} from '../src/world/celestiary-sky.js'

// celestiary.org/layer.html's hello as published (2026-10-30): orbits only.
const ORBITS_HELLO = {
  type: 'layer:hello', version: 1, adapter: 'celestiary-orbits',
  capabilities: { kinds: ['overlay'], depth: ['shared'], projections: ['matrix'], frames: ['ecef'], warp: false, anchors: true, time: true, labels: false },
}
// celestiary's sky guest (sky.html, design/SkyGuest.md there).
const SKY_HELLO = { type: 'layer:hello', version: 1, adapter: 'celestiary-sky', capabilities: { kinds: ['sky'], depth: ['none'], projections: ['matrix'], frames: ['equator-of-date'], time: true, observer: true } }

describe('the guest page', () => {
  const prod = 'https://pablo-mayrgundter.github.io'
  it('is celestiary.org by default', () => {
    expect(resolveSkySrc({ pageOrigin: prod })).toEqual({ src: SKY_SRC, origin: 'https://celestiary.org', rejected: null })
  })
  it("takes celestiary's PR previews on a deployed page, to try a change before it merges", () => {
    const pr = 'https://celestiary.org/web/pr-preview/pr-350/sky.html'
    expect(resolveSkySrc({ param: pr, pageOrigin: prod })).toEqual({ src: pr, origin: 'https://celestiary.org', rejected: null })
    expect(resolveSkySrc({ param: pr, pageOrigin: 'https://exo.cafe' }).src).toBe(pr)
  })
  it('ignores a loopback or other origin on a deployed page', () => {
    for (const p of ['http://localhost:5481/', 'https://127.0.0.1:5481/', 'https://evil.example/sky.html', 'https://celestiary.org.evil.example/sky.html']) {
      const r = resolveSkySrc({ param: p, pageOrigin: prod })
      expect(r.src).toBe(SKY_SRC)
      expect(r.rejected).toBe(p)
    }
  })
  it('takes a loopback or celestiary page on a loopback page', () => {
    expect(resolveSkySrc({ param: 'http://127.0.0.1:5481/', pageOrigin: 'http://localhost:4173' }).origin).toBe('http://127.0.0.1:5481')
    expect(resolveSkySrc({ param: 'https://celestiary.org/web/pr-preview/pr-9/sky.html', pageOrigin: 'http://localhost:4173' }).src)
      .toBe('https://celestiary.org/web/pr-preview/pr-9/sky.html')
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

describe("the camera's view", () => {
  const site = { lat: 55.6, lon: 0 }, t = Date.UTC(2026, 10, 2, 22)
  const M = eqToWorld(t, site)
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
  camera.position.set(3, 1.7, -2) // where it stands doesn't matter: the sky is at infinity
  camera.rotation.set(0.4, -1.1, 0, 'YXZ')
  camera.updateMatrixWorld()
  const vp = new THREE.Matrix4().fromArray(skyProjection(camera)).multiply(new THREE.Matrix4().fromArray(skyViewMatrix(camera, M)))
  // A world direction, in the equator of date.
  const eq = (w) => w.clone().applyMatrix3(M.clone().transpose())

  it('is a rotation, with no translation', () => {
    const V = new THREE.Matrix4().fromArray(skyViewMatrix(camera, M))
    expect(V.determinant()).toBeCloseTo(1, 9)
    expect(V.elements.slice(12, 15)).toEqual([0, 0, 0])
  })
  it('puts what the camera looks at in the middle of the frame', () => {
    const ahead = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld)
    const [u, v] = skyLookup(vp, eq(ahead))
    expect(u).toBeCloseTo(0.5, 9)
    expect(v).toBeCloseTo(0.5, 9)
  })
  it("covers the camera's field with room to turn", () => {
    // The top edge of the camera's field lands short of the frame's.
    const top = new THREE.Vector3(0, Math.tan(30 * Math.PI / 180), -1).normalize().transformDirection(camera.matrixWorld)
    expect(skyLookup(vp, eq(top))[1]).toBeCloseTo(0.5 + 0.5 / SKY_OVERSCAN, 9)
    const right = new THREE.Vector3(Math.tan(30 * Math.PI / 180) * 16 / 9, 0, -1).normalize().transformDirection(camera.matrixWorld)
    expect(skyLookup(vp, eq(right))[0]).toBeCloseTo(0.5 + 0.5 / SKY_OVERSCAN, 9)
    // Behind it, nothing.
    expect(skyLookup(vp, eq(new THREE.Vector3(0, 0, 1).transformDirection(camera.matrixWorld)))).toBeNull()
  })
})

describe("the Sun's height, for the daylight", () => {
  it('is the almanac\'s', () => {
    const at = (iso) => sunAltitude(Date.parse(iso), { lat: 55.62, lon: 0 })
    expect(at('2026-11-02T12:00:00Z')).toBeCloseTo(19.5, 0)
    expect(at('2026-11-02T16:15:00Z')).toBeCloseTo(-0.4, 0)
    expect(at('2026-11-02T18:30:00Z')).toBeCloseTo(-18.8, 0)
  })
})

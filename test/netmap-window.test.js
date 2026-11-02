import { describe, it, expect } from 'vitest'
import {
  resolveNetMapSrc, isMapHello, gateCamera, mapView, paceMs, NETMAP_MAP_SRC, MAP_FRAME_MS, MAP_SIZE, DIE_MARK,
} from '../src/world/netmap-window.js'
import { DIE_GEO } from '../src/cosmic/units.js'

// netmap's map.html hello (web/src/mapView.js MAP_HELLO).
const MAP_HELLO = {
  type: 'layer:hello', version: 1, adapter: 'netmap',
  capabilities: { kinds: ['map'], frames: ['ecef'], views: ['globe-camera'], time: true, anchors: false, marks: true },
  units: { meters: 1 }, earth: { model: 'sphere', radius: 6370972 },
}
// celestiary's orbits layer: a guest, but not a map.
const ORBITS_HELLO = { type: 'layer:hello', version: 1, adapter: 'celestiary-orbits', capabilities: { kinds: ['overlay'], frames: ['ecef'] } }

describe('the guest page', () => {
  const prod = 'https://exo.cafe'
  it("is netmap's map.html by default", () => {
    expect(resolveNetMapSrc({ pageOrigin: prod })).toEqual({ src: NETMAP_MAP_SRC, origin: 'https://pablo-mayrgundter.github.io', rejected: null })
  })
  it('ignores ?netmap_src= on a deployed page, whatever it names', () => {
    for (const p of ['http://127.0.0.1:5481/map.html', 'https://pablo-mayrgundter.github.io/netmap/pr-preview/pr-25/map.html', 'https://evil.example/map.html']) {
      const r = resolveNetMapSrc({ param: p, pageOrigin: prod })
      expect(r.src).toBe(NETMAP_MAP_SRC)
      expect(r.rejected).toBe(p)
    }
  })
  it("takes a loopback page or a netmap preview on a loopback page", () => {
    expect(resolveNetMapSrc({ param: 'http://127.0.0.1:5481/map.html', pageOrigin: 'http://localhost:4173' }).origin).toBe('http://127.0.0.1:5481')
    expect(resolveNetMapSrc({ param: 'https://pablo-mayrgundter.github.io/netmap/pr-preview/pr-25/map.html', pageOrigin: 'http://localhost:4173' }).src)
      .toBe('https://pablo-mayrgundter.github.io/netmap/pr-preview/pr-25/map.html')
  })
  it('refuses other origins, credentials and other schemes even on loopback', () => {
    for (const p of ['https://evil.example/', 'http://user:pw@localhost:1/', 'javascript:alert(1)', 'http://pablo-mayrgundter.github.io/netmap/map.html', 'not a url']) {
      expect(resolveNetMapSrc({ param: p, pageOrigin: 'http://localhost:4173' }).src).toBe(NETMAP_MAP_SRC)
    }
  })
})

describe('the hello', () => {
  it("takes netmap's map", () => expect(isMapHello(MAP_HELLO)).toBe(true))
  it('lets a guest go that draws no globe camera', () => {
    expect(isMapHello(ORBITS_HELLO)).toBe(false)
    expect(isMapHello({ capabilities: { kinds: ['map'], views: ['matrix'] } })).toBe(false)
    expect(isMapHello({ capabilities: { kinds: ['map'] } })).toBe(false)
    expect(isMapHello(null)).toBe(false)
  })
})

describe('the view', () => {
  it('sweeps slowly over the die, looking straight down', () => {
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity
    for (let t = 0; t < 600; t += 0.5) {
      const c = gateCamera(t)
      lonMin = Math.min(lonMin, c.lon); lonMax = Math.max(lonMax, c.lon)
      latMin = Math.min(latMin, c.lat); latMax = Math.max(latMax, c.lat)
      expect(c.pitch).toBe(0)
      // Slow: under a degree a second.
      const d = gateCamera(t + 1)
      expect(Math.hypot(d.lon - c.lon, d.lat - c.lat)).toBeLessThan(2)
    }
    // 0° N 0° E stays in view, the globe's disc always holding it.
    expect(lonMin).toBeLessThan(DIE_GEO.lon); expect(lonMax).toBeGreaterThan(DIE_GEO.lon)
    expect(latMin).toBeLessThan(DIE_GEO.lat); expect(latMax).toBeGreaterThan(DIE_GEO.lat)
    expect(Math.max(-lonMin, lonMax, -latMin, latMax)).toBeLessThan(60)
  })
  it('is a globe camera, full frame, that marks the die', () => {
    const v = mapView(30, 1.8e12)
    expect(v).toMatchObject({ kind: 'globe-camera', width: MAP_SIZE, height: MAP_SIZE, timeMs: 1.8e12, marks: [DIE_MARK] })
    expect(v.fit).toBeGreaterThan(0.5)
    expect(v.fit).toBeLessThanOrEqual(1) // the disc inside the ring's circle
    expect(DIE_MARK).toMatchObject({ lon: 0, lat: 0 })
    for (const k of ['lon', 'lat', 'bearing', 'pitch']) expect(Number.isFinite(v[k])).toBe(true)
  })
})

describe('the pace', () => {
  it('is MAP_FRAME_MS while the guest is cheap', () => {
    expect(paceMs(null)).toBe(MAP_FRAME_MS)
    expect(paceMs(0)).toBe(MAP_FRAME_MS)
    expect(paceMs(3)).toBe(MAP_FRAME_MS)
  })
  it('keeps a costly guest to its share of the frame time', () => {
    expect(paceMs(50)).toBe(500)
    expect(paceMs(20_000)).toBe(200_000)
    expect(paceMs(50, 0.5)).toBe(100)
  })
})

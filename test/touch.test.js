import { describe, expect, it } from 'vitest'
import { touchMode, pixelRatio, promptFor, placeAbove, jukeboxLabels, fovFor } from '../src/touch.js'

const mq = (coarse) => (q) => ({ matches: q === '(pointer: coarse)' && coarse })

describe('touchMode', () => {
  it('follows a coarse primary pointer', () => {
    expect(touchMode(new URLSearchParams(''), mq(true))).toBe(true)
    expect(touchMode(new URLSearchParams(''), mq(false))).toBe(false)
    expect(touchMode(new URLSearchParams(''), undefined)).toBe(false)
  })
  it('can be forced either way', () => {
    expect(touchMode(new URLSearchParams('touch'), mq(false))).toBe(true)
    expect(touchMode(new URLSearchParams('touch=1'), mq(false))).toBe(true)
    expect(touchMode(new URLSearchParams('touch=0'), mq(true))).toBe(false)
  })
})

describe('pixelRatio', () => {
  it('keeps desktops at up to 2', () => {
    expect(pixelRatio(1, false)).toBe(1)
    expect(pixelRatio(2, false)).toBe(2)
    expect(pixelRatio(3, false)).toBe(2)
  })
  it('caps touch screens at 1.5', () => {
    expect(pixelRatio(3, true)).toBe(1.5)
    expect(pixelRatio(2, true)).toBe(1.5)
    expect(pixelRatio(1, true)).toBe(1)
    expect(pixelRatio(undefined, true)).toBe(1)
  })
  it('takes ?dpr= over either', () => {
    expect(pixelRatio(3, true, '2')).toBe(2)
    expect(pixelRatio(1, false, '0.5')).toBe(0.5)
    expect(pixelRatio(3, true, 'x')).toBe(1.5)
    expect(pixelRatio(3, true, '')).toBe(1.5)
    expect(pixelRatio(3, true, '9')).toBe(4)
  })
})

describe('promptFor', () => {
  it('reads as before on desktop', () => {
    expect(promptFor({ action: 'sit' }, false)).toEqual({ text: 'E · sit', button: null })
    expect(promptFor({ action: 'stand up', tip: 'Click the glass to drink' }, false))
      .toEqual({ text: 'Click the glass to drink · E · stand up', button: null })
    expect(promptFor({}, false)).toEqual({ text: null, button: null })
  })
  it('puts the action on a button on touch screens, and taps instead of clicks', () => {
    expect(promptFor({ action: 'sit' }, true)).toEqual({ text: null, button: 'Sit' })
    expect(promptFor({ action: 'stand up', tip: 'Click the glass to drink' }, true))
      .toEqual({ text: 'Tap the glass to drink', button: 'Stand up' })
    expect(promptFor({ action: null }, true)).toEqual({ text: null, button: null })
  })
})

describe('placeAbove', () => {
  const view = { w: 400, h: 800 }, size = { w: 200, h: 50 }
  const bounds = { top: 50, right: 10, bottom: 200, left: 10 }
  it('centres a box above the point', () => {
    expect(placeAbove({ x: 0, y: 0, z: 0.5 }, view, size, bounds)).toEqual({ x: 100, y: 342, visible: true })
  })
  it('keeps it inside the margins', () => {
    expect(placeAbove({ x: -1, y: 1, z: 0.5 }, view, size, bounds)).toMatchObject({ x: 10, y: 50 })
    expect(placeAbove({ x: 1, y: -1, z: 0.5 }, view, size, bounds)).toMatchObject({ x: 190, y: 550 })
  })
  it('hides it when the point is behind the camera or off screen', () => {
    expect(placeAbove({ x: 0, y: 0, z: 1.2 }, view, size, bounds).visible).toBe(false)
    expect(placeAbove({ x: 1.5, y: 0, z: 0.5 }, view, size, bounds).visible).toBe(false)
  })
})

describe('jukeboxLabels', () => {
  it('names what a tap would do', () => {
    expect(jukeboxLabels({ playing: false, muted: false })).toEqual({ play: 'Play', mute: 'Mute' })
    expect(jukeboxLabels({ playing: true, muted: true })).toEqual({ play: 'Pause', mute: 'Unmute' })
  })
})

describe('fovFor', () => {
  const across = (fov, aspect) => 2 * Math.atan(Math.tan(fov * Math.PI / 360) * aspect) * 180 / Math.PI
  it('leaves landscape and desktop screens at 60°', () => {
    for (const a of [16 / 9, 4 / 3, 1, 0.85]) expect(fovFor(a)).toBe(60)
  })
  it('keeps 50° across on a phone held upright', () => {
    const a = 390 / 844
    expect(fovFor(a)).toBeGreaterThan(60)
    expect(across(fovFor(a), a)).toBeCloseTo(50, 6)
    expect(fovFor(a)).toBeLessThan(95)
  })
})

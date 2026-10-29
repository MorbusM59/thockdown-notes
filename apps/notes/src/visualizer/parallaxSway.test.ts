import { describe, expect, it } from 'vitest'
import { BREATH_AMPLITUDE_MAX, MusicBreath, breathScales, swayDepth, swayOffset, swayOverscanPx } from './parallaxSway'

describe('swayOffset', () => {
  it('never travels past the overscan, at any depth or time', () => {
    const amplitude = 40
    for (let t = 0; t < 2000; t += 0.37) {
      for (let index = 0; index < 6; index += 1) {
        const { x, y } = swayOffset(index, 1, t, amplitude)
        expect(Math.abs(x)).toBeLessThanOrEqual(swayOverscanPx(amplitude))
        expect(Math.abs(y)).toBeLessThanOrEqual(swayOverscanPx(amplitude))
      }
    }
  })

  it('moves a near layer further than a far one, so they shift against each other', () => {
    let near = 0
    let far = 0
    for (let t = 0; t < 120; t += 0.5) {
      near += Math.abs(swayOffset(0, 1, t, 40).x)
      far += Math.abs(swayOffset(1, 0.3, t, 40).x)
    }
    expect(near).toBeGreaterThan(2.5 * far)
  })
})

describe('swayDepth', () => {
  it('gives every layer the nearest range at 0 and halves it layer by layer at 1', () => {
    for (const index of [0, 1, 4]) expect(swayDepth(index, 0)).toBe(1)
    expect([0, 1, 2, 3].map((index) => swayDepth(index, 1))).toEqual([1, 0.5, 0.25, 0.125])
  })

  it('stays inside the overscan with the music at its widest', () => {
    expect(breathScales(1e9).amplitude).toBe(BREATH_AMPLITUDE_MAX)
    const range = 200
    for (let t = 0; t < 500; t += 0.37) {
      const { x, y } = swayOffset(0, swayDepth(0, 0), t, range * BREATH_AMPLITUDE_MAX)
      expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(swayOverscanPx(range * BREATH_AMPLITUDE_MAX))
    }
  })
})

describe('MusicBreath', () => {
  it('reads 1 for steady music at any level, and settles to 0 in silence', () => {
    for (const level of [1e-6, 1, 1000]) {
      const breath = new MusicBreath()
      let value = 0
      for (let i = 0; i < 60 * 60; i += 1) value = breath.step(level, 1 / 60)
      expect(value).toBeCloseTo(1, 2)
      for (let i = 0; i < 60 * 20; i += 1) value = breath.step(0, 1 / 60)
      expect(value).toBeLessThan(0.01)
    }
  })

  it('widens the sway for a louder passage and keeps it within bounds', () => {
    expect(breathScales(0)).toEqual({ amplitude: 0.6, speed: 0.8 })
    expect(breathScales(1).amplitude).toBeCloseTo(1, 9)
    expect(breathScales(3)).toEqual({ amplitude: 1.5, speed: 1.3 })
  })
})

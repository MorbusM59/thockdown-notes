import { describe, expect, it } from 'vitest'
import { angleAbout, offsetDeltaForAngle, offsetVelocity, swipeLanding } from './escapeHoldSwipe'

describe('escape ring swipe', () => {
  it('turns the offset against a clockwise finger, one slot per slot angle, across the atan2 seam', () => {
    const count = 12
    expect(offsetDeltaForAngle((2 * Math.PI) / count, count)).toBeCloseTo(-1)
    // From just below +pi to just above -pi is a small clockwise turn, not most of a circle.
    const a = angleAbout(-10, 0.01, 0, 0)
    const b = angleAbout(-10, -0.01, 0, 0)
    expect(Math.abs(offsetDeltaForAngle(b - a, count))).toBeLessThan(0.01)
  })

  it('measures the lift speed in slots per second', () => {
    expect(offsetVelocity([{ offset: 0, t: 0 }, { offset: 2, t: 100 }])).toBeCloseTo(20)
    expect(offsetVelocity([{ offset: 0, t: 0 }])).toBe(0)
  })

  it('always rests on a whole slot within a turn, ahead of the motion, never sooner than the minimum', () => {
    for (const offset of [-3.4, -0.5, 0, 0.2, 5.7]) {
      for (const velocity of [-200, -8, -0.3, 0, 0.3, 8, 200]) {
        const { target, durationSec } = swipeLanding(offset, velocity, 10, 0.4)
        expect(Number.isInteger(target)).toBe(true)
        expect(Math.abs(target - offset)).toBeLessThanOrEqual(10.5)
        expect(durationSec).toBeGreaterThanOrEqual(0.4)
        if (Math.abs(velocity) >= 8) expect(Math.sign(target - offset)).toBe(Math.sign(velocity))
      }
    }
  })

  it('a still lift rests on the nearest slot', () => {
    expect(swipeLanding(2.3, 0, 8, 0.4)).toEqual({ target: 2, durationSec: 0.4 })
  })
})

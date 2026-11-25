import { describe, expect, it } from 'vitest'
import { durationLabel, fadeSecFor, remainingText, activeTimerSeconds, sanitizeTimer, stepDuration } from './timer'

describe('timer', () => {
  it('steps through the durations, stopping at either end', () => {
    expect(stepDuration(60, -1)).toBe(60)
    expect(stepDuration(90 * 60, 1)).toBe(2 * 3600)
    expect(stepDuration(16 * 3600, 3)).toBe(24 * 3600)
  })

  it('labels minutes up to 90, hours from 2', () => {
    expect(durationLabel(90 * 60)).toBe('90 m')
    expect(durationLabel(8 * 3600)).toBe('8 h')
  })

  it('fades over a tenth of the play time, at most five minutes', () => {
    expect(fadeSecFor(60)).toBe(6)
    expect(fadeSecFor(8 * 3600)).toBe(300)
  })

  it('shows the time left without leading zeros, and keeps stored settings on the grid', () => {
    expect(remainingText(3_909_000)).toBe('1:05:09')
    expect(remainingText(309_000)).toBe('5:09')
    expect(remainingText(8_400)).toBe('0:09')
    expect(sanitizeTimer({ durations: [7, 'x'], selected: 9, enabled: 'yes' })).toEqual({ durations: [60, 15 * 60, 3600, 7200, 8 * 3600], selected: 1, enabled: false })
    expect(activeTimerSeconds(sanitizeTimer({ selected: 2, enabled: true }))).toBe(3600)
    expect(activeTimerSeconds(sanitizeTimer({ selected: 2, enabled: false }))).toBe(0)
  })
})

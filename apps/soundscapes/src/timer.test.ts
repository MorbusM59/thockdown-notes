import { describe, expect, it } from 'vitest'
import { durationLines, fadeSecFor, MAX_DURATION_SEC, MIN_DURATION_SEC, remainingText, sanitizeTimer, stepDuration } from './timer'

describe('timer', () => {
  it('steps on a grid that coarsens as it grows, and a step down undoes a step up', () => {
    expect(stepDuration(55, 1)).toBe(60)
    expect(stepDuration(60, 1)).toBe(90)
    expect(stepDuration(60, -1)).toBe(55)
    expect(stepDuration(5 * 60, 1)).toBe(6 * 60)
    expect(stepDuration(60 * 60, -1)).toBe(55 * 60)
    expect(stepDuration(8 * 3600, 1)).toBe(9 * 3600)
    expect(stepDuration(8 * 3600, -1)).toBe(7.5 * 3600)
    for (let sec = MIN_DURATION_SEC; sec < MAX_DURATION_SEC; sec = stepDuration(sec, 1)) {
      expect(stepDuration(stepDuration(sec, 1), -1)).toBe(sec)
    }
  })

  it('holds within 5 seconds and 24 hours', () => {
    expect(stepDuration(5, -3)).toBe(5)
    expect(stepDuration(23 * 3600, 5)).toBe(24 * 3600)
  })

  it('labels the longer unit over the shorter, leaving out an empty one', () => {
    expect(durationLines(8 * 3600)).toEqual(['8 h'])
    expect(durationLines(80 * 60)).toEqual(['1 h', '20 min'])
    expect(durationLines(210)).toEqual(['3 min', '30 sec'])
    expect(durationLines(45)).toEqual(['45 sec'])
  })

  it('fades over a tenth of the play time, at most five minutes', () => {
    expect(fadeSecFor(60)).toBe(6)
    expect(fadeSecFor(8 * 3600)).toBe(300)
  })

  it('shows the time left without leading zeros, and keeps stored settings on the grid', () => {
    expect(remainingText(3_909_000)).toBe('1:05:09')
    expect(remainingText(309_000)).toBe('5:09')
    expect(remainingText(8_400)).toBe('0:09')
    expect(sanitizeTimer({ durations: [7, 'x'], active: 9 })).toEqual({ durations: [10, 15 * 60, 3600, 7200, 8 * 3600], active: null })
  })
})

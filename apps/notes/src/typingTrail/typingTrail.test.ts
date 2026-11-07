import { describe, expect, it } from 'vitest'
import { fadeCurve, nextTrailLevel, trailLevelAt, typesCharacter, type TrailBoxBirth } from './typingTrail'

const settings = { fadeMaxTime: 3, fadeShape: 0, gainPercent: 5 }

/** Types `count` characters `intervalSec` apart and returns each box's starting level. */
function run(count: number, intervalSec: number, s = settings, from: TrailBoxBirth | null = null, startSec = 0): number[] {
  const levels: number[] = []
  let last = from
  for (let i = 0; i < count; i += 1) {
    const now = startSec + i * intervalSec
    const level = nextTrailLevel(last, now, s)
    levels.push(level)
    last = { level, bornSec: now }
  }
  return levels
}

describe('fadeCurve', () => {
  it('runs from 1 to 0 over the fade time at every shape', () => {
    for (const shape of [-5, -1, 0, 1, 5]) {
      expect(fadeCurve(0, 3, shape)).toBe(1)
      expect(fadeCurve(3, 3, shape)).toBe(0)
      expect(fadeCurve(1.5, 3, shape)).toBeGreaterThan(0)
      expect(fadeCurve(1.5, 3, shape)).toBeLessThan(1)
    }
  })
})

describe('nextTrailLevel', () => {
  it('adds one step of gainPercent to what the previous box has faded to', () => {
    expect(nextTrailLevel(null, 0, settings)).toBeCloseTo(1 / 20)
    const previous = { level: 0.5, bornSec: 0 }
    expect(nextTrailLevel(previous, 1.5, settings)).toBeCloseTo(0.5 * 0.5 + 1 / 20)
  })

  it('settles in over 100 / gainPercent characters when typing is faster than a step fades', () => {
    // Back to back, the previous box has not faded at all: the n-th box is n x 5%.
    const levels = run(25, 0, settings)
    levels.slice(0, 20).forEach((level, i) => expect(level).toBeCloseTo((i + 1) / 20))
    expect(levels.slice(20).every((level) => level === 1)).toBe(true)
  })

  it('rises monotonically, never past 1, to the fixed point of its pace', () => {
    for (const interval of [0.05, 0.15, 0.4]) {
      const levels = run(400, interval, settings)
      for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] - 1e-12)
      expect(Math.max(...levels)).toBeLessThanOrEqual(1)
      // The fixed point L = L * fade(interval) + step, where it is below 1.
      const fade = fadeCurve(interval, settings.fadeMaxTime, settings.fadeShape)
      const fixed = Math.min(1, (settings.gainPercent / 100) / (1 - fade))
      expect(levels[levels.length - 1]).toBeCloseTo(fixed, 6)
    }
  })

  it('starts again from one step after a pause longer than the fade', () => {
    const before = run(30, 0.1, settings)
    const last = { level: before[before.length - 1], bornSec: 2.9 }
    expect(nextTrailLevel(last, 2.9 + settings.fadeMaxTime, settings)).toBeCloseTo(1 / 20)
  })

  it('reads the previous box through the fade shape', () => {
    const late = { ...settings, fadeShape: -3 }
    const box = { level: 1, bornSec: 0 }
    expect(trailLevelAt(box, 1.5, late)).toBeCloseTo(fadeCurve(1.5, 3, -3))
    expect(nextTrailLevel(box, 1.5, late)).toBeCloseTo(Math.min(1, fadeCurve(1.5, 3, -3) + 1 / 20))
  })
})

describe('typesCharacter', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra })
  it('takes a character or Space and nothing else', () => {
    expect(typesCharacter(key('a'))).toBe(true)
    expect(typesCharacter(key(' '))).toBe(true)
    expect(typesCharacter(key('Enter'))).toBe(false)
    expect(typesCharacter(key('a', { ctrlKey: true }))).toBe(false)
    expect(typesCharacter(key('@', { ctrlKey: true, altKey: true }))).toBe(true)
    expect(typesCharacter(key('a', { repeat: true }))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { curveSegment, curveYAt, editCurvePoint } from './drawnCurve'
import {
  DEFAULT_FLASHING_SETTINGS,
  FACTORY_FLASH_SHAPES,
  FLASH_BEATS_REPEAT,
  FLASH_MATCHINGS,
  FLASH_PLANE,
  flashLevelAt,
  flashLevels,
  flashPhaseAt,
  sanitizeFlashShapePreferences,
  sanitizeFlashMatching,
  sanitizeFlashShape,
} from './flashing'

describe('the flashing curve', () => {
  it('wraps: every factory curve meets itself at the seam in value and in slope', () => {
    for (const { settings: shape } of FACTORY_FLASH_SHAPES) {
      const curve = shape.curve
      const last = curve.length - 2
      const [start, out] = curveSegment(FLASH_PLANE, curve, 0)
      const [, , into, end] = curveSegment(FLASH_PLANE, curve, last)
      expect(end[1]).toBeCloseTo(start[1], 12)
      const slopeOut = out[0] === start[0] ? 0 : (out[1] - start[1]) / (out[0] - start[0])
      const slopeIn = into[0] === end[0] ? 0 : (end[1] - into[1]) / (end[0] - into[0])
      expect(slopeIn).toBeCloseTo(slopeOut, 9)
    }
  })

  it('keeps the seam closed whichever end is edited', () => {
    const curve = DEFAULT_FLASHING_SETTINGS.curve
    const fromEnd = editCurvePoint(FLASH_PLANE, curve, curve.length - 1, { y: 0.2, handle: 0.4 })
    expect(fromEnd[0]).toMatchObject({ y: 0.2, handle: 0.4 })
    const fromStart = editCurvePoint(FLASH_PLANE, curve, 0, { y: 0.7 })
    expect(fromStart[fromStart.length - 1].y).toBe(0.7)
  })

  it('stays inside 0..1 everywhere, every factory curve', () => {
    for (const { settings: shape } of FACTORY_FLASH_SHAPES) {
      for (let k = 0; k <= 480; k += 1) {
        const y = curveYAt(FLASH_PLANE, shape.curve, k / 480)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('samples a cycle whose last level is its first', () => {
    const levels = flashLevels(DEFAULT_FLASHING_SETTINGS.curve)
    expect(levels[levels.length - 1]).toBeCloseTo(levels[0], 12)
    expect(flashLevelAt(levels, 0)).toBe(levels[0])
    expect(flashLevelAt(levels, 1)).toBeCloseTo(levels[0], 12)
  })

  it('keeps every factory preset as it is through the sanitizer', () => {
    for (const { settings: shape } of FACTORY_FLASH_SHAPES) {
      expect(sanitizeFlashShape(shape)).toEqual(shape)
    }
  })
})

describe('matching the beat', () => {
  it('starts every cycle on the same beat after FLASH_BEATS_REPEAT beats, so the counted beat may wrap there', () => {
    for (const { cyclesPerBeat } of FLASH_MATCHINGS) {
      for (const beat of [0, 0.3, 1.7, 5.25, 11.9]) {
        expect(flashPhaseAt(beat + FLASH_BEATS_REPEAT, cyclesPerBeat)).toBeCloseTo(flashPhaseAt(beat, cyclesPerBeat), 9)
      }
    }
  })

  it('reads in bar notation: 4/4 a cycle a beat, 1/4 a cycle a bar starting on the one', () => {
    const at = (label: string) => FLASH_MATCHINGS.find((m) => m.label === label)!.cyclesPerBeat
    expect(flashPhaseAt(2.25, at('4/4'))).toBeCloseTo(0.25, 12)
    expect(flashPhaseAt(4, at('1/4'))).toBe(0)
    expect(flashPhaseAt(2, at('1/4'))).toBeCloseTo(0.5, 12)
  })
})

describe('sanitizing', () => {
  it('reads anything that is not an object as the defaults', () => {
    expect(sanitizeFlashShape(undefined)).toEqual({ curve: DEFAULT_FLASHING_SETTINGS.curve, cycleMs: DEFAULT_FLASHING_SETTINGS.cycleMs })
    expect(sanitizeFlashMatching(undefined)).toBe(DEFAULT_FLASHING_SETTINGS.matching)
    expect(sanitizeFlashShapePreferences(null).custom).toEqual([])
  })

  it('clamps the cycle and the matching, and closes a seam left open', () => {
    const out = sanitizeFlashShape({ cycleMs: 1, curve: [{ x: 0, y: 0.2, handle: 1 }, { x: 0.5, y: 3, handle: 9 }, { x: 1, y: 0.9, handle: 0 }] })
    expect(out.cycleMs).toBe(100)
    expect(sanitizeFlashMatching(99)).toBe(FLASH_MATCHINGS.length - 1)
    expect(out.curve).toEqual([{ x: 0, y: 0.2, handle: 1 }, { x: 0.5, y: 1, handle: 2 }, { x: 1, y: 0.2, handle: 1 }])
  })
})

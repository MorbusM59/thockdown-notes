import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WHEEL_STEP_LINES,
  DEFAULT_WHEEL_STEP_ROWS,
  formatWheelStepLines,
  getWheelStepLines,
  getWheelStepRows,
  resolveWheelStepLines,
  resolveWheelStepRows,
  setWheelStepLines,
  setWheelStepRows,
  WHEEL_STEP_LINES_MAX,
  WHEEL_STEP_LINES_MIN,
  WHEEL_STEP_ROWS_MAX,
  WHEEL_STEP_ROWS_MIN,
} from './wheelStep'

describe('wheelStep', () => {
  beforeEach(() => {
    setWheelStepRows(DEFAULT_WHEEL_STEP_ROWS)
    setWheelStepLines(DEFAULT_WHEEL_STEP_LINES)
  })

  it('keeps the edit view on whole rows', () => {
    expect(resolveWheelStepRows(3.4)).toBe(3)
    expect(resolveWheelStepRows(3.6)).toBe(4)
  })

  it('clamps a stored value from outside the current bounds', () => {
    expect(resolveWheelStepRows(0)).toBe(WHEEL_STEP_ROWS_MIN)
    expect(resolveWheelStepRows(99)).toBe(WHEEL_STEP_ROWS_MAX)
    expect(resolveWheelStepLines(0.1)).toBe(WHEEL_STEP_LINES_MIN)
    expect(resolveWheelStepLines(50)).toBe(WHEEL_STEP_LINES_MAX)
  })

  it('falls back to the default rather than propagating a broken value', () => {
    expect(resolveWheelStepRows(Number.NaN)).toBe(DEFAULT_WHEEL_STEP_ROWS)
    expect(resolveWheelStepLines(Number.NaN)).toBe(DEFAULT_WHEEL_STEP_LINES)
  })

  it('keeps the render view fractional', () => {
    expect(resolveWheelStepLines(2.7)).toBeCloseTo(2.7, 6)
    expect(formatWheelStepLines(2)).toBe('2.0')
  })

  it('clamps on the way into the live tunables too', () => {
    setWheelStepRows(999)
    setWheelStepLines(999)
    expect(getWheelStepRows()).toBe(WHEEL_STEP_ROWS_MAX)
    expect(getWheelStepLines()).toBe(WHEEL_STEP_LINES_MAX)
  })
})

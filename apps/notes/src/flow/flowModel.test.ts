import { describe, expect, it } from 'vitest'
import {
  EMPTY_FLOW_STATE,
  flowHit,
  flowLevelAt,
  hitWorth,
  isFlowHit,
  RHYTHM_BONUS,
  type FlowState,
  type FlowTuning,
} from './flowModel'

const TUNING: FlowTuning = { thresholdWpm: 45, gainPercent: 3, fadeSec: 2 }

/** Types `count` keys at the given intervals (cycled), returning the state and the time of the last key. */
function type(intervals: number[], count: number, tuning = TUNING, start: FlowState = EMPTY_FLOW_STATE, t0 = 0) {
  let state = start
  let t = t0
  for (let i = 0; i < count; i += 1) {
    t += intervals[i % intervals.length]
    state = flowHit(state, t, tuning)
  }
  return { state, t }
}

const atWpm = (wpm: number) => 12 / wpm

describe('flow model', () => {
  it('adds the build gain from the very first key', () => {
    const state = flowHit(EMPTY_FLOW_STATE, 0, TUNING)
    expect(state.levelAtHit).toBeCloseTo(0.03)
  })

  it('stays inside 0..1 however long and fast the typing', () => {
    const { state } = type([0.03], 5000)
    expect(state.levelAtHit).toBe(1)
  })

  it('a steady rhythm at the threshold earns the full bonus on top of full speed', () => {
    const interval = atWpm(45)
    expect(hitWorth([interval, interval, interval], interval, 45)).toBeCloseTo(1 + RHYTHM_BONUS)
  })

  it('the rhythm bonus falls to nothing at a 20% deviation and never goes negative', () => {
    const avg = atWpm(90)
    expect(hitWorth([avg, avg], avg * 1.2, 45) - hitWorth([avg, avg], avg * 1.5, 45)).toBe(0)
    expect(hitWorth([avg, avg], avg * 1.1, 45)).toBeCloseTo(1 + RHYTHM_BONUS / 2)
  })

  it('a steady rhythm below the threshold can out-earn an uneven one at it', () => {
    const steady = type([atWpm(40)], 60)
    const uneven = type([atWpm(45) * 0.6, atWpm(45) * 1.4], 60)
    expect(steady.state.levelAtHit).toBeGreaterThan(uneven.state.levelAtHit)
  })

  it('decays quadratically, empty exactly fadeSec after the last key', () => {
    const state: FlowState = { levelAtHit: 1, lastHitSec: 0, intervals: [] }
    expect(flowLevelAt(state, TUNING.fadeSec / Math.SQRT2, TUNING)).toBeCloseTo(0.5)
    expect(flowLevelAt(state, TUNING.fadeSec, TUNING)).toBe(0)
    expect(flowLevelAt(state, TUNING.fadeSec * 3, TUNING)).toBe(0)
  })

  it('a pause restarts the interval history', () => {
    const { state, t } = type([atWpm(60)], 20)
    expect(state.intervals.length).toBe(10)
    expect(flowHit(state, t + 3, TUNING).intervals).toEqual([])
  })

  it('counts characters, Space and Enter as hits and nothing else', () => {
    const k = (key: string, extra: Partial<KeyboardEvent> = {}) =>
      isFlowHit({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra })
    expect(k('a')).toBe(true)
    expect(k(' ')).toBe(true)
    expect(k('Enter')).toBe(true)
    expect(k('Backspace')).toBe(false)
    expect(k('ArrowLeft')).toBe(false)
    expect(k('z', { ctrlKey: true })).toBe(false)
    expect(k('@', { ctrlKey: true, altKey: true })).toBe(true)
    expect(k('a', { repeat: true })).toBe(false)
  })
})

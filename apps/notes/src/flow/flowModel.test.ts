import { describe, expect, it } from 'vitest'
import {
  classifyFlowKey,
  EMPTY_FLOW_STATE,
  flowHit,
  flowLevelAt,
  hitGain,
  type FlowState,
  type FlowTuning,
} from './flowModel'

const TUNING: FlowTuning = { thresholdWpm: 45, buildKeys: 150, fadeSec: 2.5, rhythm: 0.5 }

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

/** The level a steady pattern settles at: typed until two passes agree. */
function settledLevel(intervals: number[], tuning = TUNING): number {
  const { state, t } = type(intervals, 4000, tuning)
  const again = type(intervals, intervals.length * 50, tuning, state, t)
  expect(Math.abs(again.state.levelAtHit - state.levelAtHit)).toBeLessThan(0.02)
  return again.state.levelAtHit
}

const atWpm = (wpm: number) => 12 / wpm

describe('flow model', () => {
  it('stays inside 0..1 however long and fast the typing', () => {
    const { state } = type([0.03], 20000)
    expect(state.levelAtHit).toBeGreaterThan(0.9)
    expect(state.levelAtHit).toBeLessThanOrEqual(1)
  })

  it('settles at a fixed point that rises with speed', () => {
    const slow = settledLevel([atWpm(30)])
    const threshold = settledLevel([atWpm(45)])
    const fast = settledLevel([atWpm(90)])
    expect(slow).toBeLessThan(threshold)
    expect(threshold).toBeLessThan(fast)
    expect(slow).toBeLessThan(0.3)
    expect(fast).toBeGreaterThan(0.6)
  })

  it('pays an even rhythm more than an uneven one at the same average speed', () => {
    const mean = atWpm(70)
    const even = settledLevel([mean])
    const uneven = settledLevel([mean * 0.5, mean * 1.5])
    expect(uneven).toBeLessThan(even)
  })

  it('makes an uneven rhythm cost more the stricter the rhythm setting', () => {
    // Same geometric mean, so the same speed reading. Some cost remains at
    // zero strictness: the longer gaps decay more, which is the pause rule
    // and not the rhythm rule.
    const mean = atWpm(70)
    const cost = (rhythm: number) => {
      const tuning = { ...TUNING, rhythm }
      return settledLevel([mean], tuning) - settledLevel([mean / 1.5, mean * 1.5], tuning)
    }
    expect(cost(0)).toBeLessThan(cost(0.5))
    expect(cost(0.5)).toBeLessThan(cost(1))
  })

  it('reaches about 90% in buildKeys perfect, decay-free hits', () => {
    const g = hitGain(TUNING.buildKeys)
    expect(Math.pow(1 - g, TUNING.buildKeys)).toBeCloseTo(0.1, 10)
  })

  it('fades to exactly half at fadeSec after the last hit, and the fade accelerates', () => {
    const state: FlowState = { ...EMPTY_FLOW_STATE, levelAtHit: 1, lastHitSec: 0 }
    expect(flowLevelAt(state, TUNING.fadeSec, TUNING)).toBeCloseTo(0.5, 10)
    const lossInFirstSecond = 1 - flowLevelAt(state, 1, TUNING)
    const lossInSecondSecond = flowLevelAt(state, 1, TUNING) - flowLevelAt(state, 2, TUNING)
    expect(lossInSecondSecond).toBeGreaterThan(lossInFirstSecond)
  })

  it('gives nothing until the rhythm has been heard, and restarts the estimate after a pause', () => {
    const first = type([atWpm(80)], 3)
    expect(first.state.levelAtHit).toBe(0)
    const flowing = type([atWpm(80)], 200)
    const afterPause = flowHit(flowing.state, flowing.t + 3, TUNING)
    expect(afterPause.intervals).toBe(0)
    expect(afterPause.levelAtHit).toBeLessThan(flowing.state.levelAtHit)
  })
})

describe('flow keys', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
    classifyFlowKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra })

  it('counts characters, Space and Enter as hits', () => {
    expect(key('a')).toBe('hit')
    expect(key(' ')).toBe('hit')
    expect(key('Enter')).toBe('hit')
  })

  it('breaks on corrections, caret moves and shortcuts', () => {
    for (const k of ['Backspace', 'Delete', 'ArrowLeft', 'ArrowUp', 'Home', 'PageDown']) expect(key(k)).toBe('break')
    expect(key('z', { ctrlKey: true })).toBe('break')
    expect(key('Backspace', { repeat: true })).toBe('break')
  })

  it('ignores modifiers, Tab and auto-repeat', () => {
    expect(key('Shift')).toBe('ignore')
    expect(key('Tab')).toBe('ignore')
    expect(key('a', { repeat: true })).toBe('ignore')
  })
})

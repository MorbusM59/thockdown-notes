import { describe, expect, it } from 'vitest'
import {
  decayed,
  EMPTY_FLOW_STATE,
  FLOW_BUFFER,
  flowHit,
  flowLevelAt,
  hitWorth,
  isFlowHit,
  presentedFlow,
  RHYTHM_BONUS,
  secondsToEmpty,
  sustainWpm,
  TICK_SEC,
  type FlowState,
  type FlowTuning,
} from './flowModel'

// The idle decay is held off so these tests see the per-tick decay alone.
const TUNING: FlowTuning = { gainPercent: 5, decayPercent: 1, idleGraceMs: 1e9, idleShape: 0, idleDuration: 1 }

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
    expect(flowHit(EMPTY_FLOW_STATE, 0, TUNING).levelAtHit).toBeCloseTo(0.05)
  })

  it('one tick loses d of the level and d of a full meter: 80% becomes 78.2%', () => {
    expect(decayed(0.8, TICK_SEC, 1)).toBeCloseTo(0.782)
  })

  it('reaches exactly zero in finite time, and stays there', () => {
    const t = secondsToEmpty(1, 1)
    expect(decayed(1, t, 1)).toBeCloseTo(0, 9)
    expect(decayed(1, t * 0.99, 1)).toBeGreaterThan(0)
    expect(decayed(1, t * 2, 1)).toBe(0)
  })

  it('the level never leaves 0..1 + buffer however fast the typing', () => {
    const { state } = type([0.01], 5000)
    expect(state.levelAtHit).toBeLessThanOrEqual(1 + FLOW_BUFFER)
    expect(presentedFlow(state.levelAtHit)).toBe(1)
  })

  it('reaching full from below fills the buffer at once', () => {
    const start: FlowState = { levelAtHit: 0.97, lastHitSec: 0, intervals: [] }
    expect(flowHit(start, 0, TUNING).levelAtHit).toBe(1 + FLOW_BUFFER)
  })

  it('above the sustaining pace a full meter holds at full; below it, it settles lower', () => {
    const uneven = (wpm: number) => [atWpm(wpm) * 0.6, atWpm(wpm) * 1.4]
    const fast = type(uneven(sustainWpm(TUNING) * 1.15), 600)
    expect(presentedFlow(flowLevelAt(fast.state, fast.t + atWpm(100), TUNING))).toBe(1)
    const slow = type(uneven(sustainWpm(TUNING) * 0.5), 600)
    expect(flowLevelAt(slow.state, slow.t, TUNING)).toBeLessThan(0.6)
  })

  it('a steady rhythm lowers the pace a full meter needs', () => {
    expect(sustainWpm(TUNING)).toBeCloseTo(96)
    expect(sustainWpm(TUNING, 1 + RHYTHM_BONUS)).toBeCloseTo(64)
    const steady = type([atWpm(75)], 600)
    expect(presentedFlow(flowLevelAt(steady.state, steady.t, TUNING))).toBe(1)
  })

  it('the rhythm bonus falls to nothing at a 20% deviation and never goes negative', () => {
    const avg = atWpm(90)
    expect(hitWorth([avg, avg], avg)).toBeCloseTo(1 + RHYTHM_BONUS)
    expect(hitWorth([avg, avg], avg * 1.1)).toBeCloseTo(1 + RHYTHM_BONUS / 2)
    expect(hitWorth([avg, avg], avg * 1.5)).toBe(1)
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

describe('idle decay', () => {
  const idle: FlowTuning = { gainPercent: 5, decayPercent: 0.5, idleGraceMs: 500, idleShape: -0.5, idleDuration: 1.5 }
  const full: FlowState = { levelAtHit: 1.2, lastHitSec: 0, intervals: [] }
  it('leaves the level alone through the grace period', () => {
    expect(flowLevelAt(full, 0.5, idle)).toBe(decayed(1.2, 0.5, 0.5))
  })
  it('empties a full meter exactly at grace + duration', () => {
    expect(flowLevelAt(full, 1.99, idle)).toBeGreaterThan(0)
    expect(flowLevelAt(full, 2, idle)).toBe(0)
  })
})

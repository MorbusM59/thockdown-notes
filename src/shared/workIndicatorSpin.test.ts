import { describe, expect, it } from 'vitest'
import {
  WORK_INDICATOR_AT_REST,
  WORK_INDICATOR_STEP_DEG,
  advanceWorkIndicator,
  resolveWorkIndicatorTiming,
} from './workIndicatorSpin'

/**
 * The wheel's artwork repeats every 45°, so "at rest" and "at rest, one tooth
 * on" are the same picture -- and resting anywhere else is the difference
 * between a mechanism and a stalled spinner. Everything here is that one
 * property, asserted across the settings range rather than at one comfortable
 * set of values, because the durations are DERIVED from those settings and a
 * derivation is exactly the thing that can be right for the values its author
 * happened to try.
 */
/**
 * `angle % 45` is the wrong test: at 89.99999999999994 it returns 44.99999...,
 * which reads as "half a tooth out" when the angle is 90 to fourteen digits.
 * Distance to the nearest whole tooth is the property meant.
 */
function expectRestsOnTooth(angleDeg: number, label = '') {
  const teeth = angleDeg / WORK_INDICATOR_STEP_DEG
  expect(Math.abs(teeth - Math.round(teeth)), `${label} angle ${angleDeg}`).toBeLessThan(1e-6)
}

const SETTINGS = [
  { speedX: 0.0, ramp: 0.5, skew: 0.5 },
  { speedX: 0.5, ramp: 0.2, skew: 0.3 },
  { speedX: 0.85, ramp: 0.9, skew: 0.7 },
  { speedX: 1.0, ramp: 0.1, skew: 0.9 },
]

function runToRest(
  settings: { speedX: number; ramp: number; skew: number },
  workingFor: (elapsedSec: number) => boolean,
  frameSec = 1 / 60,
  maxSeconds = 120,
) {
  const timing = resolveWorkIndicatorTiming(settings.speedX, settings.ramp, settings.skew)
  let state = WORK_INDICATOR_AT_REST
  let elapsed = 0
  let started = false
  while (elapsed < maxSeconds) {
    const working = workingFor(elapsed)
    state = advanceWorkIndicator(state, frameSec, working, timing)
    if (state.phase !== 'idle') started = true
    if (started && state.phase === 'idle') break
    elapsed += frameSec
  }
  return { state, timing, started }
}

describe('the work indicator comes to rest on a tooth', () => {
  it.each(SETTINGS)('after a very short piece of work (%o)', (settings) => {
    // One frame of work: still a full attack and a full release, because a
    // phase runs to completion. 90 degrees, the documented minimum.
    const { state, started } = runToRest(settings, (elapsed) => elapsed < 0.001)
    expect(started).toBe(true)
    expect(state.phase).toBe('idle')
    expect(state.angleDeg).toBeCloseTo(2 * WORK_INDICATOR_STEP_DEG, 6)
  })

  it.each(SETTINGS)('after work that outlasts several sustain increments (%o)', (settings) => {
    const { state, timing } = runToRest(settings, (elapsed) => elapsed < timingHold(settings))
    expect(state.phase).toBe('idle')
    expectRestsOnTooth(state.angleDeg)
    // Attack + at least one sustain + release.
    expect(state.angleDeg).toBeGreaterThanOrEqual(3 * WORK_INDICATOR_STEP_DEG - 1e-6)
    expect(timing.maxSpeedDegPerSec).toBeGreaterThan(0)
  })

  function timingHold(settings: { speedX: number; ramp: number; skew: number }) {
    const timing = resolveWorkIndicatorTiming(settings.speedX, settings.ramp, settings.skew)
    return timing.attackSec + timing.sustainSec * 2.5
  }

  it('rests on a tooth for randomized work patterns and frame rates', () => {
    let seed = 20260913
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    for (let trial = 0; trial < 400; trial += 1) {
      const settings = SETTINGS[Math.floor(rng() * SETTINGS.length)]
      // Irregular frames, including long stalls -- a dropped frame must not
      // desynchronise the angle from the phase.
      const frameSec = 0.004 + rng() * 0.12
      const stopAt = rng() * 3
      const { state, started } = runToRest(settings, (elapsed) => elapsed < stopAt, frameSec)
      expect(started).toBe(true)
      expect(state.phase, `trial ${trial}`).toBe('idle')
      expectRestsOnTooth(state.angleDeg, `trial ${trial}`)
    }
  })

  it('never runs backwards, whatever the phase', () => {
    const settings = SETTINGS[1]
    const timing = resolveWorkIndicatorTiming(settings.speedX, settings.ramp, settings.skew)
    let state = WORK_INDICATOR_AT_REST
    let previous = 0
    for (let frame = 0; frame < 600; frame += 1) {
      const working = frame < 120
      state = advanceWorkIndicator(state, 1 / 60, working, timing)
      expect(state.angleDeg).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = state.angleDeg
    }
  })

  it('stays at rest while nothing is working', () => {
    const settings = SETTINGS[0]
    const timing = resolveWorkIndicatorTiming(settings.speedX, settings.ramp, settings.skew)
    let state = WORK_INDICATOR_AT_REST
    for (let frame = 0; frame < 100; frame += 1) {
      state = advanceWorkIndicator(state, 1 / 60, false, timing)
    }
    expect(state).toEqual(WORK_INDICATOR_AT_REST)
  })
})

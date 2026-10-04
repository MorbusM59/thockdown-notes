import { describe, expect, it } from 'vitest'
import {
  cancelWheelSpin,
  createWheelSpinState,
  DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
  DEFAULT_WHEEL_SPIN_THRESHOLD_MS,
  nextWheelSpinDelayMs,
  refreshWheelSpinCoast,
  registerWheelSpinNudge,
  resolveWheelSpinDecay,
  takeWheelSpinNudge,
  formatWheelSpinThreshold,
  resolveWheelSpinThresholdMs,
  WHEEL_SPIN_DAMPEN_DIVISOR_MAX,
  WHEEL_SPIN_DAMPEN_DIVISOR_MIN,
  WHEEL_SPIN_DAMPEN_ENDLESS,
  DEFAULT_WHEEL_SPIN_CUTOFF_MS,
  WHEEL_SPIN_CUTOFF_MAX_MS,
  WHEEL_SPIN_CUTOFF_MIN_MS,
  WHEEL_SPIN_GRACE_MS,
  WHEEL_SPIN_THRESHOLD_MAX_MS,
  WHEEL_SPIN_THRESHOLD_MIN_MS,
  WHEEL_SPIN_THRESHOLD_OFF,
  type WheelSpinAction,
  type WheelSpinDirection,
  type WheelSpinState,
} from './wheelSpin'

const THRESHOLD_MS = 100
const DIVISOR = 91 // a = 1/(10*(101-91)) = 0.01
const CUTOFF_MS = 500

const nudge = (
  state: WheelSpinState,
  nowMs: number,
  direction: WheelSpinDirection = -1,
  thresholdMs = THRESHOLD_MS,
): WheelSpinAction => registerWheelSpinNudge(state, { nowMs, direction, rows: 1, thresholdMs })

/** A spin of three nudges 40ms apart, so d_avg is 40. */
const coasting = (startMs = 0) => {
  const state = createWheelSpinState()
  nudge(state, startMs)
  nudge(state, startMs + 40)
  nudge(state, startMs + 80)
  return state
}

describe('registerWheelSpinNudge', () => {
  it('starts a coast on the third nudge inside the threshold, and that nudge still scrolls', () => {
    const state = createWheelSpinState()
    expect(nudge(state, 0)).toEqual({ kind: 'scroll', rows: 1, startsCoast: false })
    expect(nudge(state, 40)).toEqual({ kind: 'scroll', rows: 1, startsCoast: false })
    expect(nudge(state, 80)).toEqual({ kind: 'scroll', rows: 1, startsCoast: true })
    expect(state.coast?.averageGapMs).toBe(40)
  })

  it('does not start a coast when a gap exceeds the threshold', () => {
    const state = createWheelSpinState()
    nudge(state, 0)
    nudge(state, 40)
    nudge(state, 40 + THRESHOLD_MS + 1)
    nudge(state, 40 + THRESHOLD_MS + 41)
    expect(state.coast).toBeNull()
  })

  it('needs three nudges in the SAME direction', () => {
    const state = createWheelSpinState()
    nudge(state, 0, -1)
    nudge(state, 40, -1)
    nudge(state, 80, 1) // reversal restarts the streak
    nudge(state, 120, 1)
    expect(state.coast).toBeNull()
    expect(nudge(state, 160, 1)).toEqual({ kind: 'scroll', rows: 1, startsCoast: true })
    expect(state.coast?.direction).toBe(1)
  })

  it('swallows real input for a flat 500ms, then answers it', () => {
    const state = coasting()
    expect(nudge(state, 80 + WHEEL_SPIN_GRACE_MS - 1)).toEqual({ kind: 'ignore' })
    // Same way, past the grace: a request for more, not an interruption.
    expect(nudge(state, 80 + WHEEL_SPIN_GRACE_MS)).toEqual({ kind: 'extend', rows: 1 })
    expect(state.coast).not.toBeNull()
  })

  it('stops only on a nudge the other way', () => {
    const state = coasting()
    // However many times the reader nudges along with it, the coast lives.
    for (let n = 1; n <= 5; n += 1) {
      expect(nudge(state, 1000 + (n * 200))).toEqual({ kind: 'extend', rows: 1 })
      expect(state.coast).not.toBeNull()
    }
    expect(nudge(state, 3000, 1)).toEqual({ kind: 'stop' })
    expect(state.coast).toBeNull()
  })

  it('honours a reversal inside the grace window, without waiting it out', () => {
    // The grace is the hand finishing its own spin, and a hand finishing a
    // spin does not reverse -- so a reversal in there is a real one, and
    // making the reader wait 500ms for it reads as the wheel being ignored.
    const state = coasting()
    expect(nudge(state, 80 + 10, 1)).toEqual({ kind: 'stop' })
    expect(state.coast).toBeNull()
  })

  it('offers a fresh spin the same way as a respin, without adopting it', () => {
    const state = coasting()
    const past = 80 + WHEEL_SPIN_GRACE_MS
    expect(nudge(state, past)).toEqual({ kind: 'extend', rows: 1 })
    expect(nudge(state, past + 20)).toEqual({ kind: 'extend', rows: 1 })
    expect(nudge(state, past + 40)).toEqual({ kind: 'respin', rows: 1, averageGapMs: 20 })
    // Deliberately untouched: only the caller knows how fast the coast is
    // actually going, so only the caller can decide this is worth taking.
    expect(state.coast?.averageGapMs).toBe(40)
    expect(state.coast?.ignoreUntilMs).toBe(80 + WHEEL_SPIN_GRACE_MS)
  })

  it('re-opens the grace window when a respin is adopted', () => {
    const state = coasting()
    const past = 80 + WHEEL_SPIN_GRACE_MS
    nudge(state, past)
    nudge(state, past + 20)
    nudge(state, past + 40)
    refreshWheelSpinCoast(state, past + 40, 20, 3)
    expect(state.coast?.averageGapMs).toBe(20)
    expect(state.coast?.rowsPerNudge).toBe(3)
    expect(state.coast?.firedCount).toBe(0)
    // The new spin has a tail of its own, exactly as the first one did.
    expect(nudge(state, past + 60)).toEqual({ kind: 'ignore' })
  })

  it('gives a fast spin the same 500ms of grace as a slow one', () => {
    // The window is the hand finishing its gesture, not a multiple of how
    // fast the wheel was going -- so a 5ms-gap spin gets 500ms too, where a
    // proportional window would have given it 10.
    const state = createWheelSpinState()
    nudge(state, 0)
    nudge(state, 5)
    nudge(state, 10)
    expect(state.coast?.ignoreUntilMs).toBe(10 + WHEEL_SPIN_GRACE_MS)
    expect(nudge(state, 400)).toEqual({ kind: 'ignore' })
  })

  it('lets a stopped coast be re-started by a fresh spin', () => {
    const state = coasting()
    nudge(state, 1000, 1) // the other way: stops, scrolls nothing
    expect(state.coast).toBeNull()
    nudge(state, 1500)
    nudge(state, 1540)
    expect(nudge(state, 1580)).toEqual({ kind: 'scroll', rows: 1, startsCoast: true })
  })
})

describe('resolveWheelSpinDecay', () => {
  it('is 1/(10*(101-c)), so a higher c damps harder', () => {
    expect(resolveWheelSpinDecay(WHEEL_SPIN_DAMPEN_DIVISOR_MIN)).toBeCloseTo(0.001, 10)
    expect(resolveWheelSpinDecay(51)).toBeCloseTo(0.002, 10)
    expect(resolveWheelSpinDecay(WHEEL_SPIN_DAMPEN_DIVISOR_MAX)).toBeCloseTo(0.1, 10)
    expect(resolveWheelSpinDecay(90)).toBeGreaterThan(resolveWheelSpinDecay(10))
  })

  it('is exactly 0 at the off position, which 1/(10*(101-c)) can never reach', () => {
    expect(resolveWheelSpinDecay(WHEEL_SPIN_DAMPEN_ENDLESS)).toBe(0)
    // One step in from it is an ordinary, very gentle decay -- not zero.
    expect(resolveWheelSpinDecay(WHEEL_SPIN_DAMPEN_DIVISOR_MIN)).toBeGreaterThan(0)
  })

  it('clamps a divisor from outside the slider, and never divides by zero', () => {
    expect(resolveWheelSpinDecay(10_000)).toBeCloseTo(0.1, 10) // clamped to c = 100
    expect(resolveWheelSpinDecay(-5)).toBe(0) // below the off position is still off
    expect(resolveWheelSpinDecay(Number.NaN))
      .toBe(resolveWheelSpinDecay(DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR))
  })
})

describe('formatWheelSpinThreshold', () => {
  it('says the word at the off position, and the millisecond count everywhere else', () => {
    expect(formatWheelSpinThreshold(WHEEL_SPIN_THRESHOLD_OFF)).toBe('off')
    expect(formatWheelSpinThreshold(WHEEL_SPIN_THRESHOLD_MIN_MS)).toBe('10')
    expect(formatWheelSpinThreshold(WHEEL_SPIN_THRESHOLD_MAX_MS)).toBe('50')
  })
})

describe('resolveWheelSpinThresholdMs', () => {
  it('resolves the off position to the 0 the rest of the code bypasses on', () => {
    expect(resolveWheelSpinThresholdMs(WHEEL_SPIN_THRESHOLD_OFF)).toBe(0)
    expect(resolveWheelSpinThresholdMs(WHEEL_SPIN_THRESHOLD_MIN_MS)).toBe(10)
    expect(resolveWheelSpinThresholdMs(Number.NaN)).toBe(0)
  })
})

describe('defaults', () => {
  it('are the ones the sliders are documented to start at', () => {
    expect(DEFAULT_WHEEL_SPIN_THRESHOLD_MS).toBe(20)
    expect(DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR).toBe(20)
    expect(DEFAULT_WHEEL_SPIN_CUTOFF_MS).toBe(150)
    expect(resolveWheelSpinDecay(DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR)).toBeCloseTo(1 / 810, 10)
  })
})

describe('nextWheelSpinDelayMs', () => {
  it('fires the first simulated nudge one average gap after the third real one', () => {
    expect(nextWheelSpinDelayMs(coasting(), DIVISOR, CUTOFF_MS)).toBe(40)
  })

  it('follows d_n = d_avg * (1 + n*a)^n', () => {
    const state = coasting()
    const seen: number[] = []
    for (let i = 0; i < 5; i += 1) {
      seen.push(nextWheelSpinDelayMs(state, DIVISOR, CUTOFF_MS) as number)
      takeWheelSpinNudge(state)
    }
    // a = 0.01: 40, 40*1.01, 40*1.02^2, 40*1.03^3, 40*1.04^4
    expect(seen[0]).toBe(40)
    expect(seen[1]).toBeCloseTo(40.4, 6)
    expect(seen[2]).toBeCloseTo(41.616, 6)
    expect(seen[3]).toBeCloseTo(43.70908, 5)
    expect(seen[4]).toBeCloseTo(46.7943424, 5)
    // Both the base and the exponent grow, so each step out-paces the last.
    const steps = seen.slice(1).map((delay, i) => delay - seen[i])
    expect(steps.every((step, i) => i === 0 || step > steps[i - 1])).toBe(true)
  })

  it('ends the coast once an interval exceeds the cut off', () => {
    const state = coasting()
    let last = 0
    let guard = 0
    for (;;) {
      const delayMs = nextWheelSpinDelayMs(state, DIVISOR, CUTOFF_MS)
      if (delayMs === null) break
      expect(delayMs).toBeLessThanOrEqual(CUTOFF_MS)
      last = delayMs
      takeWheelSpinNudge(state)
      guard += 1
      expect(guard).toBeLessThan(1000)
    }
    expect(guard).toBeGreaterThan(1) // it really did coast, not stop immediately
    expect(last).toBeGreaterThan(CUTOFF_MS / 2) // and it ran right up to the cut off
  })

  it('ends sooner at a tighter cut off', () => {
    const count = (cutoffMs: number) => {
      const state = coasting()
      let fired = 0
      while (nextWheelSpinDelayMs(state, DIVISOR, cutoffMs) !== null && fired < 1000) {
        takeWheelSpinNudge(state)
        fired += 1
      }
      return fired
    }
    expect(count(WHEEL_SPIN_CUTOFF_MIN_MS)).toBeLessThan(count(WHEEL_SPIN_CUTOFF_MAX_MS))
  })

  it('clamps a cut off from outside the slider rather than trusting it', () => {
    // 0 would otherwise end every coast on its first nudge.
    expect(nextWheelSpinDelayMs(coasting(), DIVISOR, 0)).toBe(40)
    expect(nextWheelSpinDelayMs(coasting(), DIVISOR, Number.NaN)).toBe(40)
  })

  it('never ends by itself at the endless position, and never slows down', () => {
    const state = coasting()
    for (let i = 0; i < 5000; i += 1) {
      expect(nextWheelSpinDelayMs(state, WHEEL_SPIN_DAMPEN_ENDLESS, CUTOFF_MS)).toBe(40)
      takeWheelSpinNudge(state)
    }
    // ...and it is still the user, not the clock, that ends it -- by
    // reversing, which is now the only nudge that means stop.
    expect(nudge(state, 100_000, 1)).toEqual({ kind: 'stop' })
    expect(nextWheelSpinDelayMs(state, WHEEL_SPIN_DAMPEN_ENDLESS, CUTOFF_MS)).toBeNull()
  })

  it('reports nothing to schedule once cancelled', () => {
    const state = coasting()
    cancelWheelSpin(state)
    expect(nextWheelSpinDelayMs(state, DIVISOR, CUTOFF_MS)).toBeNull()
    expect(takeWheelSpinNudge(state)).toBeNull()
  })
})

describe('the coast direction and size', () => {
  it('carries the direction and row count of the spin', () => {
    const state = createWheelSpinState()
    registerWheelSpinNudge(state, { nowMs: 0, direction: 1, rows: 2, thresholdMs: THRESHOLD_MS })
    registerWheelSpinNudge(state, { nowMs: 30, direction: 1, rows: 2, thresholdMs: THRESHOLD_MS })
    registerWheelSpinNudge(state, { nowMs: 60, direction: 1, rows: 2, thresholdMs: THRESHOLD_MS })
    expect(takeWheelSpinNudge(state)).toEqual({ direction: 1, rows: 2 })
  })
})

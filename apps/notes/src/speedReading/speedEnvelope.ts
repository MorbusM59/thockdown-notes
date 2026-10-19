/**
 * How fast speed reading is going right now, as a share of the chosen words
 * per minute: 0 is stopped, 1 is the full pace.
 *
 * The share follows the app's bell (`@thockdown/interaction/smoothCurve`'s
 * `evaluateCurve` through `warpForSkew`), read as a VELOCITY: the bell's
 * leading half, from its start to its apex, is the ease from rest up to full
 * pace, and its trailing half, from the apex to its end, is the ease back down
 * to rest. That is the shape a held page key travels with -- the page key's
 * continuous scroll ramps up the same leading half and its release coasts down
 * the same trailing one -- with the curve's three numbers the reader's own
 * speed-reading settings rather than the Animations section's.
 *
 * The bell never reaches zero at its ends (its value there is about a tenth of
 * its peak), so each half is normalised against its own end: 0 exactly at
 * rest, 1 exactly at the apex. Without that a pause would never stop, it would
 * crawl at a tenth of the pace.
 *
 * The state is a single number, `x`, the position on the curve from 0 to 1.
 * `x` at or below the apex is the rising half, above it the falling half, and
 * each half is monotone. A change of direction part-way through a half maps
 * the share it had reached onto the other half (`turn`), so the pace is
 * continuous through any reversal: releasing a pause half-way down speeds up
 * from the half-way pace, not from the top or from rest.
 */
import { evaluateCurve, warpForSkew } from '@thockdown/interaction/smoothCurve'
import { deriveRenderScrollResponsivenessFromDynamic } from '@thockdown/interaction/ScrollCurvePlan'

export interface SpeedCurve {
  /** The bell's dynamic `a`. */
  ramp: number
  /** The apex position, 0..1. */
  shape: number
  /** Seconds the whole bell takes; 0 makes every change instant. */
  speedSec: number
}

/** The curve's raw value at `x` (0..1 along it). */
function raw(curve: SpeedCurve, x: number): number {
  const t = 1
  const b = deriveRenderScrollResponsivenessFromDynamic(curve.ramp)
  return evaluateCurve(warpForSkew(x * t, t, curve.shape), Math.max(0.0001, curve.ramp), b, t)
}

/** The share of the full pace at `x`. */
export function speedShareAt(curve: SpeedCurve, x: number): number {
  const apex = curve.shape
  const peak = raw(curve, apex)
  if (x <= apex) {
    const floor = raw(curve, 0)
    const span = peak - floor
    return span > 0 ? Math.max(0, Math.min(1, (raw(curve, x) - floor) / span)) : (x >= apex ? 1 : 0)
  }
  const floor = raw(curve, 1)
  const span = peak - floor
  return span > 0 ? Math.max(0, Math.min(1, (raw(curve, x) - floor) / span)) : 0
}

/** The `x` in [lo, hi] where the share is `share`, the half being monotone in `direction`. */
function invert(curve: SpeedCurve, share: number, lo: number, hi: number, rising: boolean): number {
  let a = lo
  let b = hi
  for (let i = 0; i < 24; i += 1) {
    const mid = (a + b) / 2
    const value = speedShareAt(curve, mid)
    if ((value < share) === rising) a = mid
    else b = mid
  }
  return (a + b) / 2
}

export interface SpeedEnvelopeState {
  x: number
}

/** At rest, ready to rise. */
export const RESTING: SpeedEnvelopeState = { x: 0 }

/** Moves the state onto the half that leads toward `target`, keeping its share. */
function turn(curve: SpeedCurve, state: SpeedEnvelopeState, target: 0 | 1): SpeedEnvelopeState {
  const apex = curve.shape
  if (target === 1 && state.x > apex) {
    if (state.x >= 1) return { x: 0 }
    return { x: invert(curve, speedShareAt(curve, state.x), 0, apex, true) }
  }
  if (target === 0 && state.x < apex) {
    if (state.x <= 0) return { x: 1 }
    return { x: invert(curve, speedShareAt(curve, state.x), apex, 1, false) }
  }
  return state
}

export interface SpeedEnvelopeStep {
  state: SpeedEnvelopeState
  /** The share now, after the step. */
  share: number
  /** The share integrated over the step, in seconds at full pace. */
  fullPaceSec: number
}

/**
 * Advances `dtSec` toward `target`.
 *
 * The integral is a trapezoid over the step, which at frame-sized steps is
 * well inside what a reader could notice; the curve itself is sampled exactly.
 */
export function stepSpeedEnvelope(
  curve: SpeedCurve,
  state: SpeedEnvelopeState,
  target: 0 | 1,
  dtSec: number,
): SpeedEnvelopeStep {
  const turned = turn(curve, state, target)
  const before = speedShareAt(curve, turned.x)
  const apex = curve.shape
  const end = target === 1 ? apex : 1
  const dx = curve.speedSec > 0 ? Math.max(0, dtSec) / curve.speedSec : Number.POSITIVE_INFINITY
  const x = Math.min(end, turned.x + dx)
  const after = speedShareAt(curve, x)
  return { state: { x }, share: after, fullPaceSec: ((before + after) / 2) * Math.max(0, dtSec) }
}

// A cogwheel that turns while the app is working, and stops on a tooth.
//
// The wheel's artwork is invariant under a 45° rotation, so 45° is the
// smallest movement that leaves it looking like itself. That is what makes
// this readable as a MECHANISM rather than as a spinner: it never rests
// mid-tooth, because every phase it can be in is exactly 45°.
//
//   ATTACK    45°, accelerating from rest to full speed
//   SUSTAIN   45° at full speed, repeated for as long as work continues
//   RELEASE   45°, decelerating back to rest
//
// The decision to keep going is taken at the END of each increment, never
// mid-turn, which is what removes the need for any rule about where a
// wind-down is allowed to start: every boundary is a tooth by construction.
//
// A single very short task therefore still turns the wheel 90° -- attack then
// release -- so a worker that finishes in 40ms reads as one deliberate click
// of a mechanism instead of a flicker. There is deliberately no "don't show
// work shorter than X" threshold: the minimum turn IS that mechanism, and it
// tells the truth (something happened) rather than hiding it.
//
// ## Durations are solved from the angle, never assumed
//
// The attack and release use the app's own animation curves, shaped by the
// reader's ramp/shape/speed settings -- so they must cover exactly 45°
// whatever those settings are. The two curves do not have the same area under
// them, so giving them a shared duration would give them different angles and
// the wheel would drift off its teeth. Instead each duration is derived: the
// curve's normalized area is measured, and the duration that makes it
// integrate to 45° is the one used. The settings then change how the turn
// FEELS and never where it stops.

import {
  resolveCursorClickDurationSec,
  sampleCursorHoldLevel,
  sampleCursorHoldReleaseLevel,
} from '../editor/CursorClickCurve'

/** The wheel's own symmetry, and therefore the size of every phase. */
export const WORK_INDICATOR_STEP_DEG = 45

/** Resolution of the travel tables. Plenty for a monotonic ramp, and cheap. */
const CURVE_SAMPLES = 256

/**
 * How much of a phase's 45° has been travelled by each point in its duration
 * -- a normalized cumulative integral of the velocity curve, from 0 to
 * exactly 1.
 *
 * A TABLE rather than an integral evaluated per frame, for two reasons, and
 * the second one is a defect this replaced rather than a preference.
 *
 * It is O(1) per frame instead of dozens of curve samples. And it is
 * MONOTONIC by construction: the first version integrated per frame with one
 * sample count and normalized by an area computed with another, so near the
 * end of a phase the two estimates disagreed by ~1e-3, the ratio clipped at
 * 1, and the next frame's estimate came in under it. The wheel ran backwards
 * by five thousandths of a degree -- invisible, and exactly the kind of thing
 * that makes a mechanism read as not-quite-real without anyone being able to
 * say why. Sharing one table means the two can no longer disagree.
 */
function buildTravelTable(sample: (progress: number) => number): Float64Array {
  const table = new Float64Array(CURVE_SAMPLES + 1)
  let running = 0
  for (let index = 1; index <= CURVE_SAMPLES; index += 1) {
    running += Math.max(0, sample((index - 0.5) / CURVE_SAMPLES))
    table[index] = running
  }
  const total = table[CURVE_SAMPLES]
  if (total <= 0) {
    for (let index = 0; index <= CURVE_SAMPLES; index += 1) table[index] = index / CURVE_SAMPLES
    return table
  }
  for (let index = 0; index <= CURVE_SAMPLES; index += 1) table[index] /= total
  return table
}

/** Mean height of a travel table's own curve -- its last running total over its span. */
function meanHeightOf(sample: (progress: number) => number): number {
  let total = 0
  for (let index = 0; index < CURVE_SAMPLES; index += 1) {
    total += Math.max(0, sample((index + 0.5) / CURVE_SAMPLES))
  }
  return Math.max(0.0001, total / CURVE_SAMPLES)
}

/** Reads a normalized travel table at `progress`, linearly between samples. */
function readTravelTable(table: Float64Array, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  const position = clamped * CURVE_SAMPLES
  const low = Math.floor(position)
  if (low >= CURVE_SAMPLES) return table[CURVE_SAMPLES]
  return table[low] + (table[low + 1] - table[low]) * (position - low)
}

export interface WorkIndicatorTiming {
  /** Degrees per second at full speed. */
  maxSpeedDegPerSec: number
  attackSec: number
  sustainSec: number
  releaseSec: number
  attackTravel: Float64Array
  releaseTravel: Float64Array
}

/**
 * Solves the three phase durations for one set of animation settings.
 *
 * `speedX`, `ramp` and `skew` are the reader's own cursor-animation sliders,
 * used here for the same reason the halo and the twitch use them: this is one
 * animation vocabulary, and a mechanism that ignored them would be the one
 * moving part in the app that does not answer to those controls.
 */
export function resolveWorkIndicatorTiming(speedX: number, ramp: number, skew: number): WorkIndicatorTiming {
  // The attack's own duration comes from the speed slider; its SPEED is then
  // whatever makes it cover 45° in that time.
  const attackSec = Math.max(0.05, resolveCursorClickDurationSec(speedX))
  const attackCurve = (progress: number) => sampleCursorHoldLevel(progress * attackSec, ramp, skew, attackSec)
  const maxSpeedDegPerSec = WORK_INDICATOR_STEP_DEG / (attackSec * meanHeightOf(attackCurve))

  // At full speed, a sustain increment is simply how long 45° takes.
  const sustainSec = WORK_INDICATOR_STEP_DEG / maxSpeedDegPerSec

  // The release decays on its own curve, so its duration is solved
  // independently to cover the same 45°. Probed at the attack's duration
  // purely to measure the curve's SHAPE; the duration that comes out is what
  // makes it travel 45°.
  const releaseProbeSec = attackSec
  const releaseCurve = (progress: number) => sampleCursorHoldReleaseLevel(1, progress * releaseProbeSec, ramp, skew, releaseProbeSec)
  const releaseSec = WORK_INDICATOR_STEP_DEG / (maxSpeedDegPerSec * meanHeightOf(releaseCurve))

  return {
    maxSpeedDegPerSec,
    attackSec,
    sustainSec,
    releaseSec,
    attackTravel: buildTravelTable(attackCurve),
    releaseTravel: buildTravelTable(releaseCurve),
  }
}

export type WorkIndicatorPhase = 'idle' | 'attack' | 'sustain' | 'release'

export interface WorkIndicatorState {
  phase: WorkIndicatorPhase
  /** Degrees turned within the current phase, in [0, 45]. */
  phaseDeg: number
  /** Total degrees turned since the wheel last rested. Only ever read modulo 360. */
  angleDeg: number
  elapsedSec: number
}

export const WORK_INDICATOR_AT_REST: WorkIndicatorState = {
  phase: 'idle',
  phaseDeg: 0,
  angleDeg: 0,
  elapsedSec: 0,
}

/** Where within its own 45° a phase has got to, as a fraction. */
function phaseProgress(state: WorkIndicatorState, timing: WorkIndicatorTiming): number {
  if (state.phase === 'attack') return Math.min(1, state.elapsedSec / timing.attackSec)
  if (state.phase === 'release') return Math.min(1, state.elapsedSec / timing.releaseSec)
  return Math.min(1, state.elapsedSec / timing.sustainSec)
}

/**
 * Advances the wheel by one frame.
 *
 * Pure, and the reason it is pure is that the interesting property -- that
 * the wheel only ever comes to rest on a multiple of 45° -- is then something
 * a test can assert over thousands of random frame timings and work patterns,
 * rather than something anyone has to watch for.
 *
 * A phase always runs to completion. Work arriving during a RELEASE therefore
 * lets that release finish and starts a fresh attack afterwards, rather than
 * re-accelerating mid-turn: the decision points are the boundaries, and
 * inventing a fourth, partial curve to rejoin between them would be the one
 * piece of this that could land the wheel off a tooth. The window in which
 * that costs a visible stop is one release long, and only for work that
 * arrives inside it -- anything arriving before the boundary never starts a
 * release at all.
 */
export function advanceWorkIndicator(
  state: WorkIndicatorState,
  deltaSec: number,
  isWorking: boolean,
  timing: WorkIndicatorTiming,
): WorkIndicatorState {
  if (state.phase === 'idle') {
    if (!isWorking) return state
    return { phase: 'attack', phaseDeg: 0, angleDeg: state.angleDeg, elapsedSec: 0 }
  }

  const phaseSec = state.phase === 'attack'
    ? timing.attackSec
    : state.phase === 'release'
      ? timing.releaseSec
      : timing.sustainSec

  const nextElapsed = state.elapsedSec + Math.max(0, deltaSec)

  if (nextElapsed < phaseSec) {
    const advanced = { ...state, elapsedSec: nextElapsed }
    // The angle is integrated from the curve rather than tracked separately,
    // so a dropped frame cannot desynchronise the two.
    const travelled = WORK_INDICATOR_STEP_DEG * travelFraction(state.phase, phaseProgress(advanced, timing), timing)
    return {
      phase: state.phase,
      phaseDeg: travelled,
      angleDeg: state.angleDeg - state.phaseDeg + travelled,
      elapsedSec: nextElapsed,
    }
  }

  // The phase completed: land exactly on the boundary, then decide.
  const landedAngle = state.angleDeg - state.phaseDeg + WORK_INDICATOR_STEP_DEG
  const overshootSec = nextElapsed - phaseSec

  if (state.phase === 'release') {
    const rested: WorkIndicatorState = { phase: 'idle', phaseDeg: 0, angleDeg: landedAngle, elapsedSec: 0 }
    return isWorking
      ? advanceWorkIndicator(rested, overshootSec, isWorking, timing)
      : rested
  }

  const next: WorkIndicatorState = {
    phase: isWorking ? 'sustain' : 'release',
    phaseDeg: 0,
    angleDeg: landedAngle,
    elapsedSec: 0,
  }
  return overshootSec > 0
    ? advanceWorkIndicator(next, overshootSec, isWorking, timing)
    : next
}

/** The fraction of this phase's 45° travelled by `progress` of its duration. */
function travelFraction(
  phase: WorkIndicatorPhase,
  progress: number,
  timing: WorkIndicatorTiming,
): number {
  if (phase === 'sustain') return Math.max(0, Math.min(1, progress))
  return readTravelTable(phase === 'attack' ? timing.attackTravel : timing.releaseTravel, progress)
}

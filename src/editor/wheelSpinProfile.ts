// A wheel spin's whole coast, planned once and sampled as a smooth curve.
//
// ## What this replaces, and why
//
// `wheelSpin.ts` describes a coast as a series of simulated nudges: the nth
// one lands d_n = d_avg * (1 + n*a)^n after the last, and each is worth one
// nudge of distance. The edit view fires those as discrete row steps, which
// is correct there -- text is never between rows (interaction design 3d).
//
// The render view has no row grid, and its earlier delivery paid each nudge
// out at CONSTANT velocity over its own interval. That made the nudge
// distance a unit of animation as well as of calculation, and it shows up in
// the numbers: velocity fell in one instant by up to 9% at the default
// settings and 17% at a slow spin with heavy dampening, and each of those
// steps was held flat for as long as 450ms near the end of a coast, where
// the intervals are longest. Then, at the cut off, speed went from a seventh
// of its starting value to zero in a single frame. A stair, ending in a
// cliff.
//
// Here the nudge distance goes back to being only what it always meant: how
// far the coast travels and how fast. It decides nothing about how the
// pixels are laid down.
//
// ## The dots, and the curve through them
//
// A coast is fully determined the moment it is detected -- d_avg, a, the cut
// off and the pixels per nudge are all known -- so there is nothing to
// discover one segment at a time and no reason to re-plan per nudge. In
// practice the schedule is 22 to 63 nudges long across the whole slider
// range, so walking all of it once costs nothing.
//
// That walk produces the coast as a series of DOTS: at time T_n the reader
// has travelled n nudges, arriving at speed P/d_(n-1). A monotone cubic
// (PCHIP) through those dots is then the motion itself:
//
//   - it passes exactly through every dot, so the coast is at the model's
//     own distance at every nudge time -- the schedule is interpolated, not
//     approximated, and none of `wheelSpin.ts`'s behaviour is restated here;
//   - it is C1, which is the stair gone;
//   - it is shape-preserving, so between two dots it can neither reverse nor
//     overshoot -- a plain cubic spline can do both, and a scroll that backs
//     up by a pixel mid-coast is a defect a reader would notice;
//   - it is sampled from absolute elapsed time, the same property
//     `NonQuantizedSmoothScroll` is built on, so a dropped or late frame
//     self-corrects instead of quietly losing distance.
//
// The endpoint slopes are the adjacent secants rather than the usual
// one-sided estimate, because at both ends the model already knows the
// answer and it is load-bearing: at the start it is d_avg exactly -- the
// rate the hand set, which is what makes a coast feel like a continuation --
// and at the end it is the speed the tail below has to pick up at.
//
// ## The tail
//
// The cut off says an interval this long no longer reads as motion. It does
// not say the motion should stop mid-stride, which is what ending at dot N
// amounted to. So the nudge that would have exceeded the cut off is not
// discarded, it is spent braking: the coast hands off at its final speed to
// `buildReleaseRampDownPlanFromCurrentParams`, the same bell tail the
// key-held continuous scroll releases with and every journey ramps down
// through. The join is C1 by construction, since the ramp is built at
// exactly the speed the last dot arrives at, and the coast ends the way
// every other motion in this app ends.
//
// Two consequences of using the shared curve rather than a bespoke one, both
// deliberate. The ramp covers whatever distance its shape dictates at that
// speed -- 40px on top of a 3,149px coast at the defaults -- so a coast's
// total travel is no longer an exact whole number of nudges. And the bell is
// truncated at its own endpoint rather than carried to zero: f(t)/f(apex) is
// about 19% at the default dynamic and responsiveness, which is true of every
// release ramp in the app. So the coast does not end at rest, it ends below
// the threshold of noticing -- at the defaults the schedule used to stop dead
// from 558px/s, or 9.3px per 60fps frame, and now stops from 39px/s, or
// 0.65px. That absolute figure is the thing worth holding, and it is what
// this module's test pins.
//
// ## What the notch that started it had not finished
//
// A spin is detected on its third real notch, and by then
// `wheelNotchTravel.ts` is part-way through delivering the first two on a
// curve of its own -- notches arrive faster than one of them is paid out, so
// close to two nudges' worth is still owed at the moment the coast takes
// over. The coast inherits that remainder rather than dropping it, folded in
// over the notch travel's own duration by a smootherstep, whose zero
// velocity and zero acceleration at both ends mean the extra distance
// arrives without putting a step into the curve it is added to.
//
// ## What is frozen, and what is not
//
// The decay and the cut off are read once, here, and baked into the profile.
// They used to be read per segment, which meant dragging the dampen slider
// re-shaped a gesture already in flight. Planning once requires freezing
// them, and freezing them is also the truer reading: the shape of a gesture
// is set by the hand that made it. The auto-scroll threshold's off position
// is the exception and stays live -- switching the feature off is a request
// to stop now, not at the next spin.

import {
  buildReleaseRampDownPlanFromCurrentParams,
  sampleReleaseRampDownPlan,
  type ReleaseRampDownPlan,
} from '@thockdown/interaction/ScrollCurvePlan'
import { resolveWheelSpinCutoffMs, resolveWheelSpinDecay } from './wheelSpin'

export type WheelSpinProfileDirection = -1 | 1

/**
 * Distance added to a coast without disturbing its schedule.
 *
 * Two different things need this and they want different pacing, which is
 * why the blend is per-carry rather than a property of the profile.
 *
 * The first is the remainder of the notch that STARTED the coast -- distance
 * the reader asked for before the coast existed and which is merely
 * undelivered. It is owed, not urgent, so it spreads across the whole
 * schedule where it cannot be seen arriving.
 *
 * The second is a nudge the reader gives DURING a coast, asking for one more
 * line. That is a fresh request and should visibly answer, so it arrives
 * over a notch's own travel time.
 *
 * Both use a smootherstep, whose zero velocity and zero acceleration at each
 * end mean an added distance cannot put a step into the curve it is added
 * to -- the whole point of the module it is being added to.
 */
export interface WheelSpinCarry {
  /** Unsigned pixels, along the coast's direction of travel. */
  px: number
  /** Profile time at which this begins folding in. */
  startMs: number
  /** How long it takes to fold in. */
  blendMs: number
}

/**
 * A ceiling on how many nudges a coast may be planned as.
 *
 * The schedule terminates on its own for any positive decay -- the longest
 * the sliders can actually produce is 63 nudges -- so this catches nothing a
 * user can reach. It is here because the loop's exit condition is a
 * floating-point comparison against a growing power, and an unbounded loop
 * built on one is a hang waiting for a rounding edge case.
 */
const MAX_PLANNED_NUDGES = 2000

/**
 * How long an endless coast takes to fold in its carry.
 *
 * An endless coast has no schedule length to borrow, since it has no end.
 * A second is long enough that the added speed is a small fraction of a
 * coast's own, and short enough that the distance is not still trickling in
 * a page later.
 */
const ENDLESS_CARRY_BLEND_MS = 1000

export interface WheelSpinProfile {
  direction: WheelSpinProfileDirection
  /** Pixels one nudge is worth -- what a real notch moved. */
  pixelsPerNudge: number
  /**
   * Set only at the dampen slider's endless position, where a is 0.
   *
   * There is no schedule to plan then: the intervals never grow, so the
   * coast is one constant speed with no last dot and nothing to ramp down
   * from. It ends when the reader or the document ends it.
   */
  endlessSpeedPxPerMs: number | null
  /** Dot times, T_0 = 0 through T_N, ascending. */
  timesMs: Float64Array
  /** Dot distances, 0 through N * pixelsPerNudge. */
  distancesPx: Float64Array
  /** The PCHIP slope at each dot, in px/ms: the coast's speed there. */
  slopesPxPerMs: Float64Array
  /** When the last dot is reached and the ramp takes over. */
  tailStartMs: number
  /** Distance at the last dot -- what the ramp's own displacement adds to. */
  tailStartPx: number
  tailPlan: ReleaseRampDownPlan | null
  tailDurationMs: number
  tailDistancePx: number
  /** Past this the coast is over. */
  totalDurationMs: number
  /**
   * Extra distance owed on top of the schedule, each folded in from its own
   * moment. See `WheelSpinCarry`.
   */
  carries: WheelSpinCarry[]
  /** Forward-walking sample cursor. Mutable; a profile belongs to one coast. */
  cursor: number
}

export interface WheelSpinProfileInput {
  direction: WheelSpinProfileDirection
  /** Pixels one nudge is worth, always positive. */
  pixelsPerNudge: number
  /** The mean gap of the spin that started this, in ms. */
  averageGapMs: number
  /** The dampen slider's c, resolved to a by `resolveWheelSpinDecay`. */
  dampenDivisor: number
  /** The cut off slider's d_max, in ms. */
  cutoffMs: number
  /**
   * Distance the notch that started this coast had not delivered yet.
   *
   * The third real nudge of a spin is still being paid out by
   * `wheelNotchTravel.ts` when the coast takes over -- close to two nudges'
   * worth, because notches arrive far faster than one of them is delivered.
   * Dropping it would mean every spin silently travelled less than the hand
   * turned, so the coast carries it instead, folded in over `carryBlendMs`
   * by a smootherstep: zero velocity AND zero acceleration at both ends, so
   * the carry adds distance without putting a step anywhere in the curve it
   * is added to. Optional; zero when nothing was in flight.
   */
  carryPx?: number
  /**
   * Over how long the carry is folded in.
   *
   * Defaults to the schedule's own length, which is almost always what it
   * should be -- see where it is resolved for the numbers. Ignored when
   * there is no carry.
   */
  carryBlendMs?: number
}

/**
 * Fritsch-Carlson slopes: monotone, and each one the model's own speed.
 *
 * The interior slope at a dot is the weighted harmonic mean of the two
 * secants around it, which for a schedule this smooth lands within a percent
 * of P/d_n -- the speed the coast is actually travelling at that dot. The
 * harmonic mean is itself the limiter that makes PCHIP monotone; no separate
 * clamp is needed while every secant is positive, which they are (distance
 * only ever grows).
 */
function buildMonotoneSlopes(timesMs: Float64Array, distancesPx: Float64Array): Float64Array {
  const count = timesMs.length
  const slopes = new Float64Array(count)
  if (count < 2) return slopes

  const secants = new Float64Array(count - 1)
  for (let i = 0; i < count - 1; i += 1) {
    const h = timesMs[i + 1] - timesMs[i]
    secants[i] = h > 0 ? (distancesPx[i + 1] - distancesPx[i]) / h : 0
  }

  // Both ends take the adjacent secant: the model already knows the true
  // speed there and both endpoints are load-bearing -- see the module
  // comment.
  slopes[0] = secants[0]
  slopes[count - 1] = secants[count - 2]

  for (let i = 1; i < count - 1; i += 1) {
    const previous = secants[i - 1]
    const next = secants[i]
    if (previous <= 0 || next <= 0) {
      slopes[i] = 0
      continue
    }
    const hPrevious = timesMs[i] - timesMs[i - 1]
    const hNext = timesMs[i + 1] - timesMs[i]
    const w1 = (2 * hNext) + hPrevious
    const w2 = hNext + (2 * hPrevious)
    slopes[i] = (w1 + w2) / ((w1 / previous) + (w2 / next))
  }

  return slopes
}

/**
 * Plan a whole coast from the spin that started it.
 *
 * Everything the coast will do is decided here; `sampleWheelSpinProfile`
 * only reads it back.
 */
export function buildWheelSpinProfile(input: WheelSpinProfileInput): WheelSpinProfile {
  const { direction } = input
  const pixelsPerNudge = Math.abs(input.pixelsPerNudge)
  const averageGapMs = Math.max(1, input.averageGapMs)
  const decay = resolveWheelSpinDecay(input.dampenDivisor)
  const rawCarryPx = input.carryPx ?? 0
  // The carry is stored in the profile's own currency: unsigned distance
  // along the direction of travel. A remainder pointing the other way is not
  // this coast's to deliver.
  const carryPx = Number.isFinite(rawCarryPx) && rawCarryPx * direction > 0
    ? Math.abs(rawCarryPx)
    : 0

  const empty = new Float64Array(0)

  if (decay === 0) {
    return {
      direction,
      pixelsPerNudge,
      endlessSpeedPxPerMs: pixelsPerNudge / averageGapMs,
      timesMs: empty,
      distancesPx: empty,
      slopesPxPerMs: empty,
      tailStartMs: Number.POSITIVE_INFINITY,
      tailStartPx: 0,
      tailPlan: null,
      tailDurationMs: 0,
      tailDistancePx: 0,
      totalDurationMs: Number.POSITIVE_INFINITY,
      carries: carryPx > 0
        ? [{ px: carryPx, startMs: 0, blendMs: Math.max(1, input.carryBlendMs ?? ENDLESS_CARRY_BLEND_MS) }]
        : [],
      cursor: 0,
    }
  }

  const cutoffMs = resolveWheelSpinCutoffMs(input.cutoffMs)

  // The dots. Dot 0 is the moment the coast begins, having travelled
  // nothing; dot n+1 follows dot n by d_n. The schedule is over on the first
  // interval that exceeds the cut off, and that interval is never walked --
  // it is the one the tail is spent on instead.
  const times: number[] = [0]
  const distances: number[] = [0]
  let elapsedMs = 0
  let lastIntervalMs = averageGapMs
  for (let n = 0; n < MAX_PLANNED_NUDGES; n += 1) {
    const intervalMs = averageGapMs * Math.pow(1 + (n * decay), n)
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > cutoffMs) break
    elapsedMs += intervalMs
    lastIntervalMs = intervalMs
    times.push(elapsedMs)
    distances.push((n + 1) * pixelsPerNudge)
  }

  const timesMs = Float64Array.from(times)
  const distancesPx = Float64Array.from(distances)
  const slopesPxPerMs = buildMonotoneSlopes(timesMs, distancesPx)

  // The speed the tail picks up at: the last dot's, or -- for a coast so
  // short it has no second dot, which the sliders cannot currently produce
  // but their clamps do not forbid -- the rate the hand set.
  const finalSpeedPxPerMs = timesMs.length >= 2
    ? slopesPxPerMs[slopesPxPerMs.length - 1]
    : pixelsPerNudge / lastIntervalMs
  const tailPlan = buildReleaseRampDownPlanFromCurrentParams(1, finalSpeedPxPerMs * 1000)
  const tailDurationMs = tailPlan ? tailPlan.tailDurationSec * 1000 : 0
  const tailDistancePx = tailPlan
    ? Math.abs(sampleReleaseRampDownPlan(tailPlan, tailPlan.tailDurationSec))
    : 0

  const tailStartMs = timesMs[timesMs.length - 1]
  // Spread over the whole schedule unless the caller says otherwise. The
  // carry is distance the reader has already asked for, so it is owed --
  // but it is not urgent, and the two readings are very different to watch.
  // Folded into the coast's first tenth of a second it peaks at 3,545px/s on
  // top of an opening 3,840px/s, which is a lurch; spread across the
  // schedule the same 208px peaks at about 200px/s against an average of
  // 1,650px/s, which is nothing. Same distance, arriving where it cannot be
  // seen arriving.
  const carryBlendMs = Math.max(1, input.carryBlendMs ?? tailStartMs)

  return {
    direction,
    pixelsPerNudge,
    endlessSpeedPxPerMs: null,
    timesMs,
    distancesPx,
    slopesPxPerMs,
    tailStartMs,
    tailStartPx: distancesPx[distancesPx.length - 1],
    tailPlan,
    tailDurationMs,
    tailDistancePx,
    totalDurationMs: tailStartMs + tailDurationMs,
    carries: carryPx > 0 ? [{ px: carryPx, startMs: 0, blendMs: carryBlendMs }] : [],
    cursor: 0,
  }
}

/**
 * 6x^5 - 15x^4 + 10x^3: zero first AND second derivative at both ends.
 *
 * Which is the whole reason the carry uses it rather than a linear fade --
 * an eased-in extra distance that starts and ends at zero velocity and zero
 * acceleration cannot introduce the very step this module exists to remove.
 */
function smootherstep(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * x * ((x * ((x * 6) - 15)) + 10)
}

/** Everything every carry has delivered by `elapsedMs`. */
function carryAt(profile: WheelSpinProfile, elapsedMs: number): number {
  let total = 0
  for (const carry of profile.carries) {
    total += carry.px * smootherstep((elapsedMs - carry.startMs) / carry.blendMs)
  }
  return total
}

/**
 * Signed distance the profile's carries still owe at `atMs`: asked for by
 * the hand, not yet folded into the scroll.
 *
 * What a coast being REPLACED must hand to its successor. A respin builds a
 * new profile from scratch, and without this the nudges that were still
 * folding in -- the extends that began the respin streak, the rest of the
 * spin's own opening carry -- were simply never scrolled.
 */
export function wheelSpinProfileUndeliveredCarryPx(profile: WheelSpinProfile, atMs: number): number {
  let owed = 0
  for (const carry of profile.carries) {
    owed += carry.px * (1 - smootherstep((atMs - carry.startMs) / carry.blendMs))
  }
  return profile.direction * owed
}

/**
 * Add distance to a coast already running, folded in from `atMs`.
 *
 * This is what a nudge in the coast's own direction does: the reader asking
 * for one more line, answered without disturbing the schedule underneath.
 * A carry pointing the other way is not this coast's to deliver and is
 * refused -- a reversal stops a coast, it does not shorten one.
 */
export function addWheelSpinProfileCarry(
  profile: WheelSpinProfile,
  signedPx: number,
  atMs: number,
  blendMs: number,
): void {
  if (!Number.isFinite(signedPx) || signedPx * profile.direction <= 0) return
  profile.carries.push({
    px: Math.abs(signedPx),
    startMs: Math.max(0, atMs),
    blendMs: Math.max(1, blendMs),
  })
}

/**
 * When everything this profile owes has been delivered.
 *
 * Not simply `totalDurationMs`: a carry added late in a coast can still be
 * folding in after the schedule and its tail are both spent, and reporting
 * the coast finished then would drop the very distance the reader last asked
 * for.
 */
export function wheelSpinProfileEndMs(profile: WheelSpinProfile): number {
  let endMs = profile.totalDurationMs
  for (const carry of profile.carries) {
    endMs = Math.max(endMs, carry.startMs + carry.blendMs)
  }
  return endMs
}

/**
 * How fast the coast is travelling at `atMs`, in px/ms.
 *
 * Central difference over the sampler, so it reads the schedule, the tail
 * and any carry in flight alike. Its inverse -- pixels per nudge divided by
 * this -- is the coast's effective nudge interval, which is the number a
 * fresh spin has to beat to be worth adopting.
 */
export function wheelSpinProfileSpeedPxPerMs(profile: WheelSpinProfile, atMs: number): number {
  const h = 0.25
  const from = Math.max(0, atMs - h)
  const to = atMs + h
  const span = to - from
  if (span <= 0) return 0
  return (sampleWheelSpinProfile(profile, to).travelledPx
    - sampleWheelSpinProfile(profile, from).travelledPx) / span
}

export interface WheelSpinProfileSample {
  /** Unsigned distance travelled since the coast began. */
  travelledPx: number
  /** True once the schedule and its tail are both spent. */
  finished: boolean
}

/** Cubic Hermite on [t_i, t_i+1], in the standard basis. */
function sampleHermite(
  timesMs: Float64Array,
  distancesPx: Float64Array,
  slopesPxPerMs: Float64Array,
  index: number,
  elapsedMs: number,
): number {
  const h = timesMs[index + 1] - timesMs[index]
  if (!(h > 0)) return distancesPx[index + 1]
  const s = (elapsedMs - timesMs[index]) / h
  const s2 = s * s
  const s3 = s2 * s
  const h00 = (2 * s3) - (3 * s2) + 1
  const h10 = s3 - (2 * s2) + s
  const h01 = (-2 * s3) + (3 * s2)
  const h11 = s3 - s2
  return (h00 * distancesPx[index])
    + (h10 * h * slopesPxPerMs[index])
    + (h01 * distancesPx[index + 1])
    + (h11 * h * slopesPxPerMs[index + 1])
}

/**
 * How far the coast has travelled `elapsedMs` after it began.
 *
 * A function of absolute elapsed time, not of what happened on previous
 * frames: a caller that samples late, or misses a frame entirely, is given
 * the distance the schedule actually owes rather than one accumulated from
 * whatever it managed to observe.
 */
export function sampleWheelSpinProfile(
  profile: WheelSpinProfile,
  elapsedMs: number,
): WheelSpinProfileSample {
  const at = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0

  const carriedPx = carryAt(profile, at)

  if (profile.endlessSpeedPxPerMs !== null) {
    return { travelledPx: (profile.endlessSpeedPxPerMs * at) + carriedPx, finished: false }
  }

  if (at >= profile.totalDurationMs) {
    return {
      travelledPx: profile.tailStartPx + profile.tailDistancePx + carriedPx,
      finished: at >= wheelSpinProfileEndMs(profile),
    }
  }

  if (at >= profile.tailStartMs) {
    const tailElapsedSec = (at - profile.tailStartMs) / 1000
    const displacement = profile.tailPlan
      ? Math.abs(sampleReleaseRampDownPlan(profile.tailPlan, tailElapsedSec))
      : 0
    return { travelledPx: profile.tailStartPx + displacement + carriedPx, finished: false }
  }

  const { timesMs, distancesPx, slopesPxPerMs } = profile
  const lastIndex = timesMs.length - 2
  if (lastIndex < 0) return { travelledPx: carriedPx, finished: false }

  // Time only advances within a coast, so the cursor walks forward and
  // almost never moves more than one step. The backward walk is for the
  // caller that resamples an earlier moment -- a test, or a stall clamp that
  // holds the clock still.
  let cursor = profile.cursor
  if (cursor > lastIndex) cursor = lastIndex
  while (cursor < lastIndex && timesMs[cursor + 1] <= at) cursor += 1
  while (cursor > 0 && timesMs[cursor] > at) cursor -= 1
  profile.cursor = cursor

  return {
    travelledPx: sampleHermite(timesMs, distancesPx, slopesPxPerMs, cursor, at) + carriedPx,
    finished: false,
  }
}

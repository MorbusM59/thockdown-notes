// One wheel notch, delivered on a curve instead of written straight to the
// scroller -- and spliced, not restarted, when the next notch arrives.
//
// ## Why a notch is not a jump
//
// The render view owns its notches (interaction design 3d): the browser's own
// scrolling is preventDefault'd so a notch can be worth what the reader asked
// for rather than whatever pixel delta the device sent. The cost of owning it
// is that nothing animates it any more -- a notch became an instantaneous
// write of several line heights, which is the one kind of motion the eye
// cannot track at all. A coast got a curve; the single notch that did not
// become a coast kept the jump.
//
// ## Two kinds of leg, and why there have to be two
//
// A lone notch -- nothing in flight, the view at rest -- rides **the shared
// bell**, the same shape every journey and ramp in the app is cut from, so
// the ramp and shape sliders reach a single line of scrolling. That is the
// whole reason this module does not simply use a continuation for
// everything: a quintic Hermite is fixed entirely by its four boundary
// conditions and reads no curve parameters at all, so a notch built on one
// measured byte-identical across the full range of every slider. The reader
// moved shape from end to end and nothing happened, which is the bug this
// split exists to fix.
//
// A notch arriving while another is still being paid out gets **a quintic
// continuation** instead. A wheel is turned, not tapped, so this is the
// common case at speed: notches land 10-50ms apart against a delivery
// measured in tens of milliseconds. Restarting a bell from rest for each one
// would discard the speed the view already has and stutter exactly when the
// reader is moving fastest, and the bell cannot be started from a velocity it
// did not plan for. So the splice snapshots the in-flight motion's
// instantaneous velocity AND acceleration
// (`estimateVelocityAndAcceleration`) and builds
// `ScrollCurvePlan.ts`'s `buildContinuationPlan` from those to the new total
// -- whatever was left of the old notch plus the new one -- landing at rest.
// Measured at a 0.0% velocity step across every cadence from 30 to 100ms.
//
// The snapshot reads whichever leg is running, bell or continuation, so the
// two compose: a run of notches is one gathering movement, and it is only
// the FIRST of them whose character the shape slider sets.
//
// ## What the reader is owed, and the sign of it
//
// Distance is signed and legs may reverse: a notch the other way is a new
// leg toward a target behind the current one, which is what the reader
// asked for. Within a single leg, though, motion must be monotone -- a
// quintic asked to land a small distance while already moving fast will
// overshoot and come back, and a render view that scrolls backwards by a few
// pixels mid-gesture is a defect. The leg's own high-water mark is held for
// that reason, and only that reason.

import {
  buildContinuationPlan,
  buildCurvePlan,
  estimateVelocityAndAcceleration,
  getRenderScrollDynamic,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
  RENDER_SCROLL_SKEW_MAX,
  RENDER_SCROLL_SKEW_MIN,
  sampleCdf,
  sampleContinuationPlan,
  type ContinuationPlan,
} from './ScrollCurvePlan'

/**
 * A notch takes this share of the journey curve's total time.
 *
 * The `speed` slider says how long a scroll animation runs, and a notch is a
 * scroll animation, so it should answer to it -- but not at full length: a
 * journey's 400ms spent on one line lags the hand badly. A half puts the
 * default at 200ms and still hands the reader the whole range: 25ms at the
 * fast end of the slider, 500ms at the slow one (the ceiling below).
 */
export const WHEEL_NOTCH_TRAVEL_TIME_FRACTION = 0.5

/** Floor and ceiling on the resolved duration, in ms. */
const WHEEL_NOTCH_TRAVEL_MIN_MS = 16
const WHEEL_NOTCH_TRAVEL_MAX_MS = 1000

/** How long one notch's worth of distance takes to arrive, right now. */
export function resolveWheelNotchTravelMs(): number {
  const fromSlider = getRenderScrollTotalTimeSec() * 1000 * WHEEL_NOTCH_TRAVEL_TIME_FRACTION
  if (!Number.isFinite(fromSlider)) return 100
  // The speed slider's own floor is 0, which would mean a notch arrives in no
  // time at all. One frame is the shortest honest answer to "how long did
  // that take", and it is what the reader gets there.
  return Math.max(WHEEL_NOTCH_TRAVEL_MIN_MS, Math.min(WHEEL_NOTCH_TRAVEL_MAX_MS, fromSlider))
}

/**
 * The bell's normalized position curve for the current ramp/shape settings.
 *
 * Memoized because a turning wheel asks for this ten times a second while
 * the answer only changes when a slider moves. `tSec` is passed as 1 and not
 * cached against: `buildCurvePlan` normalizes every x by it, so it cancels
 * out of the shape entirely -- which is what lets the same curve be played
 * over a notch's duration rather than a journey's.
 */
let cachedCurveCdf: Float64Array | null = null
let cachedCurveKey = ''

function currentCurveCdf(): Float64Array {
  const a = Math.max(0.0001, getRenderScrollDynamic())
  const b = Math.max(0.0001, getRenderScrollResponsiveness())
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, getRenderScrollSkew()),
  )
  const key = `${a}|${b}|${skew}`
  if (cachedCurveCdf !== null && cachedCurveKey === key) return cachedCurveCdf
  cachedCurveCdf = buildCurvePlan(a, b, 1, skew).cdf
  cachedCurveKey = key
  return cachedCurveCdf
}

/** A leg from rest, shaped by the ramp and shape sliders. */
interface CurveLeg {
  kind: 'curve'
  cdf: Float64Array
  signedDistance: number
  durationSec: number
}

/** A leg picking up an in-flight motion's velocity and acceleration. */
interface ContinuationLeg {
  kind: 'continuation'
  plan: ContinuationPlan
  durationSec: number
}

export type WheelNotchLeg = CurveLeg | ContinuationLeg

export interface WheelNotchTravel {
  leg: WheelNotchLeg
  startMs: number
  /** Signed pixels already handed to the scroller on this leg. */
  paidPx: number
  /** The leg's furthest point so far, for the monotonicity guard. */
  reachedPx: number
  /** +1 or -1: which way this leg is meant to go. */
  sign: 1 | -1
}

/** Signed displacement from the leg's start, at `elapsedSec` into it. */
function sampleLeg(leg: WheelNotchLeg, elapsedSec: number): number {
  if (leg.kind === 'continuation') return sampleContinuationPlan(leg.plan, elapsedSec)
  if (elapsedSec <= 0) return 0
  if (elapsedSec >= leg.durationSec) return leg.signedDistance
  return leg.signedDistance * sampleCdf(leg.cdf, elapsedSec / leg.durationSec)
}

/** What the leg still owes, whatever kind it is. */
function legDistance(leg: WheelNotchLeg): number {
  return leg.kind === 'continuation' ? leg.plan.signedDistance : leg.signedDistance
}

/**
 * How much of the current leg has not been delivered yet.
 *
 * Signed, in the leg's own direction. Used both to build the next leg's
 * target and to hand an interrupted leg's remainder to whatever takes over
 * -- a coast, which must not silently drop the notches the hand already
 * turned.
 */
export function remainingWheelNotchTravelPx(travel: WheelNotchTravel | null): number {
  if (!travel) return 0
  return owedPx(travel)
}

/**
 * What the leg owes the SCROLLER: its distance less what has actually been
 * paid out (`paidPx`), not less where the curve has got to by now. Between
 * frames those differ by whatever the curve has covered since the last paid
 * step, and measuring from the curve dropped that gap at every splice -- up
 * to a frame of peak-speed travel per notch, so a fast turn of the wheel
 * went visibly less far than the step setting. Measured from what was paid,
 * distance is conserved by construction, and the monotonicity guard's
 * surplus (paid ahead of the curve) is not paid twice.
 */
function owedPx(travel: WheelNotchTravel): number {
  return legDistance(travel.leg) - travel.paidPx
}

/**
 * Begin a leg carrying `addedPx` on top of whatever is still owed.
 *
 * `travel` is the leg in flight, or null to start from rest. The returned
 * leg always replaces it. Which of the two kinds it is follows from that
 * one fact and nothing else -- see the module comment.
 */
export function retargetWheelNotchTravel(
  travel: WheelNotchTravel | null,
  addedPx: number,
  nowMs: number,
  travelMs: number = resolveWheelNotchTravelMs(),
): WheelNotchTravel {
  const durationSec = Math.max(0.0001, travelMs / 1000)

  if (!travel) {
    return {
      leg: { kind: 'curve', cdf: currentCurveCdf(), signedDistance: addedPx, durationSec },
      startMs: nowMs,
      paidPx: 0,
      reachedPx: 0,
      sign: addedPx >= 0 ? 1 : -1,
    }
  }

  const elapsedSec = Math.max(0, (nowMs - travel.startMs) / 1000)
  const snapshot = estimateVelocityAndAcceleration(
    (atSec) => sampleLeg(travel.leg, atSec),
    elapsedSec,
  )
  const signedDistance = owedPx(travel) + addedPx

  return {
    leg: {
      kind: 'continuation',
      plan: buildContinuationPlan(
        signedDistance,
        snapshot.velocity,
        snapshot.acceleration,
        durationSec,
      ),
      durationSec,
    },
    startMs: nowMs,
    paidPx: 0,
    reachedPx: 0,
    sign: signedDistance >= 0 ? 1 : -1,
  }
}

export interface WheelNotchTravelStep {
  /** Signed pixels to scroll now. */
  pixels: number
  /** True once the leg has delivered all of its distance. */
  finished: boolean
}

/**
 * Take whatever the leg owes since it was last asked.
 *
 * Sampled from absolute elapsed time rather than accumulated per frame, so a
 * late or dropped frame lands where the plan says it should instead of
 * losing the difference.
 */
export function takeWheelNotchTravelStep(
  travel: WheelNotchTravel,
  nowMs: number,
): WheelNotchTravelStep {
  const elapsedSec = Math.max(0, (nowMs - travel.startMs) / 1000)
  const raw = sampleLeg(travel.leg, elapsedSec)

  // Never pay backwards within a leg -- see the module comment.
  const travelled = travel.sign > 0
    ? Math.max(raw, travel.reachedPx)
    : Math.min(raw, travel.reachedPx)
  travel.reachedPx = travelled

  const pixels = travelled - travel.paidPx
  travel.paidPx = travelled

  return {
    pixels,
    finished: elapsedSec >= travel.leg.durationSec,
  }
}

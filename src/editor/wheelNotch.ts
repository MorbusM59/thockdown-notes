// How many rows one turn of the wheel is worth.
//
// ## The bug this exists because of
//
// The edit view scrolls by whole rows -- the grid is the point (see
// rowGridGuard.ts) -- so a wheel handler here has to answer one question:
// how much pixel delta is one notch? The old answer was the constant 100,
// the Windows default of three lines at 33.3px each. On a machine whose
// pointer settings send 50 per notch (one or two lines), the accumulator
// then took TWO notches to reach one unit: the first fell under the
// threshold and moved nothing, the second moved a row. Every other notch
// did nothing, in both directions, on every note. It was reported from the
// symptom -- "scrolling up only produces a line movement on every other
// wheel position" -- and found by tracing the real deltas
// (`thockdown:debug-wheel`), because the arithmetic is provably symmetric
// and correct for the delta it was written for. The delta was the input
// nobody had checked.
//
// ## Why measuring beats a bigger constant
//
// A device's notch size is a system setting, not a platform constant: the
// same OS sends 50, 100 or 120 depending on the user's "lines to scroll".
// Any fixed number is right for some machines and halves or doubles the
// scroll rate on the rest. The device states its own notch size on every
// event, so the honest unit is the smallest delta the current gesture has
// actually produced -- one notch, by definition, since a gesture cannot
// send less than one.
//
// The unit only ever SHRINKS, and is never reset -- deliberately, and this
// was the one real design decision here. Re-learning it per gesture reads
// as the safer choice, and it is the opposite: a reset unit means the first
// notch after every pause is measured against the 100px assumption again,
// so on a 50px device an isolated, deliberate single notch -- the most
// common scroll there is -- would move nothing at all, forever. Persisting
// it costs only the case where a second pointing device with a LARGER notch
// is used later in the same session, which then scrolls a shade fast and
// never scrolls dead. Fast is a preference; dead is a bug.
//
// ## What may shrink it
//
// Only a delta that is plausibly a NOTCH: one the current unit is a
// near-whole multiple of (100 -> 50 yes, 100 -> 33.3 yes, 100 -> 27 no).
// Taking the plain minimum was the first version, and one fast trackpad
// swipe on a laptop then taught it a small unit -- trackpad deltas of 12px
// and up pass the floor below -- after which every click of a real mouse
// wheel on the same machine scrolled several rows and turned the escape ring
// several cells, until the editor remounted. A real notch size divides every
// notch the device has sent, because a fast turn sends whole multiples of
// it; a trackpad's continuous stream has no such unit, so its deltas almost
// never divide the one already standing. The unit only ever moves by
// divisible steps, so everything it has been is a multiple of what it is
// now, and checking the current unit is checking all of them. The browser
// does not say which device sent an event, so per-device learning is not an
// option; this is the question that can be answered from the deltas alone.
//
// Deltas below WHEEL_NOTCH_MIN_PX never teach anything: those are trackpad
// pixel-scroll events, which have no notch to measure and would otherwise
// drive the unit down to a couple of pixels and make the wheel wildly
// oversensitive. They still accumulate against the standing unit, which is
// exactly the behavior a trackpad had before any of this.

import { PIXELS_PER_WHEEL_UNIT } from './LayoutConstants'

/** The notch size assumed until a device demonstrates its own. */
export const WHEEL_NOTCH_DEFAULT_PX = PIXELS_PER_WHEEL_UNIT

/**
 * The smallest delta allowed to be believed as a notch.
 *
 * Above it, a delta is a discrete wheel click worth one row. Below it, it is
 * a trackpad's continuous pixel scroll, which has no notch at all -- see the
 * module comment.
 */
export const WHEEL_NOTCH_MIN_PX = 12

/**
 * Quiet time after which a leftover sub-notch remainder is abandoned.
 *
 * Only the remainder -- the learned notch size persists across gestures on
 * purpose (see the module comment). A fraction of a notch left over from a
 * scroll a second ago should not be spent on the next one; within a single
 * continuous gesture it is exactly what should carry.
 */
export const WHEEL_GESTURE_IDLE_MS = 500

/**
 * How far from a whole number `unit / candidate` may be and still count as
 * one. Deltas arrive in fractional pixels under display scaling (a 100px
 * notch at 125% arrives as 80 on one machine and 79.99 on another), so an
 * exact test would refuse real notches.
 */
export const WHEEL_NOTCH_RATIO_TOLERANCE = 0.05

export interface WheelNotchState {
  /** The pixel size of one notch, as currently understood. */
  notchPx: number
  /** Delta accumulated since the last whole row, signed. */
  pendingPx: number
  /** When the last wheel event arrived, for gesture-boundary detection. */
  lastEventMs: number | null
}

export function createWheelNotchState(): WheelNotchState {
  return { notchPx: WHEEL_NOTCH_DEFAULT_PX, pendingPx: 0, lastEventMs: null }
}

/**
 * The notch size after seeing `deltaPx`. Only ever shrinks, and only to a
 * delta the current size is a near-whole multiple of -- see the module
 * comment.
 */
export function resolveWheelNotchPx(currentNotchPx: number, deltaPx: number): number {
  const magnitude = Math.abs(deltaPx)
  if (!Number.isFinite(magnitude) || magnitude < WHEEL_NOTCH_MIN_PX || magnitude >= currentNotchPx) return currentNotchPx
  const ratio = currentNotchPx / magnitude
  return Math.abs(ratio - Math.round(ratio)) <= WHEEL_NOTCH_RATIO_TOLERANCE ? magnitude : currentNotchPx
}

/**
 * How many rows a pixel-mode wheel event should scroll, advancing `state`.
 *
 * Returns 0 when the event was genuinely sub-notch (a trackpad still
 * accumulating), which is the only case the caller should decline.
 */
export function stepWheelNotch(state: WheelNotchState, deltaPx: number, nowMs: number): number {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return 0

  // A new gesture inherits no remainder: carrying one across the gap spends
  // it on a later, unrelated turn of the wheel. The learned notch does carry.
  if (state.lastEventMs !== null && nowMs - state.lastEventMs > WHEEL_GESTURE_IDLE_MS) {
    state.pendingPx = 0
  }
  state.lastEventMs = nowMs

  // A reversal discards the residual too. Half a notch of leftover downward
  // travel must not be subtracted from the first notch of an upward one --
  // that is the same swallowed-notch feeling this module exists to remove,
  // just at the turn instead of at every other click.
  if (state.pendingPx !== 0 && Math.sign(deltaPx) !== Math.sign(state.pendingPx)) {
    state.pendingPx = 0
  }

  state.notchPx = resolveWheelNotchPx(state.notchPx, deltaPx)
  state.pendingPx += deltaPx

  const sign = state.pendingPx < 0 ? -1 : 1
  const unitCount = Math.floor(Math.abs(state.pendingPx) / state.notchPx)
  if (unitCount === 0) return 0
  state.pendingPx -= unitCount * state.notchPx * sign
  return unitCount * sign
}

/** The parts of a wheel event this module needs. */
export interface WheelDelta {
  deltaY: number
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number
}

/**
 * How many NOTCHES a wheel event is worth, signed, in any pane.
 *
 * The one place the three delta modes are read, so the two panes cannot
 * drift apart on what counts as a nudge: the same wheel on the same desk
 * must start a spin (editor/wheelSpin.ts) in both of them at the same
 * moment, and a trackpad's sub-notch stream must start one in neither.
 *
 * Line and page mode state their own unit and are taken at their word --
 * they are counts already, and no accumulator can improve on a count. Only
 * pixel mode, where the device's notch size is a system setting nobody
 * declares, goes through the accumulator above. 0 means "not a notch yet",
 * which is the only case a caller should decline.
 *
 * What a notch is then WORTH to the reader is not this module's business:
 * see editor/wheelStep.ts.
 */
export function resolveWheelEventUnits(
  event: WheelDelta,
  state: WheelNotchState,
  nowMs: number,
): number {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 0
  const direction = event.deltaY > 0 ? 1 : -1
  if (event.deltaMode === 1 || event.deltaMode === 2) {
    return Math.max(1, Math.trunc(Math.abs(event.deltaY))) * direction
  }
  return stepWheelNotch(state, event.deltaY, nowMs)
}

// A finger dragging the edit view, as rows.
//
// The edit view is a fixed character grid and its scroll position is a whole
// number of rows (`rowGridGuard.ts`). A native touch pan moves the content by
// the finger's own sub-pixel amounts and then flings it the same way, so the
// text slides off the grid and only snaps back when the motion ends. The edit
// view therefore takes the finger itself (`touch-action: none` on its
// scroller) and this module turns the finger's travel into whole rows: every
// time the finger has moved one row height from where the last row was
// taken, the view scrolls one row, the same step a wheel notch takes.
//
// A swipe that is still moving when the finger lifts coasts on, through the
// wheel's own coast (`wheelSpin.ts`), and by the wheel's own rule for when a
// gesture is fast enough to coast at all: the row crossings are the nudges.
// The last `WHEEL_SPIN_NUDGE_COUNT` crossings must each follow the one before
// within the reader's spin threshold, and the lift must follow the last
// crossing within it too -- a finger that stopped and then lifted has asked
// for nothing more. The coast starts at the mean of those gaps, one row a
// step, so it continues at the rate the finger set -- but never faster than
// a held PageDown travels (`minGapMs`, the reader's own top scroll speed). A
// finger is a far faster instrument than a wheel: a flick crosses rows
// every millisecond or two, which handed to the coast as it stood sent the
// view off at hundreds of rows a second, much further than the reader meant.
//
// Pure, so the rule can be tested without a browser; `CM6Editor.tsx` owns
// the listeners.

import { WHEEL_SPIN_NUDGE_COUNT, type WheelSpinDirection } from './wheelSpin'

export interface FingerPan {
  readonly pointerId: number
  readonly startY: number
  /** Where the finger was when the last row was taken (or when it landed). */
  anchorY: number
  /** The finger has left `slopPx` of where it landed: it is a pan, not a tap. */
  panning: boolean
  direction: WheelSpinDirection | null
  /** Times of the most recent row crossings in `direction`, oldest first. */
  crossingsMs: number[]
  lastMoveMs: number
}

export function beginFingerPan(pointerId: number, y: number, nowMs: number): FingerPan {
  return { pointerId, startY: y, anchorY: y, panning: false, direction: null, crossingsMs: [], lastMoveMs: nowMs }
}

/**
 * The finger moved to `y`: returns the rows to scroll now, positive for down
 * the document (the finger moving up). Until the finger has left `slopPx`
 * nothing scrolls, so a tap that wobbles stays a tap; from then on rows are
 * measured from where the finger landed, so the text keeps its place under
 * the finger to within a row.
 */
export function moveFingerPan(pan: FingerPan, y: number, nowMs: number, lineHeightPx: number, slopPx: number): number {
  const previousMs = pan.lastMoveMs
  pan.lastMoveMs = nowMs
  if (!pan.panning) {
    if (Math.abs(y - pan.startY) <= slopPx) return 0
    pan.panning = true
  }
  if (!(lineHeightPx > 0)) return 0
  const rows = Math.trunc((pan.anchorY - y) / lineHeightPx)
  if (rows === 0) return 0
  pan.anchorY -= rows * lineHeightPx
  const direction: WheelSpinDirection = rows > 0 ? 1 : -1
  if (direction !== pan.direction) {
    pan.direction = direction
    pan.crossingsMs = []
  }
  // Several rows in one event crossed at evenly spaced moments between this
  // event and the last: a fast finger reports as many rows per event as it
  // covered, and stamping them all with one time would read as infinitely fast.
  const count = Math.abs(rows)
  for (let i = 1; i <= count; i += 1) pan.crossingsMs.push(previousMs + ((nowMs - previousMs) * i) / count)
  if (pan.crossingsMs.length > WHEEL_SPIN_NUDGE_COUNT) pan.crossingsMs.splice(0, pan.crossingsMs.length - WHEEL_SPIN_NUDGE_COUNT)
  return rows
}

/**
 * The finger lifted: the coast it hands on, or null when it was not moving
 * fast enough to coast by the wheel's rule (see the module comment), or when
 * coasting is off (`thresholdMs <= 0`).
 */
export function releaseFingerPan(pan: FingerPan, nowMs: number, thresholdMs: number, minGapMs: number): { direction: WheelSpinDirection; averageGapMs: number } | null {
  if (!pan.panning || pan.direction === null || !(thresholdMs > 0)) return null
  const crossings = pan.crossingsMs
  if (crossings.length < WHEEL_SPIN_NUDGE_COUNT) return null
  if (nowMs - crossings[crossings.length - 1] > thresholdMs) return null
  const gaps = crossings.slice(1).map((time, i) => time - crossings[i])
  if (gaps.some((gap) => gap > thresholdMs)) return null
  const averageGapMs = gaps.reduce((total, gap) => total + gap, 0) / gaps.length
  // Rows crossed within one event have gaps no shorter than a share of that
  // event's interval, so this is zero only if two events shared a timestamp.
  if (!(averageGapMs > 0)) return null
  return { direction: pan.direction, averageGapMs: Math.max(averageGapMs, minGapMs) }
}

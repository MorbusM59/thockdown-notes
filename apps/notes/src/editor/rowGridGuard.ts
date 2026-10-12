// The hard guard that keeps edit-mode text on the row grid.
//
// ## The invariant
//
// The editor is a fixed character grid, and every row of text sits on a line
// of it. That holds only while `scrollTop` is an exact multiple of the row
// height. It is not a rendering nicety: text landing half a row off is the one
// thing that makes the grid look broken rather than deliberate.
//
// ## Why a guard rather than more careful writes
//
// Every deliberate scroll write in CM6Editor.tsx already quantizes -- the
// wheel handler rounds, the curve engines round every frame, the cage rounds
// its target, the thumb drag rounds. That was believed to be sufficient, and
// it is not, because "every write we wrote" is a different claim from "every
// write".
//
// Measured (scripts/perf/verifyEditRowGrid.mjs, 300k-character note, 26px
// rows), watching `scrollTop` on every scroll event the browser fires:
//
//   dragging the thumb        worst 12px off, and RESTING 6px off
//   arrow keys past the cage  12px off, held across four consecutive samples
//   a track click that travels 6px off, transiently
//
// The thumb drag is the conclusive one: `scrollFromThumbTop` provably writes
// `Math.round(target / lineHeight) * lineHeight`, so the position it left
// behind was on the grid, and something afterwards moved it 6px and left it
// there. CodeMirror refines its own height estimates as unmeasured lines come
// into view and shifts `scrollTop` to keep the content stationary while it
// does -- by whatever amount the correction happens to be, which is not a row
// multiple. Those are writes nobody here makes and nobody here can enumerate,
// which is exactly what a guard is for.
//
// ## What it does about it
//
// Rounds to the nearest row, immediately, on every scroll event. Rounding
// costs at most half a row of content shift; leaving it costs the grid. The
// invariant says the grid wins.
//
// Round-to-NEAREST specifically, and not floor: flooring only tolerates
// error in one direction, and a value a hair before a row boundary would be
// dragged back a whole row. It is also the correction that moves the content
// least, which matters because every correction the reader can see is a cost.
//
// The one exception is a position a GESTURE is actively driving -- native
// drag-to-select auto-scroll, which advances by sub-pixel amounts every
// frame. Correcting that to the nearest row pulls backwards against the drag
// half the time, which the reader feels as the selection stuttering. There
// the rounding goes the way the gesture is already going, so the correction
// can only ever be a rounding-up of motion the reader asked for. That is what
// `direction` is for, and it is the whole of the difference.
//
// The document end needs no special case: CM6Editor sizes `.cm-content`'s
// bottom padding (`alignmentPaddingBottomPx`) so that the maximum scroll
// position is itself a row multiple. If a correction ever has to be clamped
// away from the grid at the bottom, that padding is wrong and the right fix
// is there, not here.

/**
 * How far off the grid is close enough.
 *
 * Not zero. `scrollTop` is a float, and on a fractional device pixel ratio a
 * browser can report a value a hair away from what was written -- correcting
 * that would be an endless write/observe loop over nothing. Half a CSS pixel
 * is far below anything visible and comfortably above that noise.
 */
export const ROW_GRID_TOLERANCE_PX = 0.5

/**
 * Which way a correction is allowed to move.
 *
 * `nearest` is the default and the right answer for an observed position that
 * nobody is currently driving. `forward`/`backward` follow a gesture already
 * in motion -- see the module comment.
 */
export type RowGridDirection = 'nearest' | 'forward' | 'backward'

export interface RowGridCorrectionInput {
  scrollTopPx: number
  lineHeightPx: number
  maxScrollTopPx: number
  direction?: RowGridDirection
}

/**
 * Below this a delta is not motion, just float noise on a stationary value.
 *
 * Deliberately far smaller than ROW_GRID_TOLERANCE_PX, because it answers a
 * different question. That one asks "is this position wrong enough to be
 * worth a correction", where half a pixel is invisible. This one asks "is the
 * reader's gesture moving", and native drag-to-select auto-scroll advances by
 * SUB-PIXEL amounts per frame -- judging those motionless would silently drop
 * the directional rounding the drag case exists for and let corrections pull
 * back against the drag.
 */
export const ROW_GRID_MOTION_EPSILON_PX = 0.01

/** The direction a scroll delta is going, for the gesture-driven case. */
export function resolveRowGridDirection(deltaPx: number): RowGridDirection {
  if (!Number.isFinite(deltaPx) || Math.abs(deltaPx) < ROW_GRID_MOTION_EPSILON_PX) return 'nearest'
  return deltaPx > 0 ? 'forward' : 'backward'
}

/**
 * The row-grid correction for a scroll position, or null if none is needed.
 *
 * Pure, so the rule itself is testable without a browser -- the DOM plumbing
 * below has no judgement in it.
 */
export function resolveRowGridCorrection(input: RowGridCorrectionInput): number | null {
  const { scrollTopPx, lineHeightPx, maxScrollTopPx, direction = 'nearest' } = input
  if (!(lineHeightPx > 0) || !Number.isFinite(scrollTopPx)) return null

  const limitPx = Math.max(0, maxScrollTopPx)
  const rows = scrollTopPx / lineHeightPx
  const snappedRows = direction === 'forward'
    ? Math.ceil(rows)
    : direction === 'backward'
      ? Math.floor(rows)
      : Math.round(rows)
  const snappedPx = snappedRows * lineHeightPx
  // Clamping a rounded value can land off the grid again, which would have
  // this write a position it would immediately want to correct. Step DOWN to
  // the last row that fits instead, so what this returns is always on the
  // grid or nothing at all.
  const targetPx = snappedPx > limitPx
    ? Math.floor(limitPx / lineHeightPx) * lineHeightPx
    : Math.max(0, snappedPx)
  if (Math.abs(targetPx - scrollTopPx) <= ROW_GRID_TOLERANCE_PX) return null
  return targetPx
}

// A FINGER PANNING THE SCROLLER is a gesture driving the position too, and
// the strongest case of one: the browser moves the content under the finger,
// and then flings it, by its own sub-pixel amounts, and snapping each of
// those to a row makes the text step and judder against the finger. So the
// guard stands down while a touch that landed on the scroller is down, and
// through the fling after it, and corrects once when that is over.
//
// The phases, and what ends each one (so that none can be stranded):
//
//   idle      ordinary guarding: every scroll is corrected.
//   touching  a finger landed on the scroller. Ends when the window reports
//             no fingers down: into `flinging` if the content moved since the
//             last time it came to rest, otherwise straight to `idle`. A
//             scroll seen while the window reports no fingers down means the
//             lift was missed, and is treated as an ordinary scroll.
//   flinging  the fingers are up and the browser is carrying the motion on.
//             Ends at the browser's `scrollend` (which fires once a fling has
//             come to rest), or at any other input (a wheel, a key, a mouse
//             press), whichever comes first; either way it corrects once.

export type RowGridTouchPhase =
  | { kind: 'idle' }
  | { kind: 'touching'; scrolled: boolean }
  | { kind: 'flinging' }

export type RowGridTouchEvent =
  | { kind: 'touchstart'; touchesDown: number }
  | { kind: 'touchend'; touchesDown: number }
  | { kind: 'scroll'; touchesDown: number }
  | { kind: 'scrollend' }
  | { kind: 'otherInput' }

/** One step of the touch phase, and whether the guard corrects now. Pure, for the tests. */
export function stepRowGridTouchPhase(phase: RowGridTouchPhase, event: RowGridTouchEvent): { phase: RowGridTouchPhase; correct: boolean } {
  switch (event.kind) {
    case 'touchstart':
      return { phase: { kind: 'touching', scrolled: phase.kind === 'touching' && phase.scrolled }, correct: false }
    case 'touchend':
      if (phase.kind !== 'touching' || event.touchesDown > 0) return { phase, correct: false }
      return phase.scrolled ? { phase: { kind: 'flinging' }, correct: false } : { phase: { kind: 'idle' }, correct: true }
    case 'scroll':
      if (phase.kind === 'idle') return { phase, correct: true }
      if (phase.kind === 'touching' && event.touchesDown === 0) return { phase: { kind: 'idle' }, correct: true }
      if (phase.kind === 'touching') return { phase: { kind: 'touching', scrolled: true }, correct: false }
      return { phase, correct: false }
    case 'scrollend':
      // Under a finger the content came to rest; a lift with no further
      // motion then has no fling to wait for.
      if (phase.kind === 'touching') return { phase: { kind: 'touching', scrolled: false }, correct: false }
      if (phase.kind === 'flinging') return { phase: { kind: 'idle' }, correct: true }
      return { phase, correct: false }
    case 'otherInput':
      if (phase.kind === 'flinging') return { phase: { kind: 'idle' }, correct: true }
      return { phase, correct: false }
  }
}

export interface RowGridGuard {
  /** Stops watching. */
  dispose: () => void
  /**
   * How many corrections have been applied.
   *
   * Exposed because it is the one signal an outside observer can assert on:
   * a correction is invisible by construction (it puts things where they
   * should already have been), so "did the guard fire" cannot be inferred
   * from geometry. It is also how a FIGHT would show up -- a guard trading
   * writes with CM6's own scroll-into-view would climb this counter without
   * bound during ordinary typing. Same reasoning as
   * wrapBoundaryAssocFixDispatchCountRef in CM6Editor.tsx.
   */
  correctionCount: () => number
}

/**
 * Watches a scroller and forces every off-grid position back onto the row grid.
 *
 * Correcting from inside the scroll handler fires another scroll event; the
 * second pass finds the position already on the grid and does nothing, so this
 * settles in one extra event rather than looping.
 */
export function attachRowGridGuard(
  scroller: HTMLElement,
  options: {
    getLineHeightPx: () => number
    /**
     * True while something else owns the scroll position and corrects it by
     * its own rule. Two correctors with different rules on one scroller trade
     * writes every frame, so ownership has to be explicit rather than implied
     * by whoever attached first.
     */
    isSuspended?: () => boolean
  },
): RowGridGuard {
  const { getLineHeightPx, isSuspended } = options
  let corrections = 0

  let phase: RowGridTouchPhase = { kind: 'idle' }
  let touchesDown = 0

  const correct = () => {
    const correction = resolveRowGridCorrection({
      scrollTopPx: scroller.scrollTop,
      lineHeightPx: getLineHeightPx(),
      maxScrollTopPx: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    })
    if (correction === null) return
    corrections += 1
    scroller.scrollTop = correction
  }

  const step = (event: RowGridTouchEvent) => {
    const result = stepRowGridTouchPhase(phase, event)
    phase = result.phase
    if (result.correct && !isSuspended?.()) correct()
  }

  // The finger count is the WINDOW's: a finger that lands on the scroller can
  // lift anywhere, and a lift seen only by the scroller could be missed.
  const onWindowTouch = (event: TouchEvent) => {
    touchesDown = event.touches.length
    if (event.type !== 'touchstart') step({ kind: 'touchend', touchesDown })
  }
  const onScrollerTouchStart = (event: TouchEvent) => step({ kind: 'touchstart', touchesDown: event.touches.length })
  const onScrollEnd = () => step({ kind: 'scrollend' })
  const onOtherInput = (event: Event) => {
    if (event instanceof PointerEvent && event.pointerType === 'touch') return
    step({ kind: 'otherInput' })
  }
  const onScroll = () => step({ kind: 'scroll', touchesDown })

  const windowTouchEvents = ['touchstart', 'touchend', 'touchcancel'] as const
  const otherInputEvents = ['wheel', 'keydown', 'pointerdown'] as const
  scroller.addEventListener('scroll', onScroll, { passive: true })
  scroller.addEventListener('scrollend', onScrollEnd, { passive: true })
  scroller.addEventListener('touchstart', onScrollerTouchStart, { passive: true })
  for (const type of windowTouchEvents) window.addEventListener(type, onWindowTouch, { capture: true, passive: true })
  for (const type of otherInputEvents) window.addEventListener(type, onOtherInput, { capture: true, passive: true })

  return {
    dispose: () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('scrollend', onScrollEnd)
      scroller.removeEventListener('touchstart', onScrollerTouchStart)
      for (const type of windowTouchEvents) window.removeEventListener(type, onWindowTouch, { capture: true })
      for (const type of otherInputEvents) window.removeEventListener(type, onOtherInput, { capture: true })
    },
    correctionCount: () => corrections,
  }
}

/**
 * The visualizer's smooth wave: soft bands of the caret's colour, at half its
 * alpha, travelling left to right across the box grid's LINES (the 1px lines
 * between the boxes, `.thockdown-grid-lines`), brightening them as they pass.
 *
 * Two elements, so a frame repaints nothing. The outer one is masked to the
 * grid lines by the same gradients that draw them, at the same tile size and
 * position, and never moves. The inner one carries one repeating band
 * pattern, one period wider than the scene, and is moved by a CSS animation
 * of `transform` alone, one period per cycle, so the loop is seamless and
 * the compositor runs it without the main thread.
 *
 * Self-contained: it reads only the box size and the grid's origin, which
 * the scene already has, so it can be switched off or moved into a package
 * without touching anything else.
 */

import type { CSSProperties } from 'react'

/** A wave's length, in boxes, from one band's peak to the next. */
const PERIOD_BOXES = 12
/** Seconds a band takes to travel one period. */
const PERIOD_SEC = 3

export function GridWave({ boxPx, originXPx, originYPx }: { boxPx: number; originXPx: number; originYPx: number }) {
  const periodPx = PERIOD_BOXES * boxPx
  return (
    <div
      className="visualizer-grid-wave"
      style={{ maskPosition: `${originXPx}px ${originYPx}px`, '--grid-wave-period': `${periodPx}px`, '--grid-wave-duration': `${PERIOD_SEC}s` } as CSSProperties}
    >
      <div className="visualizer-grid-wave-bands" />
    </div>
  )
}

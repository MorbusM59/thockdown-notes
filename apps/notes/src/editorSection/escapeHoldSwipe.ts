// A FINGER SWIPING THE ESCAPE RING TURNS THE DIAL, and a swipe still moving
// when the finger lifts carries on as a flywheel would and comes to rest on
// a whole slot.
//
// While the finger is down the ring follows it by ANGLE about the ring's
// centre, the same quantity the cells are placed by (escapeHoldRingLayout.ts):
// a finger that travels a twelfth of a turn around the centre moves the
// cells a twelfth of a turn, so the cell under the finger stays under it.
//
// At the lift the dial is a flywheel under constant-ratio friction: speed
// decays as `v * e^(-t / tau)`, so it would travel `v * tau` further before
// stopping. `tau` and the window the lift speed is measured over are the
// page's own finger coast (touchScroll.ts's `COAST_TIME_CONSTANT_MS`,
// `VELOCITY_WINDOW_MS`), so a flick of the ring and a flick of a list carry
// on alike. That natural rest point is then rounded to the nearest slot, the
// one place the dial may stop, and the ring is carried there by the ring's
// own continuation curve (ScrollCurvePlan.ts's `buildContinuationPlan`),
// starting at the finger's velocity: the same curve a key press arriving
// mid-turn splices in, so a swipe and the keyboard move one dial.
//
// Pure, so the arithmetic is tested without a browser; EscapeHoldPanel.tsx
// owns the listeners.

import { COAST_TIME_CONSTANT_MS } from '@thockdown/interaction/touchScroll'

/**
 * The angle of `(x, y)` about `(cx, cy)`, in radians, increasing CLOCKWISE
 * on screen (y grows downwards), as the ring's slots do.
 */
export function angleAbout(x: number, y: number, cx: number, cy: number): number {
  return Math.atan2(y - cy, x - cx)
}

/**
 * How far the rotation offset moves when the finger turns by `deltaAngle`
 * (radians, clockwise positive), unwrapped across the atan2 seam. The offset
 * counts the other way round from the angle: a cell at index `i` sits at
 * slot `i - offset`, so cells turning clockwise is the offset falling.
 */
export function offsetDeltaForAngle(deltaAngle: number, count: number): number {
  let delta = deltaAngle
  if (delta > Math.PI) delta -= 2 * Math.PI
  else if (delta <= -Math.PI) delta += 2 * Math.PI
  return (-delta * count) / (2 * Math.PI)
}

/** The rotation offset's speed at the lift, in slots per second, from timed offsets (oldest first). */
export function offsetVelocity(history: readonly { offset: number; t: number }[]): number {
  const first = history[0]
  const last = history[history.length - 1]
  if (!first || !last || last.t <= first.t) return 0
  return ((last.offset - first.offset) / (last.t - first.t)) * 1000
}

export interface SwipeLanding {
  /** The whole slot the dial comes to rest on, in the same unwrapped frame as `offset`. */
  target: number
  /** How long the carry takes, in seconds. */
  durationSec: number
}

/**
 * Where a dial at `offset` turning at `velocity` (slots per second) comes to
 * rest, and how long it takes to get there. The rest point is the flywheel's
 * (see the module comment), rounded to a slot and kept within one full turn,
 * since a flick past that only lands on the same cells again. The duration
 * is that of a constant deceleration from `velocity` to rest over the
 * distance, `2 * distance / velocity`, so the carry neither surges nor
 * stalls, and never shorter than `minimumSec` (the reader's own smooth-step
 * time), which is also what a lift with no speed to speak of gets.
 */
export function swipeLanding(offset: number, velocity: number, count: number, minimumSec: number): SwipeLanding {
  const coast = Math.max(-count, Math.min(count, velocity * (COAST_TIME_CONSTANT_MS / 1000)))
  const target = Math.round(offset + coast)
  const distance = target - offset
  const decelerationSec = velocity !== 0 && Math.sign(distance) === Math.sign(velocity)
    ? (2 * Math.abs(distance)) / Math.abs(velocity)
    : 0
  return { target, durationSec: Math.max(minimumSec, decelerationSec) }
}

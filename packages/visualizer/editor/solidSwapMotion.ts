/**
 * How one solid gives way to the next when the reader clicks the empty scene
 * (SolidCanvas.tsx). The old solid is pinged to the BACK -- it shrinks a
 * little, as if knocked away from the viewer, hops and falls out of view
 * under gravity -- and the new one swings down from above on an
 * underdamped spring, overshooting its place once and settling: the bounce.
 *
 * Offsets are in resting sides of the solid (positive is down), times in
 * seconds. `edge` is the offset at which a solid at rest size has just left
 * the canvas: half the canvas's height plus half the solid's side, in sides.
 */

/** How far the ping knocks the old solid back: it ends at this share smaller. */
const FALL_SHRINK = 0.25
/** How quickly the knock-back happens (time constant, seconds). */
const FALL_SHRINK_SEC = 0.08
/** The hop as the solid is hit (sides a second, upwards) and the pull down (sides a second squared, halved). */
const FALL_HOP = 0.5
const FALL_GRAVITY = 7
/** The new solid sets off this long after the old one is hit, so the two read as a hand-over. */
export const ARRIVAL_DELAY_SEC = 0.12
/** The arrival spring: natural frequency (radians a second) and damping ratio (one overshoot of about a fifth). */
const SPRING_OMEGA = 12
const SPRING_DAMPING = 0.45
/** Where the arrival counts as settled, in sides: well under a device pixel. */
const SETTLED_SIDES = 0.0005

export type SolidPose = { offsetY: number; scale: number }

/** The old solid `t` seconds after it was hit, from where it was hit. */
export function fallPose(t: number, from: SolidPose): SolidPose {
  return {
    offsetY: from.offsetY - FALL_HOP * t + FALL_GRAVITY * t * t,
    scale: from.scale * (1 - FALL_SHRINK * (1 - Math.exp(-t / FALL_SHRINK_SEC))),
  }
}

/** Whether a falling solid has left a canvas whose edge is `edge` sides away. */
export function hasFallenOut(pose: SolidPose, edge: number): boolean {
  return pose.offsetY >= edge - 0.5 + pose.scale / 2
}

/**
 * The new solid `t` seconds after the click: held just above the canvas for
 * the delay, then the spring's response from there to its place with no
 * initial velocity. Null once it has settled, when it is simply at rest.
 */
export function arrivalPose(t: number, edge: number): SolidPose | null {
  const u = t - ARRIVAL_DELAY_SEC
  if (u <= 0) return { offsetY: -edge, scale: 1 }
  const decay = Math.exp(-SPRING_DAMPING * SPRING_OMEGA * u)
  // The envelope bounds the displacement, so below the threshold it can never come back.
  if (edge * decay / Math.sqrt(1 - SPRING_DAMPING ** 2) < SETTLED_SIDES) return null
  const damped = SPRING_OMEGA * Math.sqrt(1 - SPRING_DAMPING ** 2)
  const offsetY = -edge * decay * (Math.cos(damped * u) + (SPRING_DAMPING * SPRING_OMEGA / damped) * Math.sin(damped * u))
  return { offsetY, scale: 1 }
}

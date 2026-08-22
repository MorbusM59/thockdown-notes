// Adapts the editor's shared smooth-scroll curve toolkit (ScrollCurvePlan.ts
// -- see that file for the underlying bell-curve/plateau-clamp/skew model,
// already shared today between render-view scroll (NonQuantizedSmoothScroll)
// and edit-view row-quantized scroll (QuantizedSmoothScroll)) to the
// escape-hold ring's rotation, the same way CursorClickCurve.ts adapts it to
// the mouse-cursor click response: by importing the module's exported
// primitives directly and reusing them, not re-deriving the curve math.
//
// The reuse is close to 1:1 -- scroll's "distance" is pixels of scrollTop,
// the ring's is "slots" (a continuous, possibly-fractional position around
// the ring; escapeHoldRingLayout.ts's computeEscapeHoldPointAtSlot already
// accepts fractional slots for exactly this reason). One "page" of scroll
// becomes exactly one slot of rotation. Every function below that only takes
// distance/speed as plain numbers (buildCurvePlan, buildScrollPlan,
// sampleScrollPlan, resolveApexSpeedPxPerSecFromCurrentParams,
// resolveRampCrossingTimeSecFromCurrentParams,
// buildReleaseRampDownPlanFromCurrentParams, sampleReleaseRampDownPlan) is
// used directly from EscapeHoldPanel.tsx with slot-based numbers in place of
// pixel-based ones -- no wrapper needed, since none of those read the
// scroll module's pixel-specific parameter internally.
//
// The one exception, and the only real adaptation this file exists to hold,
// is `renderScrollMaxSpeedPxPerSec`: buildScrollPlanFromCurrentParams reads
// it directly (in px/sec) to decide whether to clamp the bell's natural
// peak with a plateau. A ring rotation's natural peak speed comes out in
// slots/sec (order of a few units), so comparing it against a raw px/sec
// number (thousands) would mean the cap silently never engages. Rather than
// invent an unrelated dial-specific constant, `pixelsPerSlotAt` measures the
// ring's own actual chord distance for the step being animated (reusing
// escapeHoldRingLayout.ts's existing geometry), and `buildEscapeHoldRotationPlan`
// converts the shared px/sec cap through it -- so the existing "max speed"
// slider still means something concrete for the dial, derived from the
// ring's real on-screen size, rather than being ignored or faked.
//
// Deliberately reuses the SAME live values the Scrolling Behavior sliders
// already set (ramp/shape/speed/max speed), not a separate set of
// dial-specific sliders -- the user's own choice, matching CursorClickCurve's
// established pattern of reuse but differing from it in this one respect
// (that file introduced its own settings; this one intentionally shares
// scroll's).

import {
  buildCurvePlan,
  buildScrollPlan,
  getRenderScrollDynamic,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
} from '../editor/ScrollCurvePlan'
import type { ScrollPlan } from '../editor/ScrollCurvePlan'
import { computeEscapeHoldPointAtSlot } from './escapeHoldRingLayout'
import type { EscapeHoldRingParams } from './escapeHoldRingLayout'

export type EscapeHoldRotationPlan = ScrollPlan

/**
 * The ring's actual on-screen distance (px) covered by one slot of
 * rotation, starting at `fromSlot` heading `direction` -- the chord between
 * two adjacent computed ring points, at the current live geometry (ring
 * size is fixed, but corner radius/inset and cell count can change while
 * the panel is open). Used only to convert the shared max-speed cap into
 * slots/sec -- see the module comment.
 */
export function pixelsPerSlotAt(
  fromSlot: number,
  direction: 1 | -1,
  count: number,
  ringParams: EscapeHoldRingParams,
): number {
  const from = computeEscapeHoldPointAtSlot(fromSlot, count, ringParams)
  const to = computeEscapeHoldPointAtSlot(fromSlot + direction, count, ringParams)
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * A discrete rotation-step plan -- the bell-curve position animation from 0
 * to `signedDistanceSlots` (e.g. +/-1 for a single tap or hold-continuation
 * step, or a small fractional distance for the post-release "settle" hop
 * onto a whole slot -- see EscapeHoldPanel.tsx). Built from the exact same
 * ramp/responsiveness/duration/skew the editor's own scroll animations are
 * currently using (ScrollCurvePlan.ts's module-level live values), with
 * only max-speed re-derived in slot units via `pixelsPerSlotAt` above.
 */
export function buildEscapeHoldRotationPlan(signedDistanceSlots: number, pixelsPerSlot: number): EscapeHoldRotationPlan {
  const a = getRenderScrollDynamic()
  const b = getRenderScrollResponsiveness()
  const tSec = getRenderScrollTotalTimeSec()
  const skew = getRenderScrollSkew()
  const curve = buildCurvePlan(a, b, tSec, skew)
  const maxSlotsPerSec = Math.max(0.01, getRenderScrollMaxSpeedPxPerSec() / Math.max(0.01, pixelsPerSlot))
  return buildScrollPlan(curve, tSec, signedDistanceSlots, maxSlotsPerSec)
}

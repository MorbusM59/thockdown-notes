// Render/menu smooth scroll engine (non-quantized, sub-pixel accurate).
//
// Consumes the shared bell-curve / plateau-clamp / skew math from
// ScrollCurvePlan. See that module for the model documentation.
//
// Each rAF frame independently computes its scrollTop from elapsed time:
//   scrollTop = startPx + sampleScrollPlan(plan, elapsedSec)
//
// This is immune to dropped frames and produces no per-step velocity
// discontinuities at 60+ fps.

import {
  buildScrollPlanFromCurrentParams,
  sampleScrollPlan,
} from './ScrollCurvePlan';
import {
  journeyDurationSec,
  journeyTotalDisplacementPx,
  planScrollJourney,
  sampleJourneyDisplacement,
  type ScrollJourneyTiming,
} from './scrollJourney';
import { resolveScrollBridge } from './scrollBridgeRegistry';
import { traceScroll } from './scrollTrace';

import { borrowAutoScrollBehavior } from './scrollBehaviorLock';
import { activeSmoothScroll, cancelSmoothScroll, registerSmoothScroll, unregisterSmoothScroll } from './smoothScrollRegistry';
import { clamp } from './clamp';
/**
 * Whether the reader has asked for less movement.
 *
 * Answered per call rather than cached: it is an OS-level setting that can be
 * changed while the app is open, and a reader who turns it on mid-session
 * means it from that moment, not from the next launch.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export {
  buildReleaseRampDownPlanFromCurrentParams,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  DEFAULT_RENDER_SCROLL_DYNAMIC,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  DEFAULT_RENDER_SCROLL_RESPONSIVENESS,
  DEFAULT_RENDER_SCROLL_SKEW,
  DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC,
  deriveRenderScrollDynamicFromResponsiveness,
  deriveRenderScrollResponsivenessFromDynamic,
  RENDER_SCROLL_SKEW_MAX,
  RENDER_SCROLL_SKEW_MIN,
  resolveApexSpeedPxPerSecFromCurrentParams,
  getRenderScrollDynamic,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
  sampleReleaseRampDownPlan,
  resolveRampCrossingTimeSecFromCurrentParams,
  setRenderScrollDynamic,
  setRenderScrollMaxSpeedPxPerSec,
  setRenderScrollResponsiveness,
  setRenderScrollSkew,
  setRenderScrollTotalTimeSec,
} from './ScrollCurvePlan';

interface NonQuantizedSmoothScrollOptions {
  onStep?: () => void;
  /**
   * The distance to plan the journey's SHAPE from, when the real one is not a
   * pixel distance in this scroller.
   *
   * The windowed preview (editorSection/previewWindow.ts) mounts only a few
   * screenfuls at a time, so a destination twenty thousand blocks away is
   * simply not in its scroll space -- `targetScrollTopPx` can only be the far
   * edge of the current window. Left to itself this would read that as a short
   * hop and play an uninterrupted curve, when what the reader asked for was a
   * journey across the document. This says how far they actually asked to go.
   * It chooses the curve and the bridge; it never places anything.
   */
  journeyDistancePx?: number;
  /**
   * Called once, at the moment the curtain fully covers the pane.
   *
   * For a caller whose destination does not exist in the scroller's current
   * space and has to put it there -- the windowed preview re-anchors its
   * window here, which is precisely the substitution the bridge exists to
   * hide. Returns the scroll position the journey should now be landing on,
   * or null to keep the original target.
   */
  onBridgeCut?: () => number | null;
}


/**
 * Travels to `targetScrollTopPx`.
 *
 * Returns the journey's shape when it was bridged, so a caller that has to
 * move in step with it can -- and null when it was an ordinary curve, an
 * instant landing, or a no-op.
 */
export function scrollToNonQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options?: NonQuantizedSmoothScrollOptions,
): ScrollJourneyTiming | null {
  // Mutable, because a bridged journey on a windowed pane relocates its own
  // destination at the cut: the scroll space it lands in is not the one it set
  // off from. Everything below reads these rather than capturing them.
  let maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const startPx = clamp(scroller.scrollTop, 0, maxScrollTopPx);
  let targetPx = clamp(targetScrollTopPx, 0, maxScrollTopPx);

  const existing = activeSmoothScroll(scroller);
  if (existing && Math.abs(existing.targetScrollTopPx - targetPx) < 0.01) {
    return null;
  }

  cancelSmoothScroll(scroller);

  // How far the reader asked to go, which on a windowed pane is not how far
  // this scroller can carry them -- see `journeyDistancePx`.
  const signedDistance = options?.journeyDistancePx ?? (targetPx - startPx);

  if (Math.abs(signedDistance) < 0.5) {
    scroller.scrollTop = targetPx;
    options?.onStep?.();
    return null;
  }

  if (prefersReducedMotion()) {
    scroller.scrollTop = targetPx;
    options?.onStep?.();
    return null;
  }

  const releaseScrollBehavior = borrowAutoScrollBehavior(scroller);

  const finish = () => {
    const landed = clamp(targetPx, 0, maxScrollTopPx);
    traceScroll(() => `journey land    at=${Math.round(landed)}`
      + ` target=${Math.round(targetPx)} max=${Math.round(maxScrollTopPx)}`
      + (Math.abs(landed - targetPx) > 0.5 ? ' (SHORT: target outside scroller)' : ''));
    scroller.scrollTop = landed;
    options?.onStep?.();
    releaseScrollBehavior();
    unregisterSmoothScroll(scroller);
  };

  // How many frames in a row the engine has asked for a position the scroller
  // could not give it. Counted rather than logged per frame: a journey that
  // spends its whole bridge pinned against a boundary would otherwise bury
  // everything else in the buffer, and the number of consecutive frames is
  // the diagnostic anyway -- one is rounding, forty is a wall.
  let pinnedFrames = 0;

  const step = (nextPx: number, hidden = false) => {
    const clamped = clamp(nextPx, 0, maxScrollTopPx);
    if (hidden) {
      // Behind the curtain the scroller's position is not visible, so a clamp
      // here is the design working rather than a scroll failing to arrive --
      // reporting it would bury the real ones.
      if (scroller.scrollTop !== clamped) {
        scroller.scrollTop = clamped;
        options?.onStep?.();
      }
      return;
    }
    // The silent failure this trace exists for: the engine is asking the
    // scroller to go somewhere it cannot, because on a windowed pane the
    // mounted content is a few screenfuls and the destination is not in it.
    // From outside this looks exactly like a scroll that stopped arriving.
    if (Math.abs(nextPx - clamped) > 0.5) {
      pinnedFrames += 1;
      if (pinnedFrames === 1 || pinnedFrames % 15 === 0) {
        traceScroll(() => `journey PINNED  want=${Math.round(nextPx)}`
          + ` got=${Math.round(clamped)} max=${Math.round(maxScrollTopPx)}`
          + ` short=${Math.round(nextPx - clamped)}px frames=${pinnedFrames}`);
      }
    } else if (pinnedFrames > 0) {
      const held = pinnedFrames;
      pinnedFrames = 0;
      traceScroll(() => `journey freed   after ${held} pinned frame(s), top=${Math.round(clamped)}`);
    }
    if (scroller.scrollTop !== clamped) {
      scroller.scrollTop = clamped;
      options?.onStep?.();
    }
  };

  let onCancel: (() => void) | undefined;
  const keepAnimating = (frame: FrameRequestCallback) => {
    registerSmoothScroll(scroller, {
      rafId: requestAnimationFrame(frame),
      targetScrollTopPx: targetPx,
      releaseScrollBehavior,
      onCancel,
    });
  };

  // A journey long enough to have a middle worth cutting, on a pane that can
  // cover the cut. Everything else falls through to the plain point-to-point
  // curve below.
  // `journeyDistancePx` is set by exactly one caller, for exactly one reason:
  // the destination has no pixel in this scroller, because the pane is
  // windowed and the target is outside the mounted window. That is the same
  // condition as "a plain scroll cannot reach it", so its presence is what
  // makes the curtain mandatory rather than a function of distance. Inferred
  // from the option already present rather than given a flag of its own --
  // two flags meaning the same thing is how they come to disagree.
  const journey = planScrollJourney(signedDistance, {
    requireBridge: options?.journeyDistancePx !== undefined,
  });
  traceScroll(() => `journey plan    kind=${journey?.kind ?? 'null'}`
    + ` asked=${Math.round(signedDistance)}px`
    + ` reachable=${Math.round(targetPx - startPx)}px`
    + ` start=${Math.round(startPx)} target=${Math.round(targetPx)} max=${Math.round(maxScrollTopPx)}`
    + (options?.journeyDistancePx !== undefined ? ' (windowed: curtain required)' : ''));
  const bridge = journey?.kind === 'bridged' ? resolveScrollBridge(scroller) : null;
  const direction: -1 | 1 = signedDistance >= 0 ? 1 : -1;
  // How much real scrolling is available before the reader runs out of mounted
  // document, and therefore how much of the journey has to be spoofed. On a
  // pane holding the whole document this is the whole distance and the curtain
  // is never needed; on a windowed one it is a screenful or two against a
  // journey of tens of thousands of pixels.
  const viewportPx = Math.max(1, scroller.clientHeight);
  const runwayPx = direction > 0 ? maxScrollTopPx - startPx : startPx;
  // Full cover has to be reached exactly as the runway runs out, so the
  // leading seam sweeps in over text that is still moving. A frozen strip
  // beside a moving one is more obviously wrong than the cut it is hiding.
  //
  // Bounded by the ramp-up as well as by the runway, and for a different
  // reason: a bridged journey deliberately does not travel its whole distance
  // -- the middle is cut -- so the cut has to happen, and cannot happen until
  // the pane is covered. On a windowed pane the runway is the binding
  // constraint; on one holding the whole document the ramp-up is, and without
  // this term the curtain would never rise there and the journey would stop
  // short by everything the cut was meant to skip.
  const coverStartPx = Math.max(0, Math.min(
    runwayPx,
    journey?.kind === 'bridged' ? Math.abs(journey.rampUp.signedDistancePx) : runwayPx,
  ) - viewportPx);
  const totalVirtualPx = journey?.kind === 'bridged' ? journeyTotalDisplacementPx(journey) : 0;
  // Opened at its longest -- the landing runway is nil until the cut says
  // otherwise -- and trimmed by resizeSweep once the cut knows better.
  const sweepPx = journey?.kind === 'bridged' && bridge
    ? bridge.begin(Math.abs(totalVirtualPx) - coverStartPx + viewportPx, direction)
    : null;

  if (journey?.kind === 'bridged' && bridge && sweepPx !== null) {
    // ONE journey, shown two ways.
    //
    // `sampleJourneyDisplacement` says where the document would be if all of
    // it were mounted -- the same curve a whole-document pane would follow.
    // Each frame this asks one question of that position: can it be shown
    // with real text, or does it have to be shown with spoof? The curtain is
    // up for exactly the interval where the answer is spoof, which on a
    // windowed pane is most of the journey rather than only its middle.
    //
    // This replaces three phases with three notions of motion, under which
    // the curtain could only ever cover the constant-speed middle -- about
    // one frame in ninety-four of the time the pane could not actually move.
    // See scrollJourney.ts for why the displacement lives there.
    const totalSec = journeyDurationSec(journey);
    const totalMagnitudePx = Math.abs(totalVirtualPx);
    let sweep = sweepPx;
    let jumped = false;
    let startTimeMs: number | null = null;
    onCancel = () => bridge.end();

    const animateJourney = (nowMs: number): void => {
      if (startTimeMs === null) startTimeMs = nowMs;
      const elapsedSec = (nowMs - startTimeMs) / 1000;

      if (elapsedSec >= totalSec) {
        bridge.end();
        finish();
        return;
      }

      const virtualPx = sampleJourneyDisplacement(journey, elapsedSec);
      const travelledPx = Math.abs(virtualPx) - coverStartPx;

      // Still inside the mounted runway: ordinary scrolling, no curtain.
      if (travelledPx <= 0) {
        step(startPx + virtualPx);
        keepAnimating(animateJourney);
        return;
      }

      bridge.advance(travelledPx);
      const covering = bridge.isCovering(travelledPx);

      if (!jumped && covering) {
        jumped = true;
        traceScroll(() => `journey CUT     covered at travelled=${Math.round(travelledPx)}px,`
          + ` relocating destination`);
        // The pane is fully covered: the one moment a caller may put its
        // destination somewhere else entirely. Re-read the geometry
        // afterwards -- a windowed pane's scroll space is a different size
        // now, and every clamp below depends on it.
        const relocated = options?.onBridgeCut?.();
        traceScroll(() => `journey cut->   onBridgeCut returned ${relocated ?? 'null (target kept)'}`);
        if (relocated !== null && relocated !== undefined) {
          maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          targetPx = clamp(relocated, 0, maxScrollTopPx);
        }
        // Only now is it known how much real scrolling is available on the
        // far side, and therefore where the curtain must stop covering. Safe
        // to trim here and nowhere else: the trailing edge being moved is
        // below the pane, because the pane is fully covered.
        const landingRunwayPx = direction > 0 ? targetPx : maxScrollTopPx - targetPx;
        // Two lower bounds on how long the curtain stays up, and the longer
        // one wins. The first is the landing runway: cover until there is
        // real text to arrive over. The second is the plateau: the middle of
        // a bridged journey is skipped rather than travelled, and that skip
        // has to stay covered however much mounted document sits either side
        // of it -- on a pane holding the whole document the landing runway
        // can be a hundred thousand pixels, which would otherwise lift the
        // curtain after a single frame and show the jump it exists to hide.
        const throughPlateauPx = Math.abs(journey.rampUp.signedDistancePx)
          + Math.abs(journey.bridgeDistancePx);
        sweep = bridge.resizeSweep(Math.max(
          totalMagnitudePx - landingRunwayPx,
          throughPlateauPx,
        ) - coverStartPx + viewportPx);
        traceScroll(() => `journey cut ok  newMax=${Math.round(maxScrollTopPx)}`
          + ` target=${Math.round(targetPx)}`
          + ` landingRunway=${Math.round(landingRunwayPx)} sweep=${Math.round(sweep)}`);
      }

      // Where the reader is, relative to the target, in the space they will
      // actually arrive in. Before the cut that space is still the old
      // window, so this is written from the start instead.
      const remainingPx = totalMagnitudePx - Math.abs(virtualPx);
      step(
        jumped ? targetPx - (direction * remainingPx) : startPx + virtualPx,
        // Fully covered means nothing here is visible, so a clamp is the
        // design and not a defect.
        covering,
      );

      keepAnimating(animateJourney);
    };

    keepAnimating(animateJourney);
    return {
      rampUp: journey.rampUp,
      rampDown: journey.rampDown,
      bridgeDurationSec: journey.bridgeDurationSec,
    };
  }

  bridge?.end();

  // Planned as bridged, but this pane cannot raise a curtain. No curve is
  // right here: with the duration ceiling gone, playing the whole distance out
  // would be a scroll measured in seconds, and seconds of unreadable blur.
  // Arriving is the honest answer.
  if (journey?.kind === 'bridged') {
    finish();
    return null;
  }

  const plan = buildScrollPlanFromCurrentParams(signedDistance);
  const totalDurationMs = plan.totalDurationSec * 1000;

  let startTimeMs: number | null = null;

  const animateFrame = (nowMs: number): void => {
    if (startTimeMs === null) {
      startTimeMs = nowMs;
    }

    const elapsedMs = nowMs - startTimeMs;

    if (elapsedMs >= totalDurationMs) {
      finish();
      return;
    }

    step(startPx + sampleScrollPlan(plan, elapsedMs / 1000));
    keepAnimating(animateFrame);
  };

  keepAnimating(animateFrame);
  return null;
}

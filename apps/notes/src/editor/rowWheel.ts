/**
 * The wheel's row-quantized scroll dynamics, shared by every surface that
 * scrolls in whole rows: the edit view (CM6Editor.tsx) and the visualizer's
 * song list (visualizer/SongList.tsx). A surface hands over the one write it
 * knows how to make -- move by N rows, and say whether anything moved -- and
 * gets back the notch resolution (editor/wheelNotch.ts), the reader's step
 * (editor/wheelStep.ts) and the spin-to-keep-scrolling coast
 * (editor/wheelSpin.ts) exactly as the edit view has them, so a wheel feels
 * the same wherever it turns rows. Per instance: two surfaces are two
 * independent scrollers, and a spin in one has nothing to say about the other.
 */

import { createWheelNotchState, resolveWheelEventUnits, type WheelNotchState } from './wheelNotch'
import { getWheelStepRows } from './wheelStep'
import {
  cancelWheelSpin,
  createWheelSpinState,
  currentWheelSpinDelayMs,
  getWheelSpinCutoffMs,
  getWheelSpinDampenDivisor,
  getWheelSpinEffectiveThresholdMs,
  nextWheelSpinDelayMs,
  refreshWheelSpinCoast,
  registerWheelSpinNudge,
  startWheelSpinCoast,
  takeWheelSpinNudge,
  type WheelSpinDirection,
  type WheelSpinState,
} from './wheelSpin'

export interface RowWheelOptions {
  /** Move by `rows` whole rows; false when nothing moved (an end was reached), which ends a coast. */
  scrollRows: (rows: number, traceLabel: string) => boolean
  /** True while the surface may not scroll; a wheel then scrolls nothing and ends any coast. */
  isBlocked: () => boolean
  /** An optional trace (editor/wheelTrace.ts), read live. */
  trace?: { isOn: () => boolean; append: (line: string) => void } | null
}

export interface RowWheel {
  notchState: WheelNotchState
  spinState: WheelSpinState
  /** A wheel event over the surface. Call with a non-passive listener: it prevents the default. */
  handleWheel: (event: WheelEvent) => void
  /** End any coast. */
  stop: (reason: string) => void
  /** Hand a coast the surface's own measured rate (a finger's swipe, editor/fingerPan.ts). */
  startCoast: (direction: WheelSpinDirection, averageGapMs: number) => void
}

export function createRowWheel({ scrollRows, isBlocked, trace = null }: RowWheelOptions): RowWheel {
  const wheelNotchState = createWheelNotchState()
  const wheelSpinState = createWheelSpinState()
  let wheelSpinTimeoutId: number | null = null
  /**
   * The user's `b`, read live so a slider drag takes effect without a
   * remount -- and resolved, so the slider's off position arrives here as
   * the 0 this handler already knows how to bypass on.
   */
  const wheelSpinThresholdMs = () => getWheelSpinEffectiveThresholdMs();

  const stopWheelSpin = (reason: string) => {
    const hadTimeout = wheelSpinTimeoutId !== null;
    if (wheelSpinTimeoutId !== null) {
      window.clearTimeout(wheelSpinTimeoutId);
      wheelSpinTimeoutId = null;
    }
    // Note the `||`: by the time a user nudge gets here the state machine
    // has already cleared its own coast, so keying the log off `coast`
    // alone silently swallowed the one line anybody would look for. An
    // armed timeout is the other proof a coast was running.
    if ((wheelSpinState.coast || hadTimeout) && (trace !== null && trace.isOn())) trace!.append(`  coast ENDED (${reason})`);
    cancelWheelSpin(wheelSpinState);
  };

  /**
   * Arm the next simulated nudge, or end the coast if there is no next one.
   *
   * A chain of timeouts rather than one interval, because the interval is
   * a different number every time -- that is the whole of the dampening.
   */
  const scheduleWheelSpinNudge = () => {
    if (wheelSpinTimeoutId !== null) {
      window.clearTimeout(wheelSpinTimeoutId);
      wheelSpinTimeoutId = null;
    }
    const delayMs = nextWheelSpinDelayMs(
      wheelSpinState,
      getWheelSpinDampenDivisor(),
      getWheelSpinCutoffMs(),
    );
    if (delayMs === null) {
      stopWheelSpin('damped out');
      return;
    }
    wheelSpinTimeoutId = window.setTimeout(() => {
      wheelSpinTimeoutId = null;
      // The threshold going non-positive mid-coast means spin detection
      // is off; honour it on the spot rather than at the next spin.
      if (wheelSpinThresholdMs() <= 0 || isBlocked()) {
        stopWheelSpin('bypassed');
        return;
      }
      const nudge = takeWheelSpinNudge(wheelSpinState);
      if (!nudge) return;
      const moved = scrollRows(nudge.direction * nudge.rows, 'coast');
      if (!moved) {
        stopWheelSpin('document end');
        return;
      }
      scheduleWheelSpinNudge();
    }, delayMs);
  };

  // Cage-quantized wheel scroll -- ported verbatim from
  // CagedScrollPlugin.tsx's own handleWheel, plus the spin coast above.
  const handleWheel = (event: WheelEvent) => {
    const tracing = trace !== null && trace.isOn();
    if (isBlocked()) {
      if (tracing) trace!.append(`wheel dy=${event.deltaY} mode=${event.deltaMode} DECLINED blocked`);
      stopWheelSpin('scroll blocked');
      event.preventDefault();
      return;
    }
    if (event.deltaY === 0) return;
    event.preventDefault();

    // How many notches (editor/wheelNotch.ts, shared with the render view
    // so the same gesture reads the same way in both panes) times what the
    // reader has said a notch is worth (editor/wheelStep.ts).
    const notches = resolveWheelEventUnits(event, wheelNotchState, performance.now());
    if (notches === 0) {
      if (tracing) {
        trace!.append(
          `wheel dy=${event.deltaY} mode=${event.deltaMode} DECLINED sub-notch` +
          ` notch=${wheelNotchState.notchPx} pending=${wheelNotchState.pendingPx.toFixed(2)}`,
        );
      }
      return;
    }
    const units = notches * getWheelStepRows();

    if (wheelSpinThresholdMs() <= 0) {
      // The off position the slider offers at its left end, resolved to
      // 0: the machinery is not consulted, not started, and costs this
      // handler one comparison.
      // Labelled distinctly: "is the spin system even switched on here"
      // is the first question any report about it raises, and the trace
      // should answer it without anyone having to reason about the code.
      scrollRows(units, `wheel[spin off] dy=${event.deltaY} mode=${event.deltaMode}`);
      return;
    }

    const direction: WheelSpinDirection = units > 0 ? 1 : -1;
    const action = registerWheelSpinNudge(wheelSpinState, {
      nowMs: performance.now(),
      direction,
      rows: Math.abs(units),
      thresholdMs: wheelSpinThresholdMs(),
    });

    if (action.kind === 'ignore') {
      // The tail of the user's own spin, arriving while the coast runs.
      if (tracing) trace!.append(`wheel dy=${event.deltaY} SWALLOWED spin-tail`);
      return;
    }
    if (action.kind === 'stop') {
      // Only a nudge the OTHER way gets here now -- see wheelSpin.ts's
      // WheelSpinAction. It scrolls nothing, so you can halt on the line
      // you meant to.
      stopWheelSpin('reverse nudge');
      return;
    }
    if (action.kind === 'extend') {
      // The coast's own way: one more row of distance, coast untouched.
      // The timeout chain is not disturbed -- this rides on top of it.
      scrollRows(direction * action.rows, `wheel EXTEND dy=${event.deltaY}`);
      return;
    }
    if (action.kind === 'respin') {
      // Worth adopting only if the hand is now turning faster than the
      // coast is currently going -- which for this pane is the coast's own
      // decayed interval, since it advances `firedCount` as it steps.
      const currentDelayMs = currentWheelSpinDelayMs(wheelSpinState, getWheelSpinDampenDivisor());
      const faster = currentDelayMs !== null && action.averageGapMs < currentDelayMs;
      if (faster) {
        if (tracing) {
          trace!.append(
            `wheel RESPIN gap=${action.averageGapMs.toFixed(1)}ms (was ${currentDelayMs.toFixed(1)}ms)`,
          );
        }
        refreshWheelSpinCoast(wheelSpinState, performance.now(), action.averageGapMs, action.rows);
        scrollRows(direction * action.rows, `wheel[RESPIN] dy=${event.deltaY}`);
        scheduleWheelSpinNudge();
        return;
      }
      scrollRows(direction * action.rows, `wheel RESPIN-declined dy=${event.deltaY}`);
      return;
    }

    scrollRows(
      direction * action.rows,
      `wheel[b=${wheelSpinThresholdMs()} c=${getWheelSpinDampenDivisor()}${action.startsCoast ? ' SPIN' : ''}]` +
      ` dy=${event.deltaY} mode=${event.deltaMode}`,
    );
    if (action.startsCoast) scheduleWheelSpinNudge();
  };

  const startCoast = (direction: WheelSpinDirection, averageGapMs: number) => {
    startWheelSpinCoast(wheelSpinState, { nowMs: performance.now(), direction, averageGapMs, rowsPerNudge: 1 })
    scheduleWheelSpinNudge()
  }

  return { notchState: wheelNotchState, spinState: wheelSpinState, handleWheel, stop: stopWheelSpin, startCoast }
}

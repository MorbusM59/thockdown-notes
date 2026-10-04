import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import {
  buildHoldRampPlan,
  holdFullTravelSec,
  HOLD_TICK_MS,
  quantizeHoldTravel,
  sampleHoldTravel,
  type HoldRampPlan,
} from './holdToAdjust'

/**
 * Binds press-and-hold value adjustment to a control. See `holdToAdjust.ts`
 * for the motion model; this file is only the wiring.
 *
 * Returns props to spread onto the element. Nothing about it is specific to
 * any one control, so any future value that wants a hold gesture should reach
 * for this rather than write a timer.
 *
 * Two behaviours worth knowing about before using it:
 *
 * - **No hold threshold.** The value starts moving on press, not after a delay
 *   spent deciding whether this is a click. Instead, a press that ends before
 *   the curve has earned a whole step still applies one (`minimumStep`), so a
 *   tap is a nudge and a hold is a sweep, with nothing in between feeling
 *   dead. The usual arrangement -- wait 300ms, then jump -- makes the control
 *   unresponsive precisely when the user is being precise.
 *
 * - **Anchored to the value at press time.** The curve is always the one that
 *   crosses the WHOLE range, so where in the range the press starts changes
 *   only how soon it reaches an end, never how it feels. A hold beginning at
 *   60 accelerates exactly like one beginning at 0.
 */
export interface HoldToAdjustOptions {
  /** The value to start from, read once per press. */
  getValue: () => number
  /** Called with each new value the hold produces; never called with no change. */
  onChange: (next: number) => void
  min: number
  max: number
  /** Granularity, and the change a tap is guaranteed to make. Defaults to 1. */
  step?: number
  /**
   * Seconds for a hold to cross min..max. Defaults to the reader's animation
   * setting, converted by `holdFullTravelSec`.
   */
  fullTravelSec?: number
  /**
   * Which way a mouse button pushes the value. The default is the app's
   * convention -- left lowers, right raises -- matching the primary/secondary
   * split used elsewhere on these controls; return 0 to ignore a button.
   */
  directionForButton?: (button: number) => -1 | 0 | 1
  /** Runs on press, before any change. For side effects like un-muting. */
  onHoldStart?: () => void
  disabled?: boolean
}

const defaultDirectionForButton = (button: number): -1 | 0 | 1 => {
  if (button === 0) return -1
  if (button === 2) return 1
  return 0
}

export interface HoldToAdjustHandlers {
  onPointerDown: (event: ReactPointerEvent) => void
  onPointerUp: (event: ReactPointerEvent) => void
  onPointerCancel: (event: ReactPointerEvent) => void
  onLostPointerCapture: (event: ReactPointerEvent) => void
  onContextMenu: (event: ReactMouseEvent) => void
  /**
   * A right press IS a gesture here (it raises), so the control has to look
   * pressed for one -- see `shared/pressTracking.ts`. Declared in the bundle
   * rather than at the call site because it is a property of this behaviour,
   * not of whoever mounts it: every consumer gets it, and the source-level
   * check cannot see through a `{...spread}` to ask for it.
   */
  'data-secondary-press': 'action'
}

interface ActiveHold {
  direction: -1 | 1
  startValue: number
  startedAtMs: number
  plan: HoldRampPlan
  pointerId: number
  /** Steps applied so far, so the release knows whether the curve moved at all. */
  appliedSteps: number
}

export function useHoldToAdjust(options: HoldToAdjustOptions): HoldToAdjustHandlers {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const holdRef = useRef<ActiveHold | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clampToRange = useCallback((value: number) => {
    const { min, max } = optionsRef.current
    return Math.min(max, Math.max(min, value))
  }, [])

  const applySteps = useCallback((steps: number) => {
    const hold = holdRef.current
    if (!hold) return
    const step = optionsRef.current.step ?? 1
    const next = clampToRange(hold.startValue + hold.direction * steps * step)
    hold.appliedSteps = steps
    // Guard against re-emitting a value the control already shows -- both when
    // the curve has not crossed a step yet and when it is pinned at an end.
    if (next !== clampToRange(optionsRef.current.getValue())) {
      optionsRef.current.onChange(next)
    }
  }, [clampToRange])

  const stopTicking = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const endHold = useCallback(() => {
    const hold = holdRef.current
    stopTicking()
    holdRef.current = null
    if (!hold) return
    // The tap case: released before the curve covered a whole step. Without
    // this the control would look broken for short presses, which are most of
    // them when someone is nudging a value by one.
    if (hold.appliedSteps === 0) {
      holdRef.current = hold
      applySteps(1)
      holdRef.current = null
    }
  }, [applySteps, stopTicking])

  const handlePointerDown = useCallback((event: ReactPointerEvent) => {
    const opts = optionsRef.current
    if (opts.disabled) return
    const direction = (opts.directionForButton ?? defaultDirectionForButton)(event.button)
    if (direction === 0) return
    // A second button pressed mid-hold is ignored rather than allowed to
    // retarget the gesture halfway through.
    if (holdRef.current) return

    event.preventDefault()
    const plan = buildHoldRampPlan(opts.max - opts.min, opts.fullTravelSec ?? holdFullTravelSec())
    if (!plan) return

    opts.onHoldStart?.()

    // Pointer capture keeps a hold alive when the pointer drifts off what is
    // often a very small button, and guarantees the matching pointerup lands
    // here rather than wherever the pointer ended up.
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId)
    } catch {
      // Capture is an improvement, not a requirement.
    }

    holdRef.current = {
      direction,
      startValue: opts.getValue(),
      startedAtMs: performance.now(),
      plan,
      pointerId: event.pointerId,
      appliedSteps: 0,
    }

    stopTicking()
    tickRef.current = setInterval(() => {
      const hold = holdRef.current
      if (!hold) return
      // Recomputed from wall-clock elapsed rather than accumulated per tick, so
      // a late or dropped tick costs nothing and the curve stays exact.
      const elapsedSec = (performance.now() - hold.startedAtMs) / 1000
      const step = optionsRef.current.step ?? 1
      const steps = quantizeHoldTravel(sampleHoldTravel(hold.plan, elapsedSec), step) / step
      if (steps !== hold.appliedSteps) applySteps(steps)
    }, HOLD_TICK_MS)
  }, [applySteps, stopTicking])

  const handlePointerUp = useCallback((event: ReactPointerEvent) => {
    const hold = holdRef.current
    if (!hold || event.pointerId !== hold.pointerId) return
    // Ended BEFORE capture is released, so the lostpointercapture that the
    // release produces finds no hold and cannot cancel away the tap step.
    endHold()
    try {
      (event.currentTarget as Element).releasePointerCapture(event.pointerId)
    } catch {
      // Already released, or never captured.
    }
  }, [endHold])

  const handlePointerCancel = useCallback((event: ReactPointerEvent) => {
    const hold = holdRef.current
    if (!hold || event.pointerId !== hold.pointerId) return
    // Cancelled, not released: stop where it is, with no tap step.
    stopTicking()
    holdRef.current = null
  }, [stopTicking])

  // Capture can be taken away without a pointerup ever arriving here (the
  // window losing focus mid-press, among others). Left running, the ramp
  // would carry on to the end of the range and every later press would be
  // refused as "mid-hold". Treated as a cancel. A normal release also ends
  // in lostpointercapture, but by then the hold is already over and this
  // finds nothing to stop.
  const handleLostPointerCapture = handlePointerCancel

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    // Right-press is a direction here, so the native menu must never appear.
    event.preventDefault()
  }, [])

  useEffect(() => stopTicking, [stopTicking])

  return {
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onLostPointerCapture: handleLostPointerCapture,
    onContextMenu: handleContextMenu,
    'data-secondary-press': 'action',
  }
}

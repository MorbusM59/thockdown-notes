/**
 * The render-view "settle gate": keeps a freshly-switched-to note's preview
 * unpainted until its geometry has actually stopped moving, so the first
 * frame the user sees is the final one.
 *
 * ## The problem this exists for
 *
 * Switching notes in render mode used to paint the new note, and only then
 * land its restored scroll position on top -- the restore in
 * useEditorSectionMount's preview-restore effect can't even *know* where to
 * scroll until an async getNoteUiState round-trip resolves, which is several
 * frames after the new blocks are already on screen. Measured in render
 * mode, switching between two notes with very different geometry:
 *
 *   BIG -> SMALL: the new note's blocks mount while scrollTop is still the
 *                 outgoing note's (40), and only the NEXT commit snaps it
 *                 to 0 -- i.e. the new text is painted at the old note's
 *                 offset first
 *
 * plus react-virtual's own corrections as each newly-mounted block's real
 * measured height replaces the initial estimate. The user sees the text
 * arrive, then shuffle.
 *
 * With the gate in place the same switch measures: visible (old note) ->
 * hidden at ~18ms as the content swaps -> revealed at ~52ms already at its
 * final geometry, with no intermediate state ever painted.
 *
 * ## Why it's built this way
 *
 * The gate deliberately does NOT count frames or wait a fixed duration --
 * "wait 2 frames and hope it's done" is exactly the failure mode it
 * replaces, and no duration can be trusted to outlast react-virtual's
 * reconciliation on an arbitrary document (the same reasoning recorded on
 * applyPreviewSourceAnchor's own "no follow-up nudge" comment). Instead it
 * watches a real signal: a *geometry fixed point*. Each evaluation samples
 * the scroll container's own geometry (scrollTop + scrollHeight + the
 * virtualizer's sizer height) and compares it against the previous sample.
 * Two consecutive identical samples means nothing is moving any more, and
 * that's the reveal signal. Evaluation is scheduled on rAF purely because
 * that's the point at which a frame's layout is complete and stable -- the
 * frame is the *observation point*, not the condition; the loop reschedules
 * itself for exactly as long as the geometry keeps changing and stops the
 * moment it doesn't, so a trivial note settles in one evaluation and a
 * pathological one takes as many as it genuinely needs.
 *
 * `visibility: hidden` (not `display: none`, not opacity) is what hides it:
 * the subtree stays laid out, so react-virtual's ResizeObserver measurement
 * and the restore's own `scrollIntoView` both behave exactly as they do
 * when visible. The gate changes *when* the user sees the result, never
 * what the mechanism underneath computes.
 *
 * The `maxSettleMs` bound is a safety valve, not the mechanism: it exists
 * so a pathological document can never leave the preview permanently
 * invisible, and reaching it is a bug worth the console warning it emits.
 */

/** How long the gate will hold the preview hidden before revealing it regardless. Safety valve only -- see the module comment. */
const DEFAULT_MAX_SETTLE_MS = 600

export interface PreviewSettleGateOptions {
  /** The preview scroll container (`previewScrollRef`'s element). Read lazily -- it isn't mounted yet when the gate is created. */
  getContainer: () => HTMLElement | null
  maxSettleMs?: number
  /** Injectable clock/schedulers, for tests. Defaults to the real ones. */
  scheduler?: PreviewSettleGateScheduler
}

export interface PreviewSettleGateScheduler {
  now: () => number
  requestFrame: (callback: () => void) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delayMs: number) => number
  clearTimer: (handle: number) => void
}

const DEFAULT_SCHEDULER: PreviewSettleGateScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle),
}

export interface PreviewSettleGate {
  /**
   * A new preview target (note switch, snapshot switch) is starting to
   * load: hide the preview and open a fresh generation. Returns the
   * generation id, which every later call must pass back so a superseded
   * switch can never reveal (or un-hide) the one that replaced it.
   */
  beginSettle: () => number
  /**
   * The restore has issued its scroll write for `generation` -- or has
   * determined there's nothing to restore. Until this lands the gate stays
   * hidden no matter how stable the geometry looks, since "stable" before
   * the scroll has been applied just means we're stably in the wrong place.
   */
  markRestoreApplied: (generation: number) => void
  /** Called from the preview renderer's commit layout effect: the block subtree changed, so geometry may be moving again. */
  notifyCommit: () => void
  /** Subscribe to those same commits -- used by the restore to retry its anchor lookup exactly when the DOM could have changed, instead of polling frames. */
  subscribeToCommit: (listener: () => void) => () => void
  /** Reveal immediately and abandon the current generation (leaving preview mode, unmount, no note open). */
  forceReveal: (reason?: string) => void
  dispose: () => void
}

export function createPreviewSettleGate({
  getContainer,
  maxSettleMs = DEFAULT_MAX_SETTLE_MS,
  scheduler = DEFAULT_SCHEDULER,
}: PreviewSettleGateOptions): PreviewSettleGate {
  let generation = 0
  let isHidden = false
  let restoreAppliedGeneration = -1
  let lastSignature: string | null = null
  let settleStartedAtMs = 0
  let scheduledFrame: number | null = null
  let safetyTimer: number | null = null
  const commitListeners = new Set<() => void>()

  const setHidden = (hidden: boolean) => {
    const container = getContainer()
    if (!container) return
    // Written directly rather than through React state on purpose: the
    // settle loop can evaluate several times per switch, and routing that
    // through a re-render would churn the whole preview subtree (and so
    // move the very geometry it's trying to observe settle).
    container.style.visibility = hidden ? 'hidden' : ''
  }

  const cancelScheduled = () => {
    if (scheduledFrame !== null) {
      scheduler.cancelFrame(scheduledFrame)
      scheduledFrame = null
    }
    if (safetyTimer !== null) {
      scheduler.clearTimer(safetyTimer)
      safetyTimer = null
    }
  }

  const reveal = () => {
    cancelScheduled()
    isHidden = false
    lastSignature = null
    setHidden(false)
  }

  /**
   * The observed signal. scrollHeight and the virtualizer's own sizer
   * height together cover "a block's real measured height replaced its
   * estimate"; scrollTop covers the restore landing (and react-virtual's
   * scroll corrections afterwards). Anything that would visibly move the
   * text moves at least one of the three.
   */
  const readGeometrySignature = (container: HTMLElement): string => {
    const sizer = container.firstElementChild as HTMLElement | null
    return `${container.scrollTop}|${container.scrollHeight}|${sizer?.style.height ?? ''}`
  }

  const evaluate = () => {
    scheduledFrame = null
    if (!isHidden) return

    const container = getContainer()
    if (!container) {
      reveal()
      return
    }

    if (scheduler.now() - settleStartedAtMs > maxSettleMs) {
      console.warn('[preview-settle-gate] revealed on the safety bound rather than a settled geometry -- something upstream never stopped moving', {
        maxSettleMs,
        signature: readGeometrySignature(container),
        restoreApplied: restoreAppliedGeneration === generation,
      })
      reveal()
      return
    }

    // Stable-but-not-yet-restored is not settled: keep watching until the
    // restore's scroll write has actually been issued for this generation.
    if (restoreAppliedGeneration !== generation) {
      lastSignature = null
      scheduleEvaluate()
      return
    }

    const signature = readGeometrySignature(container)
    if (lastSignature !== null && signature === lastSignature) {
      reveal()
      return
    }

    lastSignature = signature
    scheduleEvaluate()
  }

  const scheduleEvaluate = () => {
    if (!isHidden || scheduledFrame !== null) return
    scheduledFrame = scheduler.requestFrame(evaluate)
  }

  return {
    beginSettle: () => {
      generation += 1
      isHidden = true
      restoreAppliedGeneration = -1
      lastSignature = null
      settleStartedAtMs = scheduler.now()
      setHidden(true)
      scheduleEvaluate()
      // A timer, NOT another animation frame, because the whole point of
      // this bound is to cover the cases where frames stop arriving: a
      // backgrounded or non-compositing window throttles rAF to nothing, and
      // a gate that could only ever reveal from inside a frame callback
      // would leave such a window's preview blank until it was focused
      // again. Timers keep firing there. (Found exactly this way -- the
      // gate held the preview hidden indefinitely in a non-compositing
      // browser pane.)
      if (safetyTimer !== null) scheduler.clearTimer(safetyTimer)
      safetyTimer = scheduler.setTimer(() => {
        safetyTimer = null
        if (!isHidden) return
        console.warn('[preview-settle-gate] revealing on the safety timer -- the geometry never reached a fixed point (or frames stopped arriving)')
        reveal()
      }, maxSettleMs)
      return generation
    },

    markRestoreApplied: (forGeneration: number) => {
      if (forGeneration !== generation) return
      restoreAppliedGeneration = forGeneration
      // Restart the comparison from here: samples taken before the scroll
      // landed say nothing about whether the *final* position is stable.
      lastSignature = null
      scheduleEvaluate()
    },

    notifyCommit: () => {
      for (const listener of commitListeners) listener()
      scheduleEvaluate()
    },

    subscribeToCommit: (listener: () => void) => {
      commitListeners.add(listener)
      return () => {
        commitListeners.delete(listener)
      }
    },

    forceReveal: () => {
      generation += 1
      restoreAppliedGeneration = -1
      reveal()
    },

    dispose: () => {
      cancelScheduled()
      commitListeners.clear()
      setHidden(false)
    },
  }
}

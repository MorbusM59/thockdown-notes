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
 * `opacity: 0` (never `display: none`) is what hides it: the subtree stays
 * laid out, so react-virtual's ResizeObserver measurement and the restore's
 * own `scrollIntoView` both behave exactly as they do when visible. The gate
 * changes *when* the user sees the result, never what the mechanism
 * underneath computes.
 *
 * This was `visibility: hidden` originally, for the same "stays laid out"
 * reason -- opacity was chosen over it once the outgoing note gained a fade,
 * because `visibility` cannot be interpolated and so cannot fade. The one
 * thing `visibility` gave for free is restored explicitly alongside it:
 * `pointer-events: none`, so a pane the reader cannot see is also one they
 * cannot click into.
 *
 * The `maxSettleMs` bound is a safety valve, not the mechanism: it exists
 * so a pathological document can never leave the preview permanently
 * invisible, and reaching it is a bug worth the console warning it emits.
 *
 * ## What it no longer has to wait for
 *
 * This gate once carried a second condition: a background survey measured
 * every block's height and committed them in one batch, and the geometry
 * would reach its fixed point BEFORE that commit -- so the note was revealed
 * at heights already known to be about to change. That whole apparatus is
 * gone. The continuous pane mounts every block, so its geometry is the
 * browser's own layout and is right the first time it is asked. A fixed
 * point is sufficient again, which is what it was originally meant to be.
 */

import {
  SETTLE_WATCH_DURATION_MS,
  formatSettleSample,
  isSettleTraceOn,
  readSettleGeometry,
  readTopMountedBlockIndex,
  sampleDiffers,
  traceSettle,
  type SettleGeometrySample,
} from './previewSettleTrace'

/** How long the gate will hold the preview hidden before revealing it regardless. Safety valve only -- see the module comment. */
const DEFAULT_MAX_SETTLE_MS = 600

/**
 * How long the outgoing note takes to fade away, when it is given the time.
 * There is deliberately no matching fade in, and it never delays anything.
 *
 * The two ends of a note switch are not symmetric, and treating them as if
 * they were is what a crossfade gets wrong.
 *
 * LEAVING is not an event. Nothing the reader wants to look at is happening,
 * and cutting the old note away in one frame is a flash; a short fade lets it
 * go without one.
 *
 * ARRIVING is the event, and it is the thing the reader asked for. A fade in
 * is the one part of a crossfade that genuinely delays it -- the note is
 * finished and correct, and the fade would be spent showing it to them
 * slowly. That is precisely what the interaction doc's note-activation rule
 * rejects: motion that conveys nothing and only delays arrival.
 *
 * ## It is never waited for
 *
 * The fade begins at the top of a note switch and the load runs alongside it,
 * so on a slow load it completes on its own and costs nothing. On a FAST load
 * the switch commits while the fade is still running, and the fade is simply
 * cut short -- the incoming note is not held back for it. An earlier version
 * did hold it back, for up to a full fade, which put a floor under every
 * switch; that floor was a third of the total wait when the pane still had a
 * measurement survey to sit through, and two thirds of it once the survey was
 * deleted. Motion that delays arrival is the thing being avoided, so it does
 * not get to delay arrival.
 *
 * Cutting it short is safe rather than merely tolerable: `beginSettle` runs
 * in the LAYOUT phase, before paint, so the frame that swaps in the new
 * note's DOM is the same frame that takes it to zero opacity. A half-faded
 * INCOMING note is never painted. What the reader can see is the outgoing
 * note's fade ending early -- at this duration, a frame or two of one.
 *
 * The fade runs against the OUTGOING note, which means it has to start before
 * React commits the incoming one -- see beginFadeOut, and the note switch in
 * EditorSection's activateNote that drives it.
 */
export const PREVIEW_FADE_OUT_MS = 50

/**
 * How long after a fade-out the gate waits for the note switch that is
 * supposed to follow it, before deciding one never will and coming back up.
 *
 * A fade-out is begun by the CALLER, at the top of a switch, and is only
 * undone by the settle that the same switch opens a moment later. If that
 * switch dies in between -- the note fails to load, the IPC rejects -- there
 * is nothing left to reveal the pane, and it stays invisible for the rest of
 * the session. This is the valve for that, and it covers every abort path
 * rather than the one or two that happen to be try/caught.
 *
 * Generous on purpose: a real load that is merely slow must not trip it and
 * flash the outgoing note back before the incoming one arrives. Anything past
 * this is not slow, it is gone.
 */
const FADE_OUT_ABANDONED_AFTER_MS = 5000

export interface PreviewSettleGateOptions {
  /** The preview scroll container (`previewScrollRef`'s element). Read lazily -- it isn't mounted yet when the gate is created. */
  getContainer: () => HTMLElement | null
  maxSettleMs?: number
  /**
   * Elements outside the scroll container that must be hidden and revealed
   * with it, in the same frame.
   *
   * The render view's scrollbar is not inside the pane it describes -- it
   * lives in its own `<aside>` (SectionEditorArea.tsx), so the container's
   * own `visibility` never reached it and it went on settling in full view
   * after the text had stopped: its size and position both change when the
   * measurement survey commits, because until then it is drawn from a
   * provisional ratio over an estimated content height. Covering the text and
   * not the thing that describes the text just moves which half of the window
   * the reader watches settle.
   */
  getCompanions?: () => Array<HTMLElement | null>
  /**
   * Run once per reveal, WHILE everything is still hidden.
   *
   * For anything that has to be brought up to date before it is seen. The
   * scrollbar needs exactly this: it is redrawn from scroll events, so on its
   * own it would reappear holding whatever it last computed and only catch up
   * on the next event -- visibly, which is the defect this is here to avoid.
   */
  onBeforeReveal?: () => void
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
  /**
   * Start fading the pane out, and answer how long that fade will take.
   *
   * Called at the START of a note switch, while the OUTGOING note is still
   * mounted -- this is the only window in which it exists to be faded. By the
   * time `beginSettle` runs, React has already replaced the DOM with the
   * incoming note, so a fade begun there would be fading in the wrong
   * content.
   *
   * The caller's job is to hold off committing the new note until the
   * returned duration has elapsed, and to do its own loading in the meantime
   * -- the fade is cover for work, not a delay bolted in front of it. It is
   * safe to call when a fade is already running (a fast second switch): the
   * pane is at zero already and there is nothing left to fade.
   */
  beginFadeOut: () => number
  /** Reveal immediately and abandon the current generation (leaving preview mode, unmount, no note open). */
  forceReveal: (reason?: string) => void
  /**
   * Whether the preview is hidden right now, waiting for its geometry to
   * settle.
   *
   * Exists so that machinery which reacts to the reader can tell that the
   * reader is not, in fact, there: nobody scrolls a pane they cannot see, so
   * a scroll event fired while this is true belongs to the restore, not to
   * them. See usePreviewMarkdownRendering's scroll listener, where treating
   * the restore's own scroll as the reader's made the measurement survey
   * stand aside for the whole quiet window at exactly the moment it most
   * needed to run.
   */
  isHolding: () => boolean
  dispose: () => void
}

export function createPreviewSettleGate({
  getContainer,
  maxSettleMs = DEFAULT_MAX_SETTLE_MS,
  getCompanions,
  onBeforeReveal,
  scheduler = DEFAULT_SCHEDULER,
}: PreviewSettleGateOptions): PreviewSettleGate {
  let generation = 0
  let isHidden = false
  let restoreAppliedGeneration = -1
  let lastSignature: string | null = null
  /** Armed by beginFadeOut, disarmed by the settle that should follow it. See FADE_OUT_ABANDONED_AFTER_MS. */
  let fadeOutAbandonTimer: number | null = null
  let settleStartedAtMs = 0
  let scheduledFrame: number | null = null
  let safetyTimer: number | null = null

  /** Every element the hold covers: the pane, plus anything outside it that describes the pane. */
  const eachCoveredElement = (visit: (element: HTMLElement) => void) => {
    const container = getContainer()
    if (container) visit(container)
    // The companions are visited even when the container is missing: they are
    // separate elements with their own lifetimes, and leaving one hidden
    // because the scroller happened to be gone is how a scrollbar disappears
    // for good.
    for (const companion of getCompanions?.() ?? []) {
      if (companion) visit(companion)
    }
  }

  /**
   * @param transitionMs 0 to change instantly (the default for hiding: the
   * fade-out is driven separately, against the outgoing note, and by the time
   * the gate hides there is nothing left worth fading).
   */
  const setHidden = (hidden: boolean, transitionMs = 0) => {
    // Written directly rather than through React state on purpose: the
    // settle loop can evaluate several times per switch, and routing that
    // through a re-render would churn the whole preview subtree (and so
    // move the very geometry it's trying to observe settle).
    eachCoveredElement((element) => {
      element.style.transition = transitionMs > 0 ? `opacity ${transitionMs}ms ease-out` : ''
      element.style.opacity = hidden ? '0' : ''
      element.style.pointerEvents = hidden ? 'none' : ''
    })
  }

  const disarmFadeOutAbandon = () => {
    if (fadeOutAbandonTimer === null) return
    scheduler.clearTimer(fadeOutAbandonTimer)
    fadeOutAbandonTimer = null
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

  /**
   * Follows the geometry for a while AFTER a reveal, when the trace is on.
   *
   * The gate's own job ends at the reveal; this is the part that says
   * whether ending it there was right. See previewSettleTrace.ts for why it
   * reports the three components separately and latches one block to follow.
   */
  let watchFrame: number | null = null
  const stopWatching = () => {
    if (watchFrame === null) return
    scheduler.cancelFrame(watchFrame)
    watchFrame = null
  }

  const watchAfterReveal = () => {
    stopWatching()
    if (!isSettleTraceOn()) return
    const container = getContainer()
    if (!container) return

    const latchedBlockIndex = readTopMountedBlockIndex(container)
    const startedAtMs = scheduler.now()
    let previous: SettleGeometrySample = readSettleGeometry(container, latchedBlockIndex)
    let changes = 0
    traceSettle(() => `watch  start latchedBlock=${latchedBlockIndex ?? 'none'} for=${SETTLE_WATCH_DURATION_MS}ms`)

    const step = () => {
      watchFrame = null
      const stillThere = getContainer()
      if (!stillThere) return
      const elapsedMs = scheduler.now() - startedAtMs
      const sample = readSettleGeometry(stillThere, latchedBlockIndex)
      if (sampleDiffers(sample, previous)) {
        changes += 1
        traceSettle(() => formatSettleSample(elapsedMs, sample, previous))
        previous = sample
      }
      if (elapsedMs >= SETTLE_WATCH_DURATION_MS) {
        traceSettle(() => `watch  end changes=${changes} -- ${changes === 0 ? 'nothing moved after the reveal' : 'the reveal was followed by movement (see the textShift on each line)'}`)
        return
      }
      watchFrame = scheduler.requestFrame(step)
    }

    watchFrame = scheduler.requestFrame(step)
  }

  const reveal = (reason: string) => {
    const container = getContainer()
    // Whether this reveal ends a real hold. A forced one (leaving preview
    // mode, no note open, startup) ends nothing, and its "heldMs" would be
    // measured from whenever the last genuine settle began -- a number in the
    // seconds that means nothing and reads as a stall that never happened.
    const wasHolding = isHidden
    traceSettle(() => {
      const held = wasHolding ? ` heldMs=${Math.round(scheduler.now() - settleStartedAtMs)}` : ''
      const geometry = container ? readSettleGeometry(container, null) : null
      return `reveal gen=${generation} reason=${reason}${held}`
        + (geometry ? ` scrollTop=${geometry.scrollTop} scrollHeight=${geometry.scrollHeight} sizerH=${geometry.sizerHeightPx}` : ' (no container)')
    })
    cancelScheduled()
    disarmFadeOutAbandon()
    isHidden = false
    lastSignature = null
    // Before the un-hide, deliberately: anything brought up to date here is
    // then correct in the very first frame it is seen, rather than correcting
    // itself in the second one.
    try {
      onBeforeReveal?.()
    } catch (error) {
      console.warn('[preview-settle-gate] onBeforeReveal threw -- revealing anyway', error)
    }
    // Instant, with no transition: the note is already final by the time this
    // runs, so there is nothing a fade could resolve -- only a delay before
    // the reader gets what they asked for.
    setHidden(false)
    watchAfterReveal()
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
      reveal('no-container')
      return
    }

    if (scheduler.now() - settleStartedAtMs > maxSettleMs) {
      console.warn('[preview-settle-gate] revealed on the safety bound rather than a settled geometry -- something upstream never stopped moving', {
        maxSettleMs,
        signature: readGeometrySignature(container),
        restoreApplied: restoreAppliedGeneration === generation,
      })
      reveal('safety-bound')
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
      reveal('fixed-point')
      return
    }

    traceSettle(() => `sample gen=${generation} sig=${signature}${lastSignature === null ? ' (first)' : ' (moved)'}`)
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
      stopWatching()
      // The switch this fade-out was for has arrived; the settle's own bounds
      // take over from here.
      disarmFadeOutAbandon()
      // INSTANT, and never the remainder of a running fade. By the time this
      // runs React has already swapped in the incoming note's DOM, so
      // continuing the fade would be fading the WRONG note in front of the
      // reader. This is the layout phase, so taking it to zero here happens
      // in the same frame the swap does and neither is ever painted.
      setHidden(true)
      traceSettle(() => `begin  gen=${generation} container=${getContainer() ? 'yes' : 'MISSING -- nothing was hidden'}`)
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
        reveal('safety-timer')
      }, maxSettleMs)
      return generation
    },

    markRestoreApplied: (forGeneration: number) => {
      if (forGeneration !== generation) {
        traceSettle(() => `restore ignored gen=${forGeneration} (current is ${generation})`)
        return
      }
      restoreAppliedGeneration = forGeneration
      traceSettle(() => `restore applied gen=${forGeneration}`)
      // Restart the comparison from here: samples taken before the scroll
      // landed say nothing about whether the *final* position is stable.
      lastSignature = null
      scheduleEvaluate()
    },

    notifyCommit: () => {
      scheduleEvaluate()
    },

    forceReveal: (reason?: string) => {
      generation += 1
      restoreAppliedGeneration = -1
      reveal(reason ?? 'forced')
    },

    beginFadeOut: () => {
      traceSettle(() => `fadeout gen=${generation} ${PREVIEW_FADE_OUT_MS}ms (outgoing note still mounted)`)
      setHidden(true, PREVIEW_FADE_OUT_MS)

      disarmFadeOutAbandon()
      fadeOutAbandonTimer = scheduler.setTimer(() => {
        fadeOutAbandonTimer = null
        // A settle took ownership; its own bounds govern from there.
        if (isHidden) return
        console.warn('[preview-settle-gate] a fade-out was never followed by a note switch -- revealing so the pane cannot stay invisible')
        reveal('fade-out-abandoned')
      }, PREVIEW_FADE_OUT_MS + FADE_OUT_ABANDONED_AFTER_MS)

      return PREVIEW_FADE_OUT_MS
    },

    isHolding: () => isHidden,

    dispose: () => {
      cancelScheduled()
      disarmFadeOutAbandon()
      stopWatching()
      setHidden(false)
    },
  }
}

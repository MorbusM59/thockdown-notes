import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import {
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  buildReleaseRampDownPlanFromCurrentParams,
  resolveApexSpeedPxPerSecFromCurrentParams,
  sampleReleaseRampDownPlan,
  sampleScrollPlan,
} from '../editor/ScrollCurvePlan'
import { buildEscapeHoldRotationPlan, pixelsPerSlotAt } from './escapeHoldRotationCurve'
import { computeEscapeHoldPointAtSlot } from './escapeHoldRingLayout'
import type { EscapeHoldRingParams } from './escapeHoldRingLayout'

// Two staggered setTimeout delays, not rAF (see the doc comments on the
// effect and handler that use these) -- setTimeout with different delays
// is spec-guaranteed to fire in delay order, which is what actually needs
// to hold here: the focus grab (0ms) needs to run, and then the blur-close
// check (comfortably later) needs to run strictly after it, across two
// independent component instances with no other way to coordinate.
const FOCUS_GRAB_DELAY_MS = 0
const BLUR_CLOSE_CHECK_DELAY_MS = 50

// Cheap fallback speed for reduceVisualEffects: true -- see the component
// doc comment for why that mode skips the curve engine below entirely
// instead of trying to feed it a "reduced" version of the same math.
const SIMPLE_ROTATION_TRANSITION_MS = 200

// Once a rapid-tap run's remaining distance to its authoritative target
// (pendingTargetSlotRef) drops to this many slots or fewer, cruise hands off
// to one exact discrete step straight to the target instead of continuing to
// coast -- see handleRingKeyDown's tap-merge branch and
// runContinuousRotation. Deliberately distance-bounded, not time-debounced:
// a timer can only ever guess when "no more taps are coming," which is what
// let a run land on the wrong slot before (see the component doc comment's
// tap-run paragraph); the discrete step's own landing is exact by
// construction regardless of exactly when it's triggered, so nothing here
// needs to guess correctly, only to trigger it before more than this many
// slots would otherwise be crossed by continuing to coast.
const SETTLE_TRIGGER_SLOTS = 1

// A key that's still down this long after a run's first tap is deliberately
// NOT yet trusted as a genuine hold, no matter how fast the curve is -- see
// armHoldCheck. Fixed and independent of curve shape, unlike the
// crossing-time-based check this replaced (see the component doc comment's
// tap-run paragraph): that one asked "has the bell curve's velocity reached
// cruise speed yet," which for an aggressive shape/dynamic setting could be
// under 30ms -- far faster than a human can physically release a key after
// tapping it, so an ordinary tap routinely still looked "held" at that
// check and got wrongly escalated into unbounded continuous rotation,
// overshooting well past the one slot a tap should ever move.
const HOLD_CHECK_INTERVAL_MS = 100
// Total elapsed time since a run's first tap, with the key still down the
// whole way, before continued key-down is trusted as a genuine hold rather
// than a slower deliberate multi-tap -- see armHoldCheck.
const HOLD_CONFIRM_DELAY_MS = 200

export interface EscapeHoldPanelProps {
  /** Whether the panel is the one currently "open" -- this component now stays
   * permanently mounted (its host toggles `display:none` around it instead of
   * mounting/unmounting it) so the shared empty-state animation it lives
   * inside never restarts. Focus management below keys off this transitioning
   * to true instead of off mount. */
  isOpen: boolean
  activeNoteId: string | null
  /** True while the active note (or its whole chapter family) is timeless -- disables New Chapter, since a frozen family can't gain a new chapter (databaseService.ts's assertNotTimeless). Export/New Note are unaffected -- they're not mutations of the frozen note itself. */
  isActiveNoteTimeless: boolean
  isExportingPdf: boolean
  isExportingMd: boolean
  /** Live user-configurable corner-radius/spacing base units (options menu sliders) -- fed straight into escapeHoldRingLayout.ts so the ring's shape tracks .editor-empty-state's actual on-screen corner radius/inset instead of a stale hardcoded value. */
  borderRadiusRegularPx: number
  spacingRegularPx: number
  /** The Performance section's "Reduce visual effects" toggle -- see the component doc comment for what it switches between. */
  reduceVisualEffects: boolean
  onCreateNote: () => void | Promise<void>
  onCreateChapter: () => void | Promise<void>
  onExportPdf: () => void | Promise<void>
  onExportMd: () => void | Promise<void>
  onOpenHelp: () => void | Promise<void>
  onClose: () => void
}

interface PanelCell {
  label: string
  icon: string
  onSelect: () => void | Promise<void>
}

/**
 * The escape-hold overlay's quick-actions ring (SectionEditorArea.tsx):
 * currently-available actions only (unavailable ones -- e.g. New Chapter
 * with no note open -- drop out entirely rather than rendering disabled),
 * spaced evenly around the shared empty-state circle's perimeter via
 * escapeHoldRingLayout.ts. Count is whatever it is; nothing here assumes a
 * fixed number of cells.
 *
 * "Telephone dial" keyboard model: `topIndex` (React state) is whichever
 * cell is bound to the fixed top-center slot -- the only cell that's ever a
 * real Tab stop (tabIndex=0; every other cell is tabIndex=-1 and reachable
 * by mouse only). Up/Left rotate back a step, Down/Right forward a step,
 * Tab/Shift+Tab the same (so Tab can't escape to whatever's behind the
 * modal overlay -- there'd otherwise be nowhere else *in* the ring for it to
 * go, since only one cell is ever tabbable). Rotating changes which cell
 * *is* `topIndex` and moves DOM focus to that cell's own button -- it isn't
 * a single DOM node that never moves; every cell's button repositions each
 * rotation, and the newly-active one simply happens to be the one that ends
 * up at the top.
 *
 * `topIndex` only updates once a rotation gesture *fully* settles (a single
 * tap's animation finishing, or a held key's continuous spin decelerating
 * and clicking into place after release) -- not continuously while a long
 * hold is spinning through many cells. Keeping focus/tabIndex/aria pinned to
 * the pre-gesture cell throughout the animation, rather than jumping cell to
 * cell many times a second, is deliberate: nothing about *which* action is
 * "selected" is meaningful again until the ring stops moving, the same way
 * you can't read a spinning reel.
 *
 * Rotation animation reuses the editor's own smooth-scroll toolkit
 * (ScrollCurvePlan.ts, already shared today between render-view and
 * edit-view scroll) rather than a bespoke animation system -- see
 * escapeHoldRotationCurve.ts's module comment for the full mapping (one
 * "page" of scroll <-> one "slot" of rotation) and CursorClickCurve.ts for
 * the precedent of adapting that same toolkit to a different interaction.
 * The state machine below mirrors CM6Editor.tsx's PageUp/PageDown handling
 * closely enough to read side by side with it, with one deliberate
 * departure -- see the tap-run paragraph below for why a distinct tap
 * (KeyboardEvent.repeat === false) doesn't splice into continuous mode
 * anywhere near as eagerly as `scrollToQuantizedSmooth`'s crossing-time
 * handoff does:
 *   - Tap: one discrete bell-curve step of exactly 1 slot (`advanceRun` ->
 *     `finishToTarget` -> `playDiscretePlan`), with a 100ms-cadence poll
 *     (`armHoldCheck`) deciding, independently of the curve's own shape,
 *     whether continued key-down eventually earns real continuous rotation.
 *   - Continuous (armHoldCheck confirming a hold, 200ms in): constant
 *     angular velocity, advanced by simple delta-time accumulation each
 *     frame (`runContinuousRotation`) -- no bell sampling needed for
 *     constant velocity, exactly like `runPageContinuousScroll`.
 *   - Release (keyup): decelerates from the current continuous velocity
 *     back toward zero along the bell's own natural tail
 *     (`buildReleaseRampDownPlanFromCurrentParams`/
 *     `sampleReleaseRampDownPlan`, reused unmodified) -- exactly like
 *     `startPageReleaseRampDown`.
 *   - Settle: the one genuinely new phase scroll never needed, since any
 *     resting scrollTop is valid but the ring MUST end up on a whole slot.
 *     Once the release ramp-down's tail duration elapses, whatever
 *     fractional slot it left the ring at gets rounded to the nearest whole
 *     one and played as one more short discrete step (reusing the exact
 *     same bell-curve machinery as a tap) -- a quick, natural "click into
 *     place" rather than an abrupt snap, since the remaining distance is
 *     always <= 0.5 slot.
 * A "run" -- either several taps landing faster than one step's own bell
 * curve takes to finish, or a single key-press whose eventual hold status
 * is still unconfirmed -- is neither queued nor replayed as independent
 * bell curves from scratch (earlier versions of this file did each of
 * those, and each broke a different way -- see below): N taps (and every
 * step played before a hold is confirmed) must always add up to exactly N
 * slots, no overshoot, no undershoot, no bounce-back. `pendingTargetSlotRef`
 * is the run's authoritative destination -- an exact integer, extended by
 * +/-1 on every step (`advanceRun`, `tapRunActiveRef` marks a run as in
 * progress) -- and every phase of the run ultimately lands precisely on it:
 * `playDiscretePlan` always finishes exactly at `start + signedDistanceSlots`
 * by construction, and `finishToTarget` always calls it with the exact live
 * remaining distance to `pendingTargetSlotRef`, however far off-target the
 * animation is at the moment it's triggered. `advanceRun` cruises at a
 * steady velocity via the same `startContinuousRotation` a confirmed hold
 * uses only when still far from the target (avoiding the stutter of
 * restarting a fresh 0-velocity curve on every step, which is what one
 * earlier version did for taps); `runContinuousRotation` checks the
 * remaining distance every frame and, once it drops to
 * `SETTLE_TRIGGER_SLOTS` or fewer, hands off to `finishToTarget` for the
 * final exact leg instead of continuing to coast (a still-earlier version
 * used a time debounce here instead of tracking distance to a fixed target
 * -- guessing "no more taps are coming" from elapsed time rather than
 * bounding by an exact target is exactly what let a run overshoot the tap
 * count).
 *
 * Whether an unbroken run of steps ever becomes a genuine, unbounded hold
 * is decided by `armHoldCheck`, not by whether the bell curve's own
 * velocity happens to reach cruise speed (a still-earlier version keyed
 * this off `resolveRampCrossingTimeSecFromCurrentParams` -- how long the
 * curve takes to cross the target speed -- which for an aggressive
 * shape/dynamic setting could be well under the time a human physically
 * takes to release a key after tapping it, so a single ordinary tap
 * routinely still read as "held" at that check and got escalated into
 * unbounded continuous rotation, overshooting past the one slot a tap
 * should ever move). `armHoldCheck` instead polls, at a flat
 * `HOLD_CHECK_INTERVAL_MS` cadence independent of curve shape, whether the
 * key that started the run is still down; each tick before
 * `HOLD_CONFIRM_DELAY_MS` has elapsed just chains one more exact
 * `advanceRun` step (armed again from `handleRingKeyDown`'s repeat:false
 * branch too, for every distinct tap -- see that branch for why it, not
 * `advanceRun`, owns resetting the run's start-time clock), so what's on
 * screen while a hold's status is still uncertain is literally the same
 * "one exact step after another" a rapid-tap run produces; only once a
 * still-held key crosses `HOLD_CONFIRM_DELAY_MS` does it hand off to real
 * continuous rotation. `tapRunActiveRef` distinguishes the whole
 * run/poll path (bounded by `pendingTargetSlotRef`) from a confirmed hold
 * (which has no fixed target and instead free-runs until its own keyup --
 * see handleRingKeyUp) so a run's own near-immediate keyup (each tap is a
 * real press+release, unlike a held key which sends no keyup until
 * actually released) doesn't trigger a premature release.
 *
 * All of the above only runs when `reduceVisualEffects` is false (the
 * Performance section's "Reduce visual effects" toggle). When true, the
 * whole curve engine is skipped -- every tap or hold-repeat just steps
 * `topIndex` by 1 immediately, and `.editor-escape-hold-panel-btn`'s own
 * plain CSS transition (added via the `is-simple-rotation` class only in
 * this mode -- see editor.css) eases the position change instead. Cheaper,
 * and there's no dial-specific settings to keep in sync with a "reduced"
 * mode since this mode doesn't touch the curve engine at all.
 *
 * The animation itself is driven imperatively, not through React state per
 * frame: a rAF loop writes each button's `style.transform` directly from a
 * continuously-updating `rotationOffsetRef` (a possibly-fractional slot
 * position), the same way NonQuantizedSmoothScroll.ts writes `scrollTop`
 * directly rather than going through React. React's own render still
 * computes each button's position from `topIndex` for the at-rest case, so
 * when a gesture finishes and `topIndex` updates, the freshly-rendered
 * value already matches exactly where the imperative loop left off -- no
 * jump, no explicit hand-off needed.
 *
 * Clicking any cell -- top or not -- activates it immediately and closes
 * the panel (`runCell`); rotation is a keyboard-only way to browse without
 * committing, not a prerequisite for activating by mouse.
 *
 * Closes itself if it ever ends up open with focus genuinely outside it
 * (`handleRingBlur`) -- the panel is meant to hold focus the entire time
 * it's shown, so losing it to something else in the app is treated as an
 * implicit dismissal, the same as clicking the backdrop. The one exception
 * is switching which editor section is active while the panel is open:
 * `isOpen` here is this section's own `isEscapeHoldActive`
 * (SectionEditorArea.tsx), which is global "the panel is open" AND-ed with
 * "this is the active section" -- so activating a different section flips
 * *this* instance's `isOpen` to false (hiding it) while the *other*
 * section's instance flips to true and grabs focus into its own top cell
 * via the effect above, without the panel ever needing to be closed and
 * reopened. Blur naturally fires here as part of that handoff too, so
 * `handleRingBlur` can't just always close on blur.
 *
 * It deliberately does NOT decide this by checking whether THIS instance's
 * own `isOpen` prop is still true after a deferred tick -- an earlier
 * version did that, and it was racy: native focus-shift on mousedown fires
 * as part of the very same synchronous dispatch that also runs
 * markSectionActive (EditorSection.tsx), so by the time blur reaches here
 * the section switch may not have re-rendered (and even less reliably,
 * this component's own `isOpen`-mirroring ref may not have been updated by
 * its passive effect) yet, even after a setTimeout(0). Checking
 * `document.activeElement` against ANY visible escape-hold ring in the
 * whole document, not just this one's own `isOpen`, sidesteps that
 * entirely: exactly one ring is ever visible at a time (only the active
 * section's), so "focus landed in *some* ring" and "focus landed in *the*
 * ring that's currently open" are the same fact, and the check is reading
 * the DOM directly rather than trusting a React ref that may not have
 * settled yet.
 *
 * ARIA: role="toolbar" rather than role="grid" -- there's no row/column
 * structure to describe, and toolbar is the WAI-ARIA pattern that actually
 * covers a roving-tabindex set of buttons. Still an imperfect fit for a
 * rotating ring (toolbar assumes a static linear layout), but closer than
 * grid.
 */
export function EscapeHoldPanel({
  isOpen,
  activeNoteId,
  isActiveNoteTimeless,
  isExportingPdf,
  isExportingMd,
  borderRadiusRegularPx,
  spacingRegularPx,
  reduceVisualEffects,
  onCreateNote,
  onCreateChapter,
  onExportPdf,
  onExportMd,
  onOpenHelp,
  onClose,
}: EscapeHoldPanelProps) {
  const hasActiveNote = Boolean(activeNoteId)

  const cells = useMemo<PanelCell[]>(() => {
    const candidates = [
      { label: 'New Note', icon: 'fa-solid fa-file', onSelect: onCreateNote, disabled: false },
      { label: 'New Chapter', icon: 'fa-solid fa-book-medical', onSelect: onCreateChapter, disabled: !hasActiveNote || isActiveNoteTimeless },
      { label: 'Export PDF', icon: 'fa-solid fa-file-pdf', onSelect: onExportPdf, disabled: !hasActiveNote || isExportingPdf },
      { label: 'Export MD', icon: 'fa-solid fa-file-code', onSelect: onExportMd, disabled: !hasActiveNote || isExportingMd },
      { label: 'Help', icon: 'fa-solid fa-circle-question', onSelect: onOpenHelp, disabled: false },
    ]
    return candidates.filter((candidate) => !candidate.disabled)
  }, [hasActiveNote, isActiveNoteTimeless, isExportingPdf, isExportingMd, onCreateNote, onCreateChapter, onExportPdf, onExportMd, onOpenHelp])

  const [topIndex, setTopIndex] = useState(0)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Mirrors of render-scope values the imperative rAF/timer chains below
  // need to read, since a callback may have been scheduled by an earlier
  // render's closure -- see cellsRef's own note. Reading through a ref
  // (a stable object mutated in place) always gets the current value
  // regardless of which render's function is the one actually running.
  const cellsRef = useRef(cells)
  useEffect(() => { cellsRef.current = cells }, [cells])
  const ringGeometryParamsRef = useRef<EscapeHoldRingParams>({ borderRadiusRegularPx, spacingRegularPx })
  useEffect(() => {
    ringGeometryParamsRef.current = { borderRadiusRegularPx, spacingRegularPx }
  }, [borderRadiusRegularPx, spacingRegularPx])

  // The live, possibly-fractional rotation position (in slots), driven by
  // the rAF loops below. Always equals `topIndex` exactly whenever nothing
  // is animating -- see the component doc comment on why the animation is
  // imperative rather than per-frame React state.
  const rotationOffsetRef = useRef(0)

  // Rotation-engine state, mirroring CM6Editor.tsx's PageUp/PageDown
  // handler almost variable-for-variable -- see the component doc comment.
  const heldKeysRef = useRef<Set<string>>(new Set())
  const continuousDirectionRef = useRef<-1 | 0 | 1>(0)
  const continuousLastTsRef = useRef<number | null>(null)
  const continuousRafIdRef = useRef<number | null>(null)
  const releaseRafIdRef = useRef<number | null>(null)
  const handoffTimeoutIdRef = useRef<number | null>(null)
  // Whichever discrete (tap or settle) bell-curve animation is currently
  // playing, if any -- separate from the continuous/release rAF ids above
  // since exactly one of "discrete" or "continuous-or-release" is ever
  // active at a time, but they're conceptually distinct loops.
  const discreteRafIdRef = useRef<number | null>(null)

  // The authoritative destination (in whole slots) for the rapid-tap run
  // currently in progress, if any -- only meaningful while tapRunActiveRef
  // is true. Set from the first tap of a run (current rest position + 1)
  // and extended by +/-1 on every subsequent tap that arrives before the
  // ring has settled, so N taps always add up to exactly N slots no matter
  // how the animation in between gets interrupted and replanned.
  const pendingTargetSlotRef = useRef(0)
  // performance.now() timestamp of the current run's first tap -- the basis
  // for HOLD_CONFIRM_DELAY_MS in armHoldCheck. Only meaningful while
  // tapRunActiveRef is true.
  const runStartTimeMsRef = useRef(0)
  // True from the first tap of a rapid-tap run until it fully settles
  // (finalizeTopIndex) or a genuine OS-repeat hold takes over -- see the
  // component doc comment's tap-run paragraph. Distinguishes "the ring is
  // moving because of tap-run merging, bounded by pendingTargetSlotRef"
  // from "the ring is moving because of a genuine held key, which has no
  // fixed target and releases on its own keyup instead" -- both
  // handleRingKeyUp and runContinuousRotation need to tell those apart.
  const tapRunActiveRef = useRef(false)

  const clearHandoffTimeout = () => {
    if (handoffTimeoutIdRef.current !== null) {
      window.clearTimeout(handoffTimeoutIdRef.current)
      handoffTimeoutIdRef.current = null
    }
  }

  const cancelDiscreteAnimation = () => {
    if (discreteRafIdRef.current !== null) {
      cancelAnimationFrame(discreteRafIdRef.current)
      discreteRafIdRef.current = null
    }
  }

  const stopContinuousRotation = () => {
    continuousDirectionRef.current = 0
    continuousLastTsRef.current = null
    if (continuousRafIdRef.current !== null) {
      cancelAnimationFrame(continuousRafIdRef.current)
      continuousRafIdRef.current = null
    }
    if (releaseRafIdRef.current !== null) {
      cancelAnimationFrame(releaseRafIdRef.current)
      releaseRafIdRef.current = null
    }
  }

  // Cancels every in-flight animation/timer -- used when the panel closes
  // or reopens, so nothing from a previous session can keep running into a
  // new one.
  const stopAllRotation = () => {
    clearHandoffTimeout()
    cancelDiscreteAnimation()
    stopContinuousRotation()
    heldKeysRef.current.clear()
    tapRunActiveRef.current = false
  }

  // Writes every cell's current position directly to the DOM from the given
  // (possibly fractional, possibly out-of-[0,count) -- the underlying angle
  // is periodic, so that's fine) rotation offset. Called every animation
  // frame; deliberately bypasses React so 60fps motion doesn't mean 60fps
  // re-renders.
  const applyRotationOffsetToDom = (offset: number) => {
    const count = cellsRef.current.length
    if (count === 0) return
    cellsRef.current.forEach((_, index) => {
      const button = buttonRefs.current[index]
      if (!button) return
      const slot = index - offset
      const point = computeEscapeHoldPointAtSlot(slot, count, ringGeometryParamsRef.current)
      button.style.transform = `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`
    })
  }

  // The one place `topIndex` actually changes -- always once rotationOffsetRef
  // has already settled on (or very near) a whole slot. Wraps into [0, count)
  // since that's what the tabIndex/aria comparison below needs, and
  // re-applies the wrapped value to the DOM so a wrap-around (e.g. settling
  // at slot -1, which is the same point as count-1) doesn't cause a visible
  // jump between the last frame's raw offset and the wrapped render.
  const finalizeTopIndex = () => {
    const count = cellsRef.current.length
    if (count === 0) return
    const wrapped = ((Math.round(rotationOffsetRef.current) % count) + count) % count
    rotationOffsetRef.current = wrapped
    applyRotationOffsetToDom(wrapped)
    tapRunActiveRef.current = false
    setTopIndex(wrapped)
  }

  // Plays a single bell-curve step of `signedDistanceSlots` from the
  // current rotationOffsetRef, calling `onComplete` once it lands exactly
  // there. Shared by both the discrete tap step and the post-release
  // settle hop -- see the component doc comment -- since both are just "one
  // bell-curve position animation from here to there," differing only in
  // distance and in whether a handoff timer gets armed alongside them.
  const playDiscretePlan = (signedDistanceSlots: number, onComplete: () => void) => {
    const count = cellsRef.current.length
    if (count === 0) return
    cancelDiscreteAnimation()
    const startSlot = rotationOffsetRef.current
    const direction: 1 | -1 = signedDistanceSlots >= 0 ? 1 : -1
    const pixelsPerSlot = pixelsPerSlotAt(startSlot, direction, count, ringGeometryParamsRef.current)
    const plan = buildEscapeHoldRotationPlan(signedDistanceSlots, pixelsPerSlot)
    const totalDurationMs = plan.totalDurationSec * 1000
    let startTimeMs: number | null = null

    const animateFrame = (nowMs: number) => {
      if (startTimeMs === null) startTimeMs = nowMs
      const elapsedMs = nowMs - startTimeMs

      if (elapsedMs >= totalDurationMs) {
        rotationOffsetRef.current = startSlot + signedDistanceSlots
        applyRotationOffsetToDom(rotationOffsetRef.current)
        discreteRafIdRef.current = null
        onComplete()
        return
      }

      const displacement = sampleScrollPlan(plan, elapsedMs / 1000)
      rotationOffsetRef.current = startSlot + displacement
      applyRotationOffsetToDom(rotationOffsetRef.current)
      discreteRafIdRef.current = requestAnimationFrame(animateFrame)
    }

    discreteRafIdRef.current = requestAnimationFrame(animateFrame)
  }

  // Plays the exact remaining distance to a target as one discrete step --
  // `playDiscretePlan` always lands precisely at `start + signedDistanceSlots`
  // regardless of how far off the ideal moment this was triggered, which is
  // what makes a rapid-tap run's landing exact no matter when cruise (or a
  // later tap) hands off to it. Guards the near-zero case the same way
  // startSettle does, so a step that's already essentially at its target
  // doesn't sit through a full animation duration doing nothing.
  const finishToTarget = (remaining: number) => {
    stopContinuousRotation()
    if (Math.abs(remaining) < 0.001) {
      finalizeTopIndex()
      return
    }
    playDiscretePlan(remaining, finalizeTopIndex)
  }

  // Rounds wherever rotationOffsetRef currently sits to the nearest whole
  // slot and plays that (always <= 0.5 slot) as one more quick discrete
  // step -- see the component doc comment for why this phase exists at all
  // (scroll never needed it; the ring can't rest on a fractional slot).
  const startSettle = () => {
    const current = rotationOffsetRef.current
    const target = Math.round(current)
    const distance = target - current
    if (Math.abs(distance) < 0.001) {
      finalizeTopIndex()
      return
    }
    playDiscretePlan(distance, finalizeTopIndex)
  }

  const continuousSpeedSlotsPerSec = () => Math.max(
    0.001,
    resolveApexSpeedPxPerSecFromCurrentParams(1) * CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  )

  const runContinuousRotation = (nowMs: number) => {
    if (continuousDirectionRef.current === 0) {
      continuousRafIdRef.current = null
      continuousLastTsRef.current = null
      return
    }
    const previousTs = continuousLastTsRef.current
    continuousLastTsRef.current = nowMs
    if (previousTs !== null) {
      const deltaSec = Math.max(0, (nowMs - previousTs) / 1000)
      rotationOffsetRef.current += continuousDirectionRef.current * continuousSpeedSlotsPerSec() * deltaSec
      applyRotationOffsetToDom(rotationOffsetRef.current)
    }

    // A rapid-tap run (as opposed to a genuine held key, which has no fixed
    // target and free-runs until its own keyup) is bounded by
    // pendingTargetSlotRef -- once cruising has closed the distance to it
    // down to SETTLE_TRIGGER_SLOTS or fewer, hand off to one exact discrete
    // step the rest of the way instead of continuing to coast, so the run
    // always lands exactly on the slot the taps actually committed to, not
    // wherever a few more frames of constant-velocity coasting happened to
    // land.
    if (tapRunActiveRef.current) {
      const remaining = pendingTargetSlotRef.current - rotationOffsetRef.current
      if (Math.abs(remaining) <= SETTLE_TRIGGER_SLOTS) {
        finishToTarget(remaining)
        return
      }
    }

    continuousRafIdRef.current = requestAnimationFrame(runContinuousRotation)
  }

  const startContinuousRotation = (direction: 1 | -1) => {
    cancelDiscreteAnimation()
    const previousDirection = continuousDirectionRef.current
    continuousDirectionRef.current = direction
    if (continuousRafIdRef.current === null || previousDirection !== direction) {
      continuousLastTsRef.current = null
    }
    if (continuousRafIdRef.current === null) {
      continuousRafIdRef.current = requestAnimationFrame(runContinuousRotation)
    }
  }

  // Decelerates from the current continuous velocity back toward zero along
  // the bell's own natural tail (reused from ScrollCurvePlan.ts unmodified),
  // then hands off to startSettle once the tail finishes -- see the
  // component doc comment.
  const startReleaseRampDown = (direction: 1 | -1) => {
    const speedSlotsPerSec = continuousSpeedSlotsPerSec()
    const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, speedSlotsPerSec)
    stopContinuousRotation()
    if (!rampDownPlan) {
      startSettle()
      return
    }

    const startSlot = rotationOffsetRef.current
    let startTimeMs: number | null = null

    const animateRampDown = (nowMs: number) => {
      if (startTimeMs === null) startTimeMs = nowMs
      const elapsedSec = Math.max(0, (nowMs - startTimeMs) / 1000)
      const displacement = sampleReleaseRampDownPlan(rampDownPlan, elapsedSec)
      rotationOffsetRef.current = startSlot + displacement
      applyRotationOffsetToDom(rotationOffsetRef.current)

      if (elapsedSec >= rampDownPlan.tailDurationSec) {
        releaseRafIdRef.current = null
        startSettle()
        return
      }
      releaseRafIdRef.current = requestAnimationFrame(animateRampDown)
    }

    releaseRafIdRef.current = requestAnimationFrame(animateRampDown)
  }

  // Extends (or starts) the current run's authoritative target by one slot
  // in `direction` and moves toward it -- shared by every tap and every
  // armHoldCheck poll tick while a run is still unconfirmed, so a distinct
  // tap and a "maybe this is a hold" poll tick both advance the ring the
  // exact same way. See the component doc comment's tap-run paragraph and
  // finishToTarget for why this always lands exactly on the target
  // regardless of what was already in flight.
  const advanceRun = (direction: 1 | -1) => {
    if (tapRunActiveRef.current) {
      pendingTargetSlotRef.current += direction
    } else {
      // Not runStartTimeMsRef -- that's owned entirely by handleRingKeyDown's
      // repeat:false branch (the only moment a *physical* key-press begins),
      // not by whether an animation happens to be mid-flight right now. This
      // branch can also be reached from armHoldCheck's own poll tick, when
      // an earlier discrete step in the same still-held press has already
      // finished and cleared tapRunActiveRef (finalizeTopIndex) between
      // ticks -- resetting the clock here would keep pushing hold
      // confirmation out for as long as each individual step keeps
      // finishing before the next 100ms poll, which for a fast curve shape
      // could mean never.
      pendingTargetSlotRef.current = Math.round(rotationOffsetRef.current) + direction
      tapRunActiveRef.current = true
    }

    const remaining = pendingTargetSlotRef.current - rotationOffsetRef.current
    if (Math.abs(remaining) <= SETTLE_TRIGGER_SLOTS) {
      finishToTarget(remaining)
    } else {
      startContinuousRotation(remaining > 0 ? 1 : -1)
    }
  }

  // Polls, at a fixed HOLD_CHECK_INTERVAL_MS cadence independent of curve
  // shape, whether `key` is still down and whether the run it started has
  // now run long enough (HOLD_CONFIRM_DELAY_MS) to trust as a genuine hold
  // rather than a tap or a slower deliberate multi-tap -- see the component
  // doc comment's tap-run paragraph for why this replaced the old
  // crossing-time-based single-shot handoff. While unconfirmed, each tick
  // chains one more exact advanceRun step in the same direction (matching
  // "play regular one after another single animations" rather than jumping
  // straight to free-running continuous rotation) and reschedules itself;
  // once confirmed, it hands off to the real continuous hold cycle and
  // stops polling (the key's own keyup takes over release timing from
  // there -- see handleRingKeyUp).
  const armHoldCheck = (direction: 1 | -1, key: string) => {
    clearHandoffTimeout()
    handoffTimeoutIdRef.current = window.setTimeout(() => {
      handoffTimeoutIdRef.current = null
      if (!heldKeysRef.current.has(key)) return
      if (performance.now() - runStartTimeMsRef.current >= HOLD_CONFIRM_DELAY_MS) {
        // A hold has no fixed target and releases on its own keyup instead,
        // so it must not stay bounded by whatever target the run so far
        // set up.
        tapRunActiveRef.current = false
        startContinuousRotation(direction)
        return
      }
      advanceRun(direction)
      armHoldCheck(direction, key)
    }, HOLD_CHECK_INTERVAL_MS)
  }

  // Resets the whole rotation engine (and topIndex) back to slot 0 each
  // time the panel transitions open OR closed -- open, so a stale position
  // from a previous time this section's panel was open never gets a chance
  // to paint at all (useLayoutEffect, not useEffect: this runs synchronously
  // before the browser paints the newly-visible panel -- with plain
  // useEffect, the browser painted one frame at the stale position first,
  // and the transition then visibly animated the reset a moment later,
  // which read as the ring "rearranging itself" right as it appeared);
  // closed, so nothing from this session can keep animating into whatever
  // opens next.
  //
  // This component stays permanently mounted (its host toggles
  // display:none around it, so the shared empty-state animation it lives
  // inside never restarts -- see SectionEditorArea.tsx), so "on mount" is
  // no longer the same moment as "on open"; keying off `isOpen` instead is
  // what makes arrow keys work immediately on every open, not just the
  // first one.
  useLayoutEffect(() => {
    stopAllRotation()
    if (!isOpen) return
    rotationOffsetRef.current = 0
    setTopIndex(0)
  }, [isOpen])

  // Invalidates any pending rotation timers/frames if this instance is ever
  // actually unmounted (rare -- see the component doc comment on why it's
  // normally just hidden, not unmounted -- but cheap insurance).
  useEffect(() => {
    return () => {
      stopAllRotation()
    }
  }, [])

  // Clamps a stale index if the cell count shrinks (e.g. a note closes and
  // New Chapter/Export drop out) while a later cell was the top one.
  useEffect(() => {
    if (topIndex > cells.length - 1) {
      const clamped = Math.max(0, cells.length - 1)
      rotationOffsetRef.current = clamped
      setTopIndex(clamped)
    }
  }, [cells.length, topIndex])

  // Follows `topIndex` with real DOM focus whenever it changes -- see the
  // component doc comment for why this, not a single unmoving DOM node, is
  // what keeps a focused/interactive slot pinned at the top, and why this
  // now only fires once per fully-settled gesture rather than continuously.
  //
  // Deferred via setTimeout, deliberately NOT synchronous/useLayoutEffect:
  // when this section just became active because of a real mouse click
  // landing directly on some OTHER element (e.g. clicking into a different
  // section's editor text to switch to it), the browser's own default
  // action for that click -- moving focus onto whatever was actually
  // clicked -- runs AFTER all synchronous JS for the event (dispatch, our
  // state updates, and any useLayoutEffect they trigger) has already
  // finished. A synchronous focus() call here was consistently losing that
  // race: it would grab focus onto the ring for an instant, then the
  // browser's own post-dispatch focus placement immediately stole it right
  // back onto the clicked element -- found live as the panel disappearing
  // the moment you clicked into another section, before mouseup even (see
  // handleRingBlur, which is what actually closed it once focus genuinely
  // ended up outside every ring). Deferring past that with setTimeout makes
  // this the last write, so it wins instead.
  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      buttonRefs.current[topIndex]?.focus()
    }, FOCUS_GRAB_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, topIndex])

  const directionFromKey = (event: KeyboardEvent<HTMLDivElement>): 1 | -1 | null => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 1
    if (event.key === 'Tab') return event.shiftKey ? -1 : 1
    return null
  }

  // Cheap fallback path for reduceVisualEffects: true -- see the component
  // doc comment. No curve engine at all: every key press (tap or OS repeat
  // alike) steps by exactly one slot immediately, and the CSS transition
  // added by `is-simple-rotation` (editor.css) eases the position change.
  const stepSimple = (direction: 1 | -1) => {
    const count = cells.length
    if (count === 0) return
    const next = ((topIndex + direction) % count + count) % count
    rotationOffsetRef.current = next
    setTopIndex(next)
  }

  const handleRingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+ArrowLeft/Right is the app's global "switch active section"
    // shortcut (App.tsx) -- must pass through untouched, not get hijacked
    // as a rotation. Plain Ctrl/Cmd+Arrow are excluded too on the same
    // principle: this ring only owns unmodified arrow/Tab presses.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const direction = directionFromKey(event)
    if (direction === null) return
    event.preventDefault()

    if (reduceVisualEffects) {
      stepSimple(direction)
      return
    }

    const key = event.key
    heldKeysRef.current.add(key)

    if (event.repeat) {
      // OS auto-repeat only ever fires for a key that already went through
      // its own initial (repeat: false) keydown below -- which by then has
      // already armed armHoldCheck's poll loop, and that loop is what's
      // deciding, on its own fixed cadence, whether/when this becomes a
      // confirmed hold (see the component doc comment's tap-run paragraph).
      // Nothing more to do with the repeat event itself.
      return
    }

    // A distinct tap -- KeyboardEvent.repeat is only ever false for the
    // first keydown of a physical press, so this is exactly the moment a
    // new key-press begins. Anchor the hold-confirmation clock here
    // (unconditionally, even for a tap landing mid-run -- see armHoldCheck
    // and advanceRun's own doc comment for why it deliberately does NOT
    // touch this), advance the run by exactly one slot, and arm the poll
    // loop that decides whether continued key-down eventually earns
    // unbounded continuous rotation.
    clearHandoffTimeout()
    runStartTimeMsRef.current = performance.now()
    advanceRun(direction)
    if (tapRunActiveRef.current) {
      armHoldCheck(direction, key)
    }
  }

  const handleRingKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = directionFromKey(event)
    if (direction === null) return
    if (reduceVisualEffects) return
    heldKeysRef.current.delete(event.key)
    clearHandoffTimeout()
    // A rapid-tap run's own keyup fires almost immediately after its
    // keydown (it's a real press+release, not a held key) -- if that were
    // allowed to reach the empty-set check below, every tap in a run would
    // immediately decelerate the continuous rotation it just started,
    // undoing the whole point of merging taps into one motion. Release
    // timing for a run is distance-driven instead (see
    // runContinuousRotation/handleRingKeyDown); a genuine held key never
    // sets tapRunActiveRef, so its own keyup still falls through to the
    // normal release below.
    if (tapRunActiveRef.current) return
    if (heldKeysRef.current.size === 0) {
      const activeDirection = continuousDirectionRef.current
      if (activeDirection !== 0) {
        startReleaseRampDown(activeDirection)
      } else {
        stopContinuousRotation()
      }
    }
  }

  const runCell = (cell: PanelCell) => {
    void cell.onSelect()
    onClose()
  }

  // Deferred well past the focus-grab effect's own delay (BLUR_CLOSE_CHECK_
  // DELAY_MS > FOCUS_GRAB_DELAY_MS) so a section-switch that's *in flight*
  // as part of this same blur (see the component doc comment) has settled
  // -- i.e. so the newly active section's own ring has had a chance to grab
  // focus, via its own deferred effect above -- before checking where focus
  // actually ended up. This needs to run strictly *after* that other
  // instance's timer, and two independently-scheduled deferrals at the
  // *same* delay have no ordering guarantee relative to each other -- found
  // live as the panel still closing intermittently even after both were
  // "one tick" via setTimeout(0), because this callback's timer had
  // sometimes already been queued (blur fires synchronously as part of the
  // section-switch) before the other instance's focus-grab effect had even
  // run, let alone its own timer fired. setTimeout callbacks at different
  // delays are spec-guaranteed to fire in delay order, so giving this one a
  // longer delay than the focus grab's is what actually makes "run after
  // it" reliable, rather than "usually runs after it, on this browser, at
  // this load level."
  //
  // See the component doc comment for why this checks the DOM globally
  // (any visible ring, not just this instance's own) rather than this
  // instance's `isOpen` prop.
  const handleRingBlur = (_event: FocusEvent<HTMLDivElement>) => {
    window.setTimeout(() => {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && activeElement.closest('.editor-escape-hold-ring.is-visible')) return
      onClose()
    }, BLUR_CLOSE_CHECK_DELAY_MS)
  }

  return (
    <div
      className={`editor-escape-hold-ring${isOpen ? ' is-visible' : ''}`}
      role="toolbar"
      aria-label="Quick note actions"
      onKeyDown={handleRingKeyDown}
      onKeyUp={handleRingKeyUp}
      onBlur={handleRingBlur}
    >
      {cells.map((cell, index) => {
        // This cell's position around the ring relative to the current top
        // ("slot 0"), not its fixed array index -- rotating the dial is
        // just changing topIndex, which shifts every cell's slot by the
        // same amount. Only the at-rest (topIndex-driven) render; during an
        // active animation, applyRotationOffsetToDom overrides this
        // imperatively every frame -- see the component doc comment.
        const slot = index - topIndex
        const point = computeEscapeHoldPointAtSlot(slot, cells.length, ringGeometryParamsRef.current)
        return (
          <button
            type="button"
            key={cell.label}
            ref={(el) => { buttonRefs.current[index] = el }}
            className={`editor-escape-hold-panel-btn${reduceVisualEffects ? ' is-simple-rotation' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
              '--rotation-duration': `${SIMPLE_ROTATION_TRANSITION_MS}ms`,
            } as CSSProperties}
            tabIndex={index === topIndex ? 0 : -1}
            aria-label={cell.label}
            onClick={() => runCell(cell)}
          >
            <span className={cell.icon} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

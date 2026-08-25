import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import {
  buildContinuationPlan,
  estimateVelocityAndAcceleration,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollTotalTimeSec,
  sampleContinuationPlan,
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

// While a key is held, native OS auto-repeat keydowns are throttled to at
// most one accepted every N ms -- see handleRingKeyDown. Decoupled from the
// OS's own (usually much faster) repeat rate on purpose: an accepted repeat
// is treated exactly like a genuine tap (advances focus by one position,
// splices a recalculated curve), so this IS the held-key advance rate,
// independent of whatever the OS/keyboard settings would otherwise
// produce. Scales inversely with the user's own live max-speed setting
// (the same "Scrolling Behavior" parameter every other curve in this file
// reads through ScrollCurvePlan.ts, getRenderScrollMaxSpeedPxPerSec) so a
// faster configured max speed also means faster-feeling held-key
// advancement: 250ms at the 50000px/s reference point, scaling
// proportionally as 250 * 50000 / maxSpeed from there.
const heldKeyRepeatThrottleMs = () => (250 * 50000) / Math.max(1, getRenderScrollMaxSpeedPxPerSec())

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
  /** Mirrors EditorToolbar.tsx's own isPreviewMode gate on its (now-removed) Export PDF/MD buttons: PDF export only makes sense against the rendered view, MD export only against the raw edit-mode text, so each cell only ever appears in its own mode rather than showing both and letting the wrong one fail or confuse. */
  isPreviewMode: boolean
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
 * `topIndex` (the animation's own "at rest" reference position, used only
 * for the JSX render below) only updates once a rotation gesture *fully*
 * settles -- not continuously while it's in flight; during flight,
 * applyRotationOffsetToDom overrides the DOM imperatively every frame from
 * rotationOffsetRef instead, so topIndex lagging doesn't cause any visible
 * stutter. Focus/tabIndex/aria are deliberately NOT tied to topIndex,
 * though, and don't wait for the animation: `focusedIndex` is a separate
 * piece of state that updates the instant a keydown is accepted (before its
 * animation even starts -- see handleRingKeyDown), so DOM focus always
 * matches the arrow key's actual target immediately. An earlier version
 * tied focus to topIndex directly and deferred it to animation completion,
 * on the theory that "which action is selected" isn't meaningful until the
 * ring stops moving -- but that meant a fast Left-then-Space could still
 * activate whatever the *previous* target was, since Space would fire on
 * the still-focused old button before the animation (and topIndex) caught
 * up. Left+Space now always produces the same outcome regardless of how
 * long the animation takes.
 *
 * Rotation animation reuses the editor's own smooth-scroll toolkit
 * (ScrollCurvePlan.ts, already shared today between render-view and
 * edit-view scroll) rather than a bespoke animation system -- see
 * escapeHoldRotationCurve.ts's module comment for the full mapping (one
 * "page" of scroll <-> one "slot" of rotation) and CursorClickCurve.ts for
 * the precedent of adapting that same toolkit to a different interaction.
 *
 * CURRENT SCOPE (deliberately, temporarily minimal -- the free-running
 * continuous hold path is closed for now while the keydown-only baseline
 * gets nailed down first, case by case): a genuine, distinct key-press
 * (`event.repeat === false`) is always accepted. A held key's own native OS
 * auto-repeat keydowns are throttled rather than acted on at whatever rate
 * the OS/keyboard settings produce: only one is accepted every
 * `heldKeyRepeatThrottleMs()` (itself scaling with the user's live max-speed
 * setting), measured from the most recently accepted keydown of either kind
 * (`lastAcceptedKeyTimeMsRef`), and every repeat
 * landing sooner is dropped outright. An accepted keydown -- tap or
 * throttled-through repeat alike, no distinction from this point on --
 * drives two deliberately independent things (`handleRingKeyDown`):
 *   - Focus always advances by exactly one position, unconditionally,
 *     regardless of whether an animation is currently in flight -- so focus
 *     can legitimately end up ahead of wherever the ring is still
 *     animating to. Expected and correct, not a bug (see `focusedIndex`'s
 *     own note above for why focus and the animation's own reference
 *     position, `topIndex`, are already separate state for exactly this
 *     reason).
 *   - The animation always plays toward `pendingTargetSlotRef` -- the true
 *     destination, advanced by exactly `direction` on every accepted
 *     keydown in lockstep with focusedIndex (see its own doc comment for
 *     why it's a plain continuous accumulator, not derived from any
 *     animation state, and why that matters). HOW it gets there depends on
 *     whether one was already in flight (`discreteRafIdRef`): from rest,
 *     it's a fresh discrete bell-curve step (`playDiscretePlan`) that
 *     starts from implicit zero velocity; mid-flight, it's a
 *     velocity/acceleration-continuous continuation (`playContinuationLeg`)
 *     spliced onto whatever was already playing, targeting the fresh
 *     `pendingTargetSlotRef - rotationOffsetRef.current` distance -- see
 *     playContinuationLeg's and handleRingKeyDown's own doc comments, and
 *     ScrollCurvePlan.ts's buildContinuationPlan for the underlying quintic
 *     Hermite math. Either way it always lands exactly on the target slot,
 *     no overshoot, no undershoot -- see finalizeTopIndex. The one
 *     deliberately unhandled edge case: tapping fast enough that the true
 *     destination has raced more than a full circle ahead of the
 *     currently-playing leg just lets that leg finish on its own instead of
 *     splicing an ever-more-elaborate multi-lap curve -- safe to skip
 *     precisely because pendingTargetSlotRef is untouched by the skip, so
 *     the ring always catches up on a later tap or completion.
 * Keyup is not handled at all yet. None of the previous continuous/hold
 * machinery exists right now; it'll be rebuilt deliberately, case by case,
 * on top of this baseline once it's solid.
 *
 * All of the above only runs when `reduceVisualEffects` is false (the
 * Performance section's "Reduce visual effects" toggle). When true, the
 * whole curve engine is skipped -- every keydown just steps `topIndex` by 1
 * immediately, and `.editor-escape-hold-panel-btn`'s own plain CSS
 * transition (added via the `is-simple-rotation` class only in this mode --
 * see editor.css) eases the position change instead. Cheaper, and there's
 * no dial-specific settings to keep in sync with a "reduced" mode since
 * this mode doesn't touch the curve engine at all.
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
 * A small label sits centered inside the ring showing whichever cell's name
 * is currently relevant: `hoveredIndex` (mouse-only, set/cleared by each
 * button's own onMouseEnter/onMouseLeave, independent of focus) takes
 * priority while the mouse is over a cell, falling back to `focusedIndex`
 * the rest of the time -- see `displayedLabel`. Sized and shaped in
 * editor.css's `.editor-escape-hold-label` to match the ring's own circle
 * exactly (same border-radius formula, width/height derived from the same
 * tokens the ring geometry itself is built from), not a hand-tuned number.
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
  isPreviewMode,
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
      { label: 'New Chapter', icon: 'fa-solid fa-bookmark', onSelect: onCreateChapter, disabled: !hasActiveNote || isActiveNoteTimeless },
      // Mirrors EditorToolbar.tsx's own (now-removed) isPreviewMode gate:
      // PDF export only in render view, MD export only in edit view -- each
      // one only makes sense against the mode it actually reflects, so the
      // other simply drops out (see isPreviewMode's own doc comment above).
      { label: 'Export PDF', icon: 'fa-solid fa-file-pdf', onSelect: onExportPdf, disabled: !hasActiveNote || isExportingPdf || !isPreviewMode },
      { label: 'Export MD', icon: 'fa-solid fa-file-code', onSelect: onExportMd, disabled: !hasActiveNote || isExportingMd || isPreviewMode },
      { label: 'User Guide', icon: 'fa-solid fa-graduation-cap', onSelect: onOpenHelp, disabled: false },
    ]
    return candidates.filter((candidate) => !candidate.disabled)
  }, [hasActiveNote, isActiveNoteTimeless, isPreviewMode, isExportingPdf, isExportingMd, onCreateNote, onCreateChapter, onExportPdf, onExportMd, onOpenHelp])

  const [topIndex, setTopIndex] = useState(0)
  // Which cell is focused/tabbable -- deliberately separate state from
  // topIndex (which only updates once a step's animation visually
  // completes, see finalizeTopIndex): this one updates immediately in
  // handleRingKeyDown, the instant a keydown is accepted, so a fast
  // Left-then-Space always activates the cell the arrow key actually
  // targeted rather than whatever was still focused because the animation
  // hadn't finished painting yet. See handleRingKeyDown and the focus-follow
  // effect below.
  const [focusedIndex, setFocusedIndex] = useState(0)
  // Which cell the mouse is currently over, if any -- drives the label
  // container (below) taking priority over focusedIndex while hovering, so
  // hovering previews what a click would activate. Independent of
  // focus/tabIndex entirely; mouse hover never moves keyboard focus here.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Mirrors of render-scope values the imperative rAF chain below needs to
  // read, since a callback may have been scheduled by an earlier render's
  // closure -- see cellsRef's own note. Reading through a ref (a stable
  // object mutated in place) always gets the current value regardless of
  // which render's function is the one actually running.
  const cellsRef = useRef(cells)
  useEffect(() => { cellsRef.current = cells }, [cells])
  const ringGeometryParamsRef = useRef<EscapeHoldRingParams>({ borderRadiusRegularPx, spacingRegularPx })
  useEffect(() => {
    ringGeometryParamsRef.current = { borderRadiusRegularPx, spacingRegularPx }
  }, [borderRadiusRegularPx, spacingRegularPx])

  // The live, possibly-fractional rotation position (in slots), driven by
  // the rAF loop below. Always equals `topIndex` exactly whenever nothing
  // is animating -- see the component doc comment on why the animation is
  // imperative rather than per-frame React state.
  const rotationOffsetRef = useRef(0)

  // The single in-flight discrete-step animation, if any. Also doubles as
  // the "is something animating" check that decides whether a keydown
  // starts a fresh step or splices a continuation -- see handleRingKeyDown.
  const discreteRafIdRef = useRef<number | null>(null)

  // Bookkeeping for whichever "leg" (a discrete bell-curve step, or a
  // velocity/acceleration-continuous continuation spliced from one) is
  // currently in flight -- see playLeg. legSamplerRef + legStartTimeMsRef
  // let a NEW leg snapshot the CURRENT leg's exact instantaneous
  // velocity/acceleration at the moment it's interrupted
  // (estimateVelocityAndAcceleration).
  const legStartTimeMsRef = useRef<number | null>(null)
  const legSamplerRef = useRef<((elapsedSec: number) => number) | null>(null)

  // The authoritative destination, in the SAME continuous (unwrapped,
  // fractional-during-flight) frame as rotationOffsetRef -- i.e. the exact
  // point the ring must ultimately reach for the top slot to show
  // `focusedIndex`. Incremented by exactly `direction` on every single
  // accepted keydown, unconditionally, in lockstep with focusedIndex's own
  // (wrapped) advance -- see handleRingKeyDown -- and adjusted by the same
  // amount rotationOffsetRef is whenever it wraps (finalizeTopIndex), so
  // the two stay in the same frame indefinitely.
  //
  // This is the fix for a real desync bug: an earlier version derived each
  // splice's distance incrementally from whatever the PREVIOUS leg's own
  // start+distance happened to be, which skipped updating that bookkeeping
  // entirely whenever a splice hit the full-circle safety cap below (that
  // tap's effect on the running target was silently dropped even though
  // focusedIndex had already advanced for it) -- a real desync that
  // compounded with every subsequent cap hit and never recovered on its
  // own, found live after holding a key for a prolonged stretch,
  // especially at higher configured max speeds (a shorter
  // heldKeyRepeatThrottleMs() means more accepted taps land inside any
  // given animation's duration, which is what makes hitting the cap
  // markedly more likely). Deriving each splice's distance directly from
  // this ref instead -- the TRUE distance from wherever the ring actually
  // is right now to the actual focused destination, direction-aware by
  // construction since it's a plain continuous accumulator rather than a
  // modular index -- means a skipped splice can never desync anything: the
  // ref itself was never touched by leg bookkeeping to begin with, so the
  // very next accepted tap (or the current leg's own eventual completion)
  // recomputes distance fresh from ground truth and the ring simply
  // catches up, however far that turns out to be.
  const pendingTargetSlotRef = useRef(0)

  // performance.now() of the most recently ACCEPTED keydown (tap or
  // throttled-through repeat) -- the baseline heldKeyRepeatThrottleMs()
  // measures from. See handleRingKeyDown.
  const lastAcceptedKeyTimeMsRef = useRef<number | null>(null)

  const cancelDiscreteAnimation = () => {
    if (discreteRafIdRef.current !== null) {
      cancelAnimationFrame(discreteRafIdRef.current)
      discreteRafIdRef.current = null
    }
    legSamplerRef.current = null
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
    const rounded = Math.round(rotationOffsetRef.current)
    const wrapped = ((rounded % count) + count) % count
    // pendingTargetSlotRef lives in the same continuous frame as
    // rotationOffsetRef -- shift it by the exact same amount being wrapped
    // off here so it keeps meaning "true remaining distance to
    // focusedIndex" relative to the ring's new (wrapped) position, instead
    // of silently drifting count-sized multiples away from it every time
    // the ring completes a lap. See pendingTargetSlotRef's own doc comment.
    pendingTargetSlotRef.current -= (rounded - wrapped)
    rotationOffsetRef.current = wrapped
    applyRotationOffsetToDom(wrapped)
    setTopIndex(wrapped)
  }

  // Runs one leg of animation: `sampler(elapsedSec)` gives the displacement
  // from `rotationOffsetRef.current` at the moment this leg started, and
  // `distance` is where that sampler is guaranteed to land at
  // `totalDurationSec` (both playDiscretePlan's bell curve and
  // playContinuationLeg's quintic curve already guarantee this by
  // construction -- see sampleScrollPlan/sampleContinuationPlan). Records
  // the leg's own start time/sampler as it goes so a LATER leg can snapshot
  // this one's exact instantaneous velocity/acceleration if it gets
  // interrupted -- see legSamplerRef's own doc comment above. (Distance
  // targeting itself is owned entirely by pendingTargetSlotRef, not by
  // anything recorded here -- see its own doc comment for why.)
  const playLeg = (
    sampler: (elapsedSec: number) => number,
    totalDurationSec: number,
    distance: number,
    onComplete: () => void,
  ) => {
    cancelDiscreteAnimation()
    const startSlot = rotationOffsetRef.current
    legSamplerRef.current = sampler
    const totalDurationMs = totalDurationSec * 1000
    let startTimeMs: number | null = null

    const animateFrame = (nowMs: number) => {
      if (startTimeMs === null) {
        startTimeMs = nowMs
        legStartTimeMsRef.current = nowMs
      }
      const elapsedMs = nowMs - startTimeMs

      if (elapsedMs >= totalDurationMs) {
        rotationOffsetRef.current = startSlot + distance
        applyRotationOffsetToDom(rotationOffsetRef.current)
        discreteRafIdRef.current = null
        legSamplerRef.current = null
        onComplete()
        return
      }

      rotationOffsetRef.current = startSlot + sampler(elapsedMs / 1000)
      applyRotationOffsetToDom(rotationOffsetRef.current)
      discreteRafIdRef.current = requestAnimationFrame(animateFrame)
    }

    discreteRafIdRef.current = requestAnimationFrame(animateFrame)
  }

  // Plays a single bell-curve step of `signedDistanceSlots` from the
  // current rotationOffsetRef, calling `onComplete` once it lands exactly
  // there. Only ever called from rest (rotationOffsetRef already settled),
  // so it always starts from implicit zero velocity/acceleration -- see
  // playContinuationLeg for the mid-flight case.
  const playDiscretePlan = (signedDistanceSlots: number, onComplete: () => void) => {
    const count = cellsRef.current.length
    if (count === 0) return
    const startSlot = rotationOffsetRef.current
    const direction: 1 | -1 = signedDistanceSlots >= 0 ? 1 : -1
    const pixelsPerSlot = pixelsPerSlotAt(startSlot, direction, count, ringGeometryParamsRef.current)
    const plan = buildEscapeHoldRotationPlan(signedDistanceSlots, pixelsPerSlot)
    playLeg((elapsedSec) => sampleScrollPlan(plan, elapsedSec), plan.totalDurationSec, signedDistanceSlots, onComplete)
  }

  // Splices a smooth continuation onto whichever leg is currently in
  // flight: snapshots its exact instantaneous velocity and acceleration at
  // this exact moment (estimateVelocityAndAcceleration, sampling the
  // in-flight leg's own sampler -- works whether that leg was itself a
  // bell-curve step or an earlier continuation, so repeated taps keep
  // composing smoothly), then builds a quintic curve from that
  // velocity/acceleration to `distance` over the FULL configured total
  // animation time (reset, not whatever time was left on the interrupted
  // leg -- see ScrollCurvePlan.ts's buildContinuationPlan doc comment for
  // the math). See handleRingKeyDown for how `distance` itself is computed.
  const playContinuationLeg = (distance: number, onComplete: () => void) => {
    const totalDurationSec = getRenderScrollTotalTimeSec()
    let initialVelocity = 0
    let initialAcceleration = 0
    if (legSamplerRef.current !== null && legStartTimeMsRef.current !== null) {
      const elapsedSec = (performance.now() - legStartTimeMsRef.current) / 1000
      const snapshot = estimateVelocityAndAcceleration(legSamplerRef.current, elapsedSec)
      initialVelocity = snapshot.velocity
      initialAcceleration = snapshot.acceleration
    }
    const plan = buildContinuationPlan(distance, initialVelocity, initialAcceleration, totalDurationSec)
    playLeg((elapsedSec) => sampleContinuationPlan(plan, elapsedSec), totalDurationSec, distance, onComplete)
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
  //
  // applyRotationOffsetToDom(0) is called explicitly here, not left to
  // React's own re-render from setTopIndex(0): if the panel had been
  // closed mid-animation, topIndex was never advanced (finalizeTopIndex
  // never got to run -- cancelDiscreteAnimation above just stops the rAF
  // loop, it doesn't rewind anything it already painted), so it's commonly
  // already 0 -- and setTopIndex(0) when the state is already 0 is a no-op
  // that React bails out of without re-rendering. With nothing else to
  // write the DOM back to the rest position, every button was left exactly
  // where the cancelled animation's last frame had imperatively placed it,
  // so reopening the panel showed it mid-spin instead of at rest -- found
  // live as icons stuck off-position after closing and reopening
  // mid-animation. Calling this directly guarantees the DOM is correct
  // before the browser paints the newly-visible panel, regardless of
  // whether topIndex's own state value happens to change.
  useLayoutEffect(() => {
    cancelDiscreteAnimation()
    lastAcceptedKeyTimeMsRef.current = null
    if (!isOpen) return
    rotationOffsetRef.current = 0
    pendingTargetSlotRef.current = 0
    applyRotationOffsetToDom(0)
    setTopIndex(0)
    setFocusedIndex(0)
    setHoveredIndex(null)
  }, [isOpen])

  // Invalidates any pending rotation frame if this instance is ever
  // actually unmounted (rare -- see the component doc comment on why it's
  // normally just hidden, not unmounted -- but cheap insurance).
  useEffect(() => {
    return () => {
      cancelDiscreteAnimation()
    }
  }, [])

  // Clamps a stale index if the cell count shrinks (e.g. a note closes and
  // New Chapter/Export drop out) while a later cell was the top one --
  // topIndex and focusedIndex are checked/clamped independently since they
  // can differ while a step is still animating (see focusedIndex's own
  // note above).
  useEffect(() => {
    const maxIndex = Math.max(0, cells.length - 1)
    if (topIndex > maxIndex) {
      rotationOffsetRef.current = maxIndex
      pendingTargetSlotRef.current = maxIndex
      setTopIndex(maxIndex)
    }
    if (focusedIndex > maxIndex) {
      setFocusedIndex(maxIndex)
    }
    setHoveredIndex((current) => (current !== null && current > maxIndex ? null : current))
  }, [cells.length, topIndex, focusedIndex])

  // Follows `focusedIndex` with real DOM focus whenever it changes -- see
  // the component doc comment for why this, not a single unmoving DOM node,
  // is what keeps a focused/interactive slot pinned at the top. Keyed off
  // focusedIndex rather than topIndex specifically so this fires the
  // instant a keydown is accepted (handleRingKeyDown sets focusedIndex
  // immediately, before the step's animation even starts), not once the
  // animation visually finishes -- see focusedIndex's own note above for
  // why that lag mattered.
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
      buttonRefs.current[focusedIndex]?.focus()
    }, FOCUS_GRAB_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, focusedIndex])

  const directionFromKey = (event: KeyboardEvent<HTMLDivElement>): 1 | -1 | null => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 1
    if (event.key === 'Tab') return event.shiftKey ? -1 : 1
    return null
  }

  // Cheap fallback path for reduceVisualEffects: true -- see the component
  // doc comment. No curve engine at all: every keydown steps by exactly one
  // slot immediately, and the CSS transition added by `is-simple-rotation`
  // (editor.css) eases the position change.
  const stepSimple = (direction: 1 | -1) => {
    const count = cells.length
    if (count === 0) return
    const next = ((topIndex + direction) % count + count) % count
    rotationOffsetRef.current = next
    setTopIndex(next)
    setFocusedIndex(next)
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

    // Native OS keyboard auto-repeat is throttled, not ignored outright --
    // see the component doc comment's CURRENT SCOPE paragraph and
    // heldKeyRepeatThrottleMs(). A held key's own repeat keydowns arrive at
    // whatever rate the OS/keyboard settings produce (usually much faster
    // than we want); only one is accepted every heldKeyRepeatThrottleMs()
    // (which itself scales with the user's live max-speed setting),
    // measured from the most recently accepted keydown of either kind, and
    // the rest are dropped outright. An accepted repeat is otherwise
    // treated exactly like a genuine tap below -- same focus advance, same
    // recalculated/spliced curve -- so holding a key reads as the ring
    // advancing one position at that rate, not free-running continuous
    // rotation (that's the still-closed hold path -- see the doc comment).
    const count = cellsRef.current.length
    if (count === 0) return

    const nowMs = performance.now()
    if (event.repeat) {
      const last = lastAcceptedKeyTimeMsRef.current
      if (last !== null && nowMs - last < heldKeyRepeatThrottleMs()) return
    }
    lastAcceptedKeyTimeMsRef.current = nowMs

    // Focus branch: advances by exactly one position on every genuine
    // keydown, unconditionally -- independent of whether an animation is
    // currently in flight. The functional updater reads the true current
    // focusedIndex rather than the value closed over at render time, which
    // matters here specifically because a second keydown landing mid-
    // animation (see the animation branch below) needs to advance from
    // wherever focus already is, not from topIndex/rotationOffsetRef (the
    // animation's own reference, which lags behind on purpose).
    setFocusedIndex((current) => ((current + direction) % count + count) % count)
    // pendingTargetSlotRef is focusedIndex's own unwrapped counterpart --
    // advanced unconditionally, in lockstep, on every accepted keydown, so
    // it's always exactly the true destination regardless of anything the
    // animation engine does or skips -- see its own doc comment.
    pendingTargetSlotRef.current += direction

    // Animation branch. Nothing in flight: play a fresh single-slot bell
    // step exactly as before.
    if (discreteRafIdRef.current === null) {
      playDiscretePlan(direction, finalizeTopIndex)
      return
    }

    // Something IS in flight: splice a smooth continuation instead of
    // discarding this keydown outright (see playContinuationLeg and the
    // component doc comment). The distance is always computed fresh from
    // pendingTargetSlotRef against wherever the ring's raw, possibly-
    // fractional position actually is right now -- not incrementally
    // derived from whatever the currently-playing leg's own bookkeeping
    // happens to say -- so this can never drift out of sync with the true
    // destination; see pendingTargetSlotRef's own doc comment for the bug
    // this fixes.
    const distance = pendingTargetSlotRef.current - rotationOffsetRef.current
    if (Math.abs(distance) > count) {
      // Tapped fast enough that the true destination has raced more than a
      // full circle ahead of the currently-playing leg -- rather than
      // splice an ever-more-elaborate multi-lap curve, just let it finish
      // on its own; pendingTargetSlotRef is untouched by this skip, so the
      // very next accepted tap (or this leg's own completion) will
      // recompute the correct distance fresh and catch up regardless.
      return
    }
    playContinuationLeg(distance, finalizeTopIndex)
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

  // Hover takes priority over focus -- while the mouse is over a cell, the
  // label previews what a click would activate; focusedIndex is the
  // fallback the rest of the time. Either can legitimately point past the
  // end of `cells` for a stale render in the same tick a shrink hasn't been
  // clamped yet (the clamp effect above runs after render, not during it),
  // so this reads defensively rather than asserting the index is valid.
  const displayedLabel = (hoveredIndex !== null ? cells[hoveredIndex] : cells[focusedIndex])?.label ?? ''

  return (
    <div
      className={`editor-escape-hold-ring${isOpen ? ' is-visible' : ''}`}
      role="toolbar"
      aria-label="Quick note actions"
      onKeyDown={handleRingKeyDown}
      onBlur={handleRingBlur}
    >
      {/* Centered label of whichever cell is focused, or hovered while the
          mouse is over one -- see displayedLabel above. Sized/shaped in
          editor.css to match the panel's own circle exactly (same
          border-radius formula; width/height computed from the same
          --circle-diameter/--spacing-large/--btn-square-larger-size tokens
          the ring geometry itself is built from, so it never needs to be
          kept in sync by hand). */}
      <div className="editor-escape-hold-label"><div className="editor-escape-hold-label-box">{displayedLabel}</div></div>
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
            tabIndex={index === focusedIndex ? 0 : -1}
            aria-label={cell.label}
            onClick={() => runCell(cell)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
          >
            <span className={cell.icon} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

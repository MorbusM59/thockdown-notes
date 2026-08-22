import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react'
import { sampleScrollPlan } from '../editor/ScrollCurvePlan'
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
 * CURRENT SCOPE (deliberately, temporarily minimal -- the hold/rapid-tap
 * path is closed for now while the keydown-only baseline gets nailed down
 * first, case by case): only a genuine, distinct key-press
 * (`event.repeat === false`) is acted on at all -- native OS keyboard
 * auto-repeat is hard-overridden, not merged, queued, or escalated into
 * anything else, so holding a key produces exactly one accepted keydown
 * and nothing further until it's physically released and pressed again.
 * That one accepted keydown drives two deliberately independent things
 * (`handleRingKeyDown`):
 *   - Focus always advances by exactly one position, unconditionally,
 *     regardless of whether an animation is currently in flight.
 *   - The animation only starts a fresh discrete bell-curve step of
 *     exactly 1 slot (`playDiscretePlan`, using the live curve parameters,
 *     landing precisely at `start + direction` by construction -- no
 *     overshoot, no undershoot) if nothing is currently animating
 *     (`discreteRafIdRef`); a keydown landing mid-animation still advances
 *     focus but does not trigger a second animation.
 * This means focus can legitimately end up ahead of wherever the ring is
 * still animating to -- expected and correct at this stage, not a bug (see
 * `focusedIndex`'s own note above for why focus and the animation's own
 * reference position, `topIndex`, are already separate state for exactly
 * this reason). Keyup is not handled at all yet. None of the previous
 * continuous/hold/rapid-tap-run machinery exists right now; it'll be
 * rebuilt deliberately, case by case, on top of this baseline once it's
 * solid.
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
  // Which cell is focused/tabbable -- deliberately separate state from
  // topIndex (which only updates once a step's animation visually
  // completes, see finalizeTopIndex): this one updates immediately in
  // handleRingKeyDown, the instant a keydown is accepted, so a fast
  // Left-then-Space always activates the cell the arrow key actually
  // targeted rather than whatever was still focused because the animation
  // hadn't finished painting yet. See handleRingKeyDown and the focus-follow
  // effect below.
  const [focusedIndex, setFocusedIndex] = useState(0)
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
  // the "is something animating" check that decides whether a keydown gets
  // played or discarded -- see handleRingKeyDown.
  const discreteRafIdRef = useRef<number | null>(null)

  const cancelDiscreteAnimation = () => {
    if (discreteRafIdRef.current !== null) {
      cancelAnimationFrame(discreteRafIdRef.current)
      discreteRafIdRef.current = null
    }
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
    setTopIndex(wrapped)
  }

  // Plays a single bell-curve step of `signedDistanceSlots` from the
  // current rotationOffsetRef, calling `onComplete` once it lands exactly
  // there.
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
    if (!isOpen) return
    rotationOffsetRef.current = 0
    applyRotationOffsetToDom(0)
    setTopIndex(0)
    setFocusedIndex(0)
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
      setTopIndex(maxIndex)
    }
    if (focusedIndex > maxIndex) {
      setFocusedIndex(maxIndex)
    }
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

    // Hard override of native OS keyboard auto-repeat -- see the component
    // doc comment's CURRENT SCOPE paragraph. Only a genuine, distinct
    // key-press (event.repeat === false) registers here at all; a held key's
    // own repeat keydowns are ignored outright, not merged, queued, or
    // escalated into anything else. Holding a key therefore produces exactly
    // one accepted keydown (this branch) and nothing further until it's
    // physically released and pressed again.
    if (event.repeat) return

    const count = cellsRef.current.length
    if (count === 0) return

    // Focus branch: advances by exactly one position on every genuine
    // keydown, unconditionally -- independent of whether an animation is
    // currently in flight. The functional updater reads the true current
    // focusedIndex rather than the value closed over at render time, which
    // matters here specifically because a second keydown landing mid-
    // animation (see the animation branch below) needs to advance from
    // wherever focus already is, not from topIndex/rotationOffsetRef (the
    // animation's own reference, which lags behind on purpose).
    setFocusedIndex((current) => ((current + direction) % count + count) % count)

    // Animation branch: starts a new step only if nothing is currently
    // animating. A keydown landing mid-animation still advances focus
    // (above) but does not trigger a second animation -- so focus can end
    // up ahead of wherever the ring is currently animating to, which is
    // expected at this stage (see the component doc comment).
    if (discreteRafIdRef.current !== null) return
    playDiscretePlan(direction, finalizeTopIndex)
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
            tabIndex={index === focusedIndex ? 0 : -1}
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

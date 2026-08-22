import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { computeEscapeHoldPointAtSlot, computeEscapeHoldRingPoints } from './escapeHoldRingLayout'

// Sampling this many intermediate points (plus the start) along the ring's
// actual curve per rotation step, fed to the Web Animations API below, is
// what makes the motion trace the rounded square's boundary instead of a
// plain CSS transform transition's straight chord between two points -- see
// `rotate`'s own comment for why a transition can't do this on its own.
const ROTATION_ANIMATION_SAMPLES = 12
const ROTATION_ANIMATION_DURATION_MS = 200

// Two staggered setTimeout delays, not rAF (see the doc comments on the
// effect and handler that use these) -- setTimeout with different delays
// is spec-guaranteed to fire in delay order, which is what actually needs
// to hold here: the focus grab (0ms) needs to run, and then the blur-close
// check (comfortably later) needs to run strictly after it, across two
// independent component instances with no other way to coordinate.
const FOCUS_GRAB_DELAY_MS = 0
const BLUR_CLOSE_CHECK_DELAY_MS = 50

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
  /** The Performance section's "Reduce visual effects" toggle -- swaps the curve-sampled dial rotation for a plain CSS transform transition (straight line between old/new position) when true. See `rotate`'s own comment. */
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
 * "Telephone dial" keyboard model: `topIndex` is whichever cell is
 * currently bound to the fixed top-center slot -- the only cell that's ever
 * a real Tab stop (tabIndex=0; every other cell is tabIndex=-1 and reachable
 * by mouse only). Up/Left rotate the ring back a step, Down/Right forward a
 * step, Tab/Shift+Tab the same (so Tab can't escape to whatever's behind the
 * modal overlay -- there'd otherwise be nowhere else *in* the ring for it to
 * go, since only one cell is ever tabbable). Rotating changes which cell
 * *is* `topIndex` and moves DOM focus to that cell's own button -- it isn't
 * a single DOM node that never moves; every cell's button repositions each
 * rotation (see the per-cell `slot` math below), and the newly-active one
 * simply happens to be the one that ends up at the top. The net effect (a
 * focused, interactive slot that's always at the top, with icons appearing
 * to shift underneath it) is the same either way, without needing to
 * coordinate a hand-off between a moving decorative element and a
 * stationary focused one.
 *
 * Two rotation animation mechanisms, chosen by `reduceVisualEffects`
 * (the Performance section's "Reduce visual effects" toggle):
 *   - Off (default): `rotate` samples several intermediate points along the
 *     ring's actual curve per button (escapeHoldRingLayout.ts's
 *     computeEscapeHoldPointAtSlot) and plays them via the Web Animations
 *     API, so motion traces the rounded square's boundary. A plain CSS
 *     transform transition can't do this on its own -- it always
 *     interpolates linearly between exactly two values, which would cut a
 *     straight chord through the panel's interior for any two points that
 *     aren't already on a shared straight edge.
 *   - On: skips that sampling/animate() call entirely and just updates
 *     state; `.editor-escape-hold-panel-btn`'s own CSS `transition:
 *     transform` (editor.css) picks up the new position and eases linearly
 *     to it instead -- cheaper, and a straight-line hop is a small enough
 *     visual difference at this scale that it's a reasonable trade for
 *     lower-end hardware.
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

  const ringPoints = useMemo(
    () => computeEscapeHoldRingPoints(cells.length, { borderRadiusRegularPx, spacingRegularPx }),
    [cells.length, borderRadiusRegularPx, spacingRegularPx],
  )

  const [topIndex, setTopIndex] = useState(0)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Resets which cell is "top" back to the first one each time the panel
  // transitions to open (the focus effect further down picks this up and
  // moves real DOM focus to match). useLayoutEffect, not useEffect: this
  // runs synchronously after the DOM update that makes the panel visible
  // but before the browser paints it, so a stale topIndex from a previous
  // time this section's panel was open (rotated away from 0, then closed
  // or switched away from) never gets a chance to paint at all -- with
  // plain useEffect, the browser painted one frame at the stale position
  // first, and the CSS transition then visibly animated the reset into
  // place a moment later, which read as the ring "rearranging itself"
  // right as it appeared.
  //
  // This component stays permanently mounted now (its host toggles
  // display:none around it, so the shared empty-state animation it lives
  // inside never restarts -- see SectionEditorArea.tsx), so "on mount" is
  // no longer the same moment as "on open"; keying off `isOpen` instead is
  // what makes arrow keys work immediately on every open, not just the
  // first one.
  useLayoutEffect(() => {
    if (!isOpen) return
    setTopIndex(0)
    // Defensive cleanup in case the panel closed mid-rotation, leaving a
    // WAAPI animation (see `rotate` below) still attached to a button.
    clearButtonAnimations()
  }, [isOpen])

  // Clamps a stale index if the cell count shrinks (e.g. a note closes and
  // New Chapter/Export drop out) while a later cell was the top one.
  useEffect(() => {
    if (topIndex > cells.length - 1) {
      setTopIndex(Math.max(0, cells.length - 1))
    }
  }, [cells.length, topIndex])

  // Follows `topIndex` with real DOM focus whenever it changes (including
  // via the effect above) -- see the component doc comment for why this,
  // not a single unmoving DOM node, is what keeps a focused/interactive
  // slot pinned at the top.
  //
  // Deferred via setTimeout, deliberately NOT synchronous/useLayoutEffect
  // like the reset above: when this section just became active because of a
  // real mouse click landing directly on some OTHER element (e.g. clicking
  // into a different section's editor text to switch to it), the browser's
  // own default action for that click -- moving focus onto whatever was
  // actually clicked -- runs AFTER all synchronous JS for the event
  // (dispatch, our state updates, and any useLayoutEffect they trigger)
  // has already finished. A synchronous focus() call here was consistently
  // losing that race: it would grab focus onto the ring for an instant,
  // then the browser's own post-dispatch focus placement immediately stole
  // it right back onto the clicked element -- found live as the panel
  // disappearing the moment you clicked into another section, before
  // mouseup even (see handleRingBlur, which is what actually closed it once
  // focus genuinely ended up outside every ring). Deferring past that with
  // setTimeout makes this the last write, so it wins instead.
  useEffect(() => {
    if (!isOpen) return
    const timeoutId = window.setTimeout(() => {
      buttonRefs.current[topIndex]?.focus()
    }, FOCUS_GRAB_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen, topIndex])

  const clearButtonAnimations = () => {
    buttonRefs.current.forEach((button) => {
      button?.getAnimations().forEach((animation) => animation.cancel())
    })
  }

  // Samples ROTATION_ANIMATION_SAMPLES+1 points along the ring's actual
  // curve, per button, between its slot before this rotation step and its
  // slot after -- see the component doc comment for why a CSS transition
  // can't do this on its own. `toSlot = fromSlot - direction`, not
  // `fromSlot + direction`: rotating the dial by one step shifts every
  // cell's slot by the same signed amount (derived from how `topIndex`
  // itself changes below), and since slots aren't wrapped for this
  // calculation, the interpolation is always a single short step around the
  // ring -- including for whichever cell crosses the slot-0/slot-(count-1)
  // boundary, since those two slots are geometrically adjacent points, not
  // opposite ends of a long sweep.
  const animateRotationAlongCurve = (previousTopIndex: number, direction: 1 | -1, count: number) => {
    cells.forEach((_, index) => {
      const button = buttonRefs.current[index]
      if (!button) return
      button.getAnimations().forEach((animation) => animation.cancel())
      const fromSlot = ((index - previousTopIndex) % count + count) % count
      const toSlot = fromSlot - direction
      const keyframes = Array.from({ length: ROTATION_ANIMATION_SAMPLES + 1 }, (_, step) => {
        const t = step / ROTATION_ANIMATION_SAMPLES
        const slot = fromSlot + (toSlot - fromSlot) * t
        const point = computeEscapeHoldPointAtSlot(slot, count, { borderRadiusRegularPx, spacingRegularPx })
        return { transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }
      })
      // No fill: 'forwards' -- React already set this button's underlying
      // inline `style.transform` to the same final point synchronously
      // (the setTopIndex call right after this function runs), so once the
      // animation's active phase ends its effect simply stops applying and
      // rendering falls through to that already-correct underlying style,
      // with no visible jump. A 'forwards' fill was tried here first and
      // caused a real regression: it holds the animation's last frame
      // indefinitely, which shadows *every* subsequent style update to this
      // button -- including a live border-radius/spacing options change --
      // until the next rotation's animate() call replaced it. Live changes
      // only "took" once a rotation happened to overwrite the stale fill.
      button.animate(keyframes, { duration: ROTATION_ANIMATION_DURATION_MS, easing: 'ease' })
    })
  }

  const rotate = (direction: 1 | -1) => {
    const count = cells.length
    if (count === 0) return
    const previousTopIndex = topIndex
    if (reduceVisualEffects) {
      // Simple path: no per-button animate() call at all -- the state
      // update below re-renders with each button's new (settled) transform,
      // and .editor-escape-hold-panel-btn's own CSS `transition: transform`
      // (editor.css) eases linearly to it. Still clears any leftover
      // elaborate-path animation so toggling the setting mid-rotation can't
      // leave one still playing over the plain style update.
      clearButtonAnimations()
    } else {
      animateRotationAlongCurve(previousTopIndex, direction, count)
    }
    setTopIndex((previousTopIndex + direction + count) % count)
  }

  const handleRingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+ArrowLeft/Right is the app's global "switch active section"
    // shortcut (App.tsx) -- must pass through untouched, not get hijacked
    // as a rotation. Plain Ctrl/Cmd+Arrow are excluded too on the same
    // principle: this ring only owns unmodified arrow/Tab presses.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      rotate(-1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      rotate(1)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      rotate(event.shiftKey ? -1 : 1)
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
      onBlur={handleRingBlur}
    >
      {cells.map((cell, index) => {
        // This cell's position around the ring relative to the current top
        // ("slot 0"), not its fixed array index -- rotating the dial is
        // just changing topIndex, which shifts every cell's slot (and so
        // its animated transform) by the same amount, wrapping at the ends.
        const slot = ((index - topIndex) % cells.length + cells.length) % cells.length
        const point = ringPoints[slot]
        return (
          <button
            type="button"
            key={cell.label}
            ref={(el) => { buttonRefs.current[index] = el }}
            className="editor-escape-hold-panel-btn"
            style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import {
  buildContinuationPlan,
  estimateVelocityAndAcceleration,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollTotalTimeSec,
  sampleContinuationPlan,
  sampleScrollPlan,
} from '../editor/ScrollCurvePlan'
import { buildEscapeHoldRotationPlan, pixelsPerSlotAt } from './escapeHoldRotationCurve'
import { computeEscapeHoldPointAtSlot, escapeHoldRingHalfExtentPx } from './escapeHoldRingLayout'
import { createWheelNotchState, resolveWheelEventUnits } from '../editor/wheelNotch'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { TYPING_SOUND_SAMPLES_PER_SET } from '../sound/typingSounds'
import {
  burstGapMs, burstNoteVoice, cellActivationVoice, cellArrivalMs, dialStepVoice,
  hoverStepVoice, panForRingX, planScreenBurst,
} from '../escapeMenu/menuSounds'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'
import type { EscapeHoldRingParams } from './escapeHoldRingLayout'
import type { EscapeMenuContribution } from '../escapeMenu/escapeMenuContract'

// Two staggered setTimeout delays, not rAF (see the doc comments on the
// effect and handler that use these) -- setTimeout with different delays
// is spec-guaranteed to fire in delay order.
const FOCUS_GRAB_DELAY_MS = 0

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

/** What an export covers: the note that is open, or its whole chapter family assembled into one document (see App.tsx's buildExportMarkdown). */
export type ExportScope = 'note' | 'all'

export interface EscapeHoldPanelProps {
  /** Whether the panel is the one currently "open" -- this component now stays
   * permanently mounted (its host toggles `display:none` around it instead of
   * mounting/unmounting it) so the shared empty-state animation it lives
   * inside never restarts. Focus management below keys off this transitioning
   * to true instead of off mount. */
  isOpen: boolean
  activeNoteId: string | null
  /**
   * Whether the slot this ring is drawn in is the ACTIVE one.
   *
   * Not the same question as `isOpen`, and that is the whole reason it
   * exists. For the quick-actions ring the two agree by construction --
   * `isEscapeHoldActive` ANDs the global flag with this one. For a MODE they
   * do not: a mode's ring is its slot's persistent interface and stays drawn
   * while the reader works in another slot (SectionEditorArea), so `isOpen`
   * never flips when they come back to it, and the focus grab below -- which
   * had only ever needed to fire on that flip -- never ran.
   *
   * The invariant it restores: THE ACTIVE SLOT HOLDS THE KEYBOARD. Clicking a
   * slot that shows no editor used to activate it and move focus nowhere, so
   * focus stayed in the other slot's editor and its first keystroke marked
   * that slot active again (EditorSection's `onKeyDownCapture`). The section
   * with nothing focusable is exactly the one with a ring.
   */
  isSectionActive: boolean
  /** True while the active note (or its whole chapter family) is timeless -- disables New Chapter, since a frozen family can't gain a new chapter (databaseService.ts's assertNotTimeless). Export/New Note are unaffected -- they're not mutations of the frozen note itself. */
  isActiveNoteTimeless: boolean
  /** True when the open note's family has at least one real (not auto-generated) chapter -- the only case in which Export All covers more than Export does, so it is the only case in which it is offered. */
  hasChapters: boolean
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
  onExportPdf: (scope: ExportScope) => void | Promise<void>
  onExportMd: (scope: ExportScope) => void | Promise<void>
  onOpenHelp: () => void | Promise<void>
  /**
   * Reports which cell is currently in the selection spot -- hovered if the
   * pointer is over one, focused otherwise, which is exactly what the ring's
   * centre label names. Null while the ring is down. The host uses it to show
   * that cell's `detail` (escapeMenuContract.ts); the panel itself has no
   * opinion about where that goes.
   */
  onActiveCellChange?: (cellId: string | null) => void
  onClose: () => void
  /**
   * Cells contributed by a feature that lives inside this ring rather than
   * merely being launched from it -- see escapeMenuContract.ts for the full
   * contract. `entryCells` join the quick actions below; a non-null
   * `activeMode` replaces them entirely for as long as it is up. Absent (or
   * empty) means the ring behaves exactly as it always has, which is what
   * every caller that has no such feature passes.
   */
  escapeMenu?: EscapeMenuContribution | null
}

interface PanelCell {
  /** Stable identity: the React key, so a cell that survives a rebuild keeps its DOM node and its focus. */
  id: string
  label: string
  icon: string
  /** When set, activating this cell leaves the menu up -- see EscapeMenuCell.keepsMenuOpen. */
  keepsMenuOpen?: boolean
  /** When set, this cell is a way BACK and sounds like one -- see EscapeMenuCell.isBack. */
  isBack?: boolean
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
 * The ring is no longer exclusively its own: the `escapeMenu` prop lets a
 * feature contribute extra cells to it, or take it over entirely for a
 * while (escapeMenuContract.ts). A takeover -- a "mode" -- supplies only
 * the cells and a `stepKey` saying when the ring has moved on to a new
 * decision. Everything else here is unchanged, deliberately and
 * permanently: the panel a mode is showing in IS the quick-actions panel,
 * same geometry, same dial, same centre label naming the one cell you are
 * about to activate and nothing else. A mode with more to say hands it to
 * the host through `status` (escapeMenuContract.ts) for the tab bar and
 * chapter bar to render; it does not get to narrate through the dial. Two consequences worth knowing: a cell can
 * opt out of closing the menu (`keepsMenuOpen`), which is what lets a mode
 * take input repeatedly, and `ringResetKey` folds "a mode advanced a step"
 * into the same reset/focus path as "the panel opened" -- see its own doc
 * comment, and the focus-follow effect's, for why the focus half of that is
 * load-bearing rather than tidiness.
 *
 * A small label sits centered inside the ring showing whichever cell's name
 * is currently relevant: `hoveredIndex` (mouse-only, set/cleared by each
 * button's own onMouseEnter/onMouseLeave AND re-asked whenever the ring
 * moves under a stationary pointer -- see refreshHoverFromPointer; it is
 * also what draws the highlight, since CSS `:hover` cannot see a cell that
 * came to the cursor rather than the other way round) takes
 * priority while the mouse is over a cell, falling back to `focusedIndex`
 * the rest of the time -- see `displayedLabel`. Sized and shaped in
 * editor.css's `.editor-escape-hold-label` to match the ring's own circle
 * exactly (same border-radius formula, width/height derived from the same
 * tokens the ring geometry itself is built from), not a hand-tuned number.
 *

 * IT NEVER CLOSES ITSELF. The panel is dismissed by Escape (a window-level
 * handler in App.tsx, so it works wherever focus happens to be) or by
 * activating a cell that does not opt out of closing -- and by nothing
 * else. Losing focus does not close it, and neither does a click on the
 * backdrop.
 *
 * That is a correctness requirement, not a preference. A mode can OWN the
 * ring for as long as it likes (escapeMenuContract.ts), and for the
 * adventure the ring is the entire interface: a stray click that dismissed
 * it would end a session through a path the game never sees, leaving the
 * view up with no way to reach it. Making dismissal conditional on which
 * mode is up would put the same rule in two places and let them disagree,
 * so there is one rule for every consumer.
 *
 * Losing focus does not close it -- and it is not this component's job to
 * get it back. It had its own recovery for focus that landed on <body>, and
 * that was a private copy of an app-wide rule: focus never rests somewhere
 * that cannot hold it, and it returns to the ACTIVE SLOT's surface, which is
 * this ring when a mode owns the slot. App.tsx's reconciler owns it for
 * everybody (src/shared/focusOwnership.ts).
 *
 * Two earlier designs closed on blur and both were racy in the same way:
 * native focus-shift on mousedown fires inside the very dispatch that also
 * runs markSectionActive (EditorSection.tsx), so nothing this component can
 * read -- neither its own `isOpen` prop nor a ref mirroring it -- has
 * settled by the time blur arrives. Switching sections while the panel is
 * open is a legitimate handoff (`isOpen` here is this section's own
 * `isEscapeHoldActive`: global "the panel is open" AND-ed with "this is the
 * active section", so the other instance takes over and grabs focus via the
 * effect above), and it is indistinguishable at blur time from a genuine
 * dismissal. Not closing on blur removes the distinction rather than
 * timing it.
 *
 * ARIA: role="toolbar" rather than role="grid" -- there's no row/column
 * structure to describe, and toolbar is the WAI-ARIA pattern that actually
 * covers a roving-tabindex set of buttons. Still an imperfect fit for a
 * rotating ring (toolbar assumes a static linear layout), but closer than
 * grid.
 */
export function EscapeHoldPanel({
  isOpen,
  isSectionActive,
  activeNoteId,
  isActiveNoteTimeless,
  hasChapters,
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
  onActiveCellChange,
  onClose,
  escapeMenu,
}: EscapeHoldPanelProps) {
  const hasActiveNote = Boolean(activeNoteId)
  const activeMode = escapeMenu?.activeMode ?? null

  // What "the ring now shows a different set of things" means, as one
  // value: opening it, and (while a mode is up) that mode advancing to its
  // next step. The reset layout effect and the focus-follow effect below
  // both key off it, so a step change is handled by exactly the same code
  // path as an open -- dial back to the top, animation cancelled, focus
  // grabbed onto the new top cell. Focus in particular is not optional
  // housekeeping here: a mode's cells are new DOM nodes on every step, and
  // a ring that loses focus to <body> closes itself (handleRingBlur), which
  // would end the mode on its first choice.
  const ringResetKey = `${isOpen ? 'open' : 'closed'}:${activeMode?.id ?? ''}:${activeMode?.stepKey ?? ''}`


  const cells = useMemo<PanelCell[]>(() => {
    // A mode owns the whole ring while it is up -- see the escapeMenu prop.
    // Returning early rather than merging is what lets a mode be written
    // without knowing which quick actions happen to be available behind it.
    if (activeMode) return activeMode.cells
    // Mirrors EditorToolbar.tsx's own (now-removed) isPreviewMode gate: the
    // view decides the format -- PDF from render view, MD from edit view --
    // since each only makes sense against the mode it actually reflects.
    // Both export cells therefore mean "in the format of what you're looking
    // at"; they differ only in scope.
    const onExport = isPreviewMode ? onExportPdf : onExportMd
    const isExporting = isPreviewMode ? isExportingPdf : isExportingMd
    const candidates = [
      { id: 'new-note', label: 'New Note', icon: 'fa-solid fa-file', onSelect: onCreateNote, disabled: false },
      { id: 'new-chapter', label: 'New Chapter', icon: 'fa-solid fa-bookmark', onSelect: onCreateChapter, disabled: !hasActiveNote || isActiveNoteTimeless },
      { id: 'export', label: 'Export', icon: 'fa-solid fa-chevron-up', onSelect: () => onExport('note'), disabled: !hasActiveNote || isExporting },
      { id: 'export-all', label: 'Export All', icon: 'fa-solid fa-angles-up', onSelect: () => onExport('all'), disabled: !hasActiveNote || isExporting || !hasChapters },
      { id: 'user-guide', label: 'User Guide', icon: 'fa-solid fa-graduation-cap', onSelect: onOpenHelp, disabled: false },
    ]
    // Contributed entry cells are appended, not interleaved: the built-in
    // note actions keep their familiar order and position regardless of
    // what else is currently reachable from here.
    return [...candidates.filter((candidate) => !candidate.disabled), ...(escapeMenu?.entryCells ?? [])]
  }, [activeMode, escapeMenu, hasActiveNote, isActiveNoteTimeless, hasChapters, isPreviewMode, isExportingPdf, isExportingMd, onCreateNote, onCreateChapter, onExportPdf, onExportMd, onOpenHelp])

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
  // Assigned during render, NOT in an effect. A passive effect runs after
  // layout effects, and the reset layout effect below writes every cell's
  // position to the DOM imperatively -- so on the commit where the cell set
  // itself changes (a mode arriving with its own cells, or advancing to a
  // step with a different number of them), a ref updated in a passive effect
  // still held the PREVIOUS array. The reset then laid the ring out for the
  // old cell count, and React never corrected it: its own virtual style for
  // those buttons had not changed, so it had nothing to write. The ring came
  // up with a cell in the wrong slot until the first input re-rendered it.
  // Found from the positions, which moved for exactly one of three cells --
  // a whole-ring geometry error would have moved all of them.
  cellsRef.current = cells

  /**
   * HOW MANY CELLS' ICONS HAVE ARRIVED. The ring itself is drawn at once --
   * every cell's chip is there from the first frame, so the shape of the
   * screen is readable immediately and nothing about the geometry is
   * staged. What is dealt out is what each cell SAYS: its icon fades and
   * grows into place on its own note of the burst below, so the sound and
   * the thing appearing are ONE event.
   *
   * A count rather than a set, because the cells arrive in ring order and
   * never out of it -- a set would be able to represent "the third arrived
   * but not the second", which is not a state this can be in.
   */
  const [arrivedCount, setArrivedCount] = useState(0)

  /**
   * HOW LONG A CELL TAKES TO ARRIVE, held in state rather than recomputed,
   * because it is spent in two places that must not disagree: the CSS
   * animation's duration and the offset that puts each note on the end of
   * it. Sampled when the screen is dealt, so a screen keeps the timing it
   * was dealt with even if the reader moves the slider mid-burst.
   */
  const [arrivalMs, setArrivalMs] = useState(() => cellArrivalMs(getRenderScrollTotalTimeSec()))

  /**
   * A NEW SCREEN, ANNOUNCED AND DEALT OUT: one ordinary key sound per choice,
   * all different, each landing as its own cell pops into place -- so the
   * player hears how many options arrived while watching them arrive.
   *
   * THE SPACING IS THE USER'S OWN. Fifty milliseconds by default, but never
   * so many that the burst outlasts a page-up scroll: `burstGapMs` divides
   * the scroll duration across the gaps when that is shorter. The value is
   * the live one the Scrolling Behavior sliders set
   * (`getRenderScrollTotalTimeSec`), which the ring's rotation curve already
   * borrows rather than inventing a dial-specific twin
   * (escapeHoldRotationCurve.ts) -- it is this app's standing answer to how
   * long a thing may take to arrive, and a menu is a thing arriving.
   *
   * EACH NOTE IS PANNED WHERE ITS CELL IS, through the ring's own geometry
   * function -- so the screen is dealt out across the stereo field in the
   * shape the ring actually has. It is supplied as mode-B pan and weighed by
   * the spatial slider the reader already set; nothing here re-decides how
   * much of it to apply.
   *
   * Keyed on `ringResetKey`, which already means exactly "the ring now shows
   * a different set of things" and is already what the reset and focus
   * effects run on. Deriving a second notion of "a new screen" is how the
   * burst would come to fire on a step the dial did not reset for.
   *
   * CANCELLED ON THE WAY OUT, and that is not housekeeping: a player pressing
   * through screens faster than the burst would otherwise have two of them
   * playing over each other, which is the one thing that makes the count
   * unreadable -- the whole point of the sound.
   */
  useEffect(() => {
    if (!isOpen) {
      setArrivedCount(0)
      return undefined
    }
    const count = cellsRef.current.length
    // The cheap-visuals path gets the sounds and none of the staging: a
    // fade-and-grow is a visual effect, and this flag is what the reader
    // sets to not have those.
    setArrivedCount(reduceVisualEffects ? count : 0)

    // ONE READING of the reader's scroll duration for the whole screen, so
    // the gap between notes and the arrival they are offset by cannot come
    // from two different samples of a live value.
    const totalTimeSec = getRenderScrollTotalTimeSec()
    const arrival = cellArrivalMs(totalTimeSec)
    setArrivalMs(arrival)

    const notes = planScreenBurst(
      count,
      TYPING_SOUND_SAMPLES_PER_SET,
      burstGapMs(count, totalTimeSec),
    )
    // TWO MOMENTS PER NOTE, one arrival apart: the cell's icon starts fading
    // and growing in, and the sound lands as it finishes. Scheduled
    // separately rather than by delaying the whole deal, so the cells still
    // set off on the gap the reader's own scroll duration set -- the offset
    // moves each note onto its own cell's landing, it does not slow the deal
    // down or bunch the notes together.
    const timers = notes.flatMap((note) => [
      window.setTimeout(() => {
        setArrivedCount((current) => Math.max(current, note.slot + 1))
      }, note.delayMs),
      window.setTimeout(() => {
        // The cell's real on-screen point, from the same function that places
        // the button -- the ring is a rounded square, so an angle recomputed
        // here would pan a sound somewhere its cell is not.
        const point = computeEscapeHoldPointAtSlot(note.slot, count, ringGeometryParamsRef.current)
        void typingSoundManager.playRandomClick(
          burstNoteVoice(note, panForRingX(point.x, escapeHoldRingHalfExtentPx(ringGeometryParamsRef.current))),
        )
      }, note.delayMs + arrival),
    ])
    return () => { for (const timer of timers) window.clearTimeout(timer) }
    // cellsRef rather than `cells`: the burst is about the screen ARRIVING,
    // so it must not re-fire when a cell's label or availability changes
    // underneath a screen that is already up.
  }, [ringResetKey, isOpen, reduceVisualEffects])
  // The ring element itself, for the native wheel listener below, and a
  // mirror of `isOpen` the two imperative handlers can read.
  const ringRef = useRef<HTMLDivElement | null>(null)
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  /**
   * The ring's geometry, as a value the render actually uses -- NOT read
   * back out of the mirror ref below.
   *
   * It was, and the ring came up misaligned until the first keypress. These
   * props start at their defaults and change once the saved UI loadout
   * loads; that changes them mid-session, so the panel re-renders -- but a
   * ref written in an effect still holds the OLD value while that render is
   * computing positions, and a ref write triggers no further render to
   * correct them. The cells therefore sat at default-geometry positions
   * until something unrelated re-rendered, which in practice meant the first
   * arrow key. Reading the props directly is the fix; the ref exists only
   * for the imperative rAF path, which cannot read render scope.
   */
  const ringGeometryParams = useMemo<EscapeHoldRingParams>(
    () => ({ borderRadiusRegularPx, spacingRegularPx }),
    [borderRadiusRegularPx, spacingRegularPx],
  )
  const ringGeometryParamsRef = useRef<EscapeHoldRingParams>(ringGeometryParams)
  // Plain assignment during render, not an effect: the rAF chain can read
  // this in the same frame the props change, and an effect would leave it a
  // render behind there too.
  ringGeometryParamsRef.current = ringGeometryParams

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

  /**
   * WHAT IS UNDER THE POINTER RIGHT NOW, re-asked whenever the RING moved
   * rather than the mouse.
   *
   * The browser only re-evaluates hover when the pointer moves (a wheel over
   * the ring scrolls nothing, so not even that helps), which made the dial's
   * nicest gesture not work: rest the pointer on a cell, turn the wheel, and
   * the next choice slides underneath it -- but the app still believed the
   * old cell was hovered, so the centre label named the wrong thing and
   * nothing lit up until the mouse was wiggled. The same gap appears when a
   * mode advances and swaps its cells out under a stationary pointer.
   *
   * Asked of the DOM (`elementFromPoint`) rather than recomputed from the
   * ring's geometry: the browser already knows exactly where the buttons
   * are, and a second hit-test of our own would be a second opinion about
   * cell positions that could disagree with the one on screen.
   */
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null)
  // Tracked at the WINDOW, and NOT gated on the ring being open.
  //
  // Both of those are load-bearing, and I got the second wrong first time.
  // Listening on the ring alone means the pointer has to enter it before
  // anything is known about where it is; gating a window listener on `isOpen`
  // has the same hole one step further out, because the ring can open under a
  // pointer that then never moves again -- which is exactly the gesture this
  // whole change exists to support. The position has to be known BEFORE the
  // ring appears, so the listener outlives it. It stores two numbers.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove) }
  }, [])
  const refreshHoverFromPointer = () => {
    const position = pointerPositionRef.current
    if (!position) return
    const under = document.elementFromPoint(position.x, position.y)
    const button = under instanceof Element
      ? under.closest<HTMLButtonElement>('.editor-escape-hold-panel-btn')
      : null
    // indexOf against the live ref array: React writes each button's ref by
    // index every render, and a stale entry left by a shrink holds a
    // detached node, which elementFromPoint can never return.
    const index = button ? buttonRefs.current.indexOf(button) : -1
    setHoveredIndex(index >= 0 && index < cellsRef.current.length ? index : null)
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
    // The cells are at their resting positions as of the line above -- this
    // path writes transforms directly, with no CSS transition to wait out --
    // so the pointer can be re-tested straight away.
    refreshHoverFromPointer()
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
    // Cleared and then re-asked rather than simply cleared: a mode advancing
    // replaces every cell under a pointer that never moved, and the cell now
    // beneath it is hovered whether the pointer arrived there or the ring
    // did. Clearing alone is what left the ring dark after a mouse-driven
    // choice in the game.
    setHoveredIndex(null)
    refreshHoverFromPointer()
  }, [ringResetKey, isOpen])

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
    // A ring in an INACTIVE slot never takes the keyboard: a mode's ring
    // stays drawn there, and grabbing focus would pull the reader out of the
    // slot they are actually working in. The converse is the point of the
    // dependency -- becoming active IS when this ring should take it.
    if (!isSectionActive) return
    const timeoutId = window.setTimeout(() => {
      buttonRefs.current[focusedIndex]?.focus()
    }, FOCUS_GRAB_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
    // ringResetKey is a dependency for a reason the name does not give
    // away: when a mode advances a step, focusedIndex is commonly already
    // 0 and stays 0, so nothing in this effect's own inputs changes -- yet
    // every button was just unmounted and replaced, taking DOM focus with
    // it to <body>. Without re-running here, handleRingBlur would see focus
    // outside every ring and close the panel on the player's first choice.
  }, [isOpen, isSectionActive, focusedIndex, ringResetKey])

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
    // Here CSS owns the movement, so the cells are not where they are going
    // to be yet. Waiting out the transition we ourselves set the duration of
    // is not a retry -- it is the one moment the answer exists.
    window.setTimeout(refreshHoverFromPointer, SIMPLE_ROTATION_TRANSITION_MS)
  }

  /**
   * ONE STEP OF THE DIAL, whatever asked for it -- an arrow key, or a notch
   * of the wheel. Everything below this line is about the dial and nothing
   * about the input that moved it, which is why the wheel gets identical
   * motion (and identical splicing mid-animation) for free rather than a
   * second, subtly different rotation path.
   */
  const rotateOneStep = (direction: 1 | -1) => {
    // THE DIAL'S OWN SOUND, here rather than at the three inputs that reach
    // this function, for exactly the reason the function exists: an arrow,
    // a Tab and a wheel notch are one motion, and giving them separate
    // sounds is the first thing that would let them drift apart
    // (escapeMenu/menuSounds.ts). Above the reduceVisualEffects branch, so
    // the cheap rotation path is not also the silent one.
    void typingSoundManager.playRandomClick(dialStepVoice(direction))
    if (reduceVisualEffects) {
      stepSimple(direction)
      return
    }

    const count = cellsRef.current.length
    if (count === 0) return

    // Also the throttle baseline a held arrow key measures from, so a wheel
    // notch and a key repeat cannot both spend the same moment.
    lastAcceptedKeyTimeMsRef.current = performance.now()

    // Focus branch: advances by exactly one position on every accepted
    // input, unconditionally -- independent of whether an animation is
    // currently in flight. The functional updater reads the true current
    // focusedIndex rather than the value closed over at render time, which
    // matters here specifically because a second input landing mid-
    // animation (see the animation branch below) needs to advance from
    // wherever focus already is, not from topIndex/rotationOffsetRef (the
    // animation's own reference, which lags behind on purpose).
    setFocusedIndex((current) => ((current + direction) % count + count) % count)
    // pendingTargetSlotRef is focusedIndex's own unwrapped counterpart --
    // advanced unconditionally, in lockstep, on every accepted input, so
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
    // discarding this input outright (see playContinuationLeg and the
    // component doc comment). The distance is always computed fresh from
    // pendingTargetSlotRef against wherever the ring's raw, possibly-
    // fractional position actually is right now -- not incrementally
    // derived from whatever the currently-playing leg's own bookkeeping
    // happens to say -- so this can never drift out of sync with the true
    // destination; see pendingTargetSlotRef's own doc comment for the bug
    // this fixes.
    const distance = pendingTargetSlotRef.current - rotationOffsetRef.current
    if (Math.abs(distance) > count) {
      // Moved fast enough that the true destination has raced more than a
      // full circle ahead of the currently-playing leg -- rather than
      // splice an ever-more-elaborate multi-lap curve, just let it finish
      // on its own; pendingTargetSlotRef is untouched by this skip, so the
      // very next accepted input (or this leg's own completion) will
      // recompute the correct distance fresh and catch up regardless.
      return
    }
    playContinuationLeg(distance, finalizeTopIndex)
  }
  const rotateOneStepRef = useRef(rotateOneStep)
  rotateOneStepRef.current = rotateOneStep

  /**
   * The wheel turns the dial: one notch up is one step anticlockwise, one
   * notch down is one step clockwise -- exactly what ArrowLeft and
   * ArrowRight do, through the same rotateOneStep, so the motion cannot
   * drift apart from the keyboard's.
   *
   * WHETHER this event is a notch is not decided here:
   * `resolveWheelEventUnits` already answers that for the whole app
   * (editor/wheelNotch.ts), learning the device's real notch size instead of
   * assuming one, and returning 0 for a trackpad's sub-notch stream. A
   * second answer to that question here is how the two panes drifted apart
   * last time.
   *
   * HOW MUCH it is worth, though, is NOT that function's answer to give
   * here, and taking it was a bug the reader saw as the dial jumping two
   * choices. That count is built for a SCROLLER, where the reader's total
   * travel has to be conserved: pixel mode keeps the remainder of a notch
   * that did not divide evenly, so a device sending 120 against a learned
   * unit of 100 banks 20 a notch and pays out DOUBLE on every fifth one,
   * and line/page mode hands back the count the device declares (three
   * lines a notch is three). Both are right for rows of text. Neither is
   * right for a dial, where a notch is one decision and there is no travel
   * to conserve -- a menu that occasionally skips the choice you were aiming
   * at is the whole of what conserving it buys. So the magnitude is
   * discarded and only the DIRECTION is taken: one notch, one step, which
   * is also what the ring's contract says a notch means.
   *
   * Attached to the RING, never to the backdrop: the backdrop is inert, and
   * a wheel over it belongs to whatever is behind it. Non-passive, because
   * a wheel that turned the dial must not also scroll the page.
   */
  const wheelNotchStateRef = useRef(createWheelNotchState())
  const handleRingWheel = useCallback((event: WheelEvent) => {
    if (!isOpenRef.current) return
    const units = resolveWheelEventUnits(event, wheelNotchStateRef.current, performance.now())
    if (units === 0) return
    event.preventDefault()
    rotateOneStepRef.current(units < 0 ? -1 : 1)
  }, [])
  useNonPassiveWheel(ringRef, handleRingWheel)

  /**
   * HOLDING SPACE PLAYS ON, at the mode's own rate, until the mode's own
   * boundary is crossed (escapeMenuContract.ts's `EscapeMenuAutoAdvance`).
   *
   * SPACE AND NOT ENTER, deliberately, and the difference is the browser's:
   * a native button fires its click from Enter on every auto-repeat keydown
   * and from Space only on RELEASE. So Enter is already a held-key repeat at
   * whatever rate the OS decides -- nobody's choice -- while Space is the one
   * key with a press and a release the panel can see the whole of. Taking it
   * over means calling `preventDefault` on the keydown, which is also what
   * stops the native click arriving on release and pressing a cell one extra
   * time after the hold has stopped.
   *
   * THE FIRST PRESS IS THE READER'S, not the timer's: the cell fires
   * immediately and the interval only governs what follows, so a tap of
   * space still means exactly what it meant before this existed.
   */
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const autoAdvanceBoundaryRef = useRef<string | null>(null)
  const autoAdvanceReleaseRef = useRef<(() => void) | null>(null)

  const stopAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearInterval(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
    autoAdvanceReleaseRef.current?.()
    autoAdvanceReleaseRef.current = null
    autoAdvanceBoundaryRef.current = null
  }, [])

  // The boundary is watched from a ref the render loop keeps current, so the
  // interval below reads the LIVE key rather than the one captured when the
  // hold began -- which is the whole mechanism: a hold ends because the game
  // moved past where the reader said to stop.
  const autoAdvanceRef = useRef(activeMode?.autoAdvance ?? null)
  autoAdvanceRef.current = activeMode?.autoAdvance ?? null
  const runCellRef = useRef<(cell: PanelCell) => void>(() => {})
  const activeCellRef = useRef<PanelCell | undefined>(undefined)

  useEffect(() => {
    const started = autoAdvanceBoundaryRef.current
    if (started === null) return
    if (autoAdvanceRef.current?.boundaryKey !== started) stopAutoAdvance()
  })

  // Lowering the ring, or losing the mode, ends any hold with it: a timer
  // pressing cells on a ring nobody is looking at is the one outcome this
  // must not have.
  useEffect(() => {
    if (!isOpen || !activeMode) stopAutoAdvance()
  }, [isOpen, activeMode, stopAutoAdvance])
  useEffect(() => stopAutoAdvance, [stopAutoAdvance])

  const handleRingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+ArrowLeft/Right is the app's global "switch active section"
    // shortcut (App.tsx) -- must pass through untouched, not get hijacked
    // as a rotation. Plain Ctrl/Cmd+Arrow are excluded too on the same
    // principle: this ring only owns unmodified arrow/Tab presses.
    if (event.altKey || event.ctrlKey || event.metaKey) return

    if (event.key === ' ' || event.key === 'Spacebar') {
      // Always ours while a ring is up: it must not scroll the page, and it
      // must not reach the native button activation that would fire a second
      // press on release.
      event.preventDefault()
      // The OS's own repeat is ignored outright -- the interval below is the
      // rate, and it is the reader's own setting rather than a keyboard's.
      if (event.repeat) return
      const cell = activeCellRef.current
      if (!cell) return
      runCellRef.current(cell)
      const auto = autoAdvanceRef.current
      if (!auto) return
      stopAutoAdvance()
      autoAdvanceBoundaryRef.current = auto.boundaryKey
      autoAdvanceTimerRef.current = window.setInterval(() => {
        const live = autoAdvanceRef.current
        const next = activeCellRef.current
        if (!live || !next || live.boundaryKey !== autoAdvanceBoundaryRef.current) {
          stopAutoAdvance()
          return
        }
        runCellRef.current(next)
      }, Math.max(1, auto.intervalMs))

      // THE RELEASE IS A WINDOW-LEVEL FACT, not the ring's.
      //
      // Every advance re-deals the ring's cells, so the focused cell
      // unmounts and focus churns through `<body>` before the panel takes it
      // back. A `keyup` bound to the ring can therefore land somewhere else
      // entirely, and the `blur` that used to stand in for that case fired on
      // the ring's OWN re-deal -- which ended every hold after exactly one
      // press. (Found live: holding space in a fight advanced a single
      // action and then sat there for twenty-four seconds.)
      //
      // So the key is watched where it cannot be missed, together with the
      // one event that means no keyup is ever coming: the window losing
      // focus. Focus moving INSIDE the app is not an end -- the reader is
      // still holding the key, and the ring is still on screen; the mode
      // going away is handled by the effect above, which is where that
      // question belongs.
      const onWindowKeyUp = (released: WindowEventMap['keyup']) => {
        if (released.key === ' ' || released.key === 'Spacebar') stopAutoAdvance()
      }
      const onWindowBlur = () => stopAutoAdvance()
      window.addEventListener('keyup', onWindowKeyUp, true)
      window.addEventListener('blur', onWindowBlur)
      autoAdvanceReleaseRef.current = () => {
        window.removeEventListener('keyup', onWindowKeyUp, true)
        window.removeEventListener('blur', onWindowBlur)
      }
      return
    }

    const direction = directionFromKey(event)
    if (direction === null) return
    event.preventDefault()

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
    if (event.repeat) {
      const last = lastAcceptedKeyTimeMsRef.current
      if (last !== null && performance.now() - last < heldKeyRepeatThrottleMs()) return
    }

    rotateOneStep(direction)
  }

  // The ring's default is to close on activation: a quick action does its
  // thing and gets out of the way. A cell that opens or advances a mode
  // opts out (keepsMenuOpen), because the next input belongs here too --
  // that is the whole difference between running an action and playing
  // something in the menu.
  const runCell = (cell: PanelCell) => {
    // Enter, or a backspace where the cell says it is a way back. The cell
    // SAYS so (EscapeMenuCell.isBack) -- every way back in the adventure
    // happens to share one icon, and so does combat's "Withdraw", which is
    // a decision the fight is for rather than a way out of a screen.
    void typingSoundManager.playRandomClick(cellActivationVoice(cell.isBack))
    void cell.onSelect()
    if (!cell.keepsMenuOpen) onClose()
  }

  // Hover takes priority over focus -- while the mouse is over a cell, the
  // label previews what a click would activate; focusedIndex is the
  // fallback the rest of the time. Either can legitimately point past the
  // end of `cells` for a stale render in the same tick a shrink hasn't been
  // clamped yet (the clamp effect above runs after render, not during it),
  // so this reads defensively rather than asserting the index is valid.
  /**
   * Whether the cell at this array index has popped in yet. The burst deals
   * cells out by SLOT (distance from the ring's top), and `topIndex` is what
   * turns one into the other -- so a screen that arrives already rotated
   * still fills from its own top outwards.
   */
  const slotArrived = (index: number) => {
    const count = cells.length
    if (count === 0) return true
    const slot = ((index - topIndex) % count + count) % count
    return slot < arrivedCount
  }

  const activeCell = hoveredIndex !== null ? cells[hoveredIndex] : cells[focusedIndex]
  // THE SAME CELL THE CENTRE LABEL NAMES, handed to the auto-advance timer
  // through a ref so the interval presses whatever is on the dial NOW rather
  // than whatever was there when the space bar went down. Two computations of
  // "the cell you are about to activate" would be two cells.
  activeCellRef.current = activeCell
  runCellRef.current = runCell
  const displayedLabel = activeCell?.label ?? ''

  // ONE resolution, two surfaces. The centre label and the chapter bar's
  // detail pill are both "the cell you are about to activate", and computing
  // that twice is how they would come to name different cells -- the same
  // argument that put the hover answer in refreshHoverFromPointer rather than
  // in CSS. Reported as an ID, not the cell: a string settles by value, so a
  // mode rebuilding its cells every render (they all do) cannot push a new
  // object into the host's state and start a loop.
  const reportedCellId = isOpen ? activeCell?.id ?? null : null
  useEffect(() => {
    onActiveCellChange?.(reportedCellId)
  }, [onActiveCellChange, reportedCellId])

  return (
    <div
      ref={ringRef}
      className={`editor-escape-hold-ring${isOpen ? ' is-visible' : ''}`}
      role="toolbar"
      aria-label="Quick note actions"
      onKeyDown={handleRingKeyDown}
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
        const point = computeEscapeHoldPointAtSlot(slot, cells.length, ringGeometryParams)
        return (
          <button
            type="button"
            key={cell.id}
            ref={(el) => { buttonRefs.current[index] = el }}
            // NOT YET ARRIVED: the screen is dealt out one cell per note of
            // the burst (see arrivedCount). The class is on the BUTTON but
            // what it hides is the ICON -- the chip is there from the first
            // frame, so the ring's shape, its refs, its focus target and
            // everything hit-testable are the same throughout, and only what
            // the cell says is staged.
            className={`editor-escape-hold-panel-btn${reduceVisualEffects ? ' is-simple-rotation' : ''}${index === hoveredIndex ? ' is-hovered' : ''}${slotArrived(index) ? '' : ' is-unarrived'}`}
            style={{
              transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
              '--rotation-duration': `${SIMPLE_ROTATION_TRANSITION_MS}ms`,
              '--cell-arrival': `${arrivalMs}ms`,
            } as CSSProperties}
            tabIndex={index === focusedIndex ? 0 : -1}
            aria-label={cell.label}
            onClick={() => runCell(cell)}
            onMouseEnter={() => {
              // THE POINTER moving onto a cell, which is the reader choosing
              // with the mouse what the arrow keys choose with the dial --
              // so it gets the dial's sound, in the direction the dial would
              // have had to turn.
              //
              // Safe against double-sounding a rotation: the browser does not
              // re-evaluate hover when the RING moves under a stationary
              // pointer -- that gap is the entire reason
              // refreshHoverFromPointer exists -- so this fires for pointer
              // movement and nothing else.
              setHoveredIndex((current) => {
                if (current === index) return current
                void typingSoundManager.playRandomClick(
                  hoverStepVoice(current ?? focusedIndex, index, cellsRef.current.length),
                )
                return index
              })
            }}
            onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
          >
            {/* THE ARRIVAL LIVES HERE, not on the button: see the CSS. The
                button's own transform is its ring placement, and scaling an
                element scales the translation its `transform` applies --
                so growing the button moved the cell along its own radius
                instead of leaving it where it is. */}
            <span className={`${cell.icon} editor-escape-hold-panel-btn-icon`} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

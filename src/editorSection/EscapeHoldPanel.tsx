import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { computeEscapeHoldRingPoints } from './escapeHoldRingLayout'

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
 * rotation (see the per-cell `slot` math below) via a plain CSS transform
 * transition, and the newly-active one simply happens to be the one that
 * ends the animation at the top. The net effect (a focused, interactive
 * slot that's always at the top, with icons appearing to shift underneath
 * it) is the same either way, without needing to coordinate a hand-off
 * between a moving decorative element and a stationary focused one.
 *
 * Clicking any cell -- top or not -- activates it immediately and closes
 * the panel (`runCell`); rotation is a keyboard-only way to browse without
 * committing, not a prerequisite for activating by mouse.
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
  // moves real DOM focus to match). This component stays permanently
  // mounted now (its host toggles display:none around it, so the shared
  // empty-state animation it lives inside never restarts -- see
  // SectionEditorArea.tsx), so "on mount" is no longer the same moment as
  // "on open"; keying off `isOpen` instead is what makes arrow keys work
  // immediately on every open, not just the first one, and keeps a stale
  // top cell from carrying over from the previous time the panel was open.
  useEffect(() => {
    if (!isOpen) return
    setTopIndex(0)
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
  useEffect(() => {
    if (!isOpen) return
    buttonRefs.current[topIndex]?.focus()
  }, [isOpen, topIndex])

  const rotate = (direction: 1 | -1) => {
    setTopIndex((current) => {
      const count = cells.length
      if (count === 0) return current
      return (current + direction + count) % count
    })
  }

  const handleRingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  return (
    <div
      className={`editor-escape-hold-ring${isOpen ? ' is-visible' : ''}`}
      role="toolbar"
      aria-label="Quick note actions"
      onKeyDown={handleRingKeyDown}
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

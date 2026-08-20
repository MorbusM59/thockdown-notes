import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface EscapeHoldPanelProps {
  activeNoteId: string | null
  isExportingPdf: boolean
  isExportingMd: boolean
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
  disabled: boolean
}

const COLUMNS = 3
const ROWS = 3
const GRID_SIZE = COLUMNS * ROWS

/**
 * The 3x3 quick-actions grid shown by the escape-hold overlay
 * (SectionEditorArea.tsx). Only the first five cells are wired to real
 * actions today -- the rest are inert placeholders that exist so the grid's
 * full shape is there to design/extend into, and so arrow-key navigation
 * has real corners and edges to be exercised against, not just a 2x2 patch.
 *
 * Keyboard model: roving tabindex over the 9 cells (only the "focused" cell
 * is a real Tab stop; the rest are tabIndex=-1), since the app suppresses
 * the native focus ring app-wide (see .app-shell button:focus-visible in
 * base.css) and a real dialog needs its own contained focus loop anyway.
 * Arrow keys move in their given direction, skipping disabled/placeholder
 * cells, and stop (don't wrap) at the grid edge. Tab/Shift+Tab traps focus
 * inside the grid by moving in reading order and wrapping at the ends --
 * without this, Tab would escape to whatever's behind the modal overlay,
 * since roving tabindex only ever leaves one native Tab stop for it to land
 * on. Enter/Space activate via each cell's own native <button> semantics,
 * so no separate key handling is needed for them.
 */
export function EscapeHoldPanel({
  activeNoteId,
  isExportingPdf,
  isExportingMd,
  onCreateNote,
  onCreateChapter,
  onExportPdf,
  onExportMd,
  onOpenHelp,
  onClose,
}: EscapeHoldPanelProps) {
  const hasActiveNote = Boolean(activeNoteId)

  const cells = useMemo<(PanelCell | null)[]>(() => {
    const actions: PanelCell[] = [
      { label: 'New Note', icon: 'fa-solid fa-file', onSelect: onCreateNote, disabled: false },
      { label: 'New Chapter', icon: 'fa-solid fa-book-medical', onSelect: onCreateChapter, disabled: !hasActiveNote },
      { label: 'Export PDF', icon: 'fa-solid fa-file-pdf', onSelect: onExportPdf, disabled: !hasActiveNote || isExportingPdf },
      { label: 'Export MD', icon: 'fa-solid fa-file-code', onSelect: onExportMd, disabled: !hasActiveNote || isExportingMd },
      { label: 'Help', icon: 'fa-solid fa-circle-question', onSelect: onOpenHelp, disabled: false },
    ]
    return [...actions, ...new Array(GRID_SIZE - actions.length).fill(null)]
  }, [hasActiveNote, isExportingPdf, isExportingMd, onCreateNote, onCreateChapter, onExportPdf, onExportMd, onOpenHelp])

  const firstEnabledIndex = useMemo(() => {
    const index = cells.findIndex((cell) => cell && !cell.disabled)
    return index === -1 ? 0 : index
  }, [cells])

  const [focusedIndex, setFocusedIndex] = useState(firstEnabledIndex)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Moves real DOM focus into the grid the instant it mounts -- this
  // component only exists in the tree while the panel is open (see its
  // conditional render in SectionEditorArea.tsx), so "on mount" and "on
  // open" are the same moment. Without this, arrow keys would do nothing
  // until the user first clicked or tabbed into a cell.
  useEffect(() => {
    buttonRefs.current[firstEnabledIndex]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nextEnabledInDirection = (fromIndex: number, rowDelta: number, colDelta: number) => {
    let row = Math.floor(fromIndex / COLUMNS)
    let col = fromIndex % COLUMNS
    for (;;) {
      row += rowDelta
      col += colDelta
      if (row < 0 || row >= ROWS || col < 0 || col >= COLUMNS) return fromIndex
      const candidate = cells[row * COLUMNS + col]
      if (candidate && !candidate.disabled) return row * COLUMNS + col
    }
  }

  const nextEnabledLinear = (fromIndex: number, direction: 1 | -1) => {
    let index = fromIndex
    for (let step = 0; step < GRID_SIZE; step += 1) {
      index = (index + direction + GRID_SIZE) % GRID_SIZE
      const candidate = cells[index]
      if (candidate && !candidate.disabled) return index
    }
    return fromIndex
  }

  const focusIndex = (index: number) => {
    setFocusedIndex(index)
    buttonRefs.current[index]?.focus()
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusIndex(nextEnabledInDirection(focusedIndex, -1, 0))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusIndex(nextEnabledInDirection(focusedIndex, 1, 0))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusIndex(nextEnabledInDirection(focusedIndex, 0, -1))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusIndex(nextEnabledInDirection(focusedIndex, 0, 1))
    } else if (event.key === 'Tab') {
      event.preventDefault()
      focusIndex(nextEnabledLinear(focusedIndex, event.shiftKey ? -1 : 1))
    }
  }

  const runCell = (cell: PanelCell) => {
    void cell.onSelect()
    onClose()
  }

  return (
    <div
      className="editor-escape-hold-panel-grid"
      role="grid"
      aria-label="Quick note actions"
      onKeyDown={handleGridKeyDown}
    >
      {Array.from({ length: ROWS }, (_, rowIndex) => (
        <div className="editor-escape-hold-panel-row" role="row" key={rowIndex}>
          {Array.from({ length: COLUMNS }, (_, colIndex) => {
            const index = rowIndex * COLUMNS + colIndex
            const cell = cells[index]
            return (
              <div className="editor-escape-hold-panel-cell" role="gridcell" key={index}>
                <button
                  type="button"
                  ref={(el) => { buttonRefs.current[index] = el }}
                  className="editor-escape-hold-panel-btn"
                  tabIndex={index === focusedIndex ? 0 : -1}
                  disabled={!cell || cell.disabled}
                  aria-label={cell ? cell.label : 'Not yet assigned'}
                  onFocus={() => setFocusedIndex(index)}
                  onClick={() => cell && runCell(cell)}
                >
                  {cell ? (
                    <>
                      <span className={cell.icon} aria-hidden="true" />
                      <span className="editor-escape-hold-panel-btn-label">{cell.label}</span>
                    </>
                  ) : (
                    <span className="editor-escape-hold-panel-btn-placeholder" aria-hidden="true">&middot;</span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

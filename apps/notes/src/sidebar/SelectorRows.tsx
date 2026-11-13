import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNonPassiveWheel } from '@thockdown/interaction/useNonPassiveWheel'
import { createWheelNotchState, resolveWheelEventUnits } from '../scroll/wheelNotch'

/** How many rows a growing selector shows before it scrolls: three rows of six, eighteen sections. */
const SELECTOR_VISIBLE_ROWS = 3

/**
 * A window onto a selector grid (an `.options-loadout-grid`, its only child)
 * whose number of cells grows with what the reader adds: the Music Library's
 * sets and the Soundscapes view's presets. It shows up to
 * `SELECTOR_VISIBLE_ROWS` whole rows; past that it scrolls ONE ROW PER WHEEL
 * NOTCH, whatever the notch's size (the escape ring's dial rule, through the
 * app's one notch resolver, `scroll/wheelNotch.ts`), and fades the outer third
 * of the edge row on whichever side has rows out of sight.
 *
 * The rows are measured from the grid as laid out (its first cell's height
 * and its row gap), so the window follows the UI scale without a constant of
 * its own. Whenever the ACTIVE cell (`.is-active`) moves to another row, the
 * window brings that row into view; scrolling afterwards may take it out of
 * sight again.
 */
export function SelectorRows({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<{ pitch: number; cell: number; rows: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const activeRowRef = useRef<number | null>(null)

  const maxOffset = geometry === null ? 0 : Math.max(0, geometry.rows - SELECTOR_VISIBLE_ROWS)
  const shownOffset = Math.min(offset, maxOffset)

  // Measured on every render (cheap: two reads of a small grid) and again when
  // the grid's size changes without one, since a cell may come or go either way.
  const measure = useCallback(() => {
    const grid = viewportRef.current?.firstElementChild as HTMLElement | null
    const first = grid?.firstElementChild as HTMLElement | null
    if (!grid || !first) { setGeometry(null); return }
    const cell = first.offsetHeight
    const pitch = cell + (parseFloat(getComputedStyle(grid).rowGap) || 0)
    const rows = pitch > 0 ? Math.round((grid.offsetHeight - cell) / pitch) + 1 : 1
    setGeometry((current) => (current && current.pitch === pitch && current.cell === cell && current.rows === rows ? current : { pitch, cell, rows }))
    const active = grid.querySelector<HTMLElement>(':scope > .is-active')
    const activeRow = active && pitch > 0 ? Math.round(active.offsetTop / pitch) : null
    if (activeRow !== activeRowRef.current) {
      activeRowRef.current = activeRow
      if (activeRow !== null) {
        setOffset((current) => Math.min(Math.max(current, activeRow - SELECTOR_VISIBLE_ROWS + 1), activeRow))
      }
    }
  }, [])

  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const grid = viewportRef.current?.firstElementChild
    if (!grid) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measure])

  const notchStateRef = useRef(createWheelNotchState())
  const handleWheel = useCallback((event: WheelEvent) => {
    if (maxOffset === 0) return
    event.preventDefault()
    const units = resolveWheelEventUnits(event, notchStateRef.current, performance.now())
    if (units === 0) return
    setOffset((current) => Math.min(Math.max(0, Math.min(current, maxOffset) + (units < 0 ? -1 : 1)), maxOffset))
  }, [maxOffset])
  useNonPassiveWheel(viewportRef, handleWheel)

  const style = geometry === null ? undefined : {
    height: `${Math.min(geometry.rows, SELECTOR_VISIBLE_ROWS) * geometry.pitch - (geometry.pitch - geometry.cell)}px`,
    '--selector-rows-shift': `${-shownOffset * geometry.pitch}px`,
    '--selector-rows-fade-top': shownOffset > 0 ? `${geometry.cell / 3}px` : '0px',
    '--selector-rows-fade-bottom': shownOffset < maxOffset ? `${geometry.cell / 3}px` : '0px',
  } as CSSProperties

  return <div ref={viewportRef} className="selector-rows" style={style}>{children}</div>
}


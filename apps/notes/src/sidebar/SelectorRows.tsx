import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNonPassiveWheel } from '@thockdown/interaction/useNonPassiveWheel'
import { createWheelNotchState, resolveWheelEventUnits } from '../scroll/wheelNotch'

/** How many rows a growing selector shows before it scrolls: three rows of six, eighteen sections. */
const SELECTOR_VISIBLE_ROWS = 3

/**
 * How long one row takes to scroll by while a drag is held just past the
 * window's edge. Further out it goes faster in proportion: one row's height
 * out halves it, three rows' quarters it.
 */
const EDGE_SCROLL_ROW_MS = 400

/** The wait before the next row while a drag is held `distance` px past an edge whose rows are `pitch` px apart. */
function edgeScrollIntervalMs(distance: number, pitch: number): number {
  return EDGE_SCROLL_ROW_MS / (1 + distance / Math.max(1, pitch))
}

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
 * its own. Whenever ANOTHER cell becomes the active one (`.is-active`), the
 * window brings its row into view; scrolling, or the cell moving in a
 * reorder, may take it out of sight again.
 *
 * A DRAG that starts inside the window (a cell being reordered,
 * `useSelectorReorder.ts`) and is held past its top or bottom edge scrolls it
 * a row at a time, faster the further out the pointer is, as the editor does
 * for a selection dragged past its pane.
 */
export function SelectorRows({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<{ pitch: number; cell: number; rows: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const activeCellRef = useRef<HTMLElement | null>(null)

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
    if (active !== activeCellRef.current) {
      activeCellRef.current = active
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

  const maxOffsetRef = useRef(maxOffset)
  maxOffsetRef.current = maxOffset
  const pitchRef = useRef(0)
  pitchRef.current = geometry?.pitch ?? 0
  const step = useCallback((direction: -1 | 1) => {
    const max = maxOffsetRef.current
    setOffset((current) => Math.min(Math.max(0, Math.min(current, max) + direction), max))
  }, [])

  const notchStateRef = useRef(createWheelNotchState())
  const handleWheel = useCallback((event: WheelEvent) => {
    if (maxOffset === 0) return
    event.preventDefault()
    const units = resolveWheelEventUnits(event, notchStateRef.current, performance.now())
    if (units !== 0) step(units < 0 ? -1 : 1)
  }, [maxOffset, step])
  useNonPassiveWheel(viewportRef, handleWheel)

  // The edge scroll: where the pointer is past an edge, read on every move
  // while a drag from inside is live, and a chain of timeouts, each waiting as
  // long as the distance at that moment says.
  const edgeRef = useRef<{ direction: -1 | 0 | 1; distance: number; timer: number | null; stop: () => void } | null>(null)
  const stopEdgeScroll = useCallback(() => edgeRef.current?.stop(), [])
  useEffect(() => stopEdgeScroll, [stopEdgeScroll])
  const handleDragStart = useCallback(() => {
    stopEdgeScroll()
    if (maxOffsetRef.current === 0) return
    const edge: NonNullable<typeof edgeRef.current> = { direction: 0, distance: 0, timer: null, stop: () => {} }
    const tick = () => {
      edge.timer = null
      if (edge.direction === 0) return
      step(edge.direction)
      edge.timer = window.setTimeout(tick, edgeScrollIntervalMs(edge.distance, pitchRef.current))
    }
    const onPointerMove = (event: PointerEvent) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      edge.direction = event.clientY < rect.top ? -1 : event.clientY > rect.bottom ? 1 : 0
      edge.distance = edge.direction < 0 ? rect.top - event.clientY : edge.direction > 0 ? event.clientY - rect.bottom : 0
      if (edge.direction !== 0 && edge.timer === null) edge.timer = window.setTimeout(tick, edgeScrollIntervalMs(edge.distance, pitchRef.current))
    }
    edge.stop = () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      if (edge.timer !== null) window.clearTimeout(edge.timer)
      if (edgeRef.current === edge) edgeRef.current = null
    }
    window.addEventListener('pointermove', onPointerMove, true)
    edgeRef.current = edge
  }, [step, stopEdgeScroll])

  const style = geometry === null ? undefined : {
    height: `${Math.min(geometry.rows, SELECTOR_VISIBLE_ROWS) * geometry.pitch - (geometry.pitch - geometry.cell)}px`,
    '--selector-rows-shift': `${-shownOffset * geometry.pitch}px`,
    '--selector-rows-fade-top': shownOffset > 0 ? `${geometry.cell / 3}px` : '0px',
    '--selector-rows-fade-bottom': shownOffset < maxOffset ? `${geometry.cell / 3}px` : '0px',
  } as CSSProperties

  // The window moves its grid by transform alone; a native scroll of the
  // clipping box (a clipped cell being focused) would add to that, so it is undone.
  return (
    <div ref={viewportRef} className="selector-rows" style={style} onScroll={(event) => { event.currentTarget.scrollTop = 0 }}
      onDragStart={handleDragStart}
      onDragEnd={stopEdgeScroll}
    >
      {children}
    </div>
  )
}


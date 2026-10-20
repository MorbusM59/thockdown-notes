/**
 * The edit view's speed reading row, drawn on the editor's own box grid.
 *
 * While a session shows a row, every box is the upper box colour
 * (`--color-bg-leading`) except one row in the middle, as many boxes wide as
 * the reader chose, in the regular box colour (`--color-bg-regular`), and the
 * chunk sits centred in it, one letter to a box. The grid lines are the
 * editor's own, left drawing over this layer; everything else the editor
 * layer draws -- the note's text, the caret, the boundary zones, the flow
 * trail -- is faded out by editor.css while this layer is present, so the
 * note is untouched underneath and comes back exactly as it was.
 *
 * Mounted by CM6Editor inside its layer, which is what puts the editor's font
 * variables (`--editor-font`, `--editor-cell-width`, ...) on the text and the
 * grid's half-cell phase in its arithmetic. Only the active slot draws it: the
 * session holds the keyboard, and the keyboard is the active slot's.
 *
 * The row changes on every chunk, so this component reads the display store
 * itself rather than through a prop: a chunk re-renders these three elements
 * and not the editor.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSpeedReadingDisplay, subscribeSpeedReadingDisplay } from './speedReadingStore'

interface SpeedReadingEditOverlayProps {
  isSectionActive: boolean
  cellWidthPx: number
  lineHeightPx: number
  halfCellWidthPx: number
  halfLineHeightPx: number
}

export function SpeedReadingEditOverlay(props: SpeedReadingEditOverlayProps) {
  const display = useSyncExternalStore(subscribeSpeedReadingDisplay, getSpeedReadingDisplay)
  const row = props.isSectionActive ? display?.row ?? null : null
  if (!row) return null
  return <SpeedReadingRowLayer {...props} text={row.text} widthBoxes={row.widthBoxes} />
}

function SpeedReadingRowLayer({
  cellWidthPx,
  lineHeightPx,
  halfCellWidthPx,
  halfLineHeightPx,
  text,
  widthBoxes,
}: SpeedReadingEditOverlayProps & { text: string; widthBoxes: number }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => setSize({ width: root.clientWidth, height: root.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  // The grid's boxes start half a cell in from the layer's top-left corner.
  const rows = size && lineHeightPx > 0 ? Math.max(1, Math.floor((size.height - halfLineHeightPx) / lineHeightPx)) : 0
  const columns = size && cellWidthPx > 0 ? Math.max(1, Math.floor((size.width - halfCellWidthPx) / cellWidthPx)) : 0
  const boxes = Math.min(widthBoxes, columns)
  const row = Math.floor((rows - 1) / 2)
  const firstColumn = Math.floor((columns - boxes) / 2)
  const textColumn = firstColumn + Math.max(0, Math.floor((boxes - text.length) / 2))
  const top = halfLineHeightPx + row * lineHeightPx
  const rowLeft = halfCellWidthPx + firstColumn * cellWidthPx
  const rowRight = rowLeft + boxes * cellWidthPx
  // The cover leaves a hole where the row is, so the row's boxes show the
  // regular box colour alone: both colours may be translucent, and a row
  // laid over the cover would show the two mixed.
  const coverClip = size
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rowLeft}px ${top}px, ${rowRight}px ${top}px, ${rowRight}px ${top + lineHeightPx}px, ${rowLeft}px ${top + lineHeightPx}px, ${rowLeft}px ${top}px)`
    : undefined

  return (
    <div ref={rootRef} className="speed-reading-overlay" aria-live="polite">
      <div className="speed-reading-cover" style={{ clipPath: coverClip }} />
      {size ? (
        <>
          <div
            className="speed-reading-row"
            style={{ top, left: rowLeft, width: rowRight - rowLeft, height: lineHeightPx }}
          />
          <div className="editor-text speed-reading-text" style={{ top, left: halfCellWidthPx + textColumn * cellWidthPx, height: lineHeightPx }}>
            {text}
          </div>
        </>
      ) : null}
    </div>
  )
}

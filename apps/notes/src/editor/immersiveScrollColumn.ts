/**
 * Geometry for immersive mode's grid scrollbar: the edit view's scroll track
 * drawn into the box grid itself (CM6Editor.tsx), because in immersive mode
 * there is no app grid left to hold the ordinary track, and the infinity grid
 * is everything. Pure, so the rules are tested rather than reasoned about
 * (immersiveScrollColumn.test.ts).
 *
 * The scrollbar LOGIC is the ordinary one -- thumb size from the text, click
 * travels, hold snaps, the bridged-journey stretch -- working in pixels
 * against whichever track element is mounted. Only the drawing is the grid's:
 * the thumb's pixel span is turned into whole rows here, and those boxes are
 * coloured.
 */

/**
 * The width reserved at the grid's right edge for its columns.
 *
 * Whole box columns plus the cut-off sliver past the last full one: the grid's
 * box columns are phase-anchored from the LEFT (half a box in), never
 * corrected against the right edge, so the right edge almost always falls
 * mid-box. Reserving the columns PLUS that remainder puts the reserved
 * region's left edge exactly on a real box boundary, with the sliver left
 * empty at the far right. The editor's text is padded out of the whole region,
 * so nothing ever wraps under a column.
 *
 * Columns, reading right to left from the last full box column: the scroll
 * column (immersive mode), then -- only when both are on -- one empty column,
 * then the review-flag column.
 */
export function computeRightEdgeReservePx(
  measuredWidthPx: number,
  cellWidthPx: number,
  columns: { reviewFlags: boolean; scrollColumn: boolean },
): number {
  const count = (columns.reviewFlags ? 1 : 0)
    + (columns.scrollColumn ? 1 : 0)
    + (columns.reviewFlags && columns.scrollColumn ? 1 : 0)
  if (count === 0 || cellWidthPx <= 0) return 0
  const halfCellWidthPx = Math.round(cellWidthPx / 2)
  const remainderPx = (((measuredWidthPx - halfCellWidthPx) % cellWidthPx) + cellWidthPx) % cellWidthPx
  return count * cellWidthPx + remainderPx
}

/**
 * The scroll column's left edge, given where the reserved region starts.
 *
 * The region opens with the review-flag column when flags are on, so the
 * scroll column sits two boxes further right -- past the flags and the one
 * empty box between them -- which makes it the last full box column either way.
 */
export function resolveScrollColumnLeftPx(regionLeftPx: number, cellWidthPx: number, reviewFlags: boolean): number {
  return regionLeftPx + (reviewFlags ? 2 * cellWidthPx : 0)
}

/**
 * The grid thumb's size: a whole number of rows -- never fewer than one, nor
 * more than the track holds.
 *
 * Applied where the thumb's size is DECIDED (CM6Editor's
 * readScrollbarGeometry), not just where it is drawn, so the thumb's travel, a
 * click's target and every frame of a journey all work with the size that
 * appears on screen. A whole-row size is what lets snapThumbSpanToRows round
 * the thumb's two edges independently and still keep it perfectly steady while
 * it moves.
 */
export function quantizeThumbHeightToRows(heightPx: number, rowHeightPx: number, totalRows: number): number {
  if (!(rowHeightPx > 0) || totalRows <= 0) return 0
  const rows = Math.min(totalRows, Math.max(1, Math.round(heightPx / rowHeightPx)))
  return rows * rowHeightPx
}

/**
 * The rows of the track a thumb span colours: each edge rounded to its own
 * nearest row boundary, independently; at least one row; kept inside the
 * track.
 *
 * The span is in pixels, measured from the track's top, exactly as the
 * ordinary scrollbar computes it -- including mid-journey, when it stretches.
 *
 * Edges, not "a size plus a start": rounding the size and the start separately
 * could put the far edge a whole row past the span's true edge. During a
 * journey's stretch that showed as a box beyond the destination lighting up
 * and then going out as the thumb settled -- a one-row overshoot. Rounding each
 * edge on its own keeps both within half a row of where the span really is,
 * so a stretch never colours past where it lands.
 *
 * With the thumb a whole number of rows (quantizeThumbHeightToRows) this is
 * also perfectly steady: moving a whole-row span shifts both edges together.
 * And it always covers the box a click was on: a click centres the thumb on
 * itself, and a band at least a row tall with independently rounded edges
 * always contains the row holding the span's centre -- pinned against either
 * end of the track included. All three are pinned down by the tests.
 */
export function snapThumbSpanToRows(
  topPx: number,
  heightPx: number,
  rowHeightPx: number,
  totalRows: number,
): { startRow: number; rows: number } {
  if (!(rowHeightPx > 0) || totalRows <= 0 || !(heightPx > 0)) return { startRow: 0, rows: 0 }
  const startRow = Math.min(totalRows - 1, Math.max(0, Math.round(topPx / rowHeightPx)))
  const endRow = Math.min(totalRows, Math.max(startRow + 1, Math.round((topPx + heightPx) / rowHeightPx)))
  return { startRow, rows: endRow - startRow }
}

/**
 * Where everything in the visualizer mode's scene goes, in whole boxes.
 * Pure, so the rules are tested rather than reasoned about
 * (visualizerLayout.test.ts); `VisualizerScene.tsx` draws what this returns.
 *
 * THE BOX IS SQUARE: as wide as the editor's real box at the reader's
 * settings, and exactly as tall as it is wide. The grid is CENTRED: as many
 * full boxes as the screen holds on each axis, and what is left over split
 * evenly between the two edges (the extra pixel of an odd remainder goes to
 * the far edge). The editor anchors its grid half a box in from the top-left
 * instead (CM6Editor.tsx's halfCellWidthPx), which keeps text in place as a
 * pane resizes; a full-screen scene has no text to keep in place, so it is
 * framed by the screen instead. Only FULL boxes are counted and used.
 *
 * TWO STRIPS OF EQUAL HEIGHT frame the scene, `STRIP_ROWS` full rows each
 * (fewer only on a screen too short for both and a row between them). The
 * TOP strip, from its first row: empty, the credits (the artist, then
 * `CREDITS_GAP_BOXES` empty boxes, then the album), empty, the title, empty,
 * the semitone row, empty. The BOTTOM strip: empty, then the spectrum in the
 * rest. Just outside them, on the middle section's first and last rows, run
 * the progress track and the volume bar, edge to edge. A row that does not
 * fit is left out (null). The text rows span the columns between
 * `ROW_INSET_BOXES` from each edge; the bars, the semitone row and the
 * spectrum span every column. Everything else in the middle section sits
 * beside the cutout between `contentTopRow` and `contentBottomRow`.
 *
 * THE CUTOUT is the empty scene's square, centred, as many whole boxes wide
 * as the empty state's own diameter (`--circle-diameter`) rounds to, so it is
 * the size the empty scene has in immersive mode, laid onto the grid.
 */

export const STRIP_ROWS = 7
/** Boxes left empty at each screen edge by the text rows. */
export const ROW_INSET_BOXES = 1
export const CREDITS_GAP_BOXES = 3

export type VisualizerLayout = {
  boxPx: number
  /** The grid's phase: the left and top edges of the first full box. */
  originXPx: number
  originYPx: number
  /** Full boxes across and down. */
  columns: number
  rows: number
  /** The height of each strip, in boxes. Zero when the screen is too small for one. */
  stripRows: number
  /** The top strip's rows (indices into the grid's rows), or null when the strip is too short for them. */
  titleRow: number | null
  creditsRow: number | null
  /** The first row of the bottom strip (the volume bar's row). */
  bottomStripRow: number
  /** The middle section's rows for what sits beside the cutout (song list, buckets, filter): one empty row from each bar. */
  contentTopRow: number
  contentBottomRow: number
  /** The progress track's row (the middle section's first) and the volume bar's (its last), or null without room for them. */
  progressRow: number | null
  volumeRow: number | null
  /** The spectrum's first row and height, in rows (zero when the strip is too short). */
  spectrumRow: number
  spectrumRows: number
  /** The full-width semitone row in the top strip, or null when it would collide with existing content. */
  chromaRow: number | null
  /** The cutout, in boxes. Size zero when there is no room for it between the strips. */
  cutout: { column: number; row: number; size: number }
}

/** The scene's layout for a `widthPx` by `heightPx` slot with square boxes of `boxPx`, and a cutout of about `cutoutPx`. */
export function computeVisualizerLayout(widthPx: number, heightPx: number, boxPx: number, cutoutPx: number): VisualizerLayout {
  const box = Math.max(1, boxPx)
  // The cutout is sized against the rows a grid of this box can always hold,
  // and the grid is then phased so the cutout sits dead centre: the part boxes
  // at the screen's edges take whatever is left, up to nearly a box each.
  const safeRows = Math.max(0, Math.floor(heightPx / box) - 1)
  const safeColumns = Math.max(0, Math.floor(widthPx / box) - 1)
  const safeStripRows = Math.max(0, Math.min(STRIP_ROWS, Math.floor((safeRows - 1) / 2)))
  // Odd, so a centre box sits on the screen's centre lines.
  const size = largestOddAtMost(Math.min(cutoutBoxes(cutoutPx, box), safeRows - 2 * safeStripRows, safeColumns))
  const cutLeftPx = Math.floor((widthPx - size * box) / 2)
  const cutTopPx = Math.floor((heightPx - size * box) / 2)
  const originXPx = ((cutLeftPx % box) + box) % box
  const originYPx = ((cutTopPx % box) + box) % box
  const columns = Math.max(0, Math.floor((widthPx - originXPx) / box))
  const rows = Math.max(0, Math.floor((heightPx - originYPx) / box))
  // Both strips have to fit with at least a row between them.
  const stripRows = Math.max(0, Math.min(STRIP_ROWS, Math.floor((rows - 1) / 2)))
  const topRow = (index: number) => (index < stripRows ? index : null)
  const creditsRow = topRow(1)
  const titleRow = topRow(3)
  const chromaRow = columns > 0 ? topRow(5) : null
  const bottomStripRow = rows - stripRows
  // The two bars sit just outside the strips, on the middle section's first
  // and last rows, when the middle has room for both and a row between.
  const barsFit = stripRows > 0 && bottomStripRow - stripRows >= 3
  const progressRow = barsFit ? stripRows : null
  const volumeRow = barsFit ? bottomStripRow - 1 : null
  // What sits beside the cutout keeps one empty row from each bar.
  const contentTopRow = stripRows + (barsFit ? 2 : 1)
  const contentBottomRow = bottomStripRow - (barsFit ? 3 : 2)
  const spectrumRows = Math.max(0, stripRows - 1)
  const spectrumRow = rows - spectrumRows

  const cutout = {
    column: (cutLeftPx - originXPx) / box,
    row: (cutTopPx - originYPx) / box,
    size,
  }

  return {
    boxPx: box,
    originXPx,
    originYPx,
    columns,
    rows,
    stripRows,
    titleRow,
    creditsRow,
    bottomStripRow,
    contentTopRow,
    contentBottomRow,
    progressRow,
    volumeRow,
    spectrumRow,
    spectrumRows,
    chromaRow,
    cutout,
  }
}

/** A bar on `row` running edge to edge, every column of the grid. */
function fullWidthBar(layout: VisualizerLayout, row: number | null): LevelBar | null {
  return row === null || layout.columns < 3 ? null : { column: 0, row, columns: layout.columns }
}

/** The progress track's place: the middle section's first row, just below the top strip, full width. */
export function progressBarArea(layout: VisualizerLayout): LevelBar | null {
  return fullWidthBar(layout, layout.progressRow)
}

/**
 * The progress track, one row of `columns` boxes: the first and last boxes
 * are the previous- and next-track buttons (always lit, carrying `<` and
 * `>`), and the TRACK is everything between, so the playhead's empty box
 * sits right beside a button at either end, the way a level bar's gap does.
 * Fewer than three boxes leaves no track.
 */
export function trackSpan(columns: number): { first: number; count: number } {
  return { first: 1, count: Math.max(0, columns - 2) }
}

/**
 * How far before a box's start the playhead may read and still count as in
 * that box (at most a quarter of a box). A seek to a box's start lands the
 * media a hair early (to the packet or sample before), and without this the
 * playhead first showed the box before the one pressed.
 */
export const PLAYHEAD_TOLERANCE_SEC = 0.05

/**
 * Which box of the track is left empty for the playhead at `timeSec` into a
 * song `durationSec` long, or null when there is no track. Box k holds
 * `[k, k + 1)` of the track's `count` equal shares of the song, each start
 * widened back by `PLAYHEAD_TOLERANCE_SEC`.
 */
export function playheadColumn(columns: number, timeSec: number, durationSec: number): number | null {
  const { first, count } = trackSpan(columns)
  if (count <= 0 || !(durationSec > 0) || !Number.isFinite(timeSec)) return null
  const boxSec = durationSec / count
  const tolerance = Math.min(PLAYHEAD_TOLERANCE_SEC, boxSec / 4)
  const box = Math.floor((Math.max(0, timeSec) + tolerance) / boxSec)
  return first + Math.min(count - 1, box)
}

/** Where in the song a press on track box `column` travels to, as a fraction: the start of that box's share, so the playhead lands on the box pressed. */
export function columnToFraction(columns: number, column: number): number | null {
  const { first, count } = trackSpan(columns)
  if (count <= 0 || column < first || column >= first + count) return null
  return (column - first) / count
}

export type ProgressPress = { kind: 'previous' } | { kind: 'next' } | { kind: 'seek'; fraction: number } | { kind: 'none' }

/** What a press on box `column` of the progress row does. */
export function progressPress(columns: number, column: number): ProgressPress {
  if (column === 0) return { kind: 'previous' }
  if (column === columns - 1 && columns > 1) return { kind: 'next' }
  const fraction = columnToFraction(columns, column)
  return fraction === null ? { kind: 'none' } : { kind: 'seek', fraction }
}

/** A run of text on a row, one character per box from `column`, every box (a space's included) lit behind it. */
export interface RowText {
  column: number
  text: string
}

/**
 * The credits row: the artist, then `CREDITS_GAP_BOXES` EMPTY boxes, then the
 * album, cut at the row's last box. Two runs rather than one string, because
 * a space inside a name is a lit box and the gap between the two is not. An
 * empty part is left out with its gap.
 */
export function creditsLine(artist: string, album: string, columns: number): RowText[] {
  const runs: RowText[] = []
  let column = 0
  for (const part of [artist.trim(), album.trim()]) {
    if (part.length === 0) continue
    const text = fitToRow(part, columns - column)
    if (text.length > 0) runs.push({ column, text })
    column += Array.from(part).length + CREDITS_GAP_BOXES
  }
  return runs
}

/** `text` cut to `columns` characters (by code point, so a character outside the BMP is not split). */
export function fitToRow(text: string, columns: number): string {
  return Array.from(text).slice(0, Math.max(0, columns)).join('')
}

/**
 * The empty boxes the song list, the bucket list and the pool filter keep
 * from the cutout: as many as there are empty rows between the cutout and
 * the progress bar, so all four sides of the orb keep one distance, and that
 * distance grows and shrinks with the screen.
 */
export function cutoutGapBoxes(layout: VisualizerLayout): number {
  const barRow = layout.progressRow ?? layout.stripRows - 1
  return Math.max(1, layout.cutout.row - barRow - 1)
}

/**
 * The song list's rectangle, in boxes: from the middle section's second row
 * and second column to its second-to-last row, its right edge at least
 * `cutoutGapBoxes` empty boxes left of the cutout. Only every
 * other row of it holds an entry, from its first row, so `slots` is how many
 * entries it shows. Null when it has no room for an entry of at least one
 * character (five boxes: two accents, two gaps, one letter).
 */
export function songListArea(layout: VisualizerLayout): { column: number; row: number; columns: number; rows: number; slots: number } | null {
  const row = layout.contentTopRow
  const lastRow = layout.contentBottomRow
  const column = 1
  const lastColumn = (layout.cutout.size > 0 ? layout.cutout.column : layout.columns) - cutoutGapBoxes(layout) - 1
  const rows = lastRow - row + 1
  const columns = lastColumn - column + 1
  if (layout.stripRows <= 0 || rows < 1 || columns < 5) return null
  return { column, row, columns, rows, slots: Math.floor((rows + 1) / 2) }
}

/**
 * One entry of the song list, `columns` boxes wide at most: an accent box, an
 * empty box, the name, an empty box, an accent box. The name is cut to fit,
 * and the closing accent follows the name rather than the rectangle's edge.
 * Returns the name and the column (from the entry's start) of the closing
 * accent.
 */
export function songListEntry(name: string, columns: number): { text: string; closingColumn: number } {
  const text = fitToRow(name.trim(), columns - 4)
  return { text, closingColumn: Array.from(text).length + 3 }
}

/**
 * The bucket list's rectangle: the song list's mirrored across the scene,
 * from the middle section's second row to its second-to-last, its right
 * edge one box in from the scene's and its left edge at least
 * `cutoutGapBoxes` empty boxes right of the cutout. Entries on
 * every other row from the top, right-aligned.
 */
export function bucketListArea(layout: VisualizerLayout): { column: number; row: number; columns: number; rows: number; slots: number } | null {
  const row = layout.contentTopRow
  // Above the pool filter, a free row between them, when there is one.
  const filter = poolFilterArea(layout)
  const lastRow = filter ? filter.row - 2 : layout.contentBottomRow
  const lastColumn = layout.columns - 2
  const column = (layout.cutout.size > 0 ? layout.cutout.column + layout.cutout.size : 0) + cutoutGapBoxes(layout)
  const rows = lastRow - row + 1
  const columns = lastColumn - column + 1
  if (layout.stripRows <= 0 || rows < 1 || columns < 5) return null
  return { column, row, columns, rows, slots: Math.floor((rows + 1) / 2) }
}

/** The pool filter's widest: two fields of ten on the top row, one of twenty-one below, each framed by accent boxes. */
export const POOL_FILTER_MAX_COLUMNS = 23

export type PoolFilterArea = {
  /** The top row's first column, and the top row; the title row is two below it. */
  column: number
  row: number
  /** Both rows' width: `2 * fieldColumns + 3`. */
  columns: number
  /** The artist and album fields' width; the title field's is `2 * fieldColumns + 1`. */
  fieldColumns: number
}

/**
 * The pool filter's two rows, bottom-right of the middle section: the right
 * edge one box in from the scene's (the bucket list's), the left at least
 * `cutoutGapBoxes` empty boxes right of the cutout, and the
 * bottom row on the song list's last entry row, so the two blocks share a
 * lowest line (one row above the middle's last, or two when the song list's
 * every-other-row pattern ends there). The top row is two above it.
 *
 * The rows are `2 * fieldColumns + 3` wide (accent, field, accent, field,
 * accent above; accent, field, accent below), so where there is less room
 * than `POOL_FILTER_MAX_COLUMNS` the two top fields lose a box each and the
 * title field two. Null when there is no room for fields of one box.
 */
export function poolFilterArea(layout: VisualizerLayout): PoolFilterArea | null {
  const songs = songListArea(layout)
  const firstRow = layout.contentTopRow
  const bottomRow = songs ? songs.row + 2 * (songs.slots - 1) : layout.contentBottomRow
  const row = bottomRow - 2
  if (layout.stripRows <= 0 || row < firstRow) return null
  const lastColumn = layout.columns - 2
  const leftLimit = (layout.cutout.size > 0 ? layout.cutout.column + layout.cutout.size : 0) + cutoutGapBoxes(layout)
  const room = Math.min(POOL_FILTER_MAX_COLUMNS, lastColumn - leftLimit + 1)
  const fieldColumns = Math.floor((room - 3) / 2)
  if (fieldColumns < 1) return null
  const columns = 2 * fieldColumns + 3
  return { column: lastColumn - columns + 1, row, columns, fieldColumns }
}

/**
 * What a field of `columns` boxes shows of `text` with the caret at `caret`
 * (a code point index): the visible characters and the caret's column. The
 * text scrolls only as far as needed to keep the caret, which may sit just
 * past the last character, in the field.
 */
export function fieldWindow(text: string, caret: number, columns: number): { chars: string[]; caretColumn: number } {
  const all = Array.from(text)
  const at = Math.max(0, Math.min(all.length, caret))
  const start = Math.max(0, at - columns + 1)
  return { chars: all.slice(start, start + columns), caretColumn: at - start }
}

export type LevelBar = { column: number; row: number; columns: number }
export type LevelBarsArea = { volume: LevelBar }

/** The volume bar: the middle section's last row, just above the bottom strip, full width. Null without a volume row. */
export function levelBarsArea(layout: VisualizerLayout): LevelBarsArea | null {
  const volume = fullWidthBar(layout, layout.volumeRow)
  return volume ? { volume } : null
}

/**
 * Where a level bar of `columns` boxes leaves its one empty box for `fraction`
 * (0..1): somewhere between its two end boxes, which are always lit, so the
 * level's whole range is the `columns - 2` boxes between them.
 */
export function levelGapColumn(columns: number, fraction: number): number {
  const span = columns - 2
  return 1 + Math.round(Math.max(0, Math.min(1, fraction)) * (span - 1))
}

/** The level a press on box `column` of a level bar sets: the inverse of `levelGapColumn`, an end box pressing the end of the range. */
export function levelAtColumn(columns: number, column: number): number {
  const span = columns - 2
  return span <= 1 ? 0 : Math.max(0, Math.min(1, (column - 1) / (span - 1)))
}

/** Rows the scene needs besides the cutout: each strip, its bar and a row of padding, top and bottom. */
export const REQUIRED_ROWS_BESIDE_CUTOUT = 2 * (STRIP_ROWS + 2)

/**
 * The fewest full rows the scene may have: both strips, both bars, and the
 * bucket list's five entries plus the pool filter's two rows with the empty
 * row between each (7 + 1 + 5 * 2 - 1 + 2 + 2 + 1 + 7).
 */
export const MIN_SCENE_ROWS = 31

/**
 * The box and font size the scene is drawn at in a slot `heightPx` tall: the
 * reader's own when both strips, both bars, a row of padding each side and the
 * cutout all fit; otherwise the largest box that fits, reached by lowering the
 * line height first, down to 1, and then the font size with it.
 */
export function fitVisualizerBox(heightPx: number, boxPx: number, fontSizePx: number, cutoutPx: number): { boxPx: number; fontSizePx: number } {
  // The full rows above the cutout (the grid is phased on it, so the rows
  // below are as many or one more), as computeVisualizerLayout places them.
  const fits = (box: number) => {
    const size = cutoutBoxes(cutoutPx, box)
    const above = Math.floor(Math.floor((heightPx - size * box) / 2) / box)
    return 2 * above >= REQUIRED_ROWS_BESIDE_CUTOUT && 2 * above + size >= MIN_SCENE_ROWS
  }
  let box = Math.max(1, boxPx)
  if (heightPx <= 0) return { boxPx: box, fontSizePx }
  while (box > 1 && !fits(box)) box -= 1
  return { boxPx: box, fontSizePx: Math.min(fontSizePx, box) }
}

/** The cutout's size in boxes for about `cutoutPx`: the nearest odd count, at least one. */
export function cutoutBoxes(cutoutPx: number, boxPx: number): number {
  return Math.max(1, 2 * Math.round((cutoutPx / boxPx - 1) / 2) + 1)
}

function largestOddAtMost(n: number): number {
  return n < 1 ? 0 : n % 2 === 1 ? n : n - 1
}

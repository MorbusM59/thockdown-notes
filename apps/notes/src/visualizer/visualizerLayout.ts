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
 * TWO STRIPS OF EQUAL HEIGHT frame the scene: the spectrum at the bottom and
 * the now-playing strip at the top. Their height is the spectrum's ceiling,
 * at most `MAX_STRIP_ROWS` boxes and at most `MAX_STRIP_SHARE` of the
 * screen's height. The top strip's rows, counted from the first full row:
 * the credits (the artist, then `CREDITS_GAP_BOXES` empty boxes, then the
 * album), a gap, the progress track, a gap, the title. A strip too short for
 * all five drops the credits first and then the title, and the progress track
 * moves up to the first row; it always stays.
 *
 * THE CUTOUT is the empty scene's square, centred, as many whole boxes wide
 * as the empty state's own diameter (`--circle-diameter`) rounds to, so it is
 * the size the empty scene has in immersive mode, laid onto the grid.
 */

export const MAX_STRIP_ROWS = 10
export const MAX_STRIP_SHARE = 0.2
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
  progressRow: number | null
  titleRow: number | null
  creditsRow: number | null
  /** The first row of the spectrum strip. */
  spectrumTopRow: number
  /** The full-width semitone row in the top strip, or null when it would collide with existing content. */
  chromaRow: number | null
  /** The cutout, in boxes. Size zero when there is no room for it between the strips. */
  cutout: { column: number; row: number; size: number }
}

/** The scene's layout for a `widthPx` by `heightPx` slot with square boxes of `boxPx`, and a cutout of about `cutoutPx`. */
export function computeVisualizerLayout(widthPx: number, heightPx: number, boxPx: number, cutoutPx: number): VisualizerLayout {
  const box = Math.max(1, boxPx)
  const columns = Math.max(0, Math.floor(widthPx / box))
  const rows = Math.max(0, Math.floor(heightPx / box))
  const originXPx = Math.floor((widthPx - columns * box) / 2)
  const originYPx = Math.floor((heightPx - rows * box) / 2)
  const ceiling = Math.min(MAX_STRIP_ROWS, Math.floor((MAX_STRIP_SHARE * heightPx) / box))
  // Both strips have to fit with at least a row between them.
  const stripRows = Math.max(0, Math.min(ceiling, Math.floor((rows - 1) / 2)))

  const creditsRow = stripRows >= 5 ? 0 : null
  const progressRow = stripRows < 1 ? null : creditsRow === null ? 0 : 2
  const titleRow = stripRows >= 3 ? progressRow! + 2 : null
  const spectrumTopRow = rows - stripRows
  const chromaRow = stripRows >= 6 && columns > 0 ? stripRows - 1 : null

  const middleRows = rows - 2 * stripRows
  const wanted = Math.max(1, Math.round(cutoutPx / box))
  const size = Math.max(0, Math.min(wanted, middleRows, columns))
  const cutout = {
    column: Math.floor((columns - size) / 2),
    row: stripRows + Math.floor((middleRows - size) / 2),
    size,
  }

  return {
    boxPx: box,
    originXPx,
    originYPx,
    columns,
    rows,
    stripRows,
    progressRow,
    titleRow,
    creditsRow,
    spectrumTopRow,
    chromaRow,
    cutout,
  }
}

/**
 * The progress track, one row of `columns` boxes: the first and last boxes
 * are the previous- and next-track buttons, the second and second-to-last
 * are dead, and the TRACK is everything between. Fewer than five boxes
 * leaves no track.
 */
export function trackSpan(columns: number): { first: number; count: number } {
  return { first: 2, count: Math.max(0, columns - 4) }
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

/** The empty boxes the song list keeps between its right edge and the cutout. */
export const SONG_LIST_CUTOUT_GAP_BOXES = 10

/**
 * The song list's rectangle, in boxes: from the middle section's second row
 * and second column to its second-to-last row, its right edge at least
 * `SONG_LIST_CUTOUT_GAP_BOXES` empty boxes left of the cutout. Only every
 * other row of it holds an entry, from its first row, so `slots` is how many
 * entries it shows. Null when it has no room for an entry of at least one
 * character (five boxes: two accents, two gaps, one letter).
 */
export function songListArea(layout: VisualizerLayout): { column: number; row: number; columns: number; rows: number; slots: number } | null {
  const row = layout.stripRows + 1
  const lastRow = layout.spectrumTopRow - 2
  const column = 1
  const lastColumn = (layout.cutout.size > 0 ? layout.cutout.column : layout.columns) - SONG_LIST_CUTOUT_GAP_BOXES - 1
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

/** The pool index of the entry in slot `slot` when `center` sits in slot `centerSlot`, round a ring of `count`. */
export function songListIndex(center: number, slot: number, centerSlot: number, count: number): number {
  return (((center + slot - centerSlot) % count) + count) % count
}

/** The shortest signed way round a ring of `count` from `from` to `to`. */
export function ringDistance(from: number, to: number, count: number): number {
  const forward = (((to - from) % count) + count) % count
  return forward > count / 2 ? forward - count : forward
}

/**
 * The bucket list's rectangle: the song list's mirrored across the scene,
 * from the middle section's second row to its second-to-last, its right
 * edge one box in from the scene's and its left edge at least
 * `SONG_LIST_CUTOUT_GAP_BOXES` empty boxes right of the cutout. Entries on
 * every other row from the top, right-aligned.
 */
export function bucketListArea(layout: VisualizerLayout): { column: number; row: number; columns: number; rows: number; slots: number } | null {
  const row = layout.stripRows + 1
  // Above the pool filter, a free row between them, when there is one.
  const filter = poolFilterArea(layout)
  const lastRow = filter ? filter.row - 2 : layout.spectrumTopRow - 2
  const lastColumn = layout.columns - 2
  const column = (layout.cutout.size > 0 ? layout.cutout.column + layout.cutout.size : 0) + SONG_LIST_CUTOUT_GAP_BOXES
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
 * `SONG_LIST_CUTOUT_GAP_BOXES` empty boxes right of the cutout, and the
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
  const firstRow = layout.stripRows + 1
  const bottomRow = songs ? songs.row + 2 * (songs.slots - 1) : layout.spectrumTopRow - 2
  const row = bottomRow - 2
  if (layout.stripRows <= 0 || row < firstRow) return null
  const lastColumn = layout.columns - 2
  const leftLimit = (layout.cutout.size > 0 ? layout.cutout.column + layout.cutout.size : 0) + SONG_LIST_CUTOUT_GAP_BOXES
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

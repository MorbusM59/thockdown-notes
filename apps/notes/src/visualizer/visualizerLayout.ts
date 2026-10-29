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
 * the progress track, a gap, the title, a gap, the credits (the artist, then
 * `CREDITS_GAP_BOXES` empty boxes, then the album). A strip too short for
 * all five drops the credits first and then the title; the progress track
 * always stays.
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

  const progressRow = stripRows >= 1 ? 0 : null
  const titleRow = stripRows >= 3 ? 2 : null
  const creditsRow = stripRows >= 5 ? 4 : null
  const spectrumTopRow = rows - stripRows

  const middleRows = rows - 2 * stripRows
  const wanted = Math.max(1, Math.round(cutoutPx / box))
  const size = Math.max(0, Math.min(wanted, middleRows, columns))
  const cutout = {
    column: Math.floor((columns - size) / 2),
    row: stripRows + Math.floor((middleRows - size) / 2),
    size,
  }

  return { boxPx: box, originXPx, originYPx, columns, rows, stripRows, progressRow, titleRow, creditsRow, spectrumTopRow, cutout }
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

/**
 * The credits row's characters, one per box: the artist, `CREDITS_GAP_BOXES`
 * empty boxes, the album, cut at the row's last box. An empty part is left
 * out with its gap. A space is an empty box.
 */
export function creditsLine(artist: string, album: string, columns: number): string {
  const parts = [artist.trim(), album.trim()].filter((part) => part.length > 0)
  return fitToRow(parts.join(' '.repeat(CREDITS_GAP_BOXES)), columns)
}

/** `text` cut to `columns` characters (by code point, so a character outside the BMP is not split). */
export function fitToRow(text: string, columns: number): string {
  return Array.from(text).slice(0, Math.max(0, columns)).join('')
}

/**
 * The press target of a row of the visualizer's boxes (the song and set
 * lists, the progress track, the volume bar): the boxes' own frame grown by
 * half a box above and below. A list's entries sit on every other row, so
 * each entry's target is then its row plus half the empty row either side,
 * and the entries' targets meet with no dead row between them; a bar's
 * target takes half of the empty row either side of it. The layout keeps an
 * empty row between every bar and list, so no two grown targets overlap.
 */
export type BoxFrame = { left: number; top: number; width: number; height: number }

export function hitFrame(frame: BoxFrame, boxPx: number): BoxFrame {
  return { left: frame.left, top: frame.top - boxPx / 2, width: frame.width, height: frame.height + boxPx }
}

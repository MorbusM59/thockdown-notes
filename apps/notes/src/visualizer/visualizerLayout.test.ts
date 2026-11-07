import { describe, expect, it } from 'vitest'
import { bucketListArea, levelAtColumn, levelBarsArea, levelGapColumn, columnToFraction, computeVisualizerLayout, creditsLine, fieldWindow, POOL_FILTER_MAX_COLUMNS, poolFilterArea, playheadColumn, progressBarArea, progressPress, cutoutGapBoxes, songListArea, songListEntry, fitVisualizerBox, MIN_SCENE_ROWS, STRIP_ROWS } from './visualizerLayout'

describe('computeVisualizerLayout', () => {
  it('gives both strips exactly eight rows wherever they fit', () => {
    expect(computeVisualizerLayout(1920, 1080, 10, 220).stripRows).toBe(7)
    expect(computeVisualizerLayout(1920, 1080, 60, 220).stripRows).toBe(7)
    expect(computeVisualizerLayout(1920, 300, 30, 220).stripRows).toBe(4)
  })

  it('lays out the top strip and the bottom strip row by row', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    expect(layout).toMatchObject({ creditsRow: 1, titleRow: 3, chromaRow: 5, progressRow: 7, stripRows: 7, contentTopRow: 9 })
    expect(layout.bottomStripRow).toBe(layout.rows - 7)
    expect(layout.volumeRow).toBe(layout.bottomStripRow - 1)
    expect(layout.contentBottomRow).toBe(layout.bottomStripRow - 3)
    expect(layout.spectrumRow).toBe(layout.bottomStripRow + 1)
    expect(layout.spectrumRows).toBe(6)
  })

  it('keeps the two strips and the cutout inside the full boxes, never overlapping', () => {
    for (const [w, h, box] of [[1920, 1080, 13], [800, 600, 31], [3840, 2160, 22], [300, 200, 40], [100, 60, 30]]) {
      const layout = computeVisualizerLayout(w, h, box, 220)
      expect(layout.originYPx + layout.rows * box).toBeLessThanOrEqual(h)
      expect(layout.originXPx + layout.columns * box).toBeLessThanOrEqual(w)
      // The part boxes at the edges are each less than a whole box.
      expect(layout.originXPx).toBeLessThan(box)
      expect(w - layout.originXPx - layout.columns * box).toBeLessThan(box)
      expect(layout.originYPx).toBeLessThan(box)
      expect(h - layout.originYPx - layout.rows * box).toBeLessThan(box)
      expect(layout.stripRows).toBeLessThan(layout.bottomStripRow + 1)
      expect(2 * layout.stripRows).toBeLessThan(Math.max(1, layout.rows))
      const { row, size, column } = layout.cutout
      if (size > 0) {
        expect(row).toBeGreaterThanOrEqual(layout.stripRows)
        expect(row + size).toBeLessThanOrEqual(layout.bottomStripRow)
        expect(column + size).toBeLessThanOrEqual(layout.columns)
      }
    }
  })

  it('leaves out the rows a short strip has no room for', () => {
    const at = (rows: number) => computeVisualizerLayout(2000, rows * 20, 20, 20)
    expect(at(9)).toMatchObject({ stripRows: 4, creditsRow: 1, titleRow: 3, chromaRow: null, progressRow: null, volumeRow: null, spectrumRows: 3 })
    expect(at(3)).toMatchObject({ stripRows: 1, creditsRow: null, titleRow: null, spectrumRows: 0 })
  })

  it('sizes the cutout to the empty scene in whole boxes, centred', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    expect(layout.cutout.size).toBe(11)
    for (let box = 5; box < 80; box += 1) expect(computeVisualizerLayout(1920, 1080, box, 220).cutout.size % 2).toBe(1)
  })

  it('puts the cutout dead centre on the screen, whatever the box', () => {
    for (const [w, h, box] of [[1920, 1080, 20], [1920, 1080, 23], [1366, 768, 17], [2560, 1440, 31], [801, 601, 13]]) {
      const layout = computeVisualizerLayout(w, h, box, 220)
      const { column, row, size } = layout.cutout
      const left = layout.originXPx + column * box
      const top = layout.originYPx + row * box
      expect(Number.isInteger(column) && Number.isInteger(row)).toBe(true)
      expect(Math.abs(left - (w - left - size * box))).toBeLessThanOrEqual(1)
      expect(Math.abs(top - (h - top - size * box))).toBeLessThanOrEqual(1)
    }
  })
})

describe('cutoutGapBoxes', () => {
  it('keeps the lists as far from the orb as the progress bar is', () => {
    for (const h of [700, 900, 1080, 1440]) {
      const layout = computeVisualizerLayout(1920, h, 20, 220)
      expect(cutoutGapBoxes(layout)).toBe(layout.cutout.row - (layout.progressRow as number) - 1)
    }
  })
})

describe('fitVisualizerBox', () => {
  it('keeps the reader\'s box and font where everything fits', () => {
    expect(fitVisualizerBox(1080, 22, 18, 220)).toEqual({ boxPx: 22, fontSizePx: 18 })
  })

  it('shrinks the line height first, then the font, until strips, bars, padding and cutout fit', () => {
    for (let h = 300; h <= 1600; h += 7) {
      const { boxPx, fontSizePx } = fitVisualizerBox(h, 60, 30, 220)
      const layout = computeVisualizerLayout(1920, h, boxPx, 220)
      expect(layout.cutout.row).toBeGreaterThanOrEqual(STRIP_ROWS + 2)
      expect(layout.rows - layout.cutout.row - layout.cutout.size).toBeGreaterThanOrEqual(STRIP_ROWS + 2)
      expect(layout.volumeRow).toBe(layout.bottomStripRow - 1)
      expect(layout.progressRow).toBe(STRIP_ROWS)
      expect(fontSizePx).toBe(Math.min(30, boxPx))
      // The largest box that fits: one more would not.
      expect(layout.rows).toBeGreaterThanOrEqual(MIN_SCENE_ROWS)
      if (boxPx < 60) {
        const bigger = computeVisualizerLayout(1920, h, boxPx + 1, 220)
        const above = bigger.cutout.row
        expect(above < STRIP_ROWS + 2 || bigger.rows - above - bigger.cutout.size < STRIP_ROWS + 2 || bigger.rows < MIN_SCENE_ROWS).toBe(true)
      }
    }
  })
})

describe('the progress track', () => {
  it('leaves exactly one box empty, walking the whole track over the song', () => {
    const columns = 40
    const seen = new Set<number>()
    for (let i = 0; i <= 1000; i += 1) {
      const column = playheadColumn(columns, (i / 1000) * 180, 180)
      expect(column).not.toBeNull()
      expect(column!).toBeGreaterThanOrEqual(1)
      expect(column!).toBeLessThanOrEqual(columns - 2)
      seen.add(column!)
    }
    expect(seen.size).toBe(columns - 2)
  })

  it('puts the playhead on the box that was pressed', () => {
    const columns = 37
    for (let column = 1; column <= columns - 2; column += 1) {
      const startSec = columnToFraction(columns, column)! * 180
      expect(playheadColumn(columns, startSec, 180)).toBe(column)
      // A seek reported a little short of where it was sent still lands on the box pressed.
      expect(playheadColumn(columns, startSec - 0.02, 180)).toBe(column)
      // The end of the box before is still that box.
      expect(playheadColumn(columns, startSec - 0.2, 180)).toBe(Math.max(1, column - 1))
    }
  })

  it('makes the ends previous and next, and the track run right up to them', () => {
    expect(progressPress(30, 0)).toEqual({ kind: 'previous' })
    expect(progressPress(30, 29)).toEqual({ kind: 'next' })
    expect(progressPress(30, 1)).toEqual({ kind: 'seek', fraction: 0 })
    expect(progressPress(30, 28)).toEqual({ kind: 'seek', fraction: 27 / 28 })
  })
})

describe('creditsLine', () => {
  it('separates artist and album by three boxes and cuts at the row', () => {
    expect(creditsLine('An Artist', 'Album', 40)).toEqual([{ column: 0, text: 'An Artist' }, { column: 12, text: 'Album' }])
    expect(creditsLine('Artist', '', 40)).toEqual([{ column: 0, text: 'Artist' }])
    expect(creditsLine('', 'Album', 40)).toEqual([{ column: 0, text: 'Album' }])
    expect(creditsLine('Artist', 'Album', 8)).toEqual([{ column: 0, text: 'Artist' }])
    expect(creditsLine('Artist', 'Album', 11)).toEqual([{ column: 0, text: 'Artist' }, { column: 9, text: 'Al' }])
  })
})

describe('song list', () => {
  it('sits between the strips, a column in, ten boxes clear of the cutout', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    const area = songListArea(layout)!
    expect(area.row).toBe(layout.contentTopRow)
    expect(area.row + area.rows - 1).toBe(layout.contentBottomRow)
    expect(area.column).toBe(1)
    expect(layout.cutout.column - (area.column + area.columns)).toBe(cutoutGapBoxes(layout))
    expect(area.slots).toBe(Math.ceil(area.rows / 2))
  })

  it('frames a name with accents and gaps, cut to fit', () => {
    expect(songListEntry('Song', 20)).toEqual({ text: 'Song', closingColumn: 7 })
    expect(songListEntry('A long title', 8)).toEqual({ text: 'A lo', closingColumn: 7 })
  })
})

describe('bucket list', () => {
  it('mirrors the song list across the scene', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    const songs = songListArea(layout)!
    const buckets = bucketListArea(layout)!
    expect(buckets.row).toBe(songs.row)
    expect(buckets.row + buckets.rows - 1).toBe(poolFilterArea(layout)!.row - 2)
    expect(layout.columns - (buckets.column + buckets.columns)).toBe(songs.column)
    expect(buckets.column - (layout.cutout.column + layout.cutout.size)).toBe(cutoutGapBoxes(layout))
  })
})

describe('pool filter', () => {
  it('shares the song list\'s lowest line, bottom right, at most 23 wide', () => {
    for (const [width, height] of [[1920, 1080], [1920, 1100], [1280, 800], [3840, 2160]]) {
      const layout = computeVisualizerLayout(width, height, 20, 220)
      const songs = songListArea(layout)!
      const area = poolFilterArea(layout)!
      expect(area.row + 2).toBe(songs.row + 2 * (songs.slots - 1))
      expect(area.column + area.columns).toBe(layout.columns - 1)
      expect(area.columns).toBe(2 * area.fieldColumns + 3)
      expect(area.columns).toBeLessThanOrEqual(POOL_FILTER_MAX_COLUMNS)
      expect(area.column - (layout.cutout.column + layout.cutout.size)).toBeGreaterThanOrEqual(cutoutGapBoxes(layout))
    }
  })

  it('keeps the caret in the field', () => {
    expect(fieldWindow('abc', 3, 10)).toEqual({ chars: ['a', 'b', 'c'], caretColumn: 3 })
    expect(fieldWindow('abcdef', 6, 4)).toEqual({ chars: ['d', 'e', 'f'], caretColumn: 3 })
    expect(fieldWindow('abcdef', 1, 4)).toEqual({ chars: ['a', 'b', 'c', 'd'], caretColumn: 1 })
  })
})

describe('level bars', () => {
  it('runs volume across the whole row above the bottom strip', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    expect(levelBarsArea(layout)!.volume).toEqual({ column: 0, row: layout.bottomStripRow - 1, columns: layout.columns })
    expect(progressBarArea(layout)).toEqual({ column: 0, row: 7, columns: layout.columns })
  })

  it('keeps both ends lit and inverts a press', () => {
    expect(levelGapColumn(12, 0)).toBe(1)
    expect(levelGapColumn(12, 1)).toBe(10)
    for (let column = 1; column <= 10; column += 1) expect(levelGapColumn(12, levelAtColumn(12, column))).toBe(column)
    expect(levelAtColumn(12, 0)).toBe(0)
    expect(levelAtColumn(12, 11)).toBe(1)
  })
})

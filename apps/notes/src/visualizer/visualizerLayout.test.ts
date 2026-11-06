import { describe, expect, it } from 'vitest'
import { bucketListArea, LEVEL_BARS_GAP_BOXES, levelAtColumn, levelBarsArea, levelGapColumn, columnToFraction, computeVisualizerLayout, creditsLine, fieldWindow, POOL_FILTER_MAX_COLUMNS, poolFilterArea, playheadColumn, progressPress, SONG_LIST_CUTOUT_GAP_BOXES, songListArea, songListEntry } from './visualizerLayout'

describe('computeVisualizerLayout', () => {
  it('caps the strips at ten boxes and at a fifth of the height', () => {
    expect(computeVisualizerLayout(1920, 1080, 10, 220).stripRows).toBe(10)
    // 20% of 1080 is 216px: nine 24px boxes, eight 27px ones.
    expect(computeVisualizerLayout(1920, 1080, 24, 220).stripRows).toBe(9)
    expect(computeVisualizerLayout(1920, 1080, 27, 220).stripRows).toBe(8)
  })

  it('keeps the two strips and the cutout inside the full boxes, never overlapping', () => {
    for (const [w, h, box] of [[1920, 1080, 13], [800, 600, 31], [3840, 2160, 22], [300, 200, 40], [100, 60, 30]]) {
      const layout = computeVisualizerLayout(w, h, box, 220)
      expect(layout.originYPx + layout.rows * box).toBeLessThanOrEqual(h)
      expect(layout.originXPx + layout.columns * box).toBeLessThanOrEqual(w)
      // Centred: the two margins differ by at most the odd pixel.
      expect(w - layout.originXPx - layout.columns * box - layout.originXPx).toBeGreaterThanOrEqual(0)
      expect(w - layout.originXPx - layout.columns * box - layout.originXPx).toBeLessThanOrEqual(1)
      expect(h - layout.originYPx - layout.rows * box - layout.originYPx).toBeGreaterThanOrEqual(0)
      expect(h - layout.originYPx - layout.rows * box - layout.originYPx).toBeLessThanOrEqual(1)
      expect(layout.stripRows).toBeLessThan(layout.spectrumTopRow + 1)
      expect(2 * layout.stripRows).toBeLessThan(Math.max(1, layout.rows))
      const { row, size, column } = layout.cutout
      if (size > 0) {
        expect(row).toBeGreaterThanOrEqual(layout.stripRows)
        expect(row + size).toBeLessThanOrEqual(layout.spectrumTopRow)
        expect(column + size).toBeLessThanOrEqual(layout.columns)
      }
    }
  })

  it('drops the credits, then the title, as the strip gets shorter', () => {
    const at = (stripRowsWanted: number) => computeVisualizerLayout(2000, (stripRowsWanted * 20) / 0.2 + 1, 20, 220)
    expect(at(6)).toMatchObject({ creditsRow: 1, progressRow: 3, titleRow: 5 })
    expect(at(5)).toMatchObject({ progressRow: 1, titleRow: 3, creditsRow: null })
    expect(at(3)).toMatchObject({ progressRow: 1, titleRow: null, creditsRow: null })
    expect(at(1)).toMatchObject({ progressRow: null, titleRow: null, creditsRow: null })
  })

  it('places a full-width chroma row at the top strip bottom when it fits without overlapping content', () => {
    const at = (stripRowsWanted: number, columns: number) =>
      computeVisualizerLayout(columns * 20, (stripRowsWanted * 20) / 0.2 + 1, 20, 220)
    expect(at(10, 40)).toMatchObject({ chromaRow: 9 })
    expect(at(6, 40)).toMatchObject({ chromaRow: null })
    expect(at(10, 11)).toMatchObject({ chromaRow: 9 })
    expect(at(10, 0)).toMatchObject({ chromaRow: null })
  })

  it('sizes the cutout to the empty scene in whole boxes, centred', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    expect(layout.cutout.size).toBe(11)
    expect(layout.cutout.column).toBe(Math.floor((layout.columns - 11) / 2))
  })
})

describe('the progress track', () => {
  it('leaves exactly one box empty, walking the whole track over the song', () => {
    const columns = 40
    const seen = new Set<number>()
    for (let i = 0; i <= 1000; i += 1) {
      const column = playheadColumn(columns, (i / 1000) * 180, 180)
      expect(column).not.toBeNull()
      expect(column!).toBeGreaterThanOrEqual(2)
      expect(column!).toBeLessThanOrEqual(columns - 3)
      seen.add(column!)
    }
    expect(seen.size).toBe(columns - 4)
  })

  it('puts the playhead on the box that was pressed', () => {
    const columns = 37
    for (let column = 2; column <= columns - 3; column += 1) {
      const startSec = columnToFraction(columns, column)! * 180
      expect(playheadColumn(columns, startSec, 180)).toBe(column)
      // A seek reported a little short of where it was sent still lands on the box pressed.
      expect(playheadColumn(columns, startSec - 0.02, 180)).toBe(column)
      // The end of the box before is still that box.
      expect(playheadColumn(columns, startSec - 0.2, 180)).toBe(Math.max(2, column - 1))
    }
  })

  it('makes the ends previous and next, and the second boxes dead', () => {
    expect(progressPress(30, 0)).toEqual({ kind: 'previous' })
    expect(progressPress(30, 29)).toEqual({ kind: 'next' })
    expect(progressPress(30, 1)).toEqual({ kind: 'none' })
    expect(progressPress(30, 28)).toEqual({ kind: 'none' })
    expect(progressPress(30, 2)).toEqual({ kind: 'seek', fraction: 0 })
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
    expect(area.row).toBe(layout.stripRows + 1)
    expect(area.row + area.rows - 1).toBe(layout.spectrumTopRow - 2)
    expect(area.column).toBe(1)
    expect(layout.cutout.column - (area.column + area.columns)).toBe(SONG_LIST_CUTOUT_GAP_BOXES)
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
    expect(buckets.column - (layout.cutout.column + layout.cutout.size)).toBe(SONG_LIST_CUTOUT_GAP_BOXES)
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
      expect(area.column - (layout.cutout.column + layout.cutout.size)).toBeGreaterThanOrEqual(SONG_LIST_CUTOUT_GAP_BOXES)
    }
  })

  it('keeps the caret in the field', () => {
    expect(fieldWindow('abc', 3, 10)).toEqual({ chars: ['a', 'b', 'c'], caretColumn: 3 })
    expect(fieldWindow('abcdef', 6, 4)).toEqual({ chars: ['d', 'e', 'f'], caretColumn: 3 })
    expect(fieldWindow('abcdef', 1, 4)).toEqual({ chars: ['a', 'b', 'c', 'd'], caretColumn: 1 })
  })
})

describe('level bars', () => {
  it('centre under the cutout on the lowest line, reverb and room a row above with the gap between', () => {
    const layout = computeVisualizerLayout(1920, 1080, 20, 220)
    const songs = songListArea(layout)!
    const bars = levelBarsArea(layout)!
    expect(bars.volume.row).toBe(songs.row + 2 * (songs.slots - 1))
    expect(layout.cutout.column - bars.volume.column).toBe(8)
    expect(bars.volume.column + bars.volume.columns - (layout.cutout.column + layout.cutout.size)).toBe(8)
    expect(bars.reverb.row).toBe(bars.volume.row - 2)
    expect(bars.reverb.column).toBe(bars.volume.column)
    expect(bars.room.column + bars.room.columns).toBe(bars.volume.column + bars.volume.columns)
    expect(bars.room.column - (bars.reverb.column + bars.reverb.columns)).toBeGreaterThanOrEqual(LEVEL_BARS_GAP_BOXES)
  })

  it('keeps both ends lit and inverts a press', () => {
    expect(levelGapColumn(12, 0)).toBe(1)
    expect(levelGapColumn(12, 1)).toBe(10)
    for (let column = 1; column <= 10; column += 1) expect(levelGapColumn(12, levelAtColumn(12, column))).toBe(column)
    expect(levelAtColumn(12, 0)).toBe(0)
    expect(levelAtColumn(12, 11)).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { columnToFraction, computeVisualizerLayout, creditsLine, playheadColumn, progressPress } from './visualizerLayout'

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
    expect(at(5)).toMatchObject({ progressRow: 0, titleRow: 2, creditsRow: 4 })
    expect(at(4)).toMatchObject({ progressRow: 0, titleRow: 2, creditsRow: null })
    expect(at(2)).toMatchObject({ progressRow: 0, titleRow: null, creditsRow: null })
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
    expect(creditsLine('Artist', 'Album', 40)).toBe('Artist   Album')
    expect(creditsLine('Artist', '', 40)).toBe('Artist')
    expect(creditsLine('', 'Album', 40)).toBe('Album')
    expect(creditsLine('Artist', 'Album', 8)).toBe('Artist  ')
  })
})

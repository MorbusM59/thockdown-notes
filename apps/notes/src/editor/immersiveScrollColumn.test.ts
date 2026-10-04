import { describe, expect, it } from 'vitest'
import {
  computeRightEdgeReservePx,
  quantizeThumbHeightToRows,
  resolveScrollColumnLeftPx,
  snapThumbSpanToRows,
} from './immersiveScrollColumn'
import { resolveThumbRubberBand } from './scrollThumbRubberBand'

// Small seeded LCG: reproducible sequences without a dependency.
const createRandom = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

describe('computeRightEdgeReservePx', () => {
  it('reserves nothing when there are no columns', () => {
    expect(computeRightEdgeReservePx(800, 11, { reviewFlags: false, scrollColumn: false })).toBe(0)
  })

  it('matches the flag-column formula it replaces when only flags are on', () => {
    for (const width of [800, 801, 805, 1333]) {
      const half = Math.round(11 / 2)
      const remainder = (((width - half) % 11) + 11) % 11
      expect(computeRightEdgeReservePx(width, 11, { reviewFlags: true, scrollColumn: false })).toBe(11 + remainder)
    }
  })

  it('always starts the reserved region on a box boundary, and makes the scroll column the last full column', () => {
    const random = createRandom(0x51de)
    for (let run = 0; run < 2000; run += 1) {
      const cell = 6 + Math.floor(random() * 20)
      const width = 300 + Math.floor(random() * 2000)
      const reviewFlags = random() < 0.5
      const reserve = computeRightEdgeReservePx(width, cell, { reviewFlags, scrollColumn: true })
      const regionLeft = width - reserve
      const half = Math.round(cell / 2)
      // The region's left edge is a real box boundary of the half-cell-phased grid.
      expect(((regionLeft - half) % cell + cell) % cell).toBe(0)
      const scrollLeft = resolveScrollColumnLeftPx(regionLeft, cell, reviewFlags)
      // Last full column: one box wide, and only the sub-box sliver after it.
      const sliver = width - (scrollLeft + cell)
      expect(sliver).toBeGreaterThanOrEqual(0)
      expect(sliver).toBeLessThan(cell)
      if (reviewFlags) {
        // Flags open the region; exactly one empty box sits between them and the scroll column.
        expect(scrollLeft - (regionLeft + cell)).toBe(cell)
      }
    }
  })
})

describe('quantizeThumbHeightToRows', () => {
  it('is a whole number of rows, at least one, at most the track', () => {
    expect(quantizeThumbHeightToRows(10, 20, 30)).toBe(20)
    // 3.4 rows rounds down to 3, 3.5 up to 4.
    expect(quantizeThumbHeightToRows(68, 20, 30)).toBe(60)
    expect(quantizeThumbHeightToRows(70, 20, 30)).toBe(80)
    expect(quantizeThumbHeightToRows(5000, 20, 30)).toBe(600)
  })
})

describe('snapThumbSpanToRows', () => {
  it('colours nothing for an empty span or track', () => {
    expect(snapThumbSpanToRows(10, 0, 20, 30)).toEqual({ startRow: 0, rows: 0 })
    expect(snapThumbSpanToRows(10, 40, 20, 0)).toEqual({ startRow: 0, rows: 0 })
  })

  it('never colours fewer than one row, nor more than the track holds', () => {
    expect(snapThumbSpanToRows(0, 3, 20, 30).rows).toBe(1)
    expect(snapThumbSpanToRows(0, 5000, 20, 30)).toEqual({ startRow: 0, rows: 30 })
  })

  it('keeps a whole-row thumb exactly its size wherever it sits', () => {
    const random = createRandom(0x3c11)
    for (let run = 0; run < 3000; run += 1) {
      const rowHeight = 12 + Math.floor(random() * 30)
      const totalRows = 2 + Math.floor(random() * 80)
      const thumbHeight = quantizeThumbHeightToRows(random() * totalRows * rowHeight, rowHeight, totalRows)
      const top = random() * (totalRows * rowHeight - thumbHeight)
      expect(snapThumbSpanToRows(top, thumbHeight, rowHeight, totalRows).rows).toBe(thumbHeight / rowHeight)
    }
  })

  it('colours the clicked box for any click, thumb size and track -- including thumbs pinned at either end', () => {
    const random = createRandom(0x7ac4)
    for (let run = 0; run < 5000; run += 1) {
      const rowHeight = 12 + Math.floor(random() * 30)
      const totalRows = 1 + Math.floor(random() * 80)
      const trackHeight = totalRows * rowHeight
      // The grid's thumb: a whole number of rows, at least one, never taller than the track.
      const thumbHeight = quantizeThumbHeightToRows(rowHeight + random() * (trackHeight - rowHeight), rowHeight, totalRows)
      // A click anywhere in the track, exact to the pixel -- the upper or lower part of a box alike.
      const clickY = random() * trackHeight
      // What the scrollbar does with it: centre the thumb on the click, kept inside the track.
      const thumbTop = Math.max(0, Math.min(clickY - thumbHeight / 2, trackHeight - thumbHeight))
      const { startRow, rows } = snapThumbSpanToRows(thumbTop, thumbHeight, rowHeight, totalRows)
      const clickedRow = Math.floor(clickY / rowHeight)
      expect(clickedRow).toBeGreaterThanOrEqual(startRow)
      expect(clickedRow).toBeLessThan(startRow + rows)
      expect(startRow).toBeGreaterThanOrEqual(0)
      expect(startRow + rows).toBeLessThanOrEqual(totalRows)
    }
  })

  it('never colours a box past where a journey lands or began, and comes to rest exactly on the landing', () => {
    const random = createRandom(0x9e17)
    for (let run = 0; run < 2000; run += 1) {
      const rowHeight = 12 + Math.floor(random() * 30)
      const totalRows = 5 + Math.floor(random() * 80)
      const trackHeight = totalRows * rowHeight
      const thumbHeight = quantizeThumbHeightToRows(rowHeight + random() * (trackHeight / 3), rowHeight, totalRows)
      const maxTop = trackHeight - thumbHeight
      const startTop = random() * maxTop
      const targetTop = random() * maxTop
      const origin = snapThumbSpanToRows(startTop, thumbHeight, rowHeight, totalRows)
      const landing = snapThumbSpanToRows(targetTop, thumbHeight, rowHeight, totalRows)
      const highestRow = Math.min(origin.startRow, landing.startRow)
      const lowestRowEnd = Math.max(origin.startRow + origin.rows, landing.startRow + landing.rows)

      // Walk the whole stretch: the leading edge runs the span, then the trailing edge catches up.
      const steps: Array<[number, number]> = []
      for (let i = 0; i <= 24; i += 1) steps.push([i / 24, 0])
      for (let i = 0; i <= 24; i += 1) steps.push([1, i / 24])
      for (const [leadProgress, trailProgress] of steps) {
        const { topPx, heightPx } = resolveThumbRubberBand({
          startTopPx: startTop,
          targetTopPx: targetTop,
          thumbHeightPx: thumbHeight,
          leadProgress,
          trailProgress,
        })
        const band = snapThumbSpanToRows(topPx, heightPx, rowHeight, totalRows)
        expect(band.startRow).toBeGreaterThanOrEqual(highestRow)
        expect(band.startRow + band.rows).toBeLessThanOrEqual(lowestRowEnd)
      }

      const rest = resolveThumbRubberBand({
        startTopPx: startTop,
        targetTopPx: targetTop,
        thumbHeightPx: thumbHeight,
        leadProgress: 1,
        trailProgress: 1,
      })
      expect(snapThumbSpanToRows(rest.topPx, rest.heightPx, rowHeight, totalRows)).toEqual(landing)
    }
  })
})

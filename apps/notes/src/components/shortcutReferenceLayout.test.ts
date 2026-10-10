import { describe, expect, it } from 'vitest'
import { arrangeSections, arrangementSize, linearSize, sizeAt, MAX_SCALE, PADDING_PX, type LinearSize } from './shortcutReferenceLayout'

const sizeAtOne = (lines: LinearSize[]) => lines.map((line) => sizeAt(line, 1))

// Cards measured at text scales 1 and 2: part of each length is fixed
// (spacing, borders), the rest grows with the text.
const sizes = [
  linearSize({ width: 200, height: 150 }, { width: 380, height: 280 }),
  linearSize({ width: 180, height: 90 }, { width: 340, height: 160 }),
  linearSize({ width: 220, height: 120 }, { width: 420, height: 220 }),
  linearSize({ width: 160, height: 200 }, { width: 300, height: 380 }),
]

// The second and fourth cards continue a panel (a small gap); the third opens a new one.
const gaps = { before: [0, 2, 8, 2], column: 8 }

describe('arrangeSections', () => {
  it('reads a straight line off two measurements', () => {
    const size = linearSize({ width: 200, height: 150 }, { width: 380, height: 280 })
    expect(sizeAt(size, 1)).toEqual({ width: 200, height: 150 })
    expect(sizeAt(size, 2)).toEqual({ width: 380, height: 280 })
    expect(sizeAt(size, 3)).toEqual({ width: 560, height: 410 })
  })

  it('keeps every section exactly once, in reading order', () => {
    for (const [w, h] of [[300, 1200], [1600, 300], [800, 600]]) {
      expect(arrangeSections(sizes, gaps, w, h).columns.flat()).toEqual([0, 1, 2, 3])
    }
  })

  it('stacks in a tall slot and spreads out in a wide one', () => {
    expect(arrangeSections(sizes, gaps, 300, 1200).columns).toHaveLength(1)
    expect(arrangeSections(sizes, gaps, 1600, 300).columns.length).toBeGreaterThan(2)
  })

  it('never solves a scale that overflows the slot, and leaves little room unused', () => {
    for (const [w, h] of [[300, 1200], [1600, 300], [800, 600], [1920, 1080]]) {
      const { columns, scale } = arrangeSections(sizes, gaps, w, h)
      const drawn = arrangementSize(sizes.map((size) => sizeAt(size, scale)), columns, gaps)
      expect(drawn.width).toBeLessThanOrEqual(w)
      expect(drawn.height).toBeLessThanOrEqual(h)
      // Either the text is at the sidebar's own size, or one dimension is
      // (within the rounding headroom) full.
      if (scale < MAX_SCALE) expect(Math.max(drawn.width / w, drawn.height / h)).toBeGreaterThan(0.97)
    }
  })

  it('spends a card\'s gap only when it shares a column with the card before it', () => {
    const flat = [0, 1, 2, 3].map(() => linearSize({ width: 100, height: 100 }, { width: 100, height: 100 }))
    expect(arrangementSize(sizeAtOne(flat), [[0, 1, 2, 3]], gaps).height).toBe(400 + 2 + 8 + 2 + PADDING_PX * 2)
    expect(arrangementSize(sizeAtOne(flat), [[0, 1], [2, 3]], gaps).height).toBe(200 + 2 + PADDING_PX * 2)
  })

  it('never draws the text larger than the sidebar does', () => {
    expect(arrangeSections(sizes, gaps, 100000, 100000).scale).toBe(MAX_SCALE)
  })

  it('draws nothing in a slot too small for any text', () => {
    expect(arrangeSections(sizes, gaps, 0, 0).scale).toBe(0)
  })
})

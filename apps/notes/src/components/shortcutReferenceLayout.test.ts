import { describe, expect, it } from 'vitest'
import { arrangeSections } from './shortcutReferenceLayout'

const sizes = [
  { width: 200, height: 150 },
  { width: 180, height: 90 },
  { width: 220, height: 120 },
  { width: 160, height: 200 },
]

describe('arrangeSections', () => {
  it('keeps every section exactly once, in reading order', () => {
    for (const [w, h] of [[300, 1200], [1600, 300], [800, 600]]) {
      expect(arrangeSections(sizes, w, h).columns.flat()).toEqual([0, 1, 2, 3])
    }
  })

  it('stacks in a tall slot and spreads out in a wide one', () => {
    expect(arrangeSections(sizes, 300, 1200).columns).toHaveLength(1)
    expect(arrangeSections(sizes, 1600, 300).columns.length).toBeGreaterThan(2)
  })

  it('never solves a size that overflows the slot', () => {
    for (const [w, h] of [[300, 1200], [1600, 300], [800, 600], [120, 90]]) {
      const { columns, fontPx } = arrangeSections(sizes, w, h)
      const scale = fontPx / 16
      const pad = 1.5 * 16 * 2
      const gap = 1.25 * 16
      const width = columns.reduce((sum, c) => sum + Math.max(...c.map((i) => sizes[i].width)), 0) + gap * (columns.length - 1) + pad
      const height = Math.max(...columns.map((c) => c.reduce((sum, i) => sum + sizes[i].height, 0) + gap * (c.length - 1))) + pad
      expect(width * scale).toBeLessThanOrEqual(w)
      expect(height * scale).toBeLessThanOrEqual(h)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { computeSectionWidthsForClose, computeSectionWidthsForNewSection, computeSlotWidthsPx } from './sectionWidths'

describe('computeSectionWidthsForNewSection', () => {
  it('splits the source section in half when it is larger than twice the minimum', () => {
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSection(
      [{ id: 'a', widthPx: 700 }, { id: 'b', widthPx: 500 }],
      'a',
      300,
      8,
    )
    expect(updatedWidths).toEqual([{ id: 'a', widthPx: 346 }, { id: 'b', widthPx: 500 }])
    expect(newSectionWidthPx).toBe(346)
  })

  it('gives the source section the odd px when an uneven split cannot be exact', () => {
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSection(
      [{ id: 'a', widthPx: 701 }, { id: 'b', widthPx: 500 }],
      'a',
      300,
      8,
    )
    expect(updatedWidths).toEqual([{ id: 'a', widthPx: 347 }, { id: 'b', widthPx: 500 }])
    expect(newSectionWidthPx).toBe(346)
  })

  it('falls back to minimal funding when the source is not large enough to split in half', () => {
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSection(
      [{ id: 'a', widthPx: 607 }, { id: 'b', widthPx: 500 }],
      'a',
      300,
      8,
    )
    expect(updatedWidths).toEqual([{ id: 'a', widthPx: 300 }, { id: 'b', widthPx: 499 }])
    expect(newSectionWidthPx).toBe(300)
  })

  it('cascades to other sections, capping any that would drop below minimum, per the worked example', () => {
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSection(
      [
        { id: 'source', widthPx: 500 },
        { id: 'a', widthPx: 310 },
        { id: 'b', widthPx: 400 },
        { id: 'c', widthPx: 600 },
      ],
      'source',
      300,
      8,
    )
    const byId = Object.fromEntries(updatedWidths.map((entry) => [entry.id, entry.widthPx]))
    expect(byId.source).toBe(300)
    expect(byId.a).toBe(300)
    expect(byId.b).toBe(360)
    expect(byId.c).toBe(540)
    // Total width conserved: whatever was taken from existing sections plus
    // the new divider equals exactly what the new section ends up with.
    const totalBefore = 500 + 310 + 400 + 600
    const totalAfter = byId.source + byId.a + byId.b + byId.c + newSectionWidthPx + 8
    expect(totalAfter).toBe(totalBefore)
    expect(newSectionWidthPx).toBeGreaterThanOrEqual(300)
  })

  it('never drops any existing section below the minimum width', () => {
    const { updatedWidths } = computeSectionWidthsForNewSection(
      [{ id: 'a', widthPx: 305 }, { id: 'b', widthPx: 305 }, { id: 'c', widthPx: 305 }],
      'a',
      300,
      8,
    )
    for (const entry of updatedWidths) {
      expect(entry.widthPx).toBeGreaterThanOrEqual(300)
    }
  })
})

describe('computeSectionWidthsForClose', () => {
  it('gives the closed section\'s entire width to its immediate left neighbor', () => {
    const result = computeSectionWidthsForClose(
      [{ id: 'a', widthPx: 400 }, { id: 'b', widthPx: 300 }, { id: 'c', widthPx: 500 }],
      'b',
    )
    expect(result).toEqual([{ id: 'a', widthPx: 700 }, { id: 'c', widthPx: 500 }])
  })

  it('leaves every other section untouched', () => {
    const result = computeSectionWidthsForClose(
      [{ id: 'a', widthPx: 400 }, { id: 'b', widthPx: 300 }, { id: 'c', widthPx: 500 }],
      'c',
    )
    expect(result).toEqual([{ id: 'a', widthPx: 400 }, { id: 'b', widthPx: 800 }])
  })
})

describe('computeSlotWidthsPx', () => {
  const sum = (widths: Map<string, number>) => [...widths.values()].reduce((total, value) => total + value, 0)

  it('splits proportionally by fraction, excluding fixed divider width from the pool', () => {
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: 0.75 }, { id: 'b', widthFraction: 0.25 }],
      1208,
      8,
      300,
    )
    expect(widths.get('a')).toBeCloseTo(900)
    expect(widths.get('b')).toBeCloseTo(300)
    expect(sum(widths)).toBeCloseTo(1200)
  })

  it('normalizes weights that do not sum to 1', () => {
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: 3 }, { id: 'b', widthFraction: 1 }],
      2008,
      8,
      300,
    )
    expect(widths.get('a')).toBeCloseTo(1500)
    expect(widths.get('b')).toBeCloseTo(500)
  })

  it('gives sections without a fraction the average of the known weights', () => {
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: 0.5 }, { id: 'b', widthFraction: 0.5 }, { id: 'c', widthFraction: null }],
      3016,
      8,
      300,
    )
    expect(widths.get('a')).toBeCloseTo(1000)
    expect(widths.get('b')).toBeCloseTo(1000)
    expect(widths.get('c')).toBeCloseTo(1000)
  })

  it('splits evenly when no section has a fraction', () => {
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: null }, { id: 'b', widthFraction: null }],
      1008,
      8,
      300,
    )
    expect(widths.get('a')).toBeCloseTo(500)
    expect(widths.get('b')).toBeCloseTo(500)
  })

  it('pins a section at the minimum and lets larger sections absorb the shrink', () => {
    // Proportional shares would be 175/525 -- 'a' bottoms out at 300 and 'b'
    // absorbs the rest, so nothing overflows the row.
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: 0.25 }, { id: 'b', widthFraction: 0.75 }],
      708,
      8,
      300,
    )
    expect(widths.get('a')).toBe(300)
    expect(widths.get('b')).toBeCloseTo(400)
    expect(sum(widths)).toBeCloseTo(700)
  })

  it('cascades pinning across passes as the row keeps shrinking', () => {
    const widths = computeSlotWidthsPx(
      [
        { id: 'a', widthFraction: 0.1 },
        { id: 'b', widthFraction: 0.2 },
        { id: 'c', widthFraction: 0.7 },
      ],
      966,
      8,
      300,
    )
    expect(widths.get('a')).toBe(300)
    expect(widths.get('b')).toBe(300)
    expect(widths.get('c')).toBeCloseTo(350)
    expect(sum(widths)).toBeCloseTo(950)
  })

  it('falls back to an equal below-minimum split instead of overflowing the row', () => {
    const widths = computeSlotWidthsPx(
      [{ id: 'a', widthFraction: 0.9 }, { id: 'b', widthFraction: 0.1 }],
      508,
      8,
      300,
    )
    expect(widths.get('a')).toBeCloseTo(250)
    expect(widths.get('b')).toBeCloseTo(250)
    expect(sum(widths)).toBeCloseTo(500)
  })

  it('always conserves the available width exactly', () => {
    for (const rowWidthPx of [508, 708, 966, 1208, 3016]) {
      const widths = computeSlotWidthsPx(
        [
          { id: 'a', widthFraction: 0.15 },
          { id: 'b', widthFraction: null },
          { id: 'c', widthFraction: 0.55 },
        ],
        rowWidthPx,
        8,
        300,
      )
      expect(sum(widths)).toBeCloseTo(rowWidthPx - 16)
    }
  })
})

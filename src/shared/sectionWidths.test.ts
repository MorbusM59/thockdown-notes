import { describe, expect, it } from 'vitest'
import { computeSectionWidthsForClose, computeSectionWidthsForNewSection } from './sectionWidths'

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

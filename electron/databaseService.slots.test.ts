import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { DEFAULT_EDITOR_SECTION_ID } from '../src/shared/sections'

/**
 * Slot geometry (docs/user-workflow-design.md §1.4): a slot is the
 * side-by-side container and owns the divider layout; a section is the tab
 * collection loaded into it and owns no width at all. These cover the cases
 * that used to need hand-written width-copying in App.tsx, plus the ones
 * where storing geometry on the section produced visibly wrong results.
 */
describe('DatabaseService editor slots', () => {
  let dataRoot: string
  let db: DatabaseService

  const positionOf = (id: string): number | null =>
    db.listEditorSections().find((entry) => entry.id === id)?.position ?? null

  const geometryAt = (position: number) => {
    const entry = db.listEditorSections().find((section) => section.position === position)
    return { widthFraction: entry?.widthFraction ?? null, fixedWidthPx: entry?.fixedWidthPx ?? null }
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-slots-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('keeps geometry with the slot when its occupant is swapped out', () => {
    db.createEditorSection('kept')
    const named = db.listEditorSections().find((entry) => entry.name === 'kept')!
    db.updateEditorSlotWidths([
      { position: 0, widthFraction: 0.75 },
      { position: 1, widthFraction: 0.25 },
    ])

    // Park the wide slot's occupant and recall the other section into it.
    db.closeSectionSlot(named.id)
    expect(positionOf(named.id)).toBeNull()

    db.createEditorSection('second')
    const second = db.listEditorSections().find((entry) => entry.name === 'second')!
    db.swapSectionIntoSlot(DEFAULT_EDITOR_SECTION_ID, second.id)

    // The pane is still 0.75 wide -- the width never belonged to whichever
    // section happened to be sitting in it.
    expect(positionOf(second.id)).toBe(0)
    expect(geometryAt(0).widthFraction).toBe(0.75)
  })

  it('reports no geometry for a parked section, rather than the width of the slot it left', () => {
    db.createEditorSection('kept')
    const named = db.listEditorSections().find((entry) => entry.name === 'kept')!
    db.updateEditorSlotWidths([{ position: 1, widthFraction: 0.4 }])
    db.updateEditorSlotFixedWidths([{ position: 1, fixedWidthPx: 320 }])

    db.closeSectionSlot(named.id)

    const parked = db.listEditorSections().find((entry) => entry.id === named.id)!
    expect(parked.position).toBeNull()
    expect(parked.widthFraction).toBeNull()
    expect(parked.fixedWidthPx).toBeNull()
  })

  it('slides the remaining slots down when one closes, so each surviving pane keeps its own geometry', () => {
    db.createEditorSection('b')
    db.createEditorSection('c')
    db.updateEditorSlotWidths([
      { position: 0, widthFraction: 0.2 },
      { position: 1, widthFraction: 0.3 },
      { position: 2, widthFraction: 0.5 },
    ])

    const middle = db.listEditorSections().find((entry) => entry.name === 'b')!
    db.closeSectionSlot(middle.id)

    // Slot 2's 0.5 slides into position 1 with its occupant, rather than
    // position 1 inheriting the closed slot's 0.3.
    expect(geometryAt(0).widthFraction).toBe(0.2)
    expect(geometryAt(1).widthFraction).toBe(0.5)
    expect(db.listEditorSections().filter((entry) => entry.position !== null)).toHaveLength(2)
  })

  it('leaves geometry in place when sections are reordered between slots', () => {
    db.createEditorSection('b')
    db.updateEditorSlotWidths([
      { position: 0, widthFraction: 0.8 },
      { position: 1, widthFraction: 0.2 },
    ])
    const other = db.listEditorSections().find((entry) => entry.name === 'b')!

    db.reorderEditorSections([other.id, DEFAULT_EDITOR_SECTION_ID])

    // Panes keep their shape; only their contents moved.
    expect(positionOf(other.id)).toBe(0)
    expect(geometryAt(0).widthFraction).toBe(0.8)
    expect(geometryAt(1).widthFraction).toBe(0.2)
  })

  it('reuses an existing empty slot when backfilling one a swap vacated, instead of opening another', () => {
    db.createEditorSection('b')
    db.createEditorSection('c')
    db.updateEditorSlotWidths([
      { position: 0, widthFraction: 0.2 },
      { position: 1, widthFraction: 0.3 },
      { position: 2, widthFraction: 0.5 },
    ])
    const third = db.listEditorSections().find((entry) => entry.name === 'c')!

    // Recall the rightmost section into slot 0, vacating slot 2...
    db.swapSectionIntoSlot(DEFAULT_EDITOR_SECTION_ID, third.id)
    // ...then backfill it the way App.tsx's handleSwapSection does.
    db.createEditorSection(null, 1)

    const occupied = db.listEditorSections().filter((entry) => entry.position !== null)
    expect(occupied).toHaveLength(3)
    expect(occupied.map((entry) => entry.position)).toEqual([0, 1, 2])
    // Every pane still has the width it had before the swap.
    expect(geometryAt(0).widthFraction).toBe(0.2)
    expect(geometryAt(1).widthFraction).toBe(0.3)
    expect(geometryAt(2).widthFraction).toBe(0.5)
  })

  it('survives a restart, reading geometry back from a fresh service instance', async () => {
    db.createEditorSection('b')
    db.updateEditorSlotWidths([
      { position: 0, widthFraction: 0.65 },
      { position: 1, widthFraction: 0.35 },
    ])
    db.updateEditorSlotFixedWidths([{ position: 1, fixedWidthPx: 300 }])
    db.close()

    const reopened = new DatabaseService(dataRoot)
    await reopened.initialize()
    try {
      const sections = reopened.listEditorSections()
      expect(sections.find((entry) => entry.position === 0)?.widthFraction).toBe(0.65)
      expect(sections.find((entry) => entry.position === 1)?.widthFraction).toBe(0.35)
      expect(sections.find((entry) => entry.position === 1)?.fixedWidthPx).toBe(300)
    } finally {
      reopened.close()
      db = reopened
    }
  })
})

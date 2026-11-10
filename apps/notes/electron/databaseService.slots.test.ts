// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { DatabaseService } from './databaseService'
import { DEFAULT_EDITOR_SECTION_ID } from '../src/shared/sections'
import { DARK_FACTORY_PRESETS, LIGHT_FACTORY_PRESETS } from '@thockdown/look/presets'
import { unsavedLoadoutEntry } from '@thockdown/look/loadouts'

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

  it('factory reset supports legacy tab schemas while preserving collections and pinned notes', async () => {
    const now = Date.now()
    for (const id of ['default-note', 'named-note', 'transient-note']) {
      db.upsertNoteContent({
        id,
        title: id,
        text: `# ${id}`,
        createdAtMs: now,
        updatedAtMs: now,
      })
    }

    db.createEditorSection('extra')
    const namedSection = db.listEditorSections().find((entry) => entry.name === 'extra')!
    const transientSection = db.createEditorSection().find((entry) => (
      entry.id !== DEFAULT_EDITOR_SECTION_ID && entry.name === null
    ))!
    db.addNoteTab(DEFAULT_EDITOR_SECTION_ID, 'default-note')
    db.addNoteTab(namedSection.id, 'named-note')
    db.addNoteTab(transientSection.id, 'transient-note')
    db.addNoteTab(transientSection.id, 'default-note')
    db.updatePendingUiLoadout('light', { ...LIGHT_FACTORY_PRESETS[0], borderRadiusRegularPx: 19 })

    db.close()
    const rawDb = new BetterSqlite3(path.join(dataRoot, 'thockdown-notes.db'))
    rawDb.pragma('foreign_keys = OFF')
    rawDb.exec(`
      DROP INDEX IF EXISTS idx_note_tabs_section_position;
      ALTER TABLE note_tabs RENAME TO note_tabs_with_id;
      CREATE TABLE note_tabs (
        sectionId TEXT NOT NULL,
        noteId TEXT NOT NULL,
        position INTEGER NOT NULL,
        addedAt INTEGER NOT NULL,
        lastActiveChapterNoteId TEXT REFERENCES notes(id) ON DELETE SET NULL,
        UNIQUE (sectionId, noteId),
        FOREIGN KEY (sectionId) REFERENCES editor_sections(id) ON DELETE CASCADE,
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
      );
      INSERT INTO note_tabs (sectionId, noteId, position, addedAt, lastActiveChapterNoteId)
      SELECT sectionId, noteId, position, addedAt, lastActiveChapterNoteId
      FROM note_tabs_with_id
      ORDER BY id;
      DROP TABLE note_tabs_with_id;
      CREATE INDEX idx_note_tabs_section_position ON note_tabs(sectionId, position);
    `)
    rawDb.close()

    db = new DatabaseService(dataRoot)
    await db.initialize()
    db.resetToFactoryDefaults()

    const sections = db.listEditorSections()
    expect(sections.find((entry) => entry.id === DEFAULT_EDITOR_SECTION_ID)).toMatchObject({
      name: null,
      position: 0,
      widthFraction: null,
      fixedWidthPx: null,
      lastActiveNoteId: null,
    })
    expect(sections.find((entry) => entry.id === namedSection.id)).toMatchObject({
      name: 'extra',
      position: null,
      widthFraction: null,
      fixedWidthPx: null,
      lastActiveNoteId: null,
    })
    expect(sections.some((entry) => entry.id === transientSection.id)).toBe(false)

    const tabs = db.listNoteTabs()
    expect(tabs.filter((tab) => tab.sectionId === DEFAULT_EDITOR_SECTION_ID).map((tab) => tab.noteId))
      .toEqual(['default-note', 'transient-note'])
    expect(tabs.find((tab) => tab.sectionId === namedSection.id)?.noteId).toBe('named-note')

    const loadouts = db.listUiLoadouts()
    expect(loadouts.entries.find((entry) => entry.id === 1)?.isActive).toBe(true)
    expect(loadouts.entries.find((entry) => entry.id === 1)?.payload).toEqual(LIGHT_FACTORY_PRESETS[0])
    expect(loadouts.entries.some((entry) => Math.abs(entry.id) === 6)).toBe(false)
    expect(unsavedLoadoutEntry(loadouts.entries, 'light')).toBeNull()
    expect(loadouts.entries.find((entry) => entry.id === 7)?.isActive).toBe(false)
    expect(loadouts.entries.find((entry) => entry.id === -1)?.isActive).toBe(true)
    expect(loadouts.entries.find((entry) => entry.id === -1)?.payload).toEqual(DARK_FACTORY_PRESETS[0])
  })

  it('keeps the unsaved changes as their own preset until they are saved', () => {
    const edited = { ...LIGHT_FACTORY_PRESETS[0], borderRadiusRegularPx: 19, filterContrast: 1.9 }
    const shown = () => unsavedLoadoutEntry(db.listUiLoadouts().entries, 'light')
    const active = () => db.listUiLoadouts().entries.find((entry) => entry.id > 0 && entry.isActive)!.id

    expect(shown()).toBeNull()
    db.updatePendingUiLoadout('light', edited)
    expect(shown()?.payload).toEqual(edited)
    expect(active()).toBe(7)

    // Trying another preset keeps them, and they can be selected again.
    db.setActiveUiLoadout(2)
    expect(shown()?.payload).toEqual(edited)
    db.setActiveUiLoadout(7)
    expect(active()).toBe(7)

    // Editing back to a preset: that preset is active and nothing is unsaved.
    db.updatePendingUiLoadout('light', LIGHT_FACTORY_PRESETS[2])
    expect(active()).toBe(3)
    expect(shown()).toBeNull()

    // Saving takes the plus's place, active, and the plus goes.
    db.updatePendingUiLoadout('light', edited)
    db.saveCustomUiLoadout('light')
    expect(active()).toBe(8)
    expect(shown()).toBeNull()
    // Nothing unsaved: a second save adds nothing.
    db.saveCustomUiLoadout('light')
    expect(db.listUiLoadouts().entries.filter((entry) => entry.id >= 8)).toHaveLength(1)

    // Deleting the layout on screen keeps the screen: it becomes unsaved.
    db.deleteCustomUiLoadout(8)
    expect(active()).toBe(7)
    expect(shown()?.payload).toEqual(edited)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'

function upsert(db: DatabaseService, id: string, cursorPos?: number | null): void {
  const now = Date.now()
  db.upsertNoteContent({ id, title: id, text: 'some text', createdAtMs: now, updatedAtMs: now, cursorPos })
}

// "No caret recorded" is a state of its own, not position 0: a note that has
// none opens at its end (EditRestoreMath's buildEditRestoreSnapshotFromUiState),
// and that rule can only apply if the store hands the absence back.
describe("a note's stored caret", () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-caret-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close?.()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('is null for a note that never recorded one, and stays null across a restart', async () => {
    upsert(db, 'fresh')
    expect(db.getNoteUiState('fresh').cursorPos).toBeNull()

    db.close?.()
    db = new DatabaseService(dataRoot)
    await db.initialize()
    expect(db.getNoteUiState('fresh').cursorPos).toBeNull()
  })

  it('is kept by a save that does not carry one, and replaced by one that does, including by 0', () => {
    upsert(db, 'n', 12)
    upsert(db, 'n')
    expect(db.getNoteUiState('n').cursorPos).toBe(12)
    db.saveNoteUiState('n', { anchorBlockIndex: 3 })
    expect(db.getNoteUiState('n').cursorPos).toBe(12)
    db.saveNoteUiState('n', { cursorPos: 0 })
    expect(db.getNoteUiState('n').cursorPos).toBe(0)
  })
})

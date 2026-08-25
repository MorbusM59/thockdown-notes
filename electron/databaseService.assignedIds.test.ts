import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { isAutoAssignedId } from '../src/shared/assignedIds'

/**
 * The transition off the pre-provisional-id system: every real note carries an
 * id, provisional ids are recognised by their shape alone, and no path invents
 * a title-derived one any more.
 */
/** Puts a note back into the pre-provisional-id state the legacy data has. */
function clearAssignedId(db: DatabaseService, noteId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (db as any).requireDb() as { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
  raw.prepare('UPDATE notes SET assignedId = NULL WHERE id = ?').run(noteId)
}

describe('DatabaseService assigned ids', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-ids-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('backfills a legacy note that has no id at all, without touching one that has a real id', async () => {
    const legacy = await lifecycle.createNote({ initialText: '# Legacy note' })
    const named = await lifecycle.createNote({ initialText: '# Named note' })
    db.setNoteAssignedId(named.id, 'REALID')
    // Simulate the pre-feature state: an id-less note.
    clearAssignedId(db, legacy.id)

    const { backfilledNoteIds } = db.sanitizeDatabase()

    // >= 1 rather than == 1: a fresh database also seeds the welcome note,
    // which predates ids being assigned at birth and is itself backfilled here
    // -- exactly the legacy case this pass exists for.
    expect(backfilledNoteIds).toBeGreaterThanOrEqual(1)
    expect(isAutoAssignedId(db.getNoteRecord(legacy.id)!.assignedId)).toBe(true)
    expect(db.getNoteRecord(named.id)!.assignedId).toBe('REALID')
  })

  it('is idempotent -- a second sanitation pass backfills nothing', async () => {
    const legacy = await lifecycle.createNote({ initialText: '# Legacy note' })
    clearAssignedId(db, legacy.id)

    expect(db.sanitizeDatabase().backfilledNoteIds).toBeGreaterThanOrEqual(1)
    expect(db.sanitizeDatabase().backfilledNoteIds).toBe(0)
  })

  it('never gives a chapter an id -- chapters have no tab identity and must not consume NOTE-#n numbers', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Parent' })
    const chapter = await lifecycle.createChapterNote(parent.id)

    db.sanitizeDatabase()

    expect(db.getNoteRecord(chapter.id)!.assignedId).toBeNull()
    expect(isAutoAssignedId(db.getNoteRecord(parent.id)!.assignedId)).toBe(true)
  })

  it('hands an emptied id back as a provisional one, never as a title-derived one', async () => {
    const note = await lifecycle.createNote({ initialText: '# My Important Recipe' })
    db.setNoteAssignedId(note.id, 'CHOSEN')
    expect(db.getNoteRecord(note.id)!.assignedId).toBe('CHOSEN')

    const cleared = db.setNoteAssignedId(note.id, '')

    // The legacy behaviour derived "MY-IMPOR" from the title here.
    expect(isAutoAssignedId(cleared)).toBe(true)
    expect(cleared).not.toContain('MY')
  })

  it('backfills each id-less note with a distinct number', async () => {
    const first = await lifecycle.createNote({ initialText: '# One' })
    const second = await lifecycle.createNote({ initialText: '# Two' })
    clearAssignedId(db, first.id)
    clearAssignedId(db, second.id)

    db.sanitizeDatabase()

    const firstId = db.getNoteRecord(first.id)!.assignedId
    const secondId = db.getNoteRecord(second.id)!.assignedId
    expect(isAutoAssignedId(firstId)).toBe(true)
    expect(isAutoAssignedId(secondId)).toBe(true)
    expect(firstId).not.toBe(secondId)
  })
})

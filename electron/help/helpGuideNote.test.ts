import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from '../databaseService'
import { NoteLifecycleService } from '../noteLifecycleService'
import { HELP_GUIDE_NOTE_IDS } from '../../src/shared/helpGuide'
import { ensureHelpNote } from './helpNote'
import { ensureHelpGuide } from './helpGuideNote'
import { HELP_GUIDE_ROOT_ID, HELP_GUIDE_CHAPTERS } from './helpGuideContent'

describe('ensureHelpGuide', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-helpguide-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('creates the welcome note when only the built-in User Guide family is present', async () => {
    // Fresh DBs already get the welcome note seeded during initialization, so
    // remove that seeded row and then simulate the real startup state: guide
    // family present, no real user note yet.
    const raw = (db as any).requireDb() as { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }
    raw.prepare('DELETE FROM notes WHERE id = ?').run('26-07-04_00-00_WELCOME00')
    raw.prepare('DELETE FROM notes_fts WHERE noteId = ?').run('26-07-04_00-00_WELCOME00')

    await ensureHelpGuide(db, lifecycle)

    const guideOnlyNotes = db.listNoteRecords().filter((note) => !HELP_GUIDE_NOTE_IDS.has(note.id))
    expect(guideOnlyNotes).toHaveLength(0)

    await ensureHelpNote(db)

    const realNotes = db.listNoteRecords().filter((note) => !HELP_GUIDE_NOTE_IDS.has(note.id))
    expect(realNotes).toHaveLength(1)
    expect(realNotes[0]?.title).toBe('Welcome to Thockdown Notes')
  })

  it('leaves the whole guide family timeless after seeding, with every real chapter linked', async () => {
    await ensureHelpGuide(db, lifecycle)

    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
    for (const chapter of HELP_GUIDE_CHAPTERS) {
      expect(db.getNoteRecord(chapter.noteId)?.isTimeless).toBe(true)
    }
    const autoTocId = db.getAutoTocChapterNoteId(HELP_GUIDE_ROOT_ID)
    expect(autoTocId).not.toBeNull()
    expect(db.getNoteRecord(autoTocId!)?.isTimeless).toBe(true)
  })

  it('re-running seeding against an already-frozen guide (every real startup) does not throw, and leaves it frozen', async () => {
    await ensureHelpGuide(db, lifecycle)
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)

    await expect(ensureHelpGuide(db, lifecycle)).resolves.not.toThrow()

    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
    for (const chapter of HELP_GUIDE_CHAPTERS) {
      expect(db.getNoteRecord(chapter.noteId)?.isTimeless).toBe(true)
    }
  })

  it('a real edit attempt against the seeded (frozen) guide root is rejected -- it stays protected between reseeds, not just during them', async () => {
    await ensureHelpGuide(db, lifecycle)

    expect(() => db.upsertNoteContent({
      id: HELP_GUIDE_ROOT_ID,
      title: 'tampered',
      filePath: '/tmp/tampered.md',
      text: 'tampered',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    })).toThrow()
  })

  it('skips the whole reseed (no unfreeze, no writes) on a second call once the content hash already matches', async () => {
    await ensureHelpGuide(db, lifecycle)

    const upsertSpy = vi.spyOn(db, 'upsertNoteContent')
    const unfreezeSpy = vi.spyOn(db, 'unfreezeNoteFamily')

    await ensureHelpGuide(db, lifecycle)

    expect(unfreezeSpy).not.toHaveBeenCalled()
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
  })

  it('reseeds again if the stored hash is missing or stale, even though the guide is already frozen', async () => {
    await ensureHelpGuide(db, lifecycle)
    db.setAppMeta('helpGuideContentHash', 'stale-hash-from-an-older-build')

    const upsertSpy = vi.spyOn(db, 'upsertNoteContent')

    await ensureHelpGuide(db, lifecycle)

    expect(upsertSpy).toHaveBeenCalled()
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { HELP_GUIDE_CHAPTER_IDS, HELP_GUIDE_ROOT_ID, isSealedNoteId } from '../src/shared/helpGuide'
import { ensureHelpGuide } from './help/helpGuideNote'

/**
 * The User Guide is SEALED: frozen like any timeless note, but with the
 * unfreeze permanently unreachable, which is what makes it genuinely
 * read-only rather than read-only-until-someone-clicks-the-toggle.
 */
describe('sealed documents', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-sealed-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
    // The guide is seeded by main.ts at startup, not by DatabaseService
    // itself -- a bare temp database has no guide to seal.
    await ensureHelpGuide(db, lifecycle)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('refuses to unfreeze the User Guide even when the request comes straight from the service', async () => {
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)

    await lifecycle.setNoteTimeless({ id: HELP_GUIDE_ROOT_ID, value: false })

    // Still frozen. The renderer's disabled button is presentation; this is
    // the actual rule, and it holds regardless of what the renderer sends.
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
  })

  it('leaves the guide unwritable after an attempted unfreeze', async () => {
    await lifecycle.setNoteTimeless({ id: HELP_GUIDE_ROOT_ID, value: false })

    await expect(lifecycle.saveNote({ id: HELP_GUIDE_ROOT_ID, text: 'vandalised' })).rejects.toThrow()
  })

  it('still lets an ordinary note be frozen and unfrozen at will', async () => {
    const note = await lifecycle.createNote({ initialText: '# Ordinary' })

    await lifecycle.setNoteTimeless({ id: note.id, value: true })
    expect(db.getNoteRecord(note.id)?.isTimeless).toBe(true)

    await lifecycle.setNoteTimeless({ id: note.id, value: false })
    expect(db.getNoteRecord(note.id)?.isTimeless).toBe(false)
  })

  it('re-seals a guide that was left unfrozen -- the state a database can be in from before the seal existed', async () => {
    // Reach the stuck state the honest way: unfreeze through the database's
    // own primitive, which is what the pre-seal UI effectively did.
    db.unfreezeNoteFamily(HELP_GUIDE_ROOT_ID)
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(false)

    const { resealedFamilies } = db.sanitizeDatabase()

    expect(resealedFamilies).toBe(1)
    expect(db.getNoteRecord(HELP_GUIDE_ROOT_ID)?.isTimeless).toBe(true)
    // And it stays sealed: a second pass has nothing to repair.
    expect(db.sanitizeDatabase().resealedFamilies).toBe(0)
  })

  it('seals every chapter of the guide, not just its root', () => {
    expect(isSealedNoteId(HELP_GUIDE_ROOT_ID)).toBe(true)
    for (const chapter of HELP_GUIDE_CHAPTER_IDS) {
      expect(isSealedNoteId(chapter.noteId)).toBe(true)
    }
    expect(isSealedNoteId('26-08-24_23-50_ORDINARY')).toBe(false)
    expect(isSealedNoteId(null)).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

// Regression coverage for a real crash report: "FOREIGN KEY constraint
// failed" thrown out of DatabaseService.addChapter, from inside
// NoteLifecycleService.createAutoTocChapter. Root cause: every chapter-
// creation path is createNote() (which awaits at least once internally --
// ensureNotesDir/fs.writeFile/fs.stat) followed by a synchronous link into
// the parent's chapter list -- if the parent note is deleted (or never
// existed) by the time the link step runs, the raw SQLite FK error was
// thrown straight out of an IPC handler, and the note createNote() had
// already created was silently left behind as a permanent orphan (a `notes`
// row and a file on disk nothing would ever clean up). These tests exercise
// every call site with that exact shape against a parent that doesn't
// exist, and assert both a clean, catchable error AND no orphaned note.
describe('NoteLifecycleService chapter-creation cleanup on a missing parent', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-chaptercreate-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('createChapterNote against a nonexistent parent throws cleanly and leaves no orphan note behind', async () => {
    const before = db.listNoteRecords().length
    await expect(lifecycle.createChapterNote('does-not-exist')).rejects.toThrow(/not found/)
    expect(db.listNoteRecords().length).toBe(before)
  })

  it('createAutoTocChapter against a nonexistent parent throws cleanly and leaves no orphan note behind', async () => {
    const before = db.listNoteRecords().length
    await expect(lifecycle.createAutoTocChapter('does-not-exist')).rejects.toThrow(/not found/)
    expect(db.listNoteRecords().length).toBe(before)
  })

  it('cloneNoteAsChapter against a nonexistent parent throws cleanly and leaves no orphan note behind', async () => {
    const source = await lifecycle.createNote({ initialText: '# Source\n\nBody.' })
    const before = db.listNoteRecords().length
    await expect(lifecycle.cloneNoteAsChapter('does-not-exist', source.id)).rejects.toThrow(/not found/)
    expect(db.listNoteRecords().length).toBe(before)
  })

  // The fourth call site sharing this exact shape -- the lazy auto-Open-Items
  // chapter creation inside the private regenerateOpenItemsGroup -- isn't
  // separately exercised here: it's only reachable through saveNote's own
  // checklist-diff hook, and it's gated by getAutoTocChapterNoteId(parentNoteId)
  // being truthy *before* it ever reaches the vulnerable create-then-link
  // step, which a simple "parent already gone" test can't get past (chapters
  // cascade-delete with their parent, so that precondition is false the
  // instant the parent is). It wires through the exact same
  // linkChapterOrCleanUp helper the three tests above already cover, so its
  // correctness rides on theirs.
})

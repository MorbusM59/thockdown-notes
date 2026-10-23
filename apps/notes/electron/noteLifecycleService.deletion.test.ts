import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

// A view of a note in the renderer can outlive the note: its last save may
// still be on its way when another view deletes it. The service announces
// the deletion so open views let go, and refuses a save of a note that no
// longer exists rather than writing a row back into being.
describe('NoteLifecycleService deletion', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService
  let deleted: string[]

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-deletion-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    deleted = []
    lifecycle = new NoteLifecycleService(db, { onNoteDeleted: (id) => deleted.push(id) })
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('announces a deleted note and its chapters, once each, and nothing for a note that did not exist', async () => {
    const note = await lifecycle.createNote({ initialText: 'gone soon' })
    const chapterIds = db.listChaptersForNote(note.id).map((chapter) => chapter.chapterNoteId)
    await lifecycle.deleteNote({ id: note.id })
    await lifecycle.deleteNote({ id: note.id })
    await lifecycle.deleteNote({ id: 'never-existed' })
    expect([...deleted].sort()).toEqual([note.id, ...chapterIds].sort())
  })

  it('refuses a save that arrives after the note was deleted', async () => {
    const note = await lifecycle.createNote({ initialText: 'gone soon' })
    await lifecycle.deleteNote({ id: note.id })
    await expect(lifecycle.saveNote({ id: note.id, text: 'late typing' })).rejects.toThrow(/does not exist/)
    expect(db.getNoteRecord(note.id)).toBeFalsy()
  })
})

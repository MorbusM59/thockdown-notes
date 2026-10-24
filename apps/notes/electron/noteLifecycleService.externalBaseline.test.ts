import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

// An external note is clean exactly when its text equals the newest record of
// its file. The note's text is stored sanitized, so the record must be too,
// or a file holding something the note cannot (an HTML tag, a tab) would read
// as edited from the moment it was opened.
describe('NoteLifecycleService external baseline', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-baseline-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('stores a from-disk record in the form the note text is stored in, so the note is clean against it', async () => {
    const fileText = '# File\n\nline<br>\n\tindented\n'
    const note = await lifecycle.createNote({ initialText: fileText, externalPath: path.join(dataRoot, 'file.md') })
    await lifecycle.saveNoteSnapshot({ id: note.id, content: fileText, isManual: true, isFromDisk: true })
    const loaded = await lifecycle.loadNote({ id: note.id })
    expect((await lifecycle.getFromDiskBaseline({ id: note.id }))?.content).toBe(loaded.text)
    const saved = await lifecycle.saveNote({ id: note.id, text: loaded.text })
    expect(saved.hasUnsavedChanges).toBe(false)
  })
})

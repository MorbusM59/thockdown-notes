import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

// A note whose .md file goes missing must survive a restart, be listed as
// missing rather than vanish, and be recoverable -- this used to be a silent
// purge of the entry and the database's copy of its text together.
describe('a note whose file is missing', () => {
  let dataRoot: string
  let db: DatabaseService
  let notes: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-missing-file-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    notes = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  async function createWithText(text: string) {
    const created = await notes.createNote({ initialText: text })
    await notes.saveNote({ id: created.id, text })
    const filePath = db.getNoteRecord(created.id)!.filePath
    return { id: created.id, filePath }
  }

  async function restart(): Promise<void> {
    await db.bootstrapFromFilesystem()
  }

  it('keeps the entry and its text across a restart, and lists it as missing', async () => {
    const { id, filePath } = await createWithText('# Kept\n\nbody')
    unlinkSync(filePath)
    await restart()

    expect(db.getNoteRecord(id)).not.toBeNull()
    const listed = (await notes.listNotes()).find((note) => note.id === id)
    expect(listed?.missingFile).toEqual({ hasStoredCopy: true })
    expect(listed?.contentText).toBe('# Kept\n\nbody')
  })

  it('restores the file from the stored copy, after which it is no longer missing', async () => {
    const { id, filePath } = await createWithText('# Restored\n\nbody')
    unlinkSync(filePath)
    await restart()

    await notes.restoreMissingNoteFile({ id })

    expect(readFileSync(filePath, 'utf8')).toBe('# Restored\n\nbody')
    const listed = (await notes.listNotes()).find((note) => note.id === id)
    expect(listed?.missingFile).toBeUndefined()
    expect((await notes.loadNote({ id })).text).toBe('# Restored\n\nbody')
  })

  it('restores the missing files of its chapters with it', async () => {
    const { id, filePath } = await createWithText('# Parent')
    const chapter = await notes.createChapterNote(id)
    await notes.saveNote({ id: chapter.id, text: '## Chapter' })
    const chapterPath = db.getNoteRecord(chapter.id)!.filePath
    unlinkSync(filePath)
    unlinkSync(chapterPath)
    await restart()

    await notes.restoreMissingNoteFile({ id })

    expect(readFileSync(chapterPath, 'utf8')).toBe('## Chapter')
  })

  it('copies a specified file into the notes folder and leaves the original alone', async () => {
    const { id, filePath } = await createWithText('# Old')
    unlinkSync(filePath)
    await restart()
    const source = path.join(dataRoot, 'elsewhere.md')
    writeFileSync(source, '# From elsewhere', 'utf8')

    await notes.adoptFileForMissingNote({ id }, source)

    expect(readFileSync(filePath, 'utf8')).toBe('# From elsewhere')
    expect(readFileSync(source, 'utf8')).toBe('# From elsewhere')
    expect((await notes.loadNote({ id })).text).toBe('# From elsewhere')
  })

  it('never writes over a file that is present', async () => {
    const { id } = await createWithText('# Present')
    const source = path.join(dataRoot, 'elsewhere.md')
    writeFileSync(source, '# Intruder', 'utf8')

    await expect(notes.adoptFileForMissingNote({ id }, source)).rejects.toThrow()
    expect((await notes.loadNote({ id })).text).toBe('# Present')
  })

  it('is deleted by removing its entry', async () => {
    const { id, filePath } = await createWithText('# Doomed')
    unlinkSync(filePath)
    await restart()

    await notes.deleteNote({ id })

    expect(db.getNoteRecord(id)).toBeNull()
    expect(existsSync(filePath)).toBe(false)
  })
})

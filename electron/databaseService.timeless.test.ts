import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'

function seedNote(db: DatabaseService, id: string): void {
  const now = Date.now()
  db.upsertNoteContent({
    id,
    title: id,
    filePath: `/tmp/${id}.md`,
    text: `# ${id}`,
    createdAtMs: now,
    updatedAtMs: now,
  })
}

describe('DatabaseService timeless notes', () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-timeless-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('freezeNoteFamily stamps isTimeless on the root and every chapter, and clears each one\'s snapshot history', () => {
    seedNote(db, 'root')
    seedNote(db, 'chapter-1')
    seedNote(db, 'chapter-2')
    db.addChapter('root', 'chapter-1')
    db.addChapter('root', 'chapter-2')
    db.saveNoteSnapshot('root', 'root v1', true)
    db.saveNoteSnapshot('chapter-1', 'chapter-1 v1', true)
    expect(db.getNoteSnapshots('root')).toHaveLength(1)
    expect(db.getNoteSnapshots('chapter-1')).toHaveLength(1)

    db.freezeNoteFamily('root')

    expect(db.getNoteRecord('root')?.isTimeless).toBe(true)
    expect(db.getNoteRecord('chapter-1')?.isTimeless).toBe(true)
    expect(db.getNoteRecord('chapter-2')?.isTimeless).toBe(true)
    expect(db.getNoteSnapshots('root')).toHaveLength(0)
    expect(db.getNoteSnapshots('chapter-1')).toHaveLength(0)
  })

  it('unfreezeNoteFamily clears isTimeless on the root and every chapter, without restoring any history', () => {
    seedNote(db, 'root')
    seedNote(db, 'chapter-1')
    db.addChapter('root', 'chapter-1')
    db.freezeNoteFamily('root')

    db.unfreezeNoteFamily('root')

    expect(db.getNoteRecord('root')?.isTimeless).toBe(false)
    expect(db.getNoteRecord('chapter-1')?.isTimeless).toBe(false)
    expect(db.getNoteSnapshots('root')).toHaveLength(0)
  })

  it('a timeless note rejects every content/tag/chapter/snapshot mutation until unfrozen -- real database-layer protection, not just a UI guard', () => {
    seedNote(db, 'root')
    seedNote(db, 'chapter-1')
    seedNote(db, 'outsider')
    db.addChapter('root', 'chapter-1')
    db.freezeNoteFamily('root')

    expect(() => db.upsertNoteContent({
      id: 'root',
      title: 'root',
      filePath: '/tmp/root.md',
      text: '# edited',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    })).toThrow()
    expect(() => db.setNoteAssignedId('root', 'NEWID')).toThrow()
    expect(() => db.addTagToNote('root', 'my-tag', 0)).toThrow()
    expect(() => db.saveNoteSnapshot('root', 'new snapshot', true)).toThrow()
    expect(() => db.deleteNote('root')).toThrow()
    expect(() => db.addChapter('root', 'outsider')).toThrow()
    expect(() => db.setChapterId('root', 'chapter-1', 'INTRO')).toThrow()
    expect(() => db.removeChapter('root', 'chapter-1')).toThrow()
    expect(() => db.reorderChapters('root', ['chapter-1'])).toThrow()

    // A/B: the same mutation succeeds once unfrozen -- proves the guard, not
    // some unrelated failure, is what rejected it above.
    db.unfreezeNoteFamily('root')
    expect(() => db.setNoteAssignedId('root', 'NEWID')).not.toThrow()
    expect(db.getNoteRecord('root')?.assignedId).toBe('NEWID')
  })

  it('the outsider note being linked as a new chapter is itself unaffected by the parent\'s freeze -- only the frozen note\'s own row is guarded', () => {
    seedNote(db, 'root')
    seedNote(db, 'outsider')
    db.freezeNoteFamily('root')

    // Mutating the (non-timeless) outsider note directly still works.
    expect(() => db.setNoteAssignedId('outsider', 'FREE')).not.toThrow()
  })
})

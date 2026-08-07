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

describe('DatabaseService chapters', () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-chapters-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('lets the same note be a chapter of any number of different parents (e.g. a shared reference card)', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'parent-b')
    seedNote(db, 'reference-card')

    db.addChapter('parent-a', 'reference-card')
    db.addChapter('parent-b', 'reference-card')

    const chaptersOfA = db.listChaptersForNote('parent-a')
    const chaptersOfB = db.listChaptersForNote('parent-b')

    expect(chaptersOfA.map((c) => c.chapterNoteId)).toEqual(['reference-card'])
    expect(chaptersOfB.map((c) => c.chapterNoteId)).toEqual(['reference-card'])
  })

  it('keeps each parent-chapter relationship independent -- removing from one parent leaves the other untouched', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'parent-b')
    seedNote(db, 'reference-card')

    db.addChapter('parent-a', 'reference-card')
    db.addChapter('parent-b', 'reference-card')

    db.removeChapter('parent-a', 'reference-card')

    expect(db.listChaptersForNote('parent-a').map((c) => c.chapterNoteId)).toEqual([])
    expect(db.listChaptersForNote('parent-b').map((c) => c.chapterNoteId)).toEqual(['reference-card'])
  })

  it('maintains gapless positions per parent independently of the same chapter appearing elsewhere', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'chapter-2')
    seedNote(db, 'chapter-3')

    db.addChapter('parent-a', 'chapter-1')
    db.addChapter('parent-a', 'chapter-2')
    db.addChapter('parent-a', 'chapter-3')

    db.removeChapter('parent-a', 'chapter-2')

    const remaining = db.listChaptersForNote('parent-a')
    expect(remaining.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-3'])
    expect(remaining.map((c) => c.position)).toEqual([0, 1])
  })

  it('still rejects a note being a chapter of itself', () => {
    seedNote(db, 'note-a')
    expect(() => db.addChapter('note-a', 'note-a')).toThrow()
  })

  it('rejects adding the same chapter to the same parent twice', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')

    db.addChapter('parent-a', 'chapter-1')
    expect(() => db.addChapter('parent-a', 'chapter-1')).toThrow()
  })
})

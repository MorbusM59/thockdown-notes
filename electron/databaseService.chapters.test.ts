import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
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

  describe('setChapterId', () => {
    it('assigns and normalizes a chapterId, defaulting to unassigned (null)', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      db.addChapter('parent-a', 'chapter-1')

      expect(db.listChaptersForNote('parent-a')[0].chapterId).toBeNull()

      const resolved = db.setChapterId('parent-a', 'chapter-1', 'intro chapter')
      expect(resolved).toBe('INTRO-CHAPTER')
      expect(db.listChaptersForNote('parent-a')[0].chapterId).toBe('INTRO-CHAPTER')
    })

    it('clears a chapterId back to unassigned given an empty string', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      db.addChapter('parent-a', 'chapter-1')
      db.setChapterId('parent-a', 'chapter-1', 'INTRO')

      const resolved = db.setChapterId('parent-a', 'chapter-1', '   ')
      expect(resolved).toBeNull()
      expect(db.listChaptersForNote('parent-a')[0].chapterId).toBeNull()
    })

    it('dedupes chapterId collisions within the same parent with a "-2" suffix', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      db.addChapter('parent-a', 'chapter-1')
      db.addChapter('parent-a', 'chapter-2')

      db.setChapterId('parent-a', 'chapter-1', 'INTRO')
      const resolved = db.setChapterId('parent-a', 'chapter-2', 'INTRO')
      expect(resolved).toBe('INTRO-2')
    })

    it('scopes chapterId uniqueness per parent -- the same id is reusable across different parents', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'parent-b')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      db.addChapter('parent-a', 'chapter-1')
      db.addChapter('parent-b', 'chapter-2')

      db.setChapterId('parent-a', 'chapter-1', 'INTRO')
      const resolved = db.setChapterId('parent-b', 'chapter-2', 'INTRO')
      expect(resolved).toBe('INTRO')
    })

    it('lets a chapter keep its own current chapterId unchanged without colliding with itself', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      db.addChapter('parent-a', 'chapter-1')
      db.setChapterId('parent-a', 'chapter-1', 'INTRO')

      const resolved = db.setChapterId('parent-a', 'chapter-1', 'INTRO')
      expect(resolved).toBe('INTRO')
    })
  })
})

describe('DatabaseService startup on a pre-chapterId database', () => {
  // Reproduces the real bug: a database created between the `chapters` table
  // first shipping and the `chapterId` column being added to it later has a
  // `chapters` table missing that column. CREATE TABLE IF NOT EXISTS is a
  // no-op against it, so an index referencing chapterId placed in that same
  // exec block (rather than after ensureChaptersColumn's migration) throws
  // "no such column: chapterId" and aborts ensureSchema -- and with it,
  // DatabaseService.initialize() -- crashing the whole app on startup.
  let dataRoot: string

  beforeEach(() => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-chapters-upgrade-test-'))
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('initializes cleanly against a chapters table that predates the chapterId column, backfilling it via migration', async () => {
    const rawDb = new BetterSqlite3(path.join(dataRoot, 'thockdown-notes.db'))
    rawDb.pragma('foreign_keys = ON')
    rawDb.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filePath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastEdited TEXT,
        progressPreview REAL,
        progressEdit REAL,
        cursorPos INTEGER,
        scrollTop INTEGER,
        sourceAnchorLine INTEGER,
        sourceAnchorText TEXT,
        contentChecksum TEXT,
        isTemp INTEGER DEFAULT 0,
        externalPath TEXT,
        hasUnsavedChanges INTEGER DEFAULT 0,
        syncMode INTEGER DEFAULT 0,
        originalEncoding TEXT,
        fileToken TEXT UNIQUE,
        previewBlockCache TEXT
      );

      CREATE TABLE chapters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        parentNoteId  TEXT    NOT NULL,
        position      INTEGER NOT NULL,
        chapterNoteId TEXT    NOT NULL,
        UNIQUE (parentNoteId, chapterNoteId),
        CHECK (parentNoteId != chapterNoteId),
        FOREIGN KEY (parentNoteId)  REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (chapterNoteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_chapters_parent_position ON chapters(parentNoteId, position);
    `)
    rawDb.close()

    const upgradedDb = new DatabaseService(dataRoot)
    await expect(upgradedDb.initialize()).resolves.not.toThrow()

    seedNote(upgradedDb, 'parent-a')
    seedNote(upgradedDb, 'chapter-1')
    upgradedDb.addChapter('parent-a', 'chapter-1')

    const chapters = upgradedDb.listChaptersForNote('parent-a')
    expect(chapters).toEqual([{ parentNoteId: 'parent-a', position: 0, chapterNoteId: 'chapter-1', chapterId: null }])

    const resolved = upgradedDb.setChapterId('parent-a', 'chapter-1', 'INTRO')
    expect(resolved).toBe('INTRO')
  })
})

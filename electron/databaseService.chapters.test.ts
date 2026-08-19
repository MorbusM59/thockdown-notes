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
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('rejects a note becoming a chapter of a second parent -- a chapter belongs to at most one parent, ever', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'parent-b')
    seedNote(db, 'shared-note')

    db.addChapter('parent-a', 'shared-note')
    expect(() => db.addChapter('parent-b', 'shared-note')).toThrow()

    expect(db.listChaptersForNote('parent-a').map((c) => c.chapterNoteId)).toEqual(['shared-note'])
    expect(db.listChaptersForNote('parent-b').map((c) => c.chapterNoteId)).toEqual([])
  })

  it('getChapterParent resolves a chapter note to its single parent, or null if it isn\'t a chapter', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'standalone')

    db.addChapter('parent-a', 'chapter-1')

    expect(db.getChapterParent('chapter-1')).toBe('parent-a')
    expect(db.getChapterParent('standalone')).toBeNull()
  })

  it('re-attaching a chapter to a new parent after detaching from the old one is allowed', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'parent-b')
    seedNote(db, 'chapter-1')

    db.addChapter('parent-a', 'chapter-1')
    db.removeChapter('parent-a', 'chapter-1')
    db.addChapter('parent-b', 'chapter-1')

    expect(db.getChapterParent('chapter-1')).toBe('parent-b')
  })

  // Regression: migrateChapterTagsToParent (private, re-runs idempotently on
  // every DatabaseService.initialize() -- i.e. every real app boot) used to
  // strip ALL of a chapterOnly note's own tags onto its parent, with no
  // exception for protected ones. A chapter's own 'archived'/'deleted' tag
  // (see ChapterBar.tsx's archive/delete split pill) is real per-chapter
  // data, not a leftover to fold into the parent -- getting this migration
  // wrong would silently strip that state back off the chapter on every
  // single restart. A regular tag left on a chapter (an actual leftover,
  // from before chapters stopped exposing their own tag bar) still needs to
  // migrate up, so both halves are asserted here, not just the new one.
  it('protects archived/deleted tags on a chapter from the parent-tag migration, but still migrates a regular one', async () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    db.addChapter('parent-a', 'chapter-1')
    // migrateChapterTagsToParent's query is scoped to chapterOnly=1 rows --
    // addChapter alone (the chapters-table attachment) doesn't set this;
    // the real create-chapter flow (noteLifecycleService.ts) always does
    // both together.
    db.setNoteChapterOnly('chapter-1', true)

    db.addTagToNote('chapter-1', 'archived', 0)
    db.addTagToNote('chapter-1', 'leftover-tag', 1)
    db.close()

    // A fresh instance re-running initialize() on the same data root is
    // what a real app restart does -- migrateChapterTagsToParent fires
    // again here, exactly like it would on every boot.
    const restarted = new DatabaseService(dataRoot)
    await restarted.initialize()

    expect(restarted.getNoteTags('chapter-1')).toEqual(['archived'])
    expect(restarted.getNoteTags('parent-a')).toEqual(['leftover-tag'])

    restarted.close()
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

  it('listNoteTabs never lists a chapterOnly note, regardless of how its note_tabs row got there', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    const section1 = db.createEditorSection().slice(-1)[0].id
    db.addNoteTab(section1, 'chapter-1')

    // Not yet chapterOnly -- the tab is real.
    expect(db.listNoteTabs().map((tab) => tab.noteId)).toEqual(['chapter-1'])

    db.setNoteChapterOnly('chapter-1', true)

    expect(db.listNoteTabs()).toEqual([])
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

  it('deleting a parent note permanently deletes its chapters too, not just the attachment', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'chapter-2')
    db.addChapter('parent-a', 'chapter-1')
    db.addChapter('parent-a', 'chapter-2')

    db.deleteNote('parent-a')

    expect(db.getNoteRecord('parent-a')).toBeNull()
    expect(db.getNoteRecord('chapter-1')).toBeNull()
    expect(db.getNoteRecord('chapter-2')).toBeNull()
  })

  it('deleting a note with no chapters only deletes that note', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'unrelated')

    db.deleteNote('unrelated')

    expect(db.getNoteRecord('unrelated')).toBeNull()
    expect(db.getNoteRecord('parent-a')).not.toBeNull()
  })

  describe('detachChapterForTrash / restoreDetachedChapter', () => {
    it('detaching a middle chapter closes the gap, and restoring puts it back at its original index, shifting later chapters forward again', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      seedNote(db, 'chapter-3')
      db.addChapter('parent-a', 'chapter-1')
      db.addChapter('parent-a', 'chapter-2')
      db.addChapter('parent-a', 'chapter-3')

      const afterDetach = db.detachChapterForTrash('parent-a', 'chapter-2')
      expect(afterDetach.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-3'])
      expect(afterDetach.map((c) => c.position)).toEqual([0, 1])
      expect(db.getChapterParent('chapter-2')).toBeNull()

      const restored = db.restoreDetachedChapter('chapter-2')
      expect(restored?.parentNoteId).toBe('parent-a')
      expect(restored?.chapters.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
      expect(restored?.chapters.map((c) => c.position)).toEqual([0, 1, 2])
      expect(db.getChapterParent('chapter-2')).toBe('parent-a')
    })

    it('restoring a chapter detached from the front or back lands it back exactly where it was', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      seedNote(db, 'chapter-3')
      db.addChapter('parent-a', 'chapter-1')
      db.addChapter('parent-a', 'chapter-2')
      db.addChapter('parent-a', 'chapter-3')

      db.detachChapterForTrash('parent-a', 'chapter-1')
      const restoredFront = db.restoreDetachedChapter('chapter-1')
      expect(restoredFront?.chapters.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])

      db.detachChapterForTrash('parent-a', 'chapter-3')
      const restoredBack = db.restoreDetachedChapter('chapter-3')
      expect(restoredBack?.chapters.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
    })

    it('restoring a chapter whose parent gained new chapters in the meantime clamps to the end instead of throwing', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      db.addChapter('parent-a', 'chapter-1')
      db.addChapter('parent-a', 'chapter-2')

      db.detachChapterForTrash('parent-a', 'chapter-2')

      // Its remembered position (1) no longer exists once chapter-1 alone
      // remains -- restoring should clamp to the end, not throw or corrupt
      // positions.
      const restored = db.restoreDetachedChapter('chapter-2')
      expect(restored?.chapters.map((c) => c.chapterNoteId)).toEqual(['chapter-1', 'chapter-2'])
      expect(restored?.chapters.map((c) => c.position)).toEqual([0, 1])
    })

    it('restoring a chapter whose remembered parent no longer exists is a no-op, not a crash', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      db.addChapter('parent-a', 'chapter-1')

      db.detachChapterForTrash('parent-a', 'chapter-1')
      db.deleteNote('parent-a')

      expect(db.restoreDetachedChapter('chapter-1')).toBeNull()
    })

    it('detaching a chapter that is not currently attached is a no-op, returning the unchanged list', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      seedNote(db, 'chapter-2')
      db.addChapter('parent-a', 'chapter-1')

      const result = db.detachChapterForTrash('parent-a', 'chapter-2')
      expect(result.map((c) => c.chapterNoteId)).toEqual(['chapter-1'])
    })

    it('restoring a chapter with no remembered detachment is a no-op', () => {
      seedNote(db, 'parent-a')
      seedNote(db, 'chapter-1')
      db.addChapter('parent-a', 'chapter-1')

      expect(db.restoreDetachedChapter('chapter-1')).toBeNull()
    })
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

describe('DatabaseService startup migration back to single-parent chapters', () => {
  // Reproduces leftover state from the multi-parent experiment (72f9864,
  // since reverted): a chapter attached to more than one parent, tags sitting
  // directly on a chapterOnly note, and a chapterOnly note with no `chapters`
  // row at all (parentless). Built via raw SQL against a schema that predates
  // idx_chapters_chapterNoteId_unique, same technique as the pre-chapterId
  // migration test below.
  let dataRoot: string

  beforeEach(() => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-chapters-migration-test-'))
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('dedupes multi-parent chapters (keeping the oldest attachment), merges orphaned chapter tags onto the parent, and purges parentless chapters', async () => {
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
        previewBlockCache TEXT,
        chapterOnly INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE note_tags (
        noteId TEXT NOT NULL,
        tagId INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (noteId, tagId),
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );

      CREATE TABLE chapters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        parentNoteId  TEXT    NOT NULL,
        position      INTEGER NOT NULL,
        chapterNoteId TEXT    NOT NULL,
        chapterId     TEXT,
        UNIQUE (parentNoteId, chapterNoteId),
        CHECK (parentNoteId != chapterNoteId),
        FOREIGN KEY (parentNoteId)  REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (chapterNoteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_chapters_parent_position ON chapters(parentNoteId, position);
      CREATE INDEX idx_chapters_parent_chapterid ON chapters(parentNoteId, chapterId);
    `)

    const now = new Date().toISOString()
    const insertNote = rawDb.prepare(`
      INSERT INTO notes (id, title, filePath, createdAt, updatedAt, chapterOnly)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertNote.run('parent-a', 'parent-a', '/tmp/parent-a.md', now, now, 0)
    insertNote.run('parent-b', 'parent-b', '/tmp/parent-b.md', now, now, 0)
    insertNote.run('shared-chapter', 'shared-chapter', '/tmp/shared-chapter.md', now, now, 1)
    insertNote.run('orphan-chapter', 'orphan-chapter', '/tmp/orphan-chapter.md', now, now, 1)

    // shared-chapter attached to parent-a first (lower chapters.id), then
    // parent-b -- the migration should keep the parent-a attachment.
    rawDb.prepare('INSERT INTO chapters (parentNoteId, position, chapterNoteId) VALUES (?, ?, ?)').run('parent-a', 0, 'shared-chapter')
    rawDb.prepare('INSERT INTO chapters (parentNoteId, position, chapterNoteId) VALUES (?, ?, ?)').run('parent-b', 0, 'shared-chapter')

    const tagId = Number(rawDb.prepare('INSERT INTO tags (name) VALUES (?)').run('leftover-tag').lastInsertRowid)
    rawDb.prepare('INSERT INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)').run('shared-chapter', tagId, 0)

    rawDb.close()

    const upgradedDb = new DatabaseService(dataRoot)
    await expect(upgradedDb.initialize()).resolves.not.toThrow()

    // Dedupe: only parent-a's attachment survives.
    expect(upgradedDb.getChapterParent('shared-chapter')).toBe('parent-a')
    expect(upgradedDb.listChaptersForNote('parent-b').map((c) => c.chapterNoteId)).toEqual([])

    // The unique index is actually enforced going forward.
    expect(() => upgradedDb.addChapter('parent-b', 'shared-chapter')).toThrow()

    // Tag merge: the chapter's own tag moved to its surviving parent.
    expect(upgradedDb.getNoteTags('shared-chapter')).toEqual([])
    expect(upgradedDb.getNoteTags('parent-a')).toEqual(['leftover-tag'])

    // Orphan purge: a chapterOnly note with no `chapters` row is gone.
    expect(upgradedDb.getNoteRecord('orphan-chapter')).toBeNull()

    upgradedDb.close()
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

    upgradedDb.close()
  })
})

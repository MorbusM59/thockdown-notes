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

  it('promotes a chapter to the parent slot while preserving the old parent as a chapter', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'chapter-2')
    seedNote(db, 'chapter-3')
    db.setNoteChapterOnly('chapter-1', true)
    db.setNoteChapterOnly('chapter-2', true)
    db.setNoteChapterOnly('chapter-3', true)

    db.addChapter('parent-a', 'chapter-1')
    db.addChapter('parent-a', 'chapter-2')
    db.addChapter('parent-a', 'chapter-3')

    db.promoteChapterToParent('parent-a', 'chapter-2')

    expect(db.getNoteRecord('chapter-2')?.chapterOnly).toBe(false)
    expect(db.getNoteRecord('chapter-2')?.chapterParentId).toBeNull()
    expect(db.getNoteRecord('parent-a')?.chapterOnly).toBe(true)
    expect(db.getNoteRecord('parent-a')?.chapterParentId).toBe('chapter-2')
    expect(db.listChaptersForNote('chapter-2').map((chapter) => chapter.chapterNoteId)).toEqual(['parent-a', 'chapter-1', 'chapter-3'])
    expect(db.getChapterParent('parent-a')).toBe('chapter-2')
  })

  it('promoting a chapter to parent migrates the old parent\'s tags onto it, leaving the old parent (now a chapter) with none', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'chapter-2')
    db.setNoteChapterOnly('chapter-1', true)
    db.setNoteChapterOnly('chapter-2', true)
    db.addChapter('parent-a', 'chapter-1')
    db.addChapter('parent-a', 'chapter-2')

    db.addTagToNote('parent-a', 'project', 0)
    db.addTagToNote('parent-a', 'urgent', 1)

    db.promoteChapterToParent('parent-a', 'chapter-1')

    expect(db.getNoteTags('chapter-1')).toEqual(['project', 'urgent'])
    expect(db.getNoteTags('parent-a')).toEqual([])
  })

  it('promoting a chapter that already carries a stray tag merges it after the migrated ones instead of losing it', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    db.setNoteChapterOnly('chapter-1', true)
    db.addChapter('parent-a', 'chapter-1')

    db.addTagToNote('parent-a', 'project', 0)
    // Chapters aren't supposed to carry tags of their own, but defend
    // against a leftover/legacy one rather than silently dropping it.
    db.addTagToNote('chapter-1', 'stray', 0)

    db.promoteChapterToParent('parent-a', 'chapter-1')

    expect(db.getNoteTags('chapter-1')).toEqual(['stray', 'project'])
    expect(db.getNoteTags('parent-a')).toEqual([])
  })

  it('promoting a chapter to parent hands the old parent\'s pinned-tab spots over to the newly-promoted note, in the same sections and positions', () => {
    seedNote(db, 'parent-a')
    seedNote(db, 'chapter-1')
    seedNote(db, 'other-note')
    db.setNoteChapterOnly('chapter-1', true)
    db.addChapter('parent-a', 'chapter-1')

    const section1 = db.createEditorSection().slice(-1)[0].id
    const section2 = db.createEditorSection().slice(-1)[0].id
    // section1: parent-a pinned alongside another note, at a non-zero
    // position -- proves the position itself carries over, not just "some"
    // tab appearing for the promoted note.
    db.addNoteTab(section1, 'other-note')
    db.addNoteTab(section1, 'parent-a')
    db.addNoteTab(section2, 'parent-a')

    const parentTabsBefore = db.listNoteTabs().filter((tab) => tab.noteId === 'parent-a')

    db.promoteChapterToParent('parent-a', 'chapter-1')

    // The old parent's own tab-bar identity is gone...
    expect(db.listNoteTabs().some((tab) => tab.noteId === 'parent-a')).toBe(false)
    // ...replaced by the newly-promoted note, in the exact same sections and positions.
    const chapterTabsAfter = db.listNoteTabs().filter((tab) => tab.noteId === 'chapter-1')
    expect(chapterTabsAfter.map((tab) => ({ sectionId: tab.sectionId, position: tab.position })).sort((a, b) => a.sectionId.localeCompare(b.sectionId)))
      .toEqual(parentTabsBefore.map((tab) => ({ sectionId: tab.sectionId, position: tab.position })).sort((a, b) => a.sectionId.localeCompare(b.sectionId)))
    // The unrelated tab in section1 is untouched.
    expect(db.listNoteTabs().some((tab) => tab.sectionId === section1 && tab.noteId === 'other-note')).toBe(true)
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

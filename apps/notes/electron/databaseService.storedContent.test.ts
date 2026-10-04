import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'

type Raw = { prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown }; exec: (sql: string) => void }
const rawOf = (db: DatabaseService) => (db as unknown as { requireDb: () => Raw }).requireDb()
const count = (db: DatabaseService, sql: string) => (rawOf(db).prepare(sql).get() as { n: number }).n

function upsert(db: DatabaseService, id: string, text: string): void {
  const now = Date.now()
  db.upsertNoteContent({ id, title: id, filePath: `/tmp/${id}.md`, text, createdAtMs: now, updatedAtMs: now })
}

describe("a note's stored content", () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-stored-content-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close?.()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('is one row per note across rewrites, and gone with the note', () => {
    upsert(db, 'n1', 'first')
    upsert(db, 'n1', 'second')
    expect(db.readStoredNoteContent('n1')).toBe('second')
    expect(count(db, "SELECT COUNT(*) AS n FROM note_content WHERE noteId = 'n1'")).toBe(1)
    db.deleteNote('n1')
    expect(count(db, "SELECT COUNT(*) AS n FROM note_content WHERE noteId = 'n1'")).toBe(0)
  })

  it('always holds exactly the last text written for every live note, and nothing for any other', () => {
    let seed = 7
    const next = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000 }
    const latest = new Map<string, string>()
    for (let step = 0; step < 300; step += 1) {
      const id = `n${Math.floor(next() * 12)}`
      if (next() < 0.25 && latest.has(id)) {
        db.deleteNote(id)
        latest.delete(id)
      } else {
        upsert(db, id, `${id} at ${step}`)
        latest.set(id, `${id} at ${step}`)
      }
    }
    for (const [id, text] of latest) expect(db.readStoredNoteContent(id)).toBe(text)
    expect(count(db, "SELECT COUNT(*) AS n FROM note_content WHERE noteId LIKE 'n%' AND noteId NOT IN (SELECT id FROM notes)")).toBe(0)
  })

  it('is moved out of the FTS table an older build kept it in, newest duplicate winning, and that table dropped', async () => {
    upsert(db, 'legacy', 'will be replaced by the migration')
    const raw = rawOf(db)
    // What an older build leaves: text in notes_fts, duplicated, and no note_content row.
    raw.prepare("DELETE FROM note_content WHERE noteId = 'legacy'").run()
    raw.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(noteId UNINDEXED, title, content)')
    raw.prepare("INSERT INTO notes_fts (noteId, title, content) VALUES ('legacy', 'legacy', 'older duplicate')").run()
    raw.prepare("INSERT INTO notes_fts (noteId, title, content) VALUES ('legacy', 'legacy', 'newest duplicate')").run()
    db.close?.()

    db = new DatabaseService(dataRoot)
    await db.initialize()
    expect(db.readStoredNoteContent('legacy')).toBe('newest duplicate')
    expect(rawOf(db).prepare("SELECT 1 FROM sqlite_master WHERE name = 'notes_fts'").get()).toBeUndefined()
  })
})

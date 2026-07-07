import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from './databaseService'

const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS

describe('snapshot storage + retention', () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-snapshot-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    db.upsertNoteContent({
      id: 'note-1',
      title: 'Test note',
      filePath: path.join(dataRoot, 'note-1.md'),
      text: 'hello',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('accumulates automatic snapshots instead of collapsing to one', () => {
    db.saveNoteSnapshot('note-1', 'v1', false)
    db.saveNoteSnapshot('note-1', 'v2', false)
    db.saveNoteSnapshot('note-1', 'v3', false)

    const snapshots = db.getNoteSnapshots('note-1')
    expect(snapshots.length).toBe(3)
    expect(snapshots.map((s) => s.content)).toEqual(['v3', 'v2', 'v1'])
  })

  it('does not write a new row when content is unchanged', () => {
    db.saveNoteSnapshot('note-1', 'same', false)
    db.saveNoteSnapshot('note-1', 'same', false)
    db.saveNoteSnapshot('note-1', 'same', false)

    expect(db.getNoteSnapshots('note-1').length).toBe(1)
  })

  it('promotes the latest automatic snapshot to manual instead of duplicating it', () => {
    db.saveNoteSnapshot('note-1', 'same content', false)
    db.saveNoteSnapshot('note-1', 'same content', true)

    const snapshots = db.getNoteSnapshots('note-1')
    expect(snapshots.length).toBe(1)
    expect(snapshots[0].isManual).toBe(true)
  })

  it('keeps manual snapshots as their own rows even with repeated identical automatic saves around them', () => {
    db.saveNoteSnapshot('note-1', 'draft', false)
    db.saveNoteSnapshot('note-1', 'draft', true) // promotes to manual
    db.saveNoteSnapshot('note-1', 'draft continues', false) // new content -> new row

    const snapshots = db.getNoteSnapshots('note-1')
    expect(snapshots.length).toBe(2)
    expect(snapshots.find((s) => s.content === 'draft')?.isManual).toBe(true)
    expect(snapshots.find((s) => s.content === 'draft continues')?.isManual).toBe(false)
  })

  it('retention: never deletes manual snapshots regardless of age', () => {
    const now = Date.parse('2026-07-07T12:00:00.000Z')
    insertSnapshotAt(db, 'note-1', 'ancient manual save', true, now - 400 * ONE_DAY_MS)

    db.runSnapshotRetention('note-1', now)

    expect(db.getNoteSnapshots('note-1').length).toBe(1)
  })

  it('retention: outside the active window, keeps only the newest automatic baseline', () => {
    const now = Date.parse('2026-07-07T12:00:00.000Z')
    insertSnapshotAt(db, 'note-1', 'old-1', false, now - 90 * ONE_DAY_MS)
    insertSnapshotAt(db, 'note-1', 'old-2', false, now - 80 * ONE_DAY_MS)
    insertSnapshotAt(db, 'note-1', 'old-3-newest-before-window', false, now - 40 * ONE_DAY_MS)

    db.runSnapshotRetention('note-1', now, 30 * ONE_DAY_MS)

    const remaining = db.getNoteSnapshots('note-1')
    expect(remaining.length).toBe(1)
    expect(remaining[0].content).toBe('old-3-newest-before-window')
  })

  it('retention: thins dense automatic history within the active window, keeping the newest', () => {
    const now = Date.parse('2026-07-07T12:00:00.000Z')
    // Ten automatic snapshots, one per hour, all within the last day.
    for (let i = 0; i < 10; i += 1) {
      insertSnapshotAt(db, 'note-1', `hour-${i}`, false, now - i * ONE_HOUR_MS)
    }

    db.runSnapshotRetention('note-1', now, 30 * ONE_DAY_MS)

    const remaining = db.getNoteSnapshots('note-1')
    // The newest always survives, and the set should have been thinned --
    // not all 10 dense hourly saves need to stick around.
    expect(remaining.some((s) => s.content === 'hour-0')).toBe(true)
    expect(remaining.length).toBeLessThan(10)
    expect(remaining.length).toBeGreaterThan(0)
  })

  it('retention: leaves manual snapshots inside the active window untouched by thinning', () => {
    const now = Date.parse('2026-07-07T12:00:00.000Z')
    insertSnapshotAt(db, 'note-1', 'manual-a', true, now - ONE_HOUR_MS)
    insertSnapshotAt(db, 'note-1', 'manual-b', true, now - 2 * ONE_HOUR_MS)
    insertSnapshotAt(db, 'note-1', 'manual-c', true, now - 3 * ONE_HOUR_MS)

    db.runSnapshotRetention('note-1', now, 30 * ONE_DAY_MS)

    expect(db.getNoteSnapshots('note-1').length).toBe(3)
  })
})

// Test-only helper: inserts a snapshot at a precise timestamp, bypassing
// saveNoteSnapshot's dedup (which stamps `now()` and isn't controllable
// enough for retention-boundary tests).
function insertSnapshotAt(
  db: DatabaseService,
  noteId: string,
  content: string,
  isManual: boolean,
  atMs: number,
): void {
  const rawDb = (db as unknown as { requireDb: () => import('better-sqlite3').Database }).requireDb()
  rawDb.prepare(`
    INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
    VALUES (?, ?, ?, ?)
  `).run(noteId, content, new Date(atMs).toISOString(), isManual ? 1 : 0)
}

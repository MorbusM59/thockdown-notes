import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'

function seedNote(db: DatabaseService, id: string, text: string): void {
  const now = Date.now()
  db.upsertNoteContent({
    id,
    title: id,
    filePath: `/tmp/${id}.md`,
    text,
    createdAtMs: now,
    updatedAtMs: now,
  })
}

describe('from-disk snapshots', () => {
  let dataRoot: string
  let db: DatabaseService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-external-snap-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close?.()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('identifies the baseline by its own column, not by "the one that is not manual"', () => {
    seedNote(db, 'n1', 'from disk')
    db.saveNoteSnapshot('n1', 'from disk', true, { isFromDisk: true, timestamp: '2026-01-01T00:00:00.000Z' })
    // The ordinary save cadence writing automatic snapshots afterwards is
    // exactly what used to make the old `find(row => !row.isManual)` scan
    // start returning the wrong row.
    db.saveNoteSnapshot('n1', 'edited once')
    db.saveNoteSnapshot('n1', 'edited twice')

    const baseline = db.getLatestFromDiskSnapshot('n1')
    expect(baseline?.content).toBe('from disk')
  })

  it('keeps the most recent from-disk record when the file changes more than once', () => {
    seedNote(db, 'n1', 'x')
    db.saveNoteSnapshot('n1', 'first disk state', true, { isFromDisk: true, timestamp: '2026-01-01T00:00:00.000Z' })
    db.saveNoteSnapshot('n1', 'second disk state', true, { isFromDisk: true, timestamp: '2026-02-01T00:00:00.000Z' })

    expect(db.getLatestFromDiskSnapshot('n1')?.content).toBe('second disk state')
  })

  it('records the file timestamp it was given, even when older than rows already stored', () => {
    seedNote(db, 'n1', 'x')
    db.saveNoteSnapshot('n1', 'recent edit')
    // A file's mtime can legitimately predate snapshots this app already took.
    db.saveNoteSnapshot('n1', 'old file state', true, { isFromDisk: true, timestamp: '2020-05-05T12:00:00.000Z' })

    const baseline = db.getLatestFromDiskSnapshot('n1')
    expect(baseline?.content).toBe('old file state')
    expect(baseline?.timestamp).toBe('2020-05-05T12:00:00.000Z')
  })

  it('never deduplicates a from-disk snapshot against matching content', () => {
    seedNote(db, 'n1', 'same bytes')
    db.saveNoteSnapshot('n1', 'same bytes', true, { isFromDisk: true, timestamp: '2026-01-01T00:00:00.000Z' })
    db.saveNoteSnapshot('n1', 'same bytes', true, { isFromDisk: true, timestamp: '2026-03-01T00:00:00.000Z' })

    // Two separate records that the file held this content at two different
    // times -- distinct events even though the bytes match.
    const fromDisk = db.getNoteSnapshots('n1').filter((row) => row.isFromDisk)
    expect(fromDisk).toHaveLength(2)
  })

  it('still deduplicates ordinary snapshots', () => {
    seedNote(db, 'n1', 'x')
    const first = db.saveNoteSnapshot('n1', 'unchanged')
    const second = db.saveNoteSnapshot('n1', 'unchanged')
    expect(second).toBe(first)
  })

  it('reports isFromDisk on the rows it returns', () => {
    seedNote(db, 'n1', 'x')
    db.saveNoteSnapshot('n1', 'disk', true, { isFromDisk: true, timestamp: '2026-01-01T00:00:00.000Z' })
    db.saveNoteSnapshot('n1', 'typed')

    const rows = db.getNoteSnapshots('n1')
    expect(rows.find((row) => row.content === 'disk')?.isFromDisk).toBe(true)
    expect(rows.find((row) => row.content === 'typed')?.isFromDisk).toBe(false)
  })
})

describe('readStoredNoteContent', () => {
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

  // The regression this exists for: content used to be read from the NEWEST
  // SNAPSHOT, which made a note's current text a function of its own history --
  // so taking any snapshot could change what the document said.
  it('returns the stored content, not the newest snapshot', () => {
    seedNote(db, 'n1', 'the actual current text')
    db.saveNoteSnapshot('n1', 'an older state of the note')

    expect(db.readStoredNoteContent('n1')).toBe('the actual current text')
  })

  it('is unaffected by adding a manual or from-disk snapshot', () => {
    seedNote(db, 'n1', 'the actual current text')
    db.saveNoteSnapshot('n1', 'something else entirely', true, { isFromDisk: true, timestamp: '2026-01-01T00:00:00.000Z' })

    expect(db.readStoredNoteContent('n1')).toBe('the actual current text')
  })

})

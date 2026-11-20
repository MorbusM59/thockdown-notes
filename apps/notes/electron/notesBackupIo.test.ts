// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { readBackup, writeBackup } from './notesBackupIo'

const GIF = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([3, 0, 2, 0, 0, 0, 0]))
const OTHER_GIF = Uint8Array.from([...GIF.slice(0, 10), 1, 1, 1])

describe('the Markdown backup', () => {
  const roots: string[] = []
  const temp = (name: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), `thockdown-backup-${name}-`))
    roots.push(dir)
    return dir
  }
  const open = async () => {
    const db = new DatabaseService(temp('db'))
    await db.initialize()
    return { db, lifecycle: new NoteLifecycleService(db) }
  }
  const dbs: DatabaseService[] = []
  let source: Awaited<ReturnType<typeof open>>
  const byAssignedId = (db: DatabaseService, id: string) => db.listNoteRecords().find((record) => record.assignedId === id)!

  beforeEach(async () => {
    source = await open()
    dbs.push(source.db)
    const { db, lifecycle } = source
    expect(db.importImage({ bytes: GIF, origin: '/cat.gif', requestedId: '&CAT' })).toEqual({ ok: true, id: '&CAT' })
    db.setImageTags('&CAT', ['pets'])
    const book = await lifecycle.createNote({ initialText: '# Book\n\n![a cat](&CAT) see [other]($OTHER)' })
    db.setNoteAssignedId(book.id, 'BOOK')
    db.addTagToNote(book.id, 'writing', 0)
    db.addTagToNote(book.id, 'novel', 1)
    const chapter = await lifecycle.createChapterNote(book.id)
    db.upsertNoteContent({ id: chapter.id, title: 'One', text: '## One\n\nchapter text', createdAtMs: 1, updatedAtMs: 2 })
    db.setChapterId(book.id, chapter.id, 'ONE')
    const other = await lifecycle.createNote({ initialText: '# Other\n\nback to [book]($BOOK§ONE)' })
    db.setNoteAssignedId(other.id, 'OTHER')
    db.addTagToNote(other.id, 'archived', 0)
  })
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close()
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('writes readable files and reads them back into the same structure', async () => {
    const backup = temp('out')
    await writeBackup(backup, source.db)
    const bookFile = path.join(backup, 'notes', 'writing', 'novel', '$BOOK', '$BOOK.md')
    expect(readFileSync(bookFile, 'utf8')).toContain('![a cat](../../../../images/pets/General/%26CAT.gif)')
    expect(readFileSync(path.join(backup, 'notes', 'writing', 'novel', '$BOOK', '§ONE.md'), 'utf8')).toContain('chapter text')
    expect(readFileSync(path.join(backup, 'notes', 'Archive', 'Uncategorized', 'General', '$OTHER.md'), 'utf8')).toContain('$BOOK§ONE')
    expect(readFileSync(path.join(backup, 'images', 'pets', 'General', '&CAT.gif'))).toEqual(Buffer.from(GIF))

    const target = await open()
    dbs.push(target.db)
    const result = await readBackup(path.join(backup, 'thockdown.json'), { mode: 'rename-incoming', openNoteIds: [] }, target.db, target.lifecycle)
    expect(result.errors).toEqual([])
    expect(result.importedImages).toBe(1)
    const book = byAssignedId(target.db, 'BOOK')
    expect(target.db.readStoredNoteContent(book.id)).toBe('# Book\n\n![a cat](&CAT) see [other]($OTHER)')
    expect(target.db.getNoteTags(book.id)).toEqual(['writing', 'novel'])
    const chapters = target.db.listChaptersForNote(book.id).filter((entry) => entry.chapterId === 'ONE')
    expect(chapters).toHaveLength(1)
    expect(target.db.readStoredNoteContent(chapters[0].chapterNoteId)).toBe('## One\n\nchapter text')
    expect(target.db.getNoteTags(byAssignedId(target.db, 'OTHER').id)).toEqual(['archived'])
    expect(target.db.imageTagNames('&CAT')).toEqual(['pets'])
    expect(byAssignedId(target.db, 'BOOK').createdAtMs).toBe(byAssignedId(source.db, 'BOOK').createdAtMs)

    // The same backup again: everything is already there.
    const again = await readBackup(path.join(backup, 'thockdown.json'), { mode: 'rename-incoming', openNoteIds: [] }, target.db, target.lifecycle)
    const manifest = JSON.parse(readFileSync(path.join(backup, 'thockdown.json'), 'utf8')) as { notes: unknown[] }
    expect(again).toMatchObject({ imported: 0, importedImages: 0, skipped: manifest.notes.length, renamedNotes: [], renamedImages: [] })
  })

  it('renames the existing side of a conflict when asked, and every reference to it', async () => {
    const backup = temp('out')
    await writeBackup(backup, source.db)
    const { db, lifecycle } = await open()
    dbs.push(db)
    // This database already has its own OTHER and &CAT, and a note using both.
    expect(db.importImage({ bytes: OTHER_GIF, origin: null, requestedId: '&CAT' })).toEqual({ ok: true, id: '&CAT' })
    const mine = await lifecycle.createNote({ initialText: '# Mine' })
    db.setNoteAssignedId(mine.id, 'OTHER')
    const linker = await lifecycle.createNote({ initialText: '![x](&CAT) [o]($OTHER)' })
    db.setNoteAssignedId(linker.id, 'LINKER')

    const result = await readBackup(path.join(backup, 'thockdown.json'), { mode: 'rename-existing', openNoteIds: [] }, db, lifecycle)
    expect(result.errors).toEqual([])
    expect(result.renamedNotes).toEqual([['OTHER', 'OTHER-OLD']])
    expect(result.renamedImages).toEqual([['&CAT', '&CAT-OLD']])
    expect(db.readStoredNoteContent(byAssignedId(db, 'OTHER-OLD').id)).toBe('# Mine')
    expect(db.readStoredNoteContent(byAssignedId(db, 'OTHER').id)).toBe('# Other\n\nback to [book]($BOOK§ONE)')
    expect(db.readStoredNoteContent(linker.id)).toBe('![x](&CAT-OLD) [o]($OTHER-OLD)')
    expect(db.readStoredNoteContent(byAssignedId(db, 'BOOK').id)).toBe('# Book\n\n![a cat](&CAT) see [other]($OTHER)')
    expect(db.resolveImages(['&CAT'])['&CAT']!.hash).not.toBe(db.resolveImages(['&CAT-OLD'])['&CAT-OLD']!.hash)
  })

  it('renames incoming ids by default, rewriting the incoming references', async () => {
    const backup = temp('out')
    await writeBackup(backup, source.db)
    const { db, lifecycle } = source
    db.upsertNoteContent({ ...byAssignedId(db, 'OTHER'), text: '# Other, edited', externalPath: null })

    const result = await readBackup(path.join(backup, 'thockdown.json'), { mode: 'rename-incoming', openNoteIds: [] }, db, lifecycle)
    expect(result.renamedNotes).toEqual([])
    expect(db.readStoredNoteContent(byAssignedId(db, 'OTHER-NEW').id)).toBe('# Other\n\nback to [book]($BOOK§ONE)')
    expect(db.readStoredNoteContent(byAssignedId(db, 'OTHER').id)).toBe('# Other, edited')
  })
})

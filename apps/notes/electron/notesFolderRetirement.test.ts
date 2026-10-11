import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

// The database is the only store of a note's text. Every case here restarts
// the way the app does (a fresh DatabaseService over the same data folder,
// initialize, then retireNotesFolder), because what is being tested is what
// survives a restart, not what one instance's cache says.

describe('the notes folder is retired', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  const launch = async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    await db.retireNotesFolder()
    lifecycle = new NoteLifecycleService(db)
  }
  const restart = async () => {
    db.close()
    await launch()
  }
  const notesDir = () => path.join(dataRoot, 'notes')
  const writeFolderFile = (id: string, text: string) => {
    mkdirSync(notesDir(), { recursive: true })
    writeFileSync(path.join(notesDir(), `${id}.md`), text, 'utf8')
  }

  // A database from before the folder was retired: it has no record that
  // the folder was read for the last time.
  const forgetRetirement = () => {
    const handle = new Sqlite(path.join(dataRoot, 'thockdown-notes.db'))
    handle.prepare("DELETE FROM app_meta WHERE key = 'notesFolderRetiredAt'").run()
    handle.close()
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-retire-folder-test-'))
    await launch()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('creates, saves and reloads notes with no folder at all', async () => {
    const note = await lifecycle.createNote({ initialText: '# Kept\n\nFirst.' })
    await lifecycle.saveNote({ id: note.id, text: '# Kept\n\nSecond.' })
    await restart()

    expect((await lifecycle.loadNote({ id: note.id })).text).toBe('# Kept\n\nSecond.')
    expect((await lifecycle.listNotes()).find((summary) => summary.id === note.id)?.contentText).toBe('# Kept\n\nSecond.')
    expect(existsSync(notesDir())).toBe(false)
  })

  it('reads the folder once: a file edited outside the app wins, and the stored text becomes a snapshot', async () => {
    const note = await lifecycle.createNote({ initialText: '# Doc\n\nIn the app.' })
    db.close()
    forgetRetirement()
    writeFolderFile(note.id, '# Doc\n\nEdited outside.')
    await launch()

    expect((await lifecycle.loadNote({ id: note.id })).text).toBe('# Doc\n\nEdited outside.')
    const snapshots = db.getNoteSnapshots(note.id)
    expect(snapshots.some((snapshot) => snapshot.content === '# Doc\n\nIn the app.' && snapshot.isManual)).toBe(true)

    // Never again: a later outside edit is not read.
    writeFolderFile(note.id, '# Doc\n\nEdited again.')
    await restart()
    expect((await lifecycle.loadNote({ id: note.id })).text).toBe('# Doc\n\nEdited outside.')
  })

  it('adopts a folder file that has no note, and leaves a frozen note alone', async () => {
    const frozen = await lifecycle.createNote({ initialText: '# Frozen\n\nAs frozen.' })
    db.freezeNoteFamily(frozen.id)
    db.close()
    forgetRetirement()
    writeFolderFile('26-01-01_00-00_ORPHAN', '# Orphan\n\nOnly on disk.')
    writeFolderFile(frozen.id, '# Frozen\n\nChanged on disk.')
    await launch()

    expect((await lifecycle.loadNote({ id: '26-01-01_00-00_ORPHAN' })).text).toBe('# Orphan\n\nOnly on disk.')
    expect((await lifecycle.loadNote({ id: frozen.id })).text).toBe('# Frozen\n\nAs frozen.')
  })

  it('keeps the last three launches as backups, taken before the database is opened', async () => {
    await restart()
    await restart()
    await restart()
    await restart()
    const backups = readdirSync(path.join(dataRoot, 'backups')).filter((name) => name.endsWith('.db')).sort()
    expect(backups).toEqual(['launch-1.db', 'launch-2.db', 'launch-3.db'])
  })

  it('backs up on demand to a file that opens as a database holding the notes', async () => {
    const note = await lifecycle.createNote({ initialText: '# Backed up' })
    const backupPath = await db.backupNow()
    const handle = new Sqlite(backupPath, { readonly: true })
    const row = handle.prepare('SELECT content FROM note_content WHERE noteId = ?').get(note.id) as { content: string }
    handle.close()
    expect(row.content).toBe('# Backed up')
  })
})

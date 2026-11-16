// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
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

  it.each(['music', 'texture', 'both'] as const)('backs up and resets incompatible %s tables without touching notes or images', async (kind) => {
    const note = await lifecycle.createNote({ initialText: '# Kept\n\n![image](&1)' })
    const image = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([3, 0, 2, 0, 0, 0, 0]))
    expect(db.importImage({ bytes: image, origin: null })).toEqual({ ok: true, id: '&1' })
    if (kind === 'texture') {
      db.addMusicSongs(3, [{ filePath: '/music/existing.mp3', title: '', artist: '', album: '', durationSec: 0 }])
    }
    db.close()
    const raw = new Sqlite(path.join(dataRoot, 'thockdown-notes.db'))
    if (kind !== 'texture') {
      raw.exec(`
        DROP TABLE music_set_songs;
        DROP TABLE music_songs;
        CREATE TABLE music_songs (
          id INTEGER PRIMARY KEY, filePath TEXT NOT NULL UNIQUE,
          playlistSlot INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 1,
          favorability INTEGER NOT NULL DEFAULT 1, title TEXT NOT NULL DEFAULT '',
          artist TEXT NOT NULL DEFAULT '', durationSec REAL NOT NULL DEFAULT 0
        );
        INSERT INTO music_songs (id, filePath, playlistSlot) VALUES (19, '/music/old.mp3', 3);
      `)
    }
    if (kind !== 'music') {
      raw.exec(`
        DROP TABLE texture_pattern_cache;
        CREATE TABLE texture_pattern_cache (
          surface TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
          seed INTEGER NOT NULL, granularity REAL NOT NULL, vSteps INTEGER NOT NULL,
          algorithmVersion INTEGER NOT NULL, data BLOB NOT NULL, mimeType TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          PRIMARY KEY (surface, width, height, seed, granularity, vSteps, algorithmVersion)
        );
      `)
    }
    raw.close()
    await launch()

    expect((await lifecycle.loadNote({ id: note.id })).text).toBe('# Kept\n\n![image](&1)')
    expect(db.resolveImages(['&1'])['&1']).not.toBeNull()
    expect(() => db.purgeTextureCache()).not.toThrow()
    db.addMusicSongs(3, [{ filePath: '/music/new.mp3', title: '', artist: '', album: '', durationSec: 0 }])

    const backups = readdirSync(path.join(dataRoot, 'backups')).filter((name) => name.startsWith('before-schema-reset-'))
    expect(backups).toHaveLength(1)
    const backup = new Sqlite(path.join(dataRoot, 'backups', backups[0]), { readonly: true })
    expect((backup.prepare('SELECT content FROM note_content WHERE noteId = ?').get(note.id) as { content: string }).content)
      .toBe('# Kept\n\n![image](&1)')
    if (kind !== 'texture') {
      expect(backup.prepare('SELECT filePath FROM music_songs WHERE id = 19').get()).toEqual({ filePath: '/music/old.mp3' })
    }
    backup.close()
    await restart()
    expect(db.getMusicPlaylist(3).map((song) => song.filePath)).toEqual(
      kind === 'texture' ? ['/music/existing.mp3', '/music/new.mp3'] : ['/music/new.mp3'],
    )
    expect(readdirSync(path.join(dataRoot, 'backups')).filter((name) => name.startsWith('before-schema-reset-') && name.endsWith('.db'))).toHaveLength(1)
  })

  it('rolls back the reset if the current schema cannot be created', async () => {
    db.close()
    const raw = new Sqlite(path.join(dataRoot, 'thockdown-notes.db'))
    raw.exec(`
      DROP TABLE music_set_songs;
      DROP TABLE music_songs;
      CREATE TABLE music_songs (id INTEGER PRIMARY KEY, filePath TEXT NOT NULL, playlistSlot INTEGER NOT NULL);
      INSERT INTO music_songs VALUES (19, '/music/old.mp3', 3);
      DROP INDEX idx_chapters_parent_position;
      ALTER TABLE chapters RENAME COLUMN position TO oldPosition;
    `)
    raw.close()
    db = new DatabaseService(dataRoot)
    await expect(db.initialize()).rejects.toThrow()
    db.close()
    const unchanged = new Sqlite(path.join(dataRoot, 'thockdown-notes.db'), { readonly: true })
    expect(unchanged.prepare('SELECT filePath, playlistSlot FROM music_songs WHERE id = 19').get())
      .toEqual({ filePath: '/music/old.mp3', playlistSlot: 3 })
    unchanged.close()
  })

  it('resets duplicate old music set names without losing notes or images', async () => {
    const note = await lifecycle.createNote({ initialText: '# Kept' })
    const image = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([3, 0, 2, 0, 0, 0, 0]))
    db.importImage({ bytes: image, origin: null })
    db.addMusicSongs(3, [{ filePath: '/music/old.mp3', title: '', artist: '', album: '', durationSec: 0 }])
    db.close()
    const raw = new Sqlite(path.join(dataRoot, 'thockdown-notes.db'))
    raw.exec(`
      DROP INDEX idx_music_sets_name;
      UPDATE music_sets SET name = (SELECT name FROM music_sets WHERE id = 2) WHERE id = 3;
    `)
    raw.close()
    await launch()
    expect((await lifecycle.loadNote({ id: note.id })).text).toBe('# Kept')
    expect(db.resolveImages(['&1'])['&1']).not.toBeNull()
    expect(db.getMusicPlaylist(3)).toEqual([])
    expect(db.addMusicSongs(3, [{ filePath: '/music/new.mp3', title: '', artist: '', album: '', durationSec: 0 }])).toHaveLength(1)
    const backupName = readdirSync(path.join(dataRoot, 'backups')).find((name) => name.startsWith('before-schema-reset-') && name.endsWith('.db'))
    expect(backupName).toBeDefined()
    const backup = new Sqlite(path.join(dataRoot, 'backups', backupName!), { readonly: true })
    expect(backup.prepare('SELECT filePath FROM music_songs').all()).toEqual([{ filePath: '/music/old.mp3' }])
    backup.close()
    await restart()
    expect(db.getMusicPlaylist(3)).toHaveLength(1)
  })
})

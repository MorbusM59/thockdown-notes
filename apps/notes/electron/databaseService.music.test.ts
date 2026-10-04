import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { DatabaseService } from './databaseService'
import { MAX_PLAYLIST_SLOT, PLAYLIST_SLOTS } from '../src/shared/audioPlayer'

/**
 * The playlist buckets grew from five to six ("Lounge"). `music_songs`
 * constrains its slot column with a CHECK, and SQLite cannot ALTER one --
 * CREATE TABLE IF NOT EXISTS is a no-op on an existing database, so without
 * the rebuild migration an upgrading install keeps the old five-slot
 * constraint and every attempt to add files to the new bucket fails at
 * INSERT with nothing on screen to explain it. A fresh install would look
 * perfectly fine, which is exactly why this needs its own coverage.
 */
describe('DatabaseService music playlist slots', () => {
  let dataRoot: string
  let db: DatabaseService

  const dbFile = () => path.join(dataRoot, 'thockdown-notes.db')

  beforeEach(() => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-music-test-'))
  })

  afterEach(() => {
    db?.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('accepts songs in every declared slot on a fresh database', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()

    for (const slot of PLAYLIST_SLOTS) {
      db.addMusicSongs(slot, [`/music/slot-${slot}.mp3`])
    }

    const counts = db.getMusicPlaylistCounts()
    for (const slot of PLAYLIST_SLOTS) {
      expect(counts[slot]).toBe(1)
    }
  })

  it('widens the slot CHECK on a database written by a five-slot build, keeping its songs', async () => {
    // Stand up the pre-migration table by hand: an old install, five slots
    // only, with a song already in it.
    const legacy = new BetterSqlite3(dbFile())
    legacy.exec(`
      CREATE TABLE music_songs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        filePath    TEXT    NOT NULL UNIQUE,
        playlistSlot INTEGER NOT NULL CHECK(playlistSlot BETWEEN 1 AND 5),
        priority    INTEGER NOT NULL DEFAULT 1,
        favorability INTEGER NOT NULL DEFAULT 1,
        title       TEXT    NOT NULL DEFAULT '',
        artist      TEXT    NOT NULL DEFAULT '',
        durationSec REAL    NOT NULL DEFAULT 0
      );
    `)
    legacy.prepare(
      "INSERT INTO music_songs (filePath, playlistSlot, title) VALUES ('/music/old.mp3', 3, 'Old')"
    ).run()
    expect(() =>
      legacy.prepare(
        `INSERT INTO music_songs (filePath, playlistSlot) VALUES ('/music/new.mp3', ${MAX_PLAYLIST_SLOT})`
      ).run()
    ).toThrow()
    legacy.close()

    db = new DatabaseService(dataRoot)
    await db.initialize()

    // The new bucket now takes files...
    db.addMusicSongs(MAX_PLAYLIST_SLOT, ['/music/new.mp3'])
    expect(db.getMusicPlaylistCounts()[MAX_PLAYLIST_SLOT]).toBe(1)

    // ...and the rebuild carried the existing library over rather than
    // starting the user's playlists from scratch.
    const kept = db.getMusicPlaylist(3)
    expect(kept).toHaveLength(1)
    expect(kept[0].filePath).toBe('/music/old.mp3')
    expect(kept[0].title).toBe('Old')
  })

  it('is a no-op on a database already carrying the current range', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    db.addMusicSongs(MAX_PLAYLIST_SLOT, ['/music/keep.mp3'])
    const idBefore = db.getMusicPlaylist(MAX_PLAYLIST_SLOT)[0].id
    db.close()

    // A second launch must not rebuild the table again (which would be
    // harmless but wasteful) nor disturb the rows it holds.
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const after = db.getMusicPlaylist(MAX_PLAYLIST_SLOT)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(idBefore)
  })
})

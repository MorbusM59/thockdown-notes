// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { DatabaseService } from './databaseService'
import { EMPTY_POOL_FILTER, FACTORY_MUSIC_SETS, type MusicSetPreferences } from '../src/shared/audioPlayer'

const indexedFile = (filePath: string) => ({ filePath, title: '', artist: '', album: '' })

describe('DatabaseService music sets', () => {
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

  it('creates the factory sets and appends user-created sets', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()

    expect(db.getMusicSets()).toEqual(FACTORY_MUSIC_SETS)
    const sets = db.createMusicSet()
    expect(sets).toHaveLength(6)
    expect(sets[5].name).toBe('Set A')
    expect(sets[5].slot).toBeGreaterThan(6)
  })

  it('moves a set onto another row and preserves the intervening order', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const initial = db.getMusicSets()
    const userSet = db.createMusicSet()[5]

    expect(db.moveMusicSet(userSet.slot, initial[1].slot).map((set) => set.slot))
      .toEqual([initial[0].slot, userSet.slot, ...initial.slice(1).map((set) => set.slot)])
    expect(db.moveMusicSet(initial[1].slot, userSet.slot).map((set) => set.slot))
      .toEqual([initial[0].slot, initial[1].slot, userSet.slot, ...initial.slice(2).map((set) => set.slot)])
  })

  it('requires unique set names and repairs duplicates from an older database', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const first = db.createMusicSet()[5]
    const second = db.createMusicSet()[6]

    expect(() => db.renameMusicSet(second.slot, first.name)).toThrow('A set with that name already exists.')

    db.close()
    const legacy = new BetterSqlite3(dbFile())
    legacy.exec('DROP INDEX idx_music_sets_name')
    legacy.prepare('UPDATE music_sets SET name = ? WHERE id = ?').run(first.name, second.slot)
    legacy.close()

    db = new DatabaseService(dataRoot)
    await db.initialize()
    expect(db.getMusicSets().find((set) => set.slot === first.slot)?.name).toBe('Set A')
    expect(db.getMusicSets().find((set) => set.slot === second.slot)?.name).toBe('Set A (2)')
  })

  it('allows one song to belong to multiple sets without duplicate pool rows', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const factorySet = db.getMusicSets()[0]
    const userSet = db.createMusicSet()[5]

    db.addMusicSongs(factorySet.slot, [indexedFile('/music/shared.mp3'), indexedFile('/music/factory.mp3')])
    const sharedInFactory = db.getMusicPlaylist(factorySet.slot).find((song) => song.filePath.endsWith('shared.mp3'))!
    const userSongs = db.addMusicSongs(userSet.slot, [
      indexedFile('/music/shared.mp3'),
      indexedFile('/music/user.mp3'),
    ])
    const sharedInUserSet = userSongs.find((song) => song.filePath.endsWith('shared.mp3'))!

    expect(sharedInUserSet.id).toBe(sharedInFactory.id)
    expect(sharedInUserSet.setIds).toEqual(expect.arrayContaining([factorySet.slot, userSet.slot]))
    expect(db.getMusicPlaylistCounts()).toMatchObject({
      [factorySet.slot]: 2,
      [userSet.slot]: 2,
    })

    const pool = db.getMusicPool({ slots: [factorySet.slot, userSet.slot], filter: EMPTY_POOL_FILTER })
    expect(pool.map((song) => song.filePath)).toHaveLength(3)
    expect(new Set(pool.map((song) => song.id)).size).toBe(3)
  })

  it('preserves shared songs when a set is cleared and purges them only after the last membership is removed', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const factorySet = db.getMusicSets()[0]
    const userSet = db.createMusicSet()[5]

    db.addMusicSongs(factorySet.slot, [indexedFile('/music/shared.mp3')])
    db.addMusicSongs(userSet.slot, [indexedFile('/music/shared.mp3'), indexedFile('/music/user-only.mp3')])
    const sharedSongId = db.getMusicPlaylist(factorySet.slot)[0].id
    const userOnlySongId = db.getMusicPlaylist(userSet.slot).find((song) => song.filePath.endsWith('user-only.mp3'))!.id

    db.clearMusicPlaylist(factorySet.slot)
    expect(db.getMusicSongById(sharedSongId)?.setIds).toEqual([userSet.slot])
    expect(db.getMusicPlaylistCounts()[factorySet.slot]).toBe(0)

    db.deleteMusicSet(userSet.slot)
    expect(db.getMusicSongById(sharedSongId)).toBeNull()
    expect(db.getMusicSongById(userOnlySongId)).toBeNull()
    expect(db.getMusicSets().some((set) => set.slot === userSet.slot)).toBe(false)
  })

  it('imports legacy slot rows into memberships and preserves their song ids', async () => {
    const legacy = new BetterSqlite3(dbFile())
    legacy.exec(`
      CREATE TABLE music_songs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        filePath     TEXT NOT NULL UNIQUE,
        playlistSlot INTEGER NOT NULL CHECK(playlistSlot BETWEEN 1 AND 5),
        priority     INTEGER NOT NULL DEFAULT 1,
        favorability INTEGER NOT NULL DEFAULT 1,
        title        TEXT NOT NULL DEFAULT '',
        artist       TEXT NOT NULL DEFAULT '',
        durationSec  REAL NOT NULL DEFAULT 0
      );
    `)
    legacy.prepare(
      "INSERT INTO music_songs (id, filePath, playlistSlot, title) VALUES (19, '/music/old.mp3', 3, 'Old')"
    ).run()
    legacy.close()

    db = new DatabaseService(dataRoot)
    await db.initialize()

    const migrated = db.getMusicPlaylist(3)
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({
      id: 19,
      filePath: '/music/old.mp3',
      title: 'Old',
      setIds: [3],
      album: '',
    })

    db.close()
    db = new DatabaseService(dataRoot)
    await db.initialize()
    expect(db.getMusicPlaylist(3)[0].id).toBe(19)
  })

  it('imports legacy names and order once, then allocates ids beyond the imported set ids', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const legacy: MusicSetPreferences = {
      sets: [
        { slot: 9, name: 'My Set' },
        { slot: 10, name: 'My Set' },
        ...FACTORY_MUSIC_SETS.map((set) => ({ ...set })),
      ],
      nextSlot: 11,
    }

    const imported = db.initializeMusicSets(legacy)
    expect(imported[0]).toEqual({ slot: 9, name: 'My Set' })
    expect(imported[1]).toEqual({ slot: 10, name: 'My Set (2)' })
    expect(db.initializeMusicSets()).toEqual(imported)
    expect(db.createMusicSet()[imported.length].slot).toBeGreaterThan(9)
  })
})

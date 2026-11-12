// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { EMPTY_POOL_FILTER, FACTORY_MUSIC_SETS } from '../src/shared/audioPlayer'

const indexedFile = (filePath: string) => ({ filePath, title: '', artist: '', album: '' })

describe('DatabaseService music sets', () => {
  let dataRoot: string
  let db: DatabaseService


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

  it('requires unique set names', async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    const first = db.createMusicSet()[5]
    const second = db.createMusicSet()[6]

    expect(() => db.renameMusicSet(second.slot, first.name)).toThrow('A set with that name already exists.')

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

})

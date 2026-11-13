// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fsPromises } from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { indexMusicRequest } from './musicIndexCore'

describe('music indexing', () => {
  let directory: string

  afterEach(() => {
    vi.restoreAllMocks()
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('recursively indexes supported audio files and ignores other files', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-music-index-'))
    const nested = path.join(directory, 'nested')
    mkdirSync(nested)
    const first = path.join(directory, 'first.MP3')
    const second = path.join(nested, 'second.flac')
    writeFileSync(first, '')
    writeFileSync(second, '')
    writeFileSync(path.join(nested, 'notes.txt'), '')

    const indexed = await indexMusicRequest({ paths: [directory] })

    expect(indexed.map(({ filePath }) => filePath).sort()).toEqual([first, second].sort())
    expect(indexed.every(({ title, artist, album }) => !title && !artist && !album)).toBe(true)
  })

  it('filters non-audio files selected individually', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-music-index-'))
    const audioFile = path.join(directory, 'song.ogg')
    writeFileSync(audioFile, '')

    await expect(indexMusicRequest({
      paths: [audioFile, path.join(directory, 'readme.txt'), path.join(directory, 'missing.mp3')],
    })).resolves.toEqual([{ filePath: audioFile, title: '', artist: '', album: '', durationSec: 0 }])
  })

  it('takes files and folders together, as a drop from the file manager brings them', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-music-index-'))
    const folder = path.join(directory, 'album')
    mkdirSync(folder)
    const inFolder = path.join(folder, 'one.mp3')
    const loose = path.join(directory, 'two.wav')
    writeFileSync(inFolder, '')
    writeFileSync(loose, '')

    const indexed = await indexMusicRequest({ paths: [folder, loose] })

    expect(indexed.map(({ filePath }) => filePath)).toEqual([inFolder, loose])
  })

  it('skips a folder it cannot read and keeps the rest of the tree', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-music-index-'))
    const locked = path.join(directory, 'locked')
    mkdirSync(locked)
    writeFileSync(path.join(locked, 'hidden.mp3'), '')
    const kept = path.join(directory, 'kept.mp3')
    writeFileSync(kept, '')
    const readdir = fsPromises.readdir.bind(fsPromises)
    vi.spyOn(fsPromises, 'readdir').mockImplementation(((target: string, options: never) => (
      target === locked ? Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })) : readdir(target, options)
    )) as typeof fsPromises.readdir)

    const indexed = await indexMusicRequest({ paths: [directory] })

    expect(indexed.map(({ filePath }) => filePath)).toEqual([kept])
  })
})

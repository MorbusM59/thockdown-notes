// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { indexMusicRequest } from './musicIndexCore'

describe('music indexing', () => {
  let directory: string

  afterEach(() => {
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

    const indexed = await indexMusicRequest({ kind: 'folder', folderPath: directory })

    expect(indexed.map(({ filePath }) => filePath).sort()).toEqual([first, second].sort())
    expect(indexed.every(({ title, artist, album }) => !title && !artist && !album)).toBe(true)
  })

  it('filters non-audio files selected individually', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-music-index-'))
    const audioFile = path.join(directory, 'song.ogg')
    writeFileSync(audioFile, '')

    await expect(indexMusicRequest({
      kind: 'files',
      filePaths: [audioFile, path.join(directory, 'readme.txt')],
    })).resolves.toEqual([{ filePath: audioFile, title: '', artist: '', album: '' }])
  })
})

import { describe, expect, it } from 'vitest'
import type { MusicIndexing } from '@thockdown/visualizer/sound/musicIndexing'
import { LIST_BATCH, scanFolder } from './folderScan'

/** A tree of `breadth`^`depth` leaf folders, each holding `songs` songs, served as the native side would. */
function fakeTree(breadth: number, depth: number, songs: number) {
  const calls: string[][] = []
  const plugin = {
    async listFolders({ folders }: { uri: string; folders: string[] }) {
      calls.push(folders)
      const parents = folders.length === 0 ? [''] : folders
      const out = { folders: [] as string[], paths: [] as string[] }
      for (const parent of parents) {
        const level = parent === '' ? 0 : parent.split('/').length
        if (level < depth) for (let i = 0; i < breadth; i += 1) out.folders.push(parent === '' ? `${i}` : `${parent}/${i}`)
        else for (let i = 0; i < songs; i += 1) out.paths.push(`${parent}/song${i}.mp3`)
      }
      return out
    },
    // Every song an MP3 whose ID3v2 title is its own path, served in ranges as MusicFolders.readSongs serves them.
    async readSongRanges({ reads, close }: { reads: Array<{ path: string; offset: number; length: number }>; close: string[] }) {
      rounds.push(reads.length)
      const results = reads.map(({ path, offset, length }) => {
        open.add(path)
        maxOpen = Math.max(maxOpen, open.size)
        const bytes = songFile(path)
        return { size: bytes.length, data: bytes.subarray(offset, offset + length).toString('base64') }
      })
      for (const path of close) { open.delete(path); closed.add(path) }
      return { results }
    },
    async closeSongs({ paths }: { paths?: string[] }) {
      for (const path of paths ?? [...open]) { open.delete(path); closed.add(path) }
    },
  }
  const rounds: number[] = []
  const open = new Set<string>()
  const closed = new Set<string>()
  let maxOpen = 0
  return { plugin, calls, rounds, open, closed, maxOpen: () => maxOpen }
}

/** An MP3 of one ID3v2.3 TIT2 frame holding `title`, then one 128 kbps frame header. */
function songFile(title: string): Buffer {
  const text = Buffer.concat([Buffer.from([3]), Buffer.from(title, 'utf8')])
  const frame = Buffer.alloc(10)
  frame.write('TIT2', 0, 'latin1')
  frame.writeUInt32BE(text.length, 4)
  const body = Buffer.concat([frame, text])
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, body.length])
  const audio = Buffer.alloc(16000)
  audio.set([0xff, 0xfb, 0x90, 0x00], 0)
  return Buffer.concat([header, body, audio])
}

describe('scanFolder', () => {
  it('walks a large tree in small steps, the bar following scanning the whole time, then indexing, song by song', async () => {
    const { plugin, calls, rounds, open, closed, maxOpen } = fakeTree(8, 3, 7) // 585 folders, 3584 songs, about the size of a real library
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', new Set(), (step) => progress.push(step), () => {})
    expect(scan.paths).toHaveLength(3584)
    expect(scan.added).toHaveLength(3584)
    expect(calls.every((folders) => folders.length <= LIST_BATCH)).toBe(true)
    const scanning = progress.filter((step) => step.indexing === null)
    expect(scanning.length).toBeGreaterThan(50)
    expect(scanning.at(-1)!.scanning).toEqual({ done: 585, total: 585 })
    // Scanning ends before indexing starts, and neither bar ever goes back.
    const firstIndexing = progress.findIndex((step) => step.indexing !== null)
    expect(progress.slice(firstIndexing).every((step) => step.indexing !== null)).toBe(true)
    for (let i = 1; i < progress.length; i += 1) {
      const [before, after] = [progress[i - 1], progress[i]]
      expect(after.scanning.done).toBeGreaterThanOrEqual(before.scanning.done)
      expect(after.scanning.done).toBeLessThanOrEqual(after.scanning.total)
      if (before.indexing && after.indexing) expect(after.indexing.done).toBeGreaterThanOrEqual(before.indexing.done)
    }
    expect(progress.at(-1)!.indexing).toEqual({ done: 3584, total: 3584 })
    // Indexing is told of every song, not of every round trip.
    expect(progress.filter((step) => step.indexing !== null).length).toBeGreaterThan(3584)
    // Read by the shared readers, many songs to a round trip, every file closed.
    expect(scan.added[100].title).toBe(scan.added[100].filePath)
    expect(scan.added[100].durationSec).toBeCloseTo(1, 0)
    expect(rounds.length).toBeLessThan(3584 / 4)
    expect(open.size).toBe(0)
    expect(closed.size).toBe(3584)
    expect(maxOpen()).toBeLessThanOrEqual(64)
  })

  it('counts songs already in the library as indexed, and reads only the rest', async () => {
    const { plugin } = fakeTree(2, 1, 5)
    const known = new Set(['0/song0.mp3', '0/song1.mp3', '1/song4.mp3'])
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', known, (step) => progress.push(step), () => {})
    expect(scan.paths).toHaveLength(10)
    expect(scan.added.map((song) => song.filePath).sort()).toEqual(scan.paths.filter((path) => !known.has(path)).sort())
    expect(progress.find((step) => step.indexing !== null)!.indexing).toEqual({ done: 3, total: 10 })
    expect(progress.at(-1)!.indexing).toEqual({ done: 10, total: 10 })
  })

  it('hands the songs on as they are found: the known ones once the tree is listed, each new one as it is read', async () => {
    const { plugin } = fakeTree(2, 1, 5)
    const known = new Set(['0/song0.mp3', '1/song4.mp3'])
    const handed: Array<{ paths: number; added: string[]; indexed: number }> = []
    let indexed = 0
    await scanFolder(plugin, 'tree', known, (step) => { indexed = step.indexing?.done ?? 0 }, (paths, added) => {
      handed.push({ paths: paths.length, added: added.map((song) => song.filePath), indexed })
    })
    // First the whole tree's paths, before any song is read; then one call per new song, each before its count is published.
    expect(handed[0]).toEqual({ paths: 10, added: [], indexed: 2 })
    expect(handed.slice(1).every((call) => call.paths === 0 && call.added.length === 1)).toBe(true)
    expect(handed.slice(1).map((call) => call.added[0]).sort()).toEqual([...Array(10).keys()].map((i) => `${i < 5 ? 0 : 1}/song${i % 5}.mp3`).filter((path) => !known.has(path)).sort())
  })

  it('a folder whose songs are all known ends with both bars full', async () => {
    const { plugin } = fakeTree(1, 1, 3)
    const progress: MusicIndexing[] = []
    await scanFolder(plugin, 'tree', new Set(['0/song0.mp3', '0/song1.mp3', '0/song2.mp3']), (step) => progress.push(step), () => {})
    expect(progress.at(-1)).toEqual({ scanning: { done: 2, total: 2 }, indexing: { done: 3, total: 3 } })
  })
})

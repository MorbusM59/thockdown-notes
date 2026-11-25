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
    async describeSongs({ paths }: { paths: string[] }) {
      return { added: paths.map((filePath) => ({ filePath, title: '', artist: '', album: '', durationSec: 0 })) }
    },
  }
  return { plugin, calls }
}

describe('scanFolder', () => {
  it('walks a large tree in small steps, the scanning bar moving the whole time, then the indexing bar', async () => {
    const { plugin, calls } = fakeTree(8, 3, 7) // 585 folders, 3584 songs, about the size of a real library
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', new Set(), (step) => progress.push(step))
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
  })

  it('counts songs already in the library as indexed, and reads only the rest', async () => {
    const { plugin } = fakeTree(2, 1, 5)
    const known = new Set(['0/song0.mp3', '0/song1.mp3', '1/song4.mp3'])
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', known, (step) => progress.push(step))
    expect(scan.paths).toHaveLength(10)
    expect(scan.added.map((song) => song.filePath).sort()).toEqual(scan.paths.filter((path) => !known.has(path)).sort())
    expect(progress.find((step) => step.indexing !== null)!.indexing).toEqual({ done: 3, total: 10 })
    expect(progress.at(-1)!.indexing).toEqual({ done: 10, total: 10 })
  })

  it('a folder whose songs are all known ends with both bars full', async () => {
    const { plugin } = fakeTree(1, 1, 3)
    const progress: MusicIndexing[] = []
    await scanFolder(plugin, 'tree', new Set(['0/song0.mp3', '0/song1.mp3', '0/song2.mp3']), (step) => progress.push(step))
    expect(progress.at(-1)).toEqual({ scanning: { done: 2, total: 2 }, indexing: { done: 3, total: 3 } })
  })
})

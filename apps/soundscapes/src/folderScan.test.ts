import { describe, expect, it } from 'vitest'
import type { MusicIndexing } from '@thockdown/visualizer/sound/musicIndexing'
import { scanFolder } from './folderScan'

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
  it('finds every song of a large tree, and the bar moves while the tree is still being walked', async () => {
    const { plugin, calls } = fakeTree(6, 3, 10) // 216 album folders, 2160 songs
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', new Set(), (step) => progress.push(step))
    expect(scan.paths).toHaveLength(2160)
    expect(scan.added).toHaveLength(2160)
    expect(calls.every((folders) => folders.length <= 8)).toBe(true)
    // Before the first tag is read, the total has already been published many times, rising.
    const listing = progress.filter((step) => step.done === 0)
    expect(new Set(listing.map((step) => step.total)).size).toBeGreaterThan(20)
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i].total).toBeGreaterThanOrEqual(progress[i - 1].total)
      expect(progress[i].done).toBeGreaterThanOrEqual(progress[i - 1].done)
      expect(progress[i].done).toBeLessThanOrEqual(progress[i].total)
    }
    expect(progress.at(-1)).toEqual({ done: 2160, total: 2160 })
  })

  it('counts songs already in the library as done, and reads only the rest', async () => {
    const { plugin } = fakeTree(2, 1, 5)
    const known = new Set(['0/song0.mp3', '0/song1.mp3', '1/song4.mp3'])
    const progress: MusicIndexing[] = []
    const scan = await scanFolder(plugin, 'tree', known, (step) => progress.push(step))
    expect(scan.paths).toHaveLength(10)
    expect(scan.added.map((song) => song.filePath).sort()).toEqual(scan.paths.filter((path) => !known.has(path)).sort())
    expect(progress.at(-1)).toEqual({ done: 10, total: 10 })
  })

  it('a folder whose songs are all known ends full rather than at 0 / 0', async () => {
    const { plugin } = fakeTree(1, 1, 3)
    const progress: MusicIndexing[] = []
    await scanFolder(plugin, 'tree', new Set(['0/song0.mp3', '0/song1.mp3', '0/song2.mp3']), (step) => progress.push(step))
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 })
  })
})

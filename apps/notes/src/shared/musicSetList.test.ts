import { describe, expect, it } from 'vitest'
import type { MusicSongEntry } from './audioPlayer'
import { groupMusicSetList, musicSetSelectorCells, musicSetSelectorOffsetShowing, sanitizeMusicSetListGrouping } from './musicSetList'

let nextId = 1
function song(filePath: string, tags: Partial<Pick<MusicSongEntry, 'title' | 'artist' | 'album'>> = {}): MusicSongEntry {
  return { id: nextId++, filePath, setIds: [2], priority: 1, favorability: 5, title: '', artist: '', album: '', durationSec: 0, ...tags }
}

const songs = [
  song('/music/rock/b.mp3', { artist: 'Zed', album: 'Two' }),
  song('/music/rock/a.flac', { artist: 'Zed', album: 'One' }),
  song('/music/rock/c.mp3', { title: 'Alpha', artist: 'Amy' }),
  song('C:\\other\\Rock\\d.mp3'),
]

describe('groupMusicSetList', () => {
  it('groups by folder, names the last level, divides by file type, sorts titles', () => {
    const groups = groupMusicSetList(songs, 'folder', '')
    expect(groups.map((g) => [g.label, g.key])).toEqual([['rock', '/music/rock'], ['Rock', 'C:\\other\\Rock']])
    expect(groups[0].dividers.map((d) => [d.label, d.songs.map((s) => s.filePath)])).toEqual([
      ['.flac', ['/music/rock/a.flac']],
      ['.mp3', ['/music/rock/c.mp3', '/music/rock/b.mp3']],
    ])
  })

  it('groups by artist and divides by album, missing tags reading as the visualizer reads them', () => {
    const groups = groupMusicSetList(songs, 'artist', '')
    expect(groups.map((g) => g.label)).toEqual(['Amy', 'no artist', 'Zed'])
    expect(groups[2].dividers.map((d) => d.label)).toEqual(['One', 'Two'])
    expect(groups[0].dividers[0].label).toBe('no album')
  })

  it('filters with the pool filter syntax', () => {
    expect(groupMusicSetList(songs, 'artist', '$zed').map((g) => g.label)).toEqual(['Zed'])
  })

  it('sanitizes the grouping', () => {
    expect(sanitizeMusicSetListGrouping('artist')).toBe('artist')
    expect(sanitizeMusicSetListGrouping('x')).toBe('folder')
  })
})

describe('the set selector window', () => {
  const shape = (count: number, offset: number) =>
    musicSetSelectorCells(count, offset).map((cell) => (cell.kind === 'set' ? cell.index : cell.kind))

  it('shows every set when they fit', () => {
    expect(shape(5, 0)).toEqual([0, 1, 2, 3, 4])
    expect(shape(6, 3)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('replaces the end cells with steps while sets lie beyond them', () => {
    expect(shape(8, 0)).toEqual([0, 1, 2, 3, 4, 'later'])
    expect(shape(8, 1)).toEqual(['earlier', 2, 3, 4, 5, 'later'])
    expect(shape(8, 2)).toEqual(['earlier', 3, 4, 5, 6, 7])
    expect(shape(8, 99)).toEqual(shape(8, 2))
  })

  it('finds the nearest window showing a set, for every set and every start', () => {
    for (let count = 1; count <= 12; count += 1) {
      for (let index = 0; index < count; index += 1) {
        for (let offset = 0; offset <= Math.max(0, count - 6); offset += 1) {
          const at = musicSetSelectorOffsetShowing(count, offset, index)
          expect(shape(count, at)).toContain(index)
          if (shape(count, offset).includes(index)) expect(at).toBe(offset)
        }
      }
    }
  })
})

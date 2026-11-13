import { describe, expect, it } from 'vitest'
import type { MusicSongEntry } from './audioPlayer'
import { groupMusicSetList, sanitizeMusicSetListGrouping } from './musicSetList'

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

  it('matches the file path unless a prefix narrows the search to a tag', () => {
    expect(groupMusicSetList(songs, 'folder', 'other').map((g) => g.label)).toEqual(['Rock'])
    expect(groupMusicSetList(songs, 'folder', '#other')).toEqual([])
  })

  it('sanitizes the grouping', () => {
    expect(sanitizeMusicSetListGrouping('artist')).toBe('artist')
    expect(sanitizeMusicSetListGrouping('x')).toBe('folder')
  })
})

describe('musicSetMark', () => {
  it('takes the first two words\' initials, or a one-word name\'s first two letters', async () => {
    const { musicSetMark } = await import('./audioPlayer')
    expect(musicSetMark('late night drive')).toBe('LN')
    expect(musicSetMark('  Chill   out ')).toBe('CO')
    expect(musicSetMark('focus')).toBe('FO')
    expect(musicSetMark('x')).toBe('X')
  })
})

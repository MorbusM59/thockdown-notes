import { describe, expect, it } from 'vitest'
import { songAlbumText, songArtistText, songTitleText } from './audioPlayer'

describe('song text', () => {
  it('falls back from a missing title to the file and up to two folders', () => {
    expect(songTitleText({ title: '', filePath: '/home/joe/Music/Band/Record/song.mp3' })).toBe('... | Band | Record | song.mp3')
    expect(songTitleText({ title: '', filePath: 'C:\\Band\\Record\\song.mp3' })).toBe('... | Band | Record | song.mp3')
    expect(songTitleText({ title: '', filePath: '/Record/song.mp3' })).toBe('Record | song.mp3')
    expect(songTitleText({ title: 'Song', filePath: '/a/b.mp3' })).toBe('Song')
  })

  it('says a missing artist or album in words', () => {
    expect(songArtistText({ artist: '' })).toBe('no artist')
    expect(songAlbumText({ album: '' })).toBe('no album')
    expect(songAlbumText({ album: 'Record' })).toBe('Record')
  })
})

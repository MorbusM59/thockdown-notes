import { describe, expect, it } from 'vitest'
import {
  AUDIO_GRID_COLUMNS,
  defaultMusicSetName,
  EMPTY_POOL_FILTER,
  FACTORY_MUSIC_SETS,
  getNextActiveSlotsForSelection,
  isFactoryMusicSet,
  matchesPoolFilter,
  PLAYLIST_BUTTON_SLOTS,
  PLAYLIST_SLOT_THEMES,
  sanitizePoolFilter,
} from './audioPlayer'

describe('audio player set layout', () => {
  it('shows Pop, Rock, Electronic, Lounge, and Ambient in the six-cell row', () => {
    expect(PLAYLIST_BUTTON_SLOTS).toEqual([2, 4, 5, 6, 3])
    expect(PLAYLIST_BUTTON_SLOTS.map((slot) => PLAYLIST_SLOT_THEMES[slot]))
      .toEqual(['Pop', 'Rock', 'Electronic', 'Lounge', 'Ambient'])
    expect(Object.keys(PLAYLIST_SLOT_THEMES).map(Number)).toEqual([2, 3, 4, 5, 6])
    expect(AUDIO_GRID_COLUMNS).toBe(6)
    expect(FACTORY_MUSIC_SETS.map((set) => set.name)).toEqual(['Pop', 'Rock', 'Electronic', 'Lounge', 'Ambient'])
    expect(isFactoryMusicSet(1)).toBe(false)
    expect(isFactoryMusicSet(2)).toBe(true)
  })
})

describe('audio set selection', () => {
  it('selects only the clicked slot unless the selection is additive', () => {
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, false)).toEqual([2])
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, true)).toEqual([1, 2, 3])
    expect(getNextActiveSlotsForSelection([1, 3], 2, true)).toEqual([1, 3, 2])
  })

})

describe('music sets', () => {
  it('continues generated names beyond Z', () => {
    expect(defaultMusicSetName(Array.from({ length: 26 }, (_, index) => ({ slot: index + 10, name: `Set ${String.fromCharCode(65 + index)}` }))))
      .toBe('Set AA')
  })

  describe('music pool search', () => {
    const song = {
      title: 'Moonlight',
      artist: 'Michael',
      album: 'Jackson',
      filePath: 'music\\moonlight.mp3',
    }
    const matches = (query: string, value = song) => matchesPoolFilter(value, { query })

    it('requires every unquoted word, allowing words to match different fields without case sensitivity', () => {
      expect(matches('mich jack')).toBe(true)
      expect(matches('mich beyonce')).toBe(false)
      expect(matches('')).toBe(true)
      expect(matches('   ')).toBe(true)
      expect(EMPTY_POOL_FILTER).toEqual({ query: '' })
    })

    it('matches quoted phrases contiguously, but not as separated words', () => {
      const jacksonSong = { ...song, title: 'Michael Jackson' }
      expect(matches('"Michael J"', jacksonSong)).toBe(true)
      expect(matches('"Michael J"', { ...jacksonSong, title: 'Michael Goja' })).toBe(false)
      expect(matches('"michael jack"', jacksonSong)).toBe(true)
    })

    it('limits the whole query to artist, album, or title when prefixed', () => {
      expect(matches('$mich')).toBe(true)
      expect(matches('$mich jack')).toBe(false)
      expect(matches('§jack')).toBe(true)
      expect(matches('#moon')).toBe(true)
      expect(matches('$moon')).toBe(false)
      expect(matches('§mich')).toBe(false)
      expect(matches('#jack')).toBe(false)
    })

    it('migrates saved three-field filters into quoted search phrases', () => {
      expect(sanitizePoolFilter({
        artist: ' Michael Jackson ',
        album: 'Bad',
        title: 'Thriller',
      })).toEqual({ query: '"Michael Jackson" "Bad" "Thriller"' })
      expect(sanitizePoolFilter({ query: 'mich jack' })).toEqual({ query: 'mich jack' })
    })
  })
})

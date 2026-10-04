import { describe, expect, it } from 'vitest'
import {
  canStepBack,
  currentHistorySongId,
  emptyPlayHistory,
  forgetSong,
  MUSIC_PLAY_HISTORY_LIMIT,
  pushPlayed,
  stepBack,
} from './musicPlayHistory'

const playAll = (...ids: number[]) => ids.reduce(pushPlayed, emptyPlayHistory())

/** Walk back n times, returning the songs handed back in order. */
function walkBack(history: ReturnType<typeof emptyPlayHistory>, times: number) {
  const heard: number[] = []
  let current = history
  for (let i = 0; i < times; i++) {
    const step = stepBack(current)
    if (!step) break
    current = step.history
    heard.push(step.songId)
  }
  return { history: current, heard }
}

describe('music play history', () => {
  it('does nothing before anything has played', () => {
    const history = emptyPlayHistory()
    expect(currentHistorySongId(history)).toBeNull()
    expect(canStepBack(history)).toBe(false)
    expect(stepBack(history)).toBeNull()
  })

  it('cannot step back off the first song', () => {
    const history = playAll(7)
    expect(canStepBack(history)).toBe(false)
    expect(stepBack(history)).toBeNull()
  })

  // The whole point of keeping a tally rather than one previous song.
  it('walks back repeatedly, one song per press', () => {
    const { heard } = walkBack(playAll(1, 2, 3, 4, 5), 4)
    expect(heard).toEqual([4, 3, 2, 1])
  })

  it('stops at the oldest entry instead of wrapping', () => {
    const { heard } = walkBack(playAll(1, 2, 3), 10)
    expect(heard).toEqual([2, 1])
  })

  // The truncation rule: after going back, a new song makes "back" return to
  // the song just heard -- not to one from before the walk.
  it('returns to the song just heard after going back then playing on', () => {
    const { history: rewound } = walkBack(playAll(1, 2, 3, 4, 5), 4)
    expect(currentHistorySongId(rewound)).toBe(1)

    const afterEnd = pushPlayed(rewound, 9)
    expect(afterEnd.entries).toEqual([1, 9])
    expect(stepBack(afterEnd)?.songId).toBe(1)
  })

  it('ignores a song re-recorded while it is already playing', () => {
    const history = pushPlayed(playAll(1, 2), 2)
    expect(history.entries).toEqual([1, 2])
    // One press still gets somewhere, rather than replaying the same track.
    expect(stepBack(history)?.songId).toBe(1)
  })

  it('keeps only the most recent songs once the tally is full', () => {
    let history = emptyPlayHistory()
    for (let id = 1; id <= MUSIC_PLAY_HISTORY_LIMIT + 20; id++) history = pushPlayed(history, id)

    expect(history.entries).toHaveLength(MUSIC_PLAY_HISTORY_LIMIT)
    expect(history.entries[0]).toBe(21)
    expect(currentHistorySongId(history)).toBe(MUSIC_PLAY_HISTORY_LIMIT + 20)

    // The cursor still addresses the right entries after the front fell off.
    const { heard } = walkBack(history, 2)
    expect(heard).toEqual([MUSIC_PLAY_HISTORY_LIMIT + 19, MUSIC_PLAY_HISTORY_LIMIT + 18])
  })

  describe('forgetting a purged song', () => {
    it('drops it and leaves the cursor on the same song', () => {
      const history = forgetSong(playAll(1, 2, 3, 4), 2)
      expect(history.entries).toEqual([1, 3, 4])
      expect(currentHistorySongId(history)).toBe(4)
      expect(stepBack(history)?.songId).toBe(3)
    })

    it('falls back to the previous entry when the playing song is the one purged', () => {
      const history = forgetSong(playAll(1, 2, 3), 3)
      expect(history.entries).toEqual([1, 2])
      expect(currentHistorySongId(history)).toBe(2)
    })

    it('leaves a history that never held the song alone', () => {
      const before = playAll(1, 2)
      expect(forgetSong(before, 99)).toBe(before)
    })

    it('empties cleanly when the only song is purged', () => {
      const history = forgetSong(playAll(5), 5)
      expect(history.entries).toEqual([])
      expect(currentHistorySongId(history)).toBeNull()
      expect(canStepBack(history)).toBe(false)
    })
  })
})

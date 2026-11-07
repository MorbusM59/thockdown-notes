import { describe, expect, it } from 'vitest'
import { countWordsFrom, nextChunk } from './speedReadingChunks'
import { chunkCost, EditPacer, formatClock, paceFor } from './speedReadingPace'
import { syntheticNote } from './speedReadingTestNote'

/** Reads the whole note as the session does, returning words, seconds, and the time left the pacer predicted at the start and halfway. */
function readThrough(text: string, wpm: number, width: number, fixationMs: number) {
  const pacer = new EditPacer(text, nextChunk(text, 0, width)!, width)
  const predictedAtStart = pacer.timeLeftSec(wpm, fixationMs) + pacer.durationSec(wpm, fixationMs)
  const durations: number[] = []
  const predictions: number[] = []
  let words = 0
  for (;;) {
    words += pacer.current.words
    predictions.push(pacer.timeLeftSec(wpm, fixationMs))
    durations.push(pacer.durationSec(wpm, fixationMs))
    if (!pacer.advance()) break
  }
  const seconds = durations.reduce((a, b) => a + b, 0)
  const half = Math.floor(durations.length / 2)
  const actualFromHalf = durations.slice(half + 1).reduce((a, b) => a + b, 0)
  return { words, seconds, predictedAtStart, predictedAtHalf: predictions[half], actualFromHalf }
}

describe('edit view pace', () => {
  const note = syntheticNote(300)

  it('counts the words reading will show without chunking', () => {
    let words = 0
    for (let c = nextChunk(note, 0, 24); c; c = nextChunk(note, c.end, 24)) words += c.words
    expect(countWordsFrom(note, 0)).toBe(words)
  })

  it.each([100, 250, 300, 450, 600, 1000, 1500])('reads at the words per minute shown: %i wpm', (wpm) => {
    for (const width of [12, 24, 40]) {
      const { words, seconds } = readThrough(note, wpm, width, 200)
      expect((words / seconds) * 60 / wpm).toBeGreaterThan(0.99)
      expect((words / seconds) * 60 / wpm).toBeLessThan(1.01)
    }
  })

  it('keeps the reader\'s fixation wherever it fits, and shrinks it only past half the time', () => {
    const cost = chunkCost({ text: 'one two three four.', words: 4 })
    expect(paceFor(cost, 300, 0.2).fixationSec).toBe(0.2)
    const fast = paceFor(cost, 1500, 0.2)
    expect(fast.fixationSec).toBeLessThan(0.2)
    expect(cost.fixations * fast.fixationSec).toBeCloseTo((4 * 60 / 1500) * 0.5, 9)
  })

  it('predicts the time left from the same model', () => {
    for (const wpm of [250, 600, 1200]) {
      const r = readThrough(note, wpm, 24, 200)
      expect(r.predictedAtStart / r.seconds).toBeGreaterThan(0.98)
      expect(r.predictedAtStart / r.seconds).toBeLessThan(1.02)
      expect(r.predictedAtHalf / r.actualFromHalf).toBeGreaterThan(0.98)
      expect(r.predictedAtHalf / r.actualFromHalf).toBeLessThan(1.02)
    }
  })

  it('reaches zero on the last chunk and keeps its sums through steps back', () => {
    const text = 'One two three. Four five, six.\n\nSeven eight nine ten.'
    const pacer = new EditPacer(text, nextChunk(text, 0, 24)!, 24)
    const fresh = pacer.timeLeftSec(300, 200)
    const starts: number[] = []
    do starts.push(pacer.current.start)
    while (pacer.advance())
    expect(pacer.timeLeftSec(300, 200)).toBe(0)
    starts.pop()
    while (starts.length) pacer.back(starts.pop()!)
    expect(pacer.timeLeftSec(300, 200)).toBeCloseTo(fresh, 9)
  })
})

describe('formatClock', () => {
  it('writes hh:mm:ss', () => {
    expect(formatClock(0)).toBe('00:00:00')
    expect(formatClock(59.6)).toBe('00:01:00')
    expect(formatClock(3725)).toBe('01:02:05')
  })
})

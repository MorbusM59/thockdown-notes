import { describe, expect, it } from 'vitest'
import { countWordsFrom, nextChunk } from './speedReadingChunks'
import { chunkCost, EditPacer, formatClock } from './speedReadingPace'
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

  // Pairs where the fixations leave time for letters; at 200ms a 12-box row
  // tops out near 380 wpm and a 24-box row near 580 (the floor, below).
  it.each([[100, 12], [250, 12], [100, 24], [300, 24], [450, 24], [300, 40], [600, 40]])('reads at the words per minute shown: %i wpm, %i boxes', (wpm, w) => {
    for (const width of [w]) {
      const { words, seconds } = readThrough(note, wpm, width, 200)
      expect((words / seconds) * 60 / wpm).toBeGreaterThan(0.99)
      expect((words / seconds) * 60 / wpm).toBeLessThan(1.01)
    }
  })

  it('reads slower than the figure only where the fixations alone exceed it', () => {
    const { words, seconds } = readThrough(note, 1500, 24, 200)
    const chunks: number[] = []
    for (let c = nextChunk(note, 0, 24); c; c = nextChunk(note, c.end, 24)) chunks.push(chunkCost(c).fixations)
    // The floor: every chunk its fixations and nothing for its letters.
    expect(seconds).toBeCloseTo(chunks.reduce((a, b) => a + b, 0) * 0.2, 6)
    expect((words / seconds) * 60).toBeLessThan(1500)
  })

  it('predicts the time left from the same model', () => {
    for (const wpm of [250, 450]) {
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

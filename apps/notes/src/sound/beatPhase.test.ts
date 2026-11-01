import { describe, expect, it } from 'vitest'
import { CaretFold, caretBeat } from './beatPhase'

describe('the caret beat from the map', () => {
  it('is the share of the way from one beat to the next in the caret range', () => {
    expect(caretBeat(10, 10.5, 3, 10.25)).toEqual({ phase: 0.5, period: 0.5 })
  })

  it('takes a fast beat in pairs by its number, so the pairing holds from beat to beat', () => {
    // 174 BPM: the caret pulses at 87, starting on even beats.
    const span = 60 / 174
    expect(caretBeat(0, span, 4, span / 2).phase).toBeCloseTo(0.25)
    expect(caretBeat(span, 2 * span, 5, 1.5 * span).phase).toBeCloseTo(0.75)
    expect(caretBeat(0, span, 4, 0).period).toBeCloseTo(2 * span)
  })

  it('splits a slow beat in two', () => {
    // 60 BPM: the caret pulses at 120.
    const beat = caretBeat(0, 1, 0, 0.75)
    expect(beat.phase).toBeCloseTo(0.5)
    expect(beat.period).toBeCloseTo(0.5)
  })

  it('has no beat without two beats around the moment', () => {
    expect(Number.isNaN(caretBeat(NaN, 1, 0, 0.5).phase)).toBe(true)
    expect(Number.isNaN(caretBeat(0, NaN, 0, 0.5).period)).toBe(true)
  })

  it('holds its octave while the tempo hovers at the edge of the range', () => {
    const fold = new CaretFold()
    // 141, 139, 141, 139 BPM: one octave throughout.
    const periods = [141, 139, 141, 139].map((bpm) => fold.beat(0, 60 / bpm, 2, 0.1).period)
    expect(new Set(periods.map((p) => p > 0.6)).size).toBe(1)
  })
})

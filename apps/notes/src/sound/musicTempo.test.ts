import { describe, expect, it } from 'vitest'
import { createTempoFollower } from './musicTempo'

describe('createTempoFollower', () => {
  // Frames at 60Hz, as the beat loop hears them.
  const frames = (follow: (t: number, p: number) => { beats: number }, from: number, to: number, period: (t: number) => number) => {
    let beats = 0
    for (let t = from; t < to; t += 1 / 60) beats += follow(t, period(t)).beats
    return beats
  }

  it('runs at 60 BPM while there is no beat', () => {
    const follow = createTempoFollower()
    expect(frames(follow, 0, 10, () => NaN)).toBeCloseTo(10, 0)
  })

  it('glides from 60 BPM onto a found beat and settles on it', () => {
    const follow = createTempoFollower()
    frames(follow, 0, 1, () => NaN)
    const first = follow(1 + 1 / 60, 0.5).beatsPerSec
    expect(first).toBeGreaterThan(1)
    expect(first).toBeLessThan(1.05)
    frames(follow, 1 + 2 / 60, 21, () => 0.5)
    expect(follow(21 + 1 / 60, 0.5).beatsPerSec).toBeCloseTo(2, 2)
  })

  it('passes no beats across a seek', () => {
    const follow = createTempoFollower()
    frames(follow, 0, 2, () => 0.5)
    expect(follow(50, 0.5).beats).toBe(0)
  })

  it('eases a change of tempo rather than stepping it, and settles on it', () => {
    const follow = createTempoFollower()
    frames(follow, 0, 5, () => 0.5)
    const first = follow(5 + 1 / 60, 0.25).beatsPerSec
    expect(first).toBeGreaterThan(2)
    expect(first).toBeLessThan(2.1)
    frames(follow, 5 + 2 / 60, 25, () => 0.25)
    expect(follow(25 + 1 / 60, 0.25).beatsPerSec).toBeCloseTo(4, 2)
  })
})

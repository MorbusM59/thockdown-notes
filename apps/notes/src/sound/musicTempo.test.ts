import { describe, expect, it } from 'vitest'
import { createTempoFollower, TEMPO_GLIDE_SEC, type TempoFrame } from './musicTempo'

/** The map as the follower is fed it: phase and period of a grid at `time + TEMPO_GLIDE_SEC`. */
type Map = (time: number) => { beatAt: number; period: number } | null

function run(map: Map, from: number, to: number, follow = createTempoFollower()) {
  const frames: Array<TempoFrame & { t: number }> = []
  for (let t = from; t < to; t += 1 / 60) {
    const g = map(t + TEMPO_GLIDE_SEC)
    const phase = g ? (((t + TEMPO_GLIDE_SEC - g.beatAt) / g.period) % 1 + 1) % 1 : NaN
    frames.push({ ...follow(t, phase, g ? g.period : NaN), t })
  }
  return { frames, follow }
}

const offGrid = (count: number) => Math.abs(count - Math.round(count))

describe('createTempoFollower', () => {
  it('runs at 60 BPM while there is no beat', () => {
    const { frames } = run(() => null, 0, 10)
    expect(frames.reduce((s, f) => s + f.beats, 0)).toBeCloseTo(10, 0)
  })

  it('lands on a found beat exactly as it is heard, at its rate', () => {
    // A 120 BPM grid from t = 10 on, beats at 10.13 + n/2.
    const grid = { beatAt: 10.13, period: 0.5 }
    const { frames } = run((t) => (t >= 10 ? grid : null), 0, 20)
    const landed = frames.find((f) => f.t >= 10)!
    expect(offGrid(landed.count - (landed.t - grid.beatAt) / grid.period)).toBeLessThan(0.02)
    expect(landed.beatsPerSec).toBeCloseTo(2, 1)
    // Before the glide began (6 s), it still ran at 60 BPM.
    expect(frames.find((f) => f.t >= 5.9)!.beatsPerSec).toBeCloseTo(1, 5)
    // Afterwards the count's whole numbers stay on the grid's beats.
    for (const f of frames.filter((f) => f.t > 10.2)) expect(offGrid(f.count - (f.t - grid.beatAt) / grid.period)).toBeLessThan(0.02)
  })

  it('is continuous in position and rate through a glide', () => {
    const { frames } = run((t) => (t >= 10 ? { beatAt: 10.3, period: 0.4 } : null), 0, 20)
    for (let i = 1; i < frames.length; i++) {
      expect(Math.abs(frames[i].beatsPerSec - frames[i - 1].beatsPerSec)).toBeLessThan(0.02)
      expect(frames[i].beats).toBeGreaterThan(0)
    }
  })

  it('glides back to 60 BPM when the beat ends, landing as it ends', () => {
    const { frames } = run((t) => (t < 10 ? { beatAt: 0, period: 0.5 } : null), 0, 20)
    expect(frames.find((f) => f.t >= 5.9)!.beatsPerSec).toBeCloseTo(2, 5)
    expect(frames.find((f) => f.t >= 10.02)!.beatsPerSec).toBeCloseTo(1, 1)
  })

  it('passes no beats across a seek', () => {
    const follow = createTempoFollower()
    follow(0, 0, 0.5)
    follow(1 / 60, 0.03, 0.5)
    expect(follow(50, 0, 0.5).beats).toBe(0)
  })
})

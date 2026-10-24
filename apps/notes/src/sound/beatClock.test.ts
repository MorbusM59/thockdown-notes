import { describe, expect, it } from 'vitest'
import { BeatClock, MAX_PHASE_RATE, type BeatGrid } from './beatClock'

const FRAME = 1 / 60

/** Runs a clock at 60 frames a second and returns the media times it crossed a beat at. */
function ticks(until: number, gridAt: (time: number) => BeatGrid | null): number[] {
  const clock = new BeatClock()
  const out: number[] = []
  let last = NaN
  for (let time = 0; time <= until; time += FRAME) {
    clock.advance(time, gridAt(time))
    const count = clock.beatCount
    if (!Number.isNaN(last) && count > last) out.push(time)
    last = count
  }
  return out
}

/** The distance from `time` to the nearest beat of `grid`, in seconds. */
function offGrid(time: number, grid: BeatGrid): number {
  const beats = (time - grid.beatTime) / grid.periodSec
  return Math.abs(beats - Math.round(beats)) * grid.periodSec
}

describe('BeatClock', () => {
  it('has no beat before it has seen a grid', () => {
    const clock = new BeatClock()
    clock.advance(1, null)
    expect(Number.isNaN(clock.phase)).toBe(true)
  })

  it('ticks on the grid it starts from', () => {
    const grid = { periodSec: 0.5, beatTime: 0.13 }
    const times = ticks(20, () => grid)
    expect(times.length).toBeGreaterThan(35)
    for (const time of times) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME)
  })

  it('follows a change of tempo and phase with steady beats, and locks onto the new grid', () => {
    const first = { periodSec: 0.5, beatTime: 0 }
    const second = { periodSec: 60 / 97, beatTime: 30.21 }
    const times = ticks(60, (time) => (time < 30 ? first : second))
    for (let i = 2; i < times.length; i++) {
      const before = times[i - 1] - times[i - 2]
      const now = times[i] - times[i - 1]
      // No beat is cut or stretched by more than the phase correction allows, plus the tempo glide and a frame either side.
      expect(Math.abs(now - before)).toBeLessThanOrEqual(before * (MAX_PHASE_RATE + 0.1) + 2 * FRAME)
    }
    for (const time of times.filter((t) => t > 45)) expect(offGrid(time, second)).toBeLessThanOrEqual(FRAME + 0.002)
  })

  it('holds the beat through a stretch with no grid', () => {
    const grid = { periodSec: 0.48, beatTime: 0 }
    const times = ticks(40, (time) => (time > 15 && time < 30 ? null : grid))
    const gap = times.filter((t) => t > 16 && t < 30)
    for (let i = 1; i < gap.length; i++) expect(Math.abs(gap[i] - gap[i - 1] - 0.48)).toBeLessThanOrEqual(FRAME)
    for (const time of gap) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME + 0.002)
  })
})

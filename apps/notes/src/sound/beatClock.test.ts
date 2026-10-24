import { describe, expect, it } from 'vitest'
import { BeatClock, MAX_PHASE_RATE } from './beatClock'

const FRAME = 1 / 60

interface Grid { periodSec: number; beatTime: number }

/**
 * Plays a clock at 60 frames a second along a listener's timeline (pieces of
 * media time, each a seek from the last) and returns the media times it
 * crossed a beat at, with whether a frame ever crossed more than one.
 */
function play(pieces: Array<[from: number, to: number]>, gridAt: (time: number) => Grid | null): { ticks: number[]; doubled: boolean } {
  const clock = new BeatClock()
  const ticks: number[] = []
  let doubled = false
  for (const [from, to] of pieces) {
    let last = NaN
    for (let frame = 0; from + frame * FRAME <= to; frame++) {
      const time = from + frame * FRAME
      const grid = gridAt(time)
      clock.advance(time, grid?.periodSec ?? NaN, grid?.beatTime ?? NaN)
      const count = Math.floor(clock.position)
      if (!Number.isNaN(last) && count > last) {
        ticks.push(time)
        if (count - last > 1) doubled = true
      }
      last = count
    }
  }
  return { ticks, doubled }
}

/** The distance from `time` to the nearest beat of `grid`, in seconds. */
function offGrid(time: number, grid: Grid): number {
  const beats = (time - grid.beatTime) / grid.periodSec
  return Math.abs(beats - Math.round(beats)) * grid.periodSec
}

/** Every interval between consecutive ticks within `bound` of the one before (as a share of it, plus a frame's quantization either side). */
function expectSteady(ticks: number[], bound: number): void {
  for (let i = 2; i < ticks.length; i++) {
    const before = ticks[i - 1] - ticks[i - 2]
    const now = ticks[i] - ticks[i - 1]
    expect(Math.abs(now - before)).toBeLessThanOrEqual(before * bound + 2 * FRAME)
  }
}

describe('BeatClock', () => {
  it('has no beat before it has seen a grid', () => {
    const clock = new BeatClock()
    clock.advance(1, NaN, NaN)
    expect(Number.isNaN(clock.phase)).toBe(true)
  })

  it('ticks on the grid it starts from', () => {
    const grid = { periodSec: 0.5, beatTime: 0.13 }
    const { ticks, doubled } = play([[0, 20]], () => grid)
    expect(ticks.length).toBeGreaterThan(35)
    expect(doubled).toBe(false)
    for (const time of ticks) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME)
  })

  it('follows a change of tempo and phase with steady beats, and locks onto the new grid', () => {
    const first = { periodSec: 0.5, beatTime: 0 }
    const second = { periodSec: 60 / 97, beatTime: 30.21 }
    const { ticks, doubled } = play([[0, 60]], (time) => (time < 30 ? first : second))
    expect(doubled).toBe(false)
    // The phase limit with a little for the tempo's glide: well short of the quarter an unlimited correction makes here.
    expectSteady(ticks, MAX_PHASE_RATE + 0.03)
    for (const time of ticks.filter((t) => t > 45)) expect(offGrid(time, second)).toBeLessThanOrEqual(FRAME + 0.002)
  })

  it('follows the tempo halving and doubling', () => {
    const base = { periodSec: 0.5, beatTime: 0 }
    const half = { periodSec: 1, beatTime: 0 }
    const { ticks, doubled } = play([[0, 60]], (time) => (time < 20 ? base : time < 40 ? half : base))
    expect(doubled).toBe(false)
    expectSteady(ticks, 0.4)
    for (const time of ticks.filter((t) => t > 32 && t < 40)) expect(offGrid(time, half)).toBeLessThanOrEqual(FRAME + 0.002)
    const late = ticks.filter((t) => t > 52)
    for (const time of late) expect(offGrid(time, base)).toBeLessThanOrEqual(FRAME + 0.002)
    expect(late[late.length - 1] - late[late.length - 2]).toBeCloseTo(0.5, 1)
  })

  it('holds the beat through a stretch with no grid', () => {
    const grid = { periodSec: 0.48, beatTime: 0 }
    const { ticks } = play([[0, 40]], (time) => (time > 15 && time < 30 ? null : grid))
    const gap = ticks.filter((t) => t > 16 && t < 30)
    for (let i = 1; i < gap.length; i++) expect(Math.abs(gap[i] - gap[i - 1] - 0.48)).toBeLessThanOrEqual(FRAME)
    for (const time of gap) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME + 0.002)
  })

  it('keeps beating after a seek backwards', () => {
    const grid = { periodSec: 0.5, beatTime: 0 }
    const { ticks, doubled } = play([[0, 60], [10, 40]], () => grid)
    expect(doubled).toBe(false)
    const after = ticks.filter((t, i) => i > 0 && ticks[i - 1] > t || false)
    expect(after.length).toBe(1)
    const replay = ticks.slice(ticks.indexOf(after[0]))
    expect(replay.length).toBeGreaterThan(55)
    for (const time of replay) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME)
  })

  it('runs on its tempo after a seek forward and seats on the grid the moment it returns', () => {
    const grid = { periodSec: 0.5, beatTime: 0.1 }
    // The new position's analysis has no grid for its first four seconds, as after a real seek.
    const { ticks, doubled } = play([[0, 20], [100.27, 120]], (time) => (time > 20 && time < 104.27 ? null : grid))
    expect(doubled).toBe(false)
    const unseated = ticks.filter((t) => t > 100.27 && t < 104.27)
    expect(unseated.length).toBeGreaterThanOrEqual(7)
    for (let i = 1; i < unseated.length; i++) expect(Math.abs(unseated[i] - unseated[i - 1] - 0.5)).toBeLessThanOrEqual(FRAME)
    const seated = ticks.filter((t) => t > 104.27)
    expectSteady(seated, 0)
    for (const time of seated) expect(offGrid(time, grid)).toBeLessThanOrEqual(FRAME)
  })
})

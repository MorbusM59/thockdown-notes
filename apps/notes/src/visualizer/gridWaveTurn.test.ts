import { describe, expect, it } from 'vitest'
import { WAVE_ANGLES_AT_REST, createTempoFollower, advanceWaveAngles, nestedWavePoint, waveTurnTransform } from './gridWaveTurn'

/** The band value (0..1 along one wave length) a stripe pattern shows at `point`, after `transform` (`translate(..) rotate(..)`). */
function bandAt(point: { x: number; y: number }, transform: string, periodPx: number): number {
  const [tx, ty, angle] = transform.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g)!.map(Number)
  const local = { x: point.x - tx, y: point.y - ty }
  const along = local.x * Math.cos(angle) + local.y * Math.sin(angle)
  return ((along / periodPx) % 1 + 1) % 1
}

/** The band value the literal nested layers show at `point`: invert the nesting and read the local x. */
function nestedBandAt(point: { x: number; y: number }, angles: Parameters<typeof nestedWavePoint>[1], widthPx: number, periodPx: number): number {
  const origin = nestedWavePoint({ x: 0, y: 0 }, angles, widthPx)
  const ex = nestedWavePoint({ x: 1, y: 0 }, angles, widthPx)
  const ux = ex.x - origin.x
  const uy = ex.y - origin.y
  const along = (point.x - origin.x) * ux + (point.y - origin.y) * uy
  return ((along / periodPx) % 1 + 1) % 1
}

describe('waveTurnTransform', () => {
  it('draws exactly what the three nested pivots draw, at every angle and point', () => {
    const widthPx = 1920
    const periodPx = 300
    let angles = WAVE_ANGLES_AT_REST
    for (let frame = 0; frame < 200; frame++) {
      angles = advanceWaveAngles(angles, frame % 2 === 0 ? 3 : -5, 0.37)
      const transform = waveTurnTransform(angles, widthPx, periodPx)
      for (const point of [{ x: 0, y: 0 }, { x: 900, y: -500 }, { x: -960, y: 540 }, { x: 123, y: 456 }]) {
        const single = bandAt(point, transform, periodPx)
        const nested = nestedBandAt(point, angles, widthPx, periodPx)
        const gap = Math.abs(single - nested)
        expect(Math.min(gap, 1 - gap)).toBeLessThan(1e-6)
      }
    }
  })

  it('never moves the layer more than one wave length from the centre', () => {
    let angles = WAVE_ANGLES_AT_REST
    for (let frame = 0; frame < 500; frame++) {
      angles = advanceWaveAngles(angles, 5, 0.11)
      const [tx, ty] = waveTurnTransform(angles, 2560, 200).match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g)!.map(Number)
      expect(Math.hypot(tx, ty)).toBeLessThanOrEqual(200 + 1e-9)
    }
  })
})

describe('advanceWaveAngles', () => {
  it('turns the tertiary once per its beats, the secondary four and the primary sixteen times slower, the sign giving the direction', () => {
    const after = advanceWaveAngles(WAVE_ANGLES_AT_REST, 3, 4)
    expect(after.tertiary).toBeCloseTo(2 * Math.PI)
    expect(after.secondary).toBeCloseTo(Math.PI / 2)
    expect(after.primary).toBeCloseTo(Math.PI / 8)
    expect(advanceWaveAngles(WAVE_ANGLES_AT_REST, -5, 1).tertiary).toBeCloseTo(-2 * Math.PI)
  })

  it('rests upright at step 0', () => {
    expect(advanceWaveAngles({ primary: 1, secondary: 2, tertiary: 3 }, 0, 1)).toEqual(WAVE_ANGLES_AT_REST)
  })
})

describe('createTempoFollower', () => {
  // Frames at 60Hz, as the beat loop hears them.
  const frames = (follow: (t: number, p: number) => number, from: number, to: number, period: (t: number) => number) => {
    let beats = 0
    for (let t = from; t < to; t += 1 / 60) beats += follow(t, period(t))
    return beats
  }

  it('turns from the first locked frame of ordinary playback, at the beat rate', () => {
    const follow = createTempoFollower()
    // Unlocked for a second, then a steady 120 BPM with no seek in between.
    frames(follow, 0, 1, () => NaN)
    const beats = frames(follow, 1, 11, () => 0.5)
    expect(beats).toBeCloseTo(20, 0)
  })

  it('passes no beats across a seek or while there is no beat', () => {
    const follow = createTempoFollower()
    frames(follow, 0, 2, () => 0.5)
    expect(follow(50, 0.5)).toBe(0)
    expect(follow(50 + 1 / 60, NaN)).toBe(0)
  })

  it('eases a change of tempo rather than stepping it, and settles on it', () => {
    const follow = createTempoFollower()
    frames(follow, 0, 5, () => 0.5)
    const first = follow(5 + 1 / 60, 0.25) * 60
    expect(first).toBeGreaterThan(2)
    expect(first).toBeLessThan(2.1)
    frames(follow, 5 + 2 / 60, 25, () => 0.25)
    expect(follow(25 + 1 / 60, 0.25) * 60).toBeCloseTo(4, 2)
  })
})

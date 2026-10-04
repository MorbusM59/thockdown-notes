import { describe, expect, it } from 'vitest'
import { resolveSeekPress, resolveSeekTarget, SEEK_TAIL_GUARD_SEC } from './MusicPlayerService'

const DURATION = 200
const END = DURATION - SEEK_TAIL_GUARD_SEC

describe('seek targeting', () => {
  it('lands where asked when the move fits inside the track', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(50, DURATION, 0.2)
    expect(timeSec).toBe(90)
    expect(overshootSec).toBe(0)
  })

  it('rewinds inside the track without reporting an overshoot', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(50, DURATION, -0.2)
    expect(timeSec).toBe(10)
    expect(overshootSec).toBe(0)
  })

  it('stops short of the true end so it cannot fire `ended` itself', () => {
    // Two code paths would otherwise handle the same crossing: this one, and
    // the ended handler that auto-advances.
    const { timeSec } = resolveSeekTarget(DURATION - 1, DURATION, 0.2)
    expect(timeSec).toBe(END)
    expect(timeSec).toBeLessThan(DURATION)
  })

  // The overshoot is how far INTO the next song the scrub should continue --
  // it is the seek that was asked for minus the part the track could absorb.
  it('reports how far past the end the seek ran', () => {
    const { overshootSec } = resolveSeekTarget(DURATION - 1, DURATION, 0.2)
    expect(overshootSec).toBeCloseTo((DURATION - 1 + 40) - END, 10)
  })

  // Negative, and its magnitude is how far before the END of the previous song
  // to land -- the sign is what tells the two crossings apart.
  it('reports how far before the start the seek ran, as a negative', () => {
    const { timeSec, overshootSec } = resolveSeekTarget(10, DURATION, -0.2)
    expect(timeSec).toBe(0)
    expect(overshootSec).toBe(-30)
  })

  it('treats a seek that lands exactly on a boundary as no crossing', () => {
    expect(resolveSeekTarget(30, DURATION, -0.15).overshootSec).toBe(0)
    expect(resolveSeekTarget(30, DURATION, -0.15).timeSec).toBe(0)
  })

  // A held scrub is repeated 5% steps; from a standstill at either end every
  // one of them has to keep crossing, not stall once the playhead is pinned.
  it('keeps reporting a crossing on every step once pinned at an end', () => {
    expect(resolveSeekTarget(0, DURATION, -0.05).overshootSec).toBe(-10)
    expect(resolveSeekTarget(END, DURATION, 0.05).overshootSec).toBeCloseTo(10, 10)
  })
})

describe('seek button presses', () => {
  const D = 200
  const press = (at: number, fraction: number) => resolveSeekPress(at, D, fraction)

  it('moves within the track when the step fits', () => {
    expect(press(100, 0.2)).toEqual({ kind: 'within', timeSec: 140 })
    expect(press(100, -0.2)).toEqual({ kind: 'within', timeSec: 60 })
  })

  // A press is a command, not a motion: with 1% left, forward means the next
  // song, not 19% into it.
  it('goes to the next song when less than a step is left', () => {
    expect(press(D - 1, 0.2)).toEqual({ kind: 'next-song' })
    expect(press(161, 0.2)).toEqual({ kind: 'next-song' })
    // Exactly a step left still fits inside the track.
    expect(press(160, 0.2)).toEqual({ kind: 'within', timeSec: D })
  })

  it('restarts the song when less than a step in, rather than wrapping back', () => {
    expect(press(30, -0.2)).toEqual({ kind: 'restart' })
    expect(press(40, -0.2)).toEqual({ kind: 'within', timeSec: 0 })
  })

  // The transport-control convention: in the opening seconds, back means the
  // previous track, entered near its end.
  it('reaches the previous song when pressed in the first two seconds', () => {
    expect(press(0, -0.2)).toEqual({ kind: 'previous-song', entryFraction: 0.8 })
    expect(press(1.999, -0.2)).toEqual({ kind: 'previous-song', entryFraction: 0.8 })
    // At the boundary it is a restart again.
    expect(press(2, -0.2)).toEqual({ kind: 'restart' })
  })

  it('takes the grace window over the restart rule, not the other way round', () => {
    // Both rules match at t=1 on a long track; the previous-song one must win.
    expect(press(1, -0.2).kind).toBe('previous-song')
  })

  it('never leaves the current song when the duration is unknown', () => {
    // A crossing computed from a missing duration would be a guess.
    expect(resolveSeekPress(5, 0, 0.2)).toEqual({ kind: 'within', timeSec: 5 })
    expect(resolveSeekPress(5, Number.NaN, -0.2)).toEqual({ kind: 'within', timeSec: 5 })
  })

  // A short track makes the two backward rules overlap heavily: 20% of a 5s
  // track is 1s, well inside the 2s grace window.
  it('still prefers the previous song on a very short track', () => {
    expect(resolveSeekPress(1.5, 5, -0.2).kind).toBe('previous-song')
    expect(resolveSeekPress(3, 5, -0.2)).toEqual({ kind: 'within', timeSec: 2 })
  })
})

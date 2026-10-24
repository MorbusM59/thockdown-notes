/**
 * A steady beat for the visualizer's caret (`musicBeat.ts`), FOLLOWING the
 * drum tracker's tempo grid (`DrumTracker.beatGrid`) rather than any hit it
 * detects. Pure: it is advanced with a media time and the grid in force at
 * that time, so `beatClock.test.ts` drives it with no audio stack.
 *
 * The clock is a phase accumulator, counted in beats. Each advance moves it
 * on by the elapsed time over its own period, and while a grid is in force
 * steers two things toward it, each by an exponential approach so a change of
 * grid is a glide rather than a jump:
 *
 * - the PERIOD, toward the grid's, with a time constant of `TEMPO_TAU_SEC`.
 *   A long compilation track changes tempo between its pieces, and the
 *   tracker's grid (read from the ten seconds around the listener) follows
 *   each piece; the clock follows the grid.
 * - the PHASE, toward the grid's beat, by its error wrapped to half a beat
 *   either way, with a time constant of `PHASE_TAU_SEC`, and never by more
 *   than `MAX_PHASE_RATE` of the clock's own advance, so a beat is never
 *   shortened or lengthened by more than that share while it re-locks.
 *
 * With no grid in force (the tracker unlocked, or a new analysis still
 * filling its window after a seek) the clock runs on at its last period and
 * phase, so a break or a fill is carried through on the established beat.
 * A clock that has never seen a grid has no phase at all.
 */

/** The tracker's grid: its beat period and the media time of one beat on it. */
export interface BeatGrid {
  periodSec: number
  beatTime: number
}

const TEMPO_TAU_SEC = 1.5
const PHASE_TAU_SEC = 1
/** The most a phase correction may add to or take from a beat, as a share of it. */
export const MAX_PHASE_RATE = 0.15
/** An advance longer than this is a jump in the listener's time (a seek, a stall), not a frame. */
const MAX_STEP_SEC = 0.5

/** `x` wrapped into -0.5..0.5. */
function wrapHalf(x: number): number {
  return x - Math.round(x)
}

export class BeatClock {
  /** The clock's position in beats at media time `time`; NaN before the first grid. */
  private beats = NaN
  private time = NaN
  private periodSec = NaN

  reset(): void {
    this.beats = NaN
    this.time = NaN
    this.periodSec = NaN
  }

  /** Moves the clock to media time `time`, steered toward `grid` when one is in force. */
  advance(time: number, grid: BeatGrid | null): void {
    if (Number.isNaN(this.periodSec)) {
      if (!grid) return
      this.seat(time, grid)
      return
    }
    const dt = time - this.time
    if (dt <= 0) return
    if (dt > MAX_STEP_SEC) {
      // The listener jumped: land where the grid says, or where the clock's own beat would be.
      if (grid) this.seat(time, grid)
      else {
        this.beats += dt / this.periodSec
        this.time = time
      }
      return
    }
    if (grid) this.periodSec += (grid.periodSec - this.periodSec) * (1 - Math.exp(-dt / TEMPO_TAU_SEC))
    const step = dt / this.periodSec
    let correction = 0
    if (grid) {
      const error = wrapHalf((time - grid.beatTime) / grid.periodSec - (this.beats + step))
      const limit = MAX_PHASE_RATE * step
      correction = Math.max(-limit, Math.min(limit, error * (1 - Math.exp(-dt / PHASE_TAU_SEC))))
    }
    this.beats += step + correction
    this.time = time
  }

  private seat(time: number, grid: BeatGrid): void {
    this.periodSec = grid.periodSec
    this.beats = (time - grid.beatTime) / grid.periodSec
    this.time = time
  }

  /** How far into the current beat the clock is, 0..1; NaN before the first grid. */
  get phase(): number {
    return this.beats - Math.floor(this.beats)
  }

  /** The whole beats counted so far; NaN before the first grid. */
  get beatCount(): number {
    return Math.floor(this.beats)
  }

  /** The clock's beat period, in seconds; NaN before the first grid. */
  get period(): number {
    return this.periodSec
  }
}

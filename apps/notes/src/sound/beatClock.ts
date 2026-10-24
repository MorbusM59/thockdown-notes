/**
 * A steady beat for the visualizer's caret (`musicBeat.ts`), FOLLOWING the
 * drum tracker's tempo grid (`DrumTracker.gridPeriodSec`/`gridBeatTime`)
 * rather than any hit it detects. Pure: it is advanced with a media time and
 * the grid in force at that time, so `beatClock.test.ts` drives it with no
 * audio stack.
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
 * With no grid in force (the tracker unlocked through a break) the clock runs
 * on at its last period and phase, so a fill or a break is carried through on
 * the established beat.
 *
 * A JUMP in the listener's time (a seek either way, or a stall: any advance
 * that is not a short step forward, and every `restart`) leaves the clock
 * UNSEATED: its period is kept, since the music around the new position is
 * most likely at the same tempo, but its phase means nothing there. An
 * unseated clock runs on its period from the moment it landed and takes the
 * next grid it is given AS IT IS, period and phase, rather than gliding to
 * it: gliding from a phase that was never the music's showed as several
 * uneven beats. A clock that has never seen a grid has no beat at all.
 */

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
  /** Whether the phase was taken from a grid since the last jump. */
  private seated = false

  /** Forgets everything: a new track. */
  reset(): void {
    this.beats = NaN
    this.time = NaN
    this.periodSec = NaN
    this.seated = false
  }

  /** The listener's time jumped: the tempo is kept and the next grid is taken as it is. */
  restart(): void {
    this.seated = false
    this.time = NaN
  }

  /**
   * Moves the clock to media time `time`, steered toward the grid of period
   * `gridPeriodSec` with a beat at `gridBeatTime`; a NaN period is no grid.
   */
  advance(time: number, gridPeriodSec: number, gridBeatTime: number): void {
    const grid = !Number.isNaN(gridPeriodSec)
    const dt = time - this.time
    if (!(dt > 0 && dt <= MAX_STEP_SEC)) {
      // A jump (or the first advance since one): land on the grid if there is
      // one, otherwise run on from here at the kept period, unseated.
      if (dt === 0) return
      this.restart()
      this.time = time
    }
    if (grid && !this.seated) {
      this.periodSec = gridPeriodSec
      const target = (time - gridBeatTime) / gridPeriodSec
      // Seated FORWARD, by less than a beat, so a seat can shorten one beat
      // but never runs the count back over a beat already shown.
      this.beats = Number.isNaN(this.beats) ? target : this.beats + (target - this.beats - Math.floor(target - this.beats))
      this.time = time
      this.seated = true
      return
    }
    if (Number.isNaN(this.periodSec) || Number.isNaN(this.beats) || !(dt > 0 && dt <= MAX_STEP_SEC)) return
    if (grid) this.periodSec += (gridPeriodSec - this.periodSec) * (1 - Math.exp(-dt / TEMPO_TAU_SEC))
    const step = dt / this.periodSec
    let correction = 0
    if (grid && this.seated) {
      const error = wrapHalf((time - gridBeatTime) / gridPeriodSec - (this.beats + step))
      const limit = MAX_PHASE_RATE * step
      correction = Math.max(-limit, Math.min(limit, error * (1 - Math.exp(-dt / PHASE_TAU_SEC))))
    }
    this.beats += step + correction
    this.time = time
  }

  /** How far into the current beat the clock is, 0..1; NaN before the first grid. */
  get phase(): number {
    return this.beats - Math.floor(this.beats)
  }

  /** The clock's position in beats, which only moves forward between jumps; NaN before the first grid. */
  get position(): number {
    return this.beats
  }

  /** The clock's beat period, in seconds; NaN before the first grid. */
  get period(): number {
    return this.periodSec
  }
}

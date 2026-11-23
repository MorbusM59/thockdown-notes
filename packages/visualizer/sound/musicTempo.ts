/**
 * THE app's tempo: one definition of how fast the music's beat runs, read by
 * everything that moves "per beat" (the grid wave's travel and turn, the
 * glare's orbit). `musicBeat.ts` runs ONE follower over the beat map and
 * hands every `subscribeMusicTempo` listener the same beats, rate and count,
 * so no two readers can disagree about the tempo or about how it changes.
 *
 * The follower keeps a COUNT of beats. While the beat map holds a beat, the
 * count's whole numbers fall on the map's beats; while it holds none (a
 * track's warm-up, after a seek, a passage it cannot follow), the count runs
 * at `NO_BEAT_PERIOD_SEC`, 60 BPM, with no grid to sit on.
 *
 * Every change (a beat found or lost, a new tempo, a grid re-seated or read
 * at double or half) is ONE glide of `TEMPO_GLIDE_SEC`: a cubic Hermite in
 * the count that starts from the count's present position and rate and ends
 * on the new grid's position AND rate, so the count lands exactly on the
 * grid's beat at the glide's end and carries on with it from there. The glide
 * is PROACTIVE: the follower is fed the map as it will be `TEMPO_GLIDE_SEC`
 * ahead (the map is planned a minute ahead of the listener), so a glide that
 * starts now lands at the moment the change is heard, never four seconds
 * after it.
 *
 * Readers that move "per beat" stay ON the beat by starting from the count's
 * share of a beat (`beatAlignedStart`) and then adding the beats each frame
 * passes, which are exactly the count's steps: their phase is the count's for
 * as long as they run, while a change of their own rate never jumps them.
 */

/** The beat period while there is no beat: 60 BPM. */
export const NO_BEAT_PERIOD_SEC = 1
/** How long every change of tempo takes, and how far ahead the follower reads the map. */
export const TEMPO_GLIDE_SEC = 4
/** A frame further than this from the last is a seek or a stall, not playback. */
const MAX_FRAME_SEC = 0.25
/** How far the map may drift from the grid the count is landing on or following before a new glide is planned: in beats of phase, and as a share of the period. */
const PHASE_TOLERANCE = 0.03
const PERIOD_TOLERANCE = 0.01

/** The grid the count lands on: its beats are `beatAt + n x period`; `free` when there is no beat (60 BPM, any phase). */
type Grid = { free: true; period: number } | { free: false; beatAt: number; period: number }

export type TempoFrame = { beats: number; beatsPerSec: number; count: number }

/**
 * Turns the time heard and the map's beat as it will be `TEMPO_GLIDE_SEC`
 * later (its phase 0..1 and period at `timeSec + TEMPO_GLIDE_SEC`, NaN while
 * the map holds no beat there), frame by frame, into the beats that passed,
 * the rate in beats a second and the count. The first frame takes the grid
 * as it is;
 * every other change, a seek or a stall included (which passes no beats),
 * is a glide that lands on it at `timeSec + TEMPO_GLIDE_SEC`.
 */
export function createTempoFollower(): (timeSec: number, aheadPhase: number, aheadPeriod: number) => TempoFrame {
  let lastTime = NaN
  let count = 0
  let rate = NaN
  let grid: Grid | null = null
  // The glide in progress: from (t0, b0, v0) to (t1, b1, v1).
  let t0 = NaN, t1 = NaN, b0 = 0, b1 = 0, v0 = 0, v1 = 0

  /** Where `g` puts the count at `t`, given that it is at `b` at `t1` (so a free grid keeps the count's own phase). */
  const followed = (g: Grid, t: number) => b1 + (t - t1) / g.period

  /** The count and rate at `t` on the plan (the glide, then its grid). */
  const planAt = (t: number): [number, number] => {
    if (t >= t1 || !grid) return [followed(grid!, t), 1 / grid!.period]
    const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s
    const pos = (2 * s3 - 3 * s2 + 1) * b0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * b1 + (s3 - s2) * h * v1
    const vel = ((6 * s2 - 6 * s) * b0 + (3 * s2 - 4 * s + 1) * h * v0 + (-6 * s2 + 6 * s) * b1 + (3 * s2 - 2 * s) * h * v1) / h
    return [pos, vel]
  }

  /** Whether `next` is the grid the plan already lands on (the free grid's phase is anything). */
  const sameGrid = (next: Grid, at: number) => {
    if (!grid || grid.free !== next.free) return false
    if (Math.abs(next.period / grid.period - 1) > PERIOD_TOLERANCE) return false
    if (next.free) return true
    const drift = followed(grid, at) - (at - next.beatAt) / next.period
    return Math.abs(drift - Math.round(drift)) <= PHASE_TOLERANCE
  }

  /** Plans a glide from the count's position and rate at `t` that lands on `next` at `t + TEMPO_GLIDE_SEC`. */
  const glideTo = (next: Grid, t: number) => {
    t0 = t
    t1 = t + TEMPO_GLIDE_SEC
    b0 = count
    v0 = rate
    v1 = 1 / next.period
    // Where a steady change of rate would arrive, moved to the grid's nearest beat phase.
    const natural = b0 + (TEMPO_GLIDE_SEC * (v0 + v1)) / 2
    if (next.free) b1 = natural
    else {
      const phase = (t1 - next.beatAt) / next.period
      b1 = natural + (phase - natural) - Math.round(phase - natural)
    }
    grid = next
  }

  return (timeSec, aheadPhase, aheadPeriod) => {
    const at = timeSec + TEMPO_GLIDE_SEC
    const next: Grid = aheadPeriod > 0 && !Number.isNaN(aheadPhase)
      ? { free: false, beatAt: at - aheadPhase * aheadPeriod, period: aheadPeriod }
      : { free: true, period: NO_BEAT_PERIOD_SEC }
    const dt = timeSec - lastTime
    lastTime = timeSec
    if (!grid) {
      // The first frame: the count joins the grid where it stands now.
      rate = 1 / next.period
      grid = next
      t0 = t1 = timeSec
      count = b1 = next.free ? 0 : (timeSec - next.beatAt) / next.period
      return { beats: 0, beatsPerSec: rate, count }
    }
    if (!(dt > 0 && dt < MAX_FRAME_SEC)) {
      // A seek or a stall: no beats pass, and the count glides from where it
      // stands onto whatever grid is there, so it never jumps.
      glideTo(next, timeSec)
      return { beats: 0, beatsPerSec: rate, count }
    }
    const [pos, vel] = planAt(timeSec)
    const beats = pos - count
    count = pos
    rate = vel
    if (!sameGrid(next, at)) glideTo(next, timeSec)
    return { beats, beatsPerSec: rate, count }
  }
}

/** What a per-beat reader adds on its first frame, so that from then on its beats keep the count's phase: the count's share of a beat. */
export function beatAlignedStart(count: number): number {
  return count - Math.floor(count)
}

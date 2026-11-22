/**
 * THE app's tempo: one definition of how fast the music's beat runs, read by
 * everything that moves "per beat" (the grid wave's travel and turn, the
 * glare's orbit). `musicBeat.ts` runs ONE follower over the beat map and
 * hands every `subscribeMusicTempo` listener the same beats and rate, so no
 * two readers can disagree about the tempo or about how it changes.
 *
 * While the music plays and the beat map holds no beat (a track's warm-up,
 * after a seek, a passage it cannot follow), the tempo is `NO_BEAT_PERIOD_SEC`,
 * 60 BPM. Every change of the target, beat found, beat lost, a new tempo, a
 * grid read at double or half, is eased over `TEMPO_EASE_SEC` along one
 * exponential, so the transition between no beat and beat is the same
 * steady glide for every reader.
 */

/** The beat period while there is no beat: 60 BPM. */
export const NO_BEAT_PERIOD_SEC = 1
/** How quickly the rate follows a change of its target. */
export const TEMPO_EASE_SEC = 2
/** A frame further than this from the last is a seek or a stall, not playback. */
const MAX_FRAME_SEC = 0.25

/**
 * Turns the heard time and the beat map's period (NaN while it holds no
 * beat), frame by frame, into the beats that passed and the eased rate in
 * beats a second. The first frame takes its target as it is; a frame
 * further than `MAX_FRAME_SEC` from the last (a seek, a stall) passes no
 * beats.
 */
export function createTempoFollower(): (timeSec: number, periodSec: number) => { beats: number; beatsPerSec: number } {
  let lastTime = NaN
  let beatsPerSec = NaN
  return (timeSec, periodSec) => {
    const dt = timeSec - lastTime
    lastTime = timeSec
    const target = 1 / (periodSec > 0 ? periodSec : NO_BEAT_PERIOD_SEC)
    if (Number.isNaN(beatsPerSec)) beatsPerSec = target
    if (!(dt > 0 && dt < MAX_FRAME_SEC)) return { beats: 0, beatsPerSec }
    beatsPerSec += (target - beatsPerSec) * (1 - Math.exp(-dt / TEMPO_EASE_SEC))
    return { beats: dt * beatsPerSec, beatsPerSec }
  }
}

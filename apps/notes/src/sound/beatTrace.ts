// The opt-in beat-pulse trace: how well the drum tracker's clock follows the
// music, for a beat that drifts out of step in a real session.
//
// `localStorage['thockdown:debug-beat'] = '1'` (read live, so it can be set
// from the console with the music already playing), then
// `copy(window.__beatTrace.join('\n'))`. Attaches nothing when unset.
//
// Three kinds of line, all stamped with the scout's media time:
// - `beat sec`: once a second, the stamp jitter the tracker averaged away
//   (the media element's reported position against where the sample count
//   puts it: mean and spread, in ms), samples lost to long frames, and the
//   tempo grid (BPM, or `--` while unlocked, and its confidence). A spread
//   above about one hop (5.3ms) is what used to walk the clock off the music.
// - `beat RESTART`: the tracker started over, and why: `gap` (more samples
//   lost at once than it fills with silence) or `drift` (the stamp moved
//   further than a seek or a stall would explain).
// - `beat RESYNC`: the scout was put back on its lead (a seek, a new track,
//   or the scout falling behind), which restarts every band.

import type { DrumTracker } from './drumTracker'

const BEAT_TRACE_FLAG = 'thockdown:debug-beat'
const BEAT_TRACE_LIMIT = 400

interface BeatTraceHost {
  __beatTrace?: string[]
}

export function isBeatTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(BEAT_TRACE_FLAG) === '1'
  } catch {
    return false
  }
}

export function appendBeatTrace(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as BeatTraceHost
  if (!host.__beatTrace) host.__beatTrace = []
  host.__beatTrace.push(line)
  if (host.__beatTrace.length > BEAT_TRACE_LIMIT) host.__beatTrace.splice(0, host.__beatTrace.length - BEAT_TRACE_LIMIT)
  console.log(line)
}

/** One tracker's readings since its last summary line. */
export class BeatTraceWindow {
  private drifts: number[] = []
  private lost = 0
  private since = NaN

  /** Records the feed the tracker just took; writes a RESTART at once and a summary once a second. */
  record(tracker: DrumTracker, lost: number, mediaTime: number): void {
    const at = mediaTime.toFixed(3)
    if (tracker.lastRestart) appendBeatTrace(`beat RESTART ${tracker.lastRestart} at=${at} drift=${(tracker.lastDriftSec * 1000).toFixed(1)}ms lost=${lost}`)
    else if (tracker.lastDriftSec !== 0) this.drifts.push(tracker.lastDriftSec * 1000)
    this.lost += lost
    if (Number.isNaN(this.since)) this.since = mediaTime
    if (mediaTime - this.since < 1 && mediaTime >= this.since) return
    const n = this.drifts.length
    const mean = n > 0 ? this.drifts.reduce((a, b) => a + b, 0) / n : 0
    const spread = n > 0 ? Math.sqrt(this.drifts.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0
    const bpm = tracker.tempoBpm
    appendBeatTrace(
      `beat sec at=${at} feeds=${n} jitter mean=${mean.toFixed(2)}ms sd=${spread.toFixed(2)}ms lost=${this.lost}`
        + ` bpm=${Number.isNaN(bpm) ? '--' : bpm.toFixed(1)} conf=${tracker.gridConfidence.toFixed(2)}`,
    )
    this.drifts = []
    this.lost = 0
    this.since = mediaTime
  }
}

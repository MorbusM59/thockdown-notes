/**
 * THE SOUNDSCAPE, AS THE VISUALIZER READS IT, beside the music: its HITS
 * and its GUST (soundscape-generator.js, SIGNALS). The soundscape is
 * generated, so nothing here detects anything: the generator says when each
 * large drop (a drip), each drop that stands out of the rain and each chime
 * strike happens, how loud it is and how far it stands above its own layer,
 * and what the scene's gust is. Each platform delivers them stamped with the
 * moment they are HEARD, on the page's performance clock (seconds):
 * `desktopMusicListening.ts` from the worklet, the phone's
 * `nativeSoundscapeVisuals.ts` from the renderer.
 *
 * A hit feeds a TRACKER (`musicBeat.ts`), as a drum score instance does:
 * a drip the TICK, a drop the PIERCE, a chime the THUMP (`HIT_TRACKER`). Its
 * response is two factors:
 * - how it stands out of the SOUNDSCAPE: its salience (peak over its layer's
 *   floor) as a strength, a natural log as the drum score's are, stretched
 *   by the tracker's own contrast over the recent hits of its kind
 *   (`instanceResponse`), so the contrast means what it means for the music;
 * - how it stands out of the MUSIC (`maskingShare`): its heard level against
 *   the music's peak around the listener, both at the volumes they are heard
 *   at (`spectrumMixWeights`). Full at the music's peak or above, nothing
 *   `MASK_RANGE_DB` below it: a full track buries a drip, a quiet drone does
 *   not, and with no music nothing is buried.
 *
 * The GUST (-1..1, already the scene's gustiness times its weather) speeds
 * the glaze's sway, drift and orbit (`gustSpeed`): twice as fast in a full
 * gust, half in a full lull, by the soundscape's share of what is heard.
 */

import type { VisualizerTrackerName } from '@thockdown/look/visualizer'
import { spectrumMixWeights, type SpectrumMixWeights } from '../visualizer/spectrumMix'
import { SOUNDSCAPE_MIX_GAIN } from '@thockdown/soundscape/soundscapeMix'
import { instanceResponse } from './instanceResponse'

export type SoundscapeHitKind = 'drip' | 'drop' | 'chime'

export const HIT_TRACKER: Record<SoundscapeHitKind, VisualizerTrackerName> = { drip: 'tick', drop: 'pierce', chime: 'thump' }

export interface SoundscapeHit {
  /** When it is heard (performance clock, seconds). */
  at: number
  kind: SoundscapeHitKind
  /** Its peak as the generator puts it out, the listener's volume left out (the engine's mix gain is applied here). */
  amplitude: number
  /** Its peak over its layer's recent floor. */
  salience: number
}

/** A signal as delivered: a hit, or a gust sample with its `value`. */
export type SoundscapeSignal =
  | SoundscapeHit
  | { at: number; kind: 'gust'; value: number }

/** How far below the music's peak a hit still registers at all, in dB. */
export const MASK_RANGE_DB = 24
/** How many recent hits of a kind its contrast is read over. */
const HISTORY = 48
/** A gust sample older than this is no longer the soundscape's: it has stopped or paused. */
const GUST_STALE_SEC = 0.5
/** How fast the gust's speed follows its target: the gust itself glides over seconds, this only smooths its start and end. */
const GUST_SPEED_GLIDE_SEC = 1
/** A soundscape signal within this long keeps the trackers running without music. */
const ACTIVE_SEC = 1

let hits: SoundscapeHit[] = []
let gusts: Array<{ at: number; value: number }> = []
let lastReceived = -Infinity
const wakers = new Set<() => void>()

/** The linear gains music and soundscape are heard at now, supplied by each app (`setSoundscapeSignalGains`). */
let gainsOf: () => { music: number; soundscape: number } = () => ({ music: 0, soundscape: 0 })

export function setSoundscapeSignalGains(read: () => { music: number; soundscape: number }): void {
  gainsOf = read
}

/** The weights music and soundscape are heard at, the louder at full scale (`spectrumMix.ts`), the soundscape always counted. */
export function soundscapeSignalWeights(): SpectrumMixWeights {
  const { music, soundscape } = gainsOf()
  return spectrumMixWeights(music, soundscape, true)
}

/**
 * Takes delivered signals, in time order. Everything held from `replaceFrom`
 * on is dropped first: a renderer that rewound re-sends what follows.
 */
export function receiveSoundscapeSignals(signals: readonly SoundscapeSignal[], nowSec: number, replaceFrom = Infinity): void {
  if (replaceFrom !== Infinity) {
    hits = hits.filter((hit) => hit.at < replaceFrom)
    gusts = gusts.filter((gust) => gust.at < replaceFrom)
  }
  // What nobody took in time (nothing running to take it) goes, so the queues stay bounded.
  let stale = 0
  while (stale < hits.length && hits[stale].at < nowSec - ACTIVE_SEC) stale++
  if (stale > 0) hits.splice(0, stale)
  stale = 0
  while (stale + 1 < gusts.length && gusts[stale + 1].at < nowSec) stale++
  if (stale > 0) gusts.splice(0, stale)
  for (const signal of signals) {
    if (signal.kind === 'gust') gusts.push({ at: signal.at, value: signal.value })
    else hits.push(signal)
  }
  lastReceived = nowSec
  for (const wake of wakers) wake()
}

/** Calls `wake` whenever signals arrive (the trackers' frame loop, stopped without music). */
export function subscribeSoundscapeSignals(wake: () => void): () => void {
  wakers.add(wake)
  return () => { wakers.delete(wake) }
}

/** Whether the soundscape has reported anything lately: it is playing. */
export function soundscapeSignalsActive(nowSec: number): boolean {
  return nowSec - lastReceived < ACTIVE_SEC
}

/** Every hit heard by `nowSec`, in order, taken off the queue. */
export function takeSoundscapeHits(nowSec: number): SoundscapeHit[] {
  let count = 0
  while (count < hits.length && hits[count].at <= nowSec) count++
  return count === 0 ? [] : hits.splice(0, count)
}

const recent: Record<SoundscapeHitKind, number[]> = { drip: [], drop: [], chime: [] }

/** How much of a hit the music leaves standing, 0..1, from both heard levels. */
export function maskingShare(heardAmplitude: number, maskerAmplitude: number): number {
  if (!(maskerAmplitude > 0)) return heardAmplitude > 0 ? 1 : 0
  if (!(heardAmplitude > 0)) return 0
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(heardAmplitude / maskerAmplitude)) / MASK_RANGE_DB))
}

/**
 * A hit's response, 0..1: how it stands out of its layer, stretched by
 * `contrast` over the recent hits of its kind, times how much of it the
 * music leaves standing. `musicPeak` is the music's peak around the
 * listener at full scale (0 with none).
 */
export function soundscapeHitResponse(hit: SoundscapeHit, musicPeak: number, weights: SpectrumMixWeights, contrast: number): number {
  const strength = Math.log(Math.max(1, hit.salience))
  const history = recent[hit.kind]
  history.push(strength)
  if (history.length > HISTORY) history.shift()
  const sorted = [...history].sort((a, b) => a - b)
  return instanceResponse(strength, sorted, contrast) * maskingShare(hit.amplitude * SOUNDSCAPE_MIX_GAIN * weights.soundscape, musicPeak * weights.music)
}

/** The gust heard at `nowSec`: the newest sample at or before it, 0 once it is stale or with none. */
export function soundscapeGustAt(nowSec: number): number {
  let index = -1
  while (index + 1 < gusts.length && gusts[index + 1].at <= nowSec) index++
  if (index > 0) gusts.splice(0, index)
  const sample = index >= 0 ? gusts[0] : null
  return sample && nowSec - sample.at < GUST_STALE_SEC ? sample.value : 0
}

let speed = 1
let speedAt = NaN

/**
 * The glaze's motion speed at `nowSec`: `2 ^ (gust x the soundscape's share)`,
 * followed smoothly, so a soundscape starting, stopping or being turned up
 * eases the motion rather than stepping it. Read once a frame by every
 * motion it scales; a second read in a frame moves nothing.
 */
export function gustSpeed(nowSec: number): number {
  const target = 2 ** (soundscapeGustAt(nowSec) * soundscapeSignalWeights().soundscape)
  const dt = Number.isNaN(speedAt) ? Infinity : Math.max(0, nowSec - speedAt)
  speedAt = nowSec
  speed += (target - speed) * (1 - Math.exp(-dt / GUST_SPEED_GLIDE_SEC))
  return speed
}

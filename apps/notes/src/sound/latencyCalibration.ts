/**
 * Tap-along calibration of the visual delay (`BeatSettings.delayMsByDevice`):
 * a click track plays, the reader taps along to what they HEAR, and the delay
 * is set so that the pulse is drawn at the moment of the taps.
 *
 * The click track is played the way the music is: an `<audio>` element
 * through a MediaElementSource into the shared output (`connectToOutput`),
 * and its position read on the frame's clock by the same `SmoothClock` the
 * beat pulse reads the music with. So a tap is measured in exactly the frame
 * of reference the pulse is drawn in, whatever the element's position, the
 * output buffer and the device add up to, and no relation between the audio
 * clock and the page's clock is assumed: the tap's time on the listener clock
 * minus the click's media time IS the lag the pulse has to be drawn with
 * (`heardLagSec`), and the setting is solved from it.
 *
 * The reader's own anticipation (people tap a little ahead of a steady beat)
 * is measured with it, deliberately: what is wanted is the pulse landing
 * where THIS reader feels the beat.
 *
 * Every tap is taken from its own event timestamp, so it costs nothing to
 * frame timing, and only taps are stored. The frame loop runs only while the
 * click track plays.
 */

import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS, BEAT_DELAY_OFFSET_MS } from '../shared/beatSettings'
import { connectToOutput, resumedOutputContext } from '@thockdown/soundscape/audioOutputBus'
import { outputLatencySec } from './musicBeat'
import { SmoothClock } from './smoothClock'

/** 100 BPM: a beat's period (0.6s) is wider than the delay's whole range (0.5s), so a tap's lag is never ambiguous by a beat. */
export const CALIBRATION_PERIOD_SEC = 0.6
/** Beats in a bar; the first of each is accented. */
const BAR_BEATS = 4
/** Silence before the first click, so the element's start-up is over before anything is measured. */
const LEAD_IN_SEC = 0.5
/** The first bar is listened to, not measured: taps before its end are ignored. */
const WARMUP_BEATS = BAR_BEATS
/** Taps that must agree before a result is taken. */
export const CALIBRATION_MIN_TAPS = 12
/** Taps after which the run ends with whatever they say. */
const MAX_TAPS = 32
/** The track: lead-in, warm-up and room for every tap with a bar to spare. */
const TRACK_BEATS = WARMUP_BEATS + MAX_TAPS + 2 * BAR_BEATS
/** How tightly the agreeing taps must cluster (a robust standard deviation) to end the run early. */
const SETTLED_SPREAD_SEC = 0.025
/** The narrowest band a tap may sit from the median and still count, so a very steady run does not throw out good taps. */
const OUTLIER_FLOOR_SEC = 0.03
/** MAD to standard deviation, for normally distributed taps. */
const MAD_SCALE = 1.4826

export interface LagEstimate {
  /** The lag from a click's media time to the reader's tap on the listener clock, in 0..period. */
  lagSec: number
  /** Robust standard deviation of the taps that were kept. */
  spreadSec: number
  /** How many taps were kept. */
  inliers: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** `value` moved by whole periods into [-period/2, period/2). */
function wrapCentred(value: number, period: number): number {
  return value - Math.floor(value / period + 0.5) * period
}

/**
 * The lag the taps agree on. Each tap is a lag modulo the beat (which beat it
 * belongs to is not known and does not matter), so they are first centred on
 * their circular mean, which makes them ordinary numbers; then the median,
 * then the taps further from it than three robust deviations (and the floor)
 * are dropped and the median taken again.
 */
export function estimateLag(lags: readonly number[], period: number = CALIBRATION_PERIOD_SEC): LagEstimate | null {
  if (lags.length === 0) return null
  let x = 0
  let y = 0
  for (const lag of lags) {
    const angle = (2 * Math.PI * lag) / period
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  const centre = (Math.atan2(y, x) / (2 * Math.PI)) * period
  const offsets = lags.map((lag) => wrapCentred(lag - centre, period))
  const first = median(offsets)
  const limit = Math.max(3 * MAD_SCALE * median(offsets.map((o) => Math.abs(o - first))), OUTLIER_FLOOR_SEC)
  const kept = offsets.filter((o) => Math.abs(o - first) <= limit)
  const settled = median(kept)
  const lagSec = centre + settled
  return {
    lagSec: lagSec - Math.floor(lagSec / period) * period,
    spreadSec: MAD_SCALE * median(kept.map((o) => Math.abs(o - settled))),
    inliers: kept.length,
  }
}

/**
 * The setting that draws the pulse `lagSec` after the graph handles a sample:
 * `heardLagSec` is the output latency plus the built-in offset plus the
 * setting, solved for the setting. A lag is only known modulo the beat, so the
 * one whole-beat shift that lands in the setting's range is taken (the period
 * is wider than the range, so there is one), then clamped for a device beyond it.
 */
export function delayForLag(lagSec: number, outputLatency: number, period: number = CALIBRATION_PERIOD_SEC): number {
  const centre = (BEAT_DELAY_MIN_MS + BEAT_DELAY_MAX_MS) / 2
  const raw = (lagSec - outputLatency) * 1000 - BEAT_DELAY_OFFSET_MS
  const shifted = centre + wrapCentred(raw - centre, period * 1000)
  return Math.round(Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, shifted)))
}

export type CalibrationVerdict = 'continue' | 'done' | 'failed'

/** Whether `taps` taps with this estimate end the run; `final` when no more can come. */
export function judgeCalibration(taps: number, estimate: LagEstimate | null, final: boolean): CalibrationVerdict {
  const enough = estimate !== null && estimate.inliers >= CALIBRATION_MIN_TAPS
  if (enough && estimate.spreadSec <= SETTLED_SPREAD_SEC) return 'done'
  if (!final && taps < MAX_TAPS) return 'continue'
  return enough && estimate.spreadSec <= 2 * SETTLED_SPREAD_SEC ? 'done' : 'failed'
}

// ── The click track ─────────────────────────────────────────────────────────

const TRACK_RATE = 22050
let trackUrl: string | null = null

/** A mono 16-bit WAV of the click track: a high click on each bar's one, a lower one on the other beats. Built once. */
function clickTrackUrl(): string {
  if (trackUrl) return trackUrl
  const frames = Math.ceil((LEAD_IN_SEC + TRACK_BEATS * CALIBRATION_PERIOD_SEC) * TRACK_RATE)
  const bytes = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(bytes)
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, TRACK_RATE, true); view.setUint32(28, TRACK_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  const clickFrames = Math.round(0.06 * TRACK_RATE)
  for (let beat = 0; beat < TRACK_BEATS; beat++) {
    const start = Math.round((LEAD_IN_SEC + beat * CALIBRATION_PERIOD_SEC) * TRACK_RATE)
    const accent = beat % BAR_BEATS === 0
    const frequency = accent ? 1760 : 1175
    const level = accent ? 0.5 : 0.35
    // Full level on the very first sample: a click's onset is the moment it is heard.
    for (let i = 0; i < clickFrames && start + i < frames; i++) {
      const t = i / TRACK_RATE
      view.setInt16(44 + (start + i) * 2, Math.round(32767 * level * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * frequency * t)), true)
    }
  }
  trackUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  return trackUrl
}

// ── A run ───────────────────────────────────────────────────────────────────

export type CalibrationProgress =
  | { phase: 'running'; taps: number; delayMs: number | null }
  | { phase: 'done'; delayMs: number }
  | { phase: 'failed' }

export interface CalibrationRun {
  /** A tap at `timeStampMs`, the press event's own `timeStamp`. */
  tap(timeStampMs: number): void
  /** Stop without a result. */
  cancel(): void
}

/**
 * Plays the click track and measures the taps; `onProgress` is told after
 * each tap and once at the end ('done' carries the setting to store).
 */
export function startLatencyCalibration(onProgress: (progress: CalibrationProgress) => void): CalibrationRun {
  const element = new Audio(clickTrackUrl())
  const clock = new SmoothClock()
  const lags: number[] = []
  let source: MediaElementAudioSourceNode | null = null
  let frame: number | null = null
  let over = false

  const finish = (progress: CalibrationProgress | null) => {
    if (over) return
    over = true
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    element.pause()
    source?.disconnect()
    if (progress) onProgress(progress)
  }

  const conclude = (final: boolean) => {
    const estimate = estimateLag(lags)
    const delayMs = estimate ? delayForLag(estimate.lagSec, outputLatencySec()) : null
    const verdict = judgeCalibration(lags.length, estimate, final)
    if (verdict === 'continue') onProgress({ phase: 'running', taps: lags.length, delayMs })
    else finish(verdict === 'done' && delayMs !== null ? { phase: 'done', delayMs } : { phase: 'failed' })
  }

  const tick = (frameTimeMs: number) => {
    clock.read(element.currentTime, frameTimeMs / 1000)
    frame = requestAnimationFrame(tick)
  }

  element.addEventListener('ended', () => conclude(true))
  void resumedOutputContext().then(async (context) => {
    if (over) return
    source = context.createMediaElementSource(element)
    connectToOutput(source)
    try {
      await element.play()
    } catch {
      finish({ phase: 'failed' })
      return
    }
    if (!over) frame = requestAnimationFrame(tick)
  })
  onProgress({ phase: 'running', taps: 0, delayMs: null })

  return {
    tap(timeStampMs) {
      if (over) return
      const listener = clock.at(timeStampMs / 1000) - LEAD_IN_SEC
      // NaN before the clock's first report; the warm-up bar is listened to.
      if (!(listener >= (WARMUP_BEATS - 0.5) * CALIBRATION_PERIOD_SEC)) return
      lags.push(listener)
      conclude(false)
    },
    cancel: () => finish(null),
  }
}

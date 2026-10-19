/**
 * The music's beat as one number, 0..1, for the beat pulse (Options > Tools):
 * how far the bass right now stands above the bass of the last second or so,
 * as a share of the loudest it has recently been above it. A kick drum reads
 * as a spike towards 1 and a steady bass line as little, which is what makes
 * it a pulse rather than a level meter.
 *
 * Read from `MusicPlayerService`'s bass analyser once a frame, and only while
 * there is a listener, the music is playing and the window is visible: the
 * frame loop is started by the play-state and visibility events and stops
 * itself otherwise, so a paused track or a hidden window costs nothing.
 * Listeners are told only of a change of at least `MIN_STEP`, and of 0 when
 * the loop stops, because each one writes a style.
 */

import { musicPlayerService } from './MusicPlayerService'

/** How fast the envelope falls back after a hit, in seconds. */
const RELEASE_SEC = 0.12
/** The window of "the bass of the last second or so", as a time constant. */
const MEAN_SEC = 1.5
/** How long the loudest recent hit is remembered, as a time constant. */
const PEAK_SEC = 4
/** A hit must stand this share above the mean before it pulses at all. */
const MEAN_MARGIN = 1.1
/** The smallest change listeners are told of. */
const MIN_STEP = 0.01

type BeatListener = (pulse: number) => void

const listeners = new Set<BeatListener>()
let frame: number | null = null
let lastTime = 0
let samples: Float32Array<ArrayBuffer> | null = null
let envelope = 0
let mean = 0
let peak = 0
let published = 0
let unsubscribePlaying: (() => void) | null = null

function publish(pulse: number): void {
  if (Math.abs(pulse - published) < MIN_STEP && !(pulse === 0 && published !== 0)) return
  published = pulse
  for (const listener of listeners) listener(pulse)
}

function tick(time: number): void {
  frame = null
  const analyser = musicPlayerService.currentBassAnalyser()
  if (!analyser || !musicPlayerService.isPlaying || document.hidden) {
    stop()
    return
  }
  const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0
  lastTime = time
  if (!samples || samples.length !== analyser.fftSize) samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)

  envelope = rms > envelope ? rms : envelope + (rms - envelope) * (1 - Math.exp(-dt / RELEASE_SEC))
  mean += (rms - mean) * (1 - Math.exp(-dt / MEAN_SEC))
  peak = Math.max(envelope, peak * Math.exp(-dt / PEAK_SEC))
  const floor = mean * MEAN_MARGIN
  const pulse = peak > floor ? Math.max(0, Math.min(1, (envelope - floor) / (peak - floor))) : 0
  publish(pulse)
  frame = requestAnimationFrame(tick)
}

function start(): void {
  if (frame !== null || listeners.size === 0 || !musicPlayerService.isPlaying || document.hidden) return
  lastTime = 0
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  envelope = 0
  publish(0)
}

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

/** Calls `listener` with the pulse whenever it moves; returns the unsubscribe. */
export function subscribeMusicBeat(listener: BeatListener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    musicPlayerService.acquireBassAnalyser()
    unsubscribePlaying = musicPlayerService.subscribePlaying((playing) => (playing ? start() : stop()))
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    stop()
    unsubscribePlaying?.()
    unsubscribePlaying = null
    document.removeEventListener('visibilitychange', onVisibility)
    musicPlayerService.releaseBassAnalyser()
    mean = 0
    peak = 0
  }
}

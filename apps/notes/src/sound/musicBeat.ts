/**
 * The beat pulse's model: each subscriber names one band of the playing
 * music and its response (`BeatChannel`) and is told a RESPONSE, 0..1, once
 * a frame it moved. Two readings of the band, mixed by `blend`:
 *
 * - A, relative: the band's level in dB minus its own average over the last
 *   `MEAN_SEC` or so, over `rangeDb`. A hit against the surrounding music
 *   reads high and a steady level reads as nothing, however loud.
 * - B, direct: the band's level in dB against full scale, over `rangeDb`, so
 *   the response is 0 at `-rangeDb` dBFS and 1 at full scale. It follows the
 *   level as it is.
 *
 * Both start from one envelope (an instant rise and a `RELEASE_SEC` fall, on
 * the band's RMS), so a blend never mixes two different timings.
 *
 * Read once a frame and only while there is a subscriber, the music is
 * playing and the window is visible: the frame loop is started by the
 * play-state and visibility events and stops itself otherwise, so a paused
 * track or a hidden window costs nothing. A band's tap
 * (`MusicPlayerService.createBandTap`) exists only while its subscriber does.
 * A subscriber is told only of a change of at least `MIN_STEP`, and of 0 when
 * the loop stops, because each one writes a style.
 */

import type { BeatChannel } from '../shared/beatSettings'
import { musicPlayerService, type MusicBandTap } from './MusicPlayerService'

/** How fast the envelope falls back after a hit, in seconds. */
const RELEASE_SEC = 0.12
/** Mode A's "surrounding music", as a time constant. */
const MEAN_SEC = 1.5
/** A level this far below full scale counts as silence (the floor of the dB readings). */
const FLOOR_DB = -100
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.01

type BeatListener = (response: number) => void

interface Band {
  channel: BeatChannel
  listener: BeatListener
  tap: MusicBandTap | null
  samples: Float32Array<ArrayBuffer> | null
  envelope: number
  meanDb: number
  published: number
}

const bands = new Set<Band>()
let frame: number | null = null
let lastTime = 0
let unsubscribePlaying: (() => void) | null = null

function publish(band: Band, response: number): void {
  if (Math.abs(response - band.published) < MIN_STEP && !(response === 0 && band.published !== 0)) return
  band.published = response
  band.listener(response)
}

function toDb(level: number): number {
  return level > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(level)) : FLOOR_DB
}

function read(band: Band, dt: number): number {
  let tap = band.tap
  if (!tap || tap.context.state === 'closed') {
    tap?.dispose()
    tap = band.tap = musicPlayerService.createBandTap(band.channel.frequencyHz, band.channel.octaves)
    band.meanDb = FLOOR_DB
  }
  const analyser = tap.analyser
  if (!band.samples || band.samples.length !== analyser.fftSize) band.samples = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(band.samples)
  let sum = 0
  for (let i = 0; i < band.samples.length; i++) sum += band.samples[i] * band.samples[i]
  const rms = Math.sqrt(sum / band.samples.length)

  band.envelope = rms > band.envelope ? rms : band.envelope + (rms - band.envelope) * (1 - Math.exp(-dt / RELEASE_SEC))
  const levelDb = toDb(band.envelope)
  band.meanDb = band.meanDb === FLOOR_DB ? levelDb : band.meanDb + (levelDb - band.meanDb) * (1 - Math.exp(-dt / MEAN_SEC))

  const { blend, rangeDb } = band.channel
  const relative = Math.max(0, Math.min(1, (levelDb - band.meanDb) / rangeDb))
  const direct = Math.max(0, Math.min(1, (levelDb + rangeDb) / rangeDb))
  return relative + (direct - relative) * blend
}

function tick(time: number): void {
  frame = null
  if (!musicPlayerService.isPlaying || document.hidden || bands.size === 0) {
    stop()
    return
  }
  const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0
  lastTime = time
  for (const band of bands) publish(band, read(band, dt))
  frame = requestAnimationFrame(tick)
}

function start(): void {
  if (frame !== null || bands.size === 0 || !musicPlayerService.isPlaying || document.hidden) return
  lastTime = 0
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  for (const band of bands) {
    band.envelope = 0
    publish(band, 0)
  }
}

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

/** Follows one band of the music; `listener` gets the response whenever it moves. Returns the unsubscribe. */
export function subscribeMusicBand(channel: BeatChannel, listener: BeatListener): () => void {
  const band: Band = { channel, listener, tap: null, samples: null, envelope: 0, meanDb: FLOOR_DB, published: 0 }
  bands.add(band)
  if (bands.size === 1) {
    unsubscribePlaying = musicPlayerService.subscribePlaying((playing) => (playing ? start() : stop()))
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
  return () => {
    bands.delete(band)
    band.tap?.dispose()
    band.tap = null
    if (bands.size > 0) return
    stop()
    unsubscribePlaying?.()
    unsubscribePlaying = null
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

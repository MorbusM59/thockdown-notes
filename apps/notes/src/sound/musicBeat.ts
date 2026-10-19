/**
 * The beat pulse's model: each subscriber names one band of the playing
 * music (`BeatChannel`) and is told a RESPONSE, 0..1, once a frame it moved.
 *
 * The response is a LEVELS STRETCH of the band's level, the way an image
 * editor's auto-contrast stretches brightness: over a window of
 * twice `LEAD_SEC` centred on the moment being heard, the `contrast` percentile
 * of the band's levels is no response and its top `TOP_SHARE` is a full one.
 * So a full response always means "as loud as this band gets around here",
 * on any track at any volume.
 *
 * The window looks AHEAD as well as back, without analysing the file in
 * advance (tracks run to an hour, which decoded is hundreds of megabytes):
 * a second copy of the track, the SCOUT, plays `LEAD_SEC` ahead of the one
 * being heard, into the bands' filters and analysers and nowhere else, so
 * it is never audible. Its readings are kept, stamped with the scout's own
 * media time, for `LEAD_SEC` behind the listener as well; what the listener
 * is hearing is read back from the middle. Memory is a few kilobytes per
 * band whatever the track's length.
 *
 * The scout is kept `LEAD_SEC` ahead by comparing media positions each
 * frame: a gap off by more than `RESYNC_SEC` (a seek, a new track, a stall)
 * puts it back and starts the window afresh. The listener reaches the
 * scout's first reading `LEAD_SEC` later, so the pulse is absent for that
 * long after a seek or a new track, and stretches from a part-filled window
 * for `LEAD_SEC` after that.
 *
 * Runs only while there is a subscriber, the music is playing and the window
 * is visible: the frame loop is started by the play-state and visibility
 * events and stops itself otherwise. A subscriber is told only of a change
 * of at least `MIN_STEP`, and of 0 when the loop stops, because each one
 * writes a style.
 */

import { outputContext } from '@thockdown/soundscape/audioOutputBus'
import type { BeatChannel } from '../shared/beatSettings'
import { fadeCurve } from '../flow/flowTrail'
import { musicPlayerService } from './MusicPlayerService'

/** How far ahead of the listener the scout plays, in seconds: half the window. */
const LEAD_SEC = 5
/** A scout this far from its lead is put back (a seek, a new track, a stall). */
const RESYNC_SEC = 0.75
/** The share of the window's moments that give a full response. */
const TOP_SHARE = 0.02
/** The narrowest span the stretch may use, so a near-constant band is not blown up into noise. */
const MIN_SPAN_DB = 3
/** A level this far below full scale counts as silence (the floor of the dB readings). */
const FLOOR_DB = -100
/** Histogram resolution, in dB. */
const BIN_DB = 0.5
const BINS = Math.ceil(-FLOOR_DB / BIN_DB) + 1
/** Readings kept per band: a window's worth at well over any display's frame rate. */
const CAPACITY = 4096
/** The bounds of a band's analyser window, in samples. */
const MIN_TAP_SIZE = 256
const MAX_TAP_SIZE = 8192
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.01

type BeatListener = (response: number) => void

interface Band {
  channel: BeatChannel
  listener: BeatListener
  filter: BiquadFilterNode | null
  analyser: AnalyserNode | null
  samples: Float32Array<ArrayBuffer> | null
  /** The last peak of the response and the listener time it was reached at, for the fall (`fallSec`, `fallShape`). */
  peak: number
  peakTime: number
  /** Ring of readings: scout media time and level in dB, oldest at `head`. */
  times: Float64Array
  levels: Float32Array
  head: number
  count: number
  bins: Uint32Array
  published: number
}

const bands = new Set<Band>()
let frame: number | null = null
let unsubscribePlaying: (() => void) | null = null

let scout: HTMLAudioElement | null = null
let scoutSource: MediaElementAudioSourceNode | null = null
let scoutUrl: string | null = null
let lastScoutTime = -1

/** A bandpass's Q for a bell `octaves` wide between its half-power points. */
function bandQ(octaves: number): number {
  const ratio = 2 ** Math.max(0.05, octaves)
  return Math.sqrt(ratio) / (ratio - 1)
}

function binOf(db: number): number {
  return Math.min(BINS - 1, Math.max(0, Math.round((db - FLOOR_DB) / BIN_DB)))
}

function clearWindow(band: Band): void {
  band.head = 0
  band.count = 0
  band.bins.fill(0)
  band.peak = 0
}

function attachBand(band: Band): void {
  if (!scoutSource || band.filter) return
  const context = scoutSource.context
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  const analyser = context.createAnalyser()
  scoutSource.connect(filter)
  filter.connect(analyser)
  band.filter = filter
  band.analyser = analyser
  tuneBand(band)
}

/** Points a band's filter and analyser at its channel's frequency and width. */
function tuneBand(band: Band): void {
  const { filter, analyser } = band
  if (!filter || !analyser) return
  filter.frequency.value = band.channel.frequencyHz
  filter.Q.value = bandQ(band.channel.octaves)
  // About three periods of the band's centre, so a low band is not read
  // from a window shorter than one of its own cycles.
  const wanted = (3 * analyser.context.sampleRate) / band.channel.frequencyHz
  analyser.fftSize = Math.min(MAX_TAP_SIZE, Math.max(MIN_TAP_SIZE, 2 ** Math.ceil(Math.log2(wanted))))
  if (band.samples?.length !== analyser.fftSize) band.samples = new Float32Array(analyser.fftSize)
}

function detachBand(band: Band): void {
  if (band.filter && scoutSource) scoutSource.disconnect(band.filter)
  band.filter?.disconnect()
  band.filter = null
  band.analyser = null
}

/** The scout for the playing track, built (or re-pointed) on demand. */
function ensureScout(url: string): HTMLAudioElement {
  const context = outputContext()
  if (!scout || scoutSource?.context !== context) {
    teardownScout()
    scout = document.createElement('audio')
    scout.crossOrigin = 'anonymous'
    scout.preload = 'auto'
    // Routed into the graph and never to an output: once an element has a
    // MediaElementSource its sound goes only where that node is connected.
    scoutSource = context.createMediaElementSource(scout)
  }
  if (scoutUrl !== url) {
    scoutUrl = url
    scout.src = url
    for (const band of bands) clearWindow(band)
  }
  for (const band of bands) attachBand(band)
  return scout
}

function teardownScout(): void {
  for (const band of bands) detachBand(band)
  if (scout) {
    scout.pause()
    scout.removeAttribute('src')
    scout.load()
  }
  scoutSource?.disconnect()
  scout = null
  scoutSource = null
  scoutUrl = null
  lastScoutTime = -1
}

/** Keeps the scout LEAD_SEC ahead; true when it was put back and the windows restart. */
function keepScoutAhead(listenerTime: number): boolean {
  const url = musicPlayerService.trackUrl
  if (!url) return false
  const element = ensureScout(url)
  if (element.paused) void element.play().catch(() => { /* retried by the next play-state change */ })
  // Before its metadata the scout has no position to compare; the seek below
  // is taken once it has one.
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) return false
  const duration = element.duration
  const target = Number.isFinite(duration) ? Math.min(duration, listenerTime + LEAD_SEC) : listenerTime + LEAD_SEC
  if (Math.abs(element.currentTime - target) <= RESYNC_SEC) return false
  element.currentTime = target
  lastScoutTime = -1
  for (const band of bands) clearWindow(band)
  return true
}

/** Takes one reading from the scout into each band's window. */
function sample(scoutTime: number): void {
  for (const band of bands) {
    if (!band.analyser || !band.samples) continue
    band.analyser.getFloatTimeDomainData(band.samples)
    let sum = 0
    for (let i = 0; i < band.samples.length; i++) sum += band.samples[i] * band.samples[i]
    const rms = Math.sqrt(sum / band.samples.length)
    const db = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB
    if (band.count === CAPACITY) dropOldest(band)
    const at = (band.head + band.count) % CAPACITY
    band.times[at] = scoutTime
    band.levels[at] = db
    band.count++
    band.bins[binOf(db)]++
  }
}

function dropOldest(band: Band): void {
  band.bins[binOf(band.levels[band.head])]--
  band.head = (band.head + 1) % CAPACITY
  band.count--
}

function percentile(band: Band, share: number): number {
  const target = share * (band.count - 1)
  let seen = 0
  for (let b = 0; b < BINS; b++) {
    seen += band.bins[b]
    if (seen > target) return FLOOR_DB + b * BIN_DB
  }
  return 0
}

/** The response for what the listener hears at `listenerTime`, from the window around it. */
function respond(band: Band, listenerTime: number): number {
  while (band.count > 0 && band.times[band.head] < listenerTime - LEAD_SEC) dropOldest(band)
  // Right after a resync the scout's readings all lie ahead of the listener:
  // nothing has been heard yet that the window can describe.
  if (band.count === 0 || band.times[band.head] > listenerTime) return 0
  // The reading for the listener's moment: the last one stamped at or before it.
  let level = band.levels[band.head]
  for (let k = 0; k < band.count; k++) {
    const at = (band.head + k) % CAPACITY
    if (band.times[at] > listenerTime) break
    level = band.levels[at]
  }
  const floor = percentile(band, band.channel.contrast)
  const top = Math.max(floor + MIN_SPAN_DB, percentile(band, 1 - TOP_SHARE))
  const raw = Math.max(0, Math.min(1, (level - floor) / (top - floor)))
  // The fall: a response never drops faster than its last peak fades, on
  // flow's fade curve (fallSec long, fallShape). A rise is taken at once.
  const held = band.peak * fadeCurve(listenerTime - band.peakTime, band.channel.fallSec, band.channel.fallShape)
  if (raw >= held) {
    band.peak = raw
    band.peakTime = listenerTime
    return raw
  }
  return held
}

function publish(band: Band, response: number): void {
  if (Math.abs(response - band.published) < MIN_STEP && !(response === 0 && band.published !== 0)) return
  band.published = response
  band.listener(response)
}

function tick(): void {
  frame = null
  if (!musicPlayerService.isPlaying || document.hidden || bands.size === 0) {
    stop()
    return
  }
  const listenerTime = musicPlayerService.currentTime
  keepScoutAhead(listenerTime)
  const scoutTime = scout?.currentTime ?? 0
  if (scoutTime !== lastScoutTime) {
    // One reading per scout position: a frame that lands before the scout's
    // clock moves would only repeat the last one.
    lastScoutTime = scoutTime
    sample(scoutTime)
  }
  for (const band of bands) publish(band, respond(band, listenerTime))
  frame = requestAnimationFrame(tick)
}

function start(): void {
  if (frame !== null || bands.size === 0 || !musicPlayerService.isPlaying || document.hidden) return
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  scout?.pause()
  for (const band of bands) publish(band, 0)
}

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

export interface MusicBandSubscription {
  /**
   * Retunes the band in place. The window of readings is kept: a new
   * frequency or width fills it with readings of the new band as they
   * arrive, rather than starting the measurement over.
   */
  update: (channel: BeatChannel) => void
  unsubscribe: () => void
}

/** Follows one band of the music; `listener` gets the response whenever it moves. */
export function subscribeMusicBand(channel: BeatChannel, listener: BeatListener): MusicBandSubscription {  const band: Band = {
    channel,
    listener,
    filter: null,
    analyser: null,
    samples: null,
    peak: 0,
    peakTime: 0,
    times: new Float64Array(CAPACITY),
    levels: new Float32Array(CAPACITY),
    head: 0,
    count: 0,
    bins: new Uint32Array(BINS),
    published: 0,
  }
  bands.add(band)
  attachBand(band)
  if (bands.size === 1) {
    unsubscribePlaying = musicPlayerService.subscribePlaying((playing) => (playing ? start() : stop()))
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
  const update = (next: BeatChannel) => {
    const retune = next.frequencyHz !== band.channel.frequencyHz || next.octaves !== band.channel.octaves
    band.channel = next
    if (retune) tuneBand(band)
  }
  const unsubscribe = () => {
    bands.delete(band)
    detachBand(band)
    if (bands.size > 0) return
    stop()
    teardownScout()
    unsubscribePlaying?.()
    unsubscribePlaying = null
    document.removeEventListener('visibilitychange', onVisibility)
  }
  return { update, unsubscribe }
}

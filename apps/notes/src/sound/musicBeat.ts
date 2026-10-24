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
 * A channel whose source is a DRUM (kick, snare or hat) follows that drum's
 * HITS instead of a band's level. Every drum channel reads ONE analysis
 * (`drums`): an analyser taking the scout unfiltered, whose every new sample
 * goes to one `DrumTracker` (`drumTracker.ts`), which finds the tempo and
 * each drum's hits in the same look-ahead window; each channel holds only
 * its place in the hits (a `DrumCursor`) and asks, per frame, whether its
 * drum was heard since it last asked. The tracker keeps time by counting
 * samples and uses the scout's reported position only to align that count
 * with the music (`DrumTracker.feed`); `thockdown:debug-beat` traces how
 * well (`beatTrace.ts`). The fall turns each hit into a pulse.
 *
 * What the listener HEARS trails the element's media time by the output's
 * latency (`AudioContext.outputLatency` and `baseLatency`, tens of
 * milliseconds, far more over Bluetooth), so every band is answered for the
 * heard moment rather than the reported one.
 *
 * Runs only while there is a subscriber, the music is playing and the window
 * is visible: the frame loop is started by the play-state and visibility
 * events and stops itself otherwise. A subscriber is told of every change
 * of at least `MIN_STEP` (finer than a subscriber's own output resolution,
 * which decides what is worth writing), and of 0 when the loop stops.
 */

import { outputContext } from '@thockdown/soundscape/audioOutputBus'
import type { VisualizerChannel as BeatChannel, VisualizerDrum } from '@thockdown/look/visualizer'
import { fadeCurve } from '../flow/flowTrail'
import { DrumCursor, DrumTracker } from './drumTracker'
import { appendBeatTrace, BeatTraceWindow, isBeatTraceOn } from './beatTrace'
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
/** The drum analysis's analyser window: a third of a second at 48kHz, so a slow frame loses no samples. */
const DRUM_TAP_SIZE = 16384
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.001

type BeatListener = (response: number) => void

interface Band {
  channel: BeatChannel
  listener: BeatListener
  filter: BiquadFilterNode | null
  analyser: AnalyserNode | null
  samples: Float32Array<ArrayBuffer> | null
  /** A drum channel's place in the shared tracker's hits; null for a band. */
  cursor: DrumCursor | null
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

/**
 * The one drum analysis every drum channel reads, while there is one and
 * the scout exists: the scout unfiltered into an analyser, and the tracker
 * fed from it. `lastReadAt` is the context time the analyser was last read
 * at (NaN: never).
 */
interface DrumAnalysis {
  analyser: AnalyserNode
  samples: Float32Array<ArrayBuffer>
  tracker: DrumTracker
  lastReadAt: number
  /** The beat trace's running window, while the trace is on (`beatTrace.ts`). */
  trace: BeatTraceWindow | null
}
let drums: DrumAnalysis | null = null
let unsubscribePlaying: (() => void) | null = null

let scout: HTMLAudioElement | null = null
let scoutSource: MediaElementAudioSourceNode | null = null
let scoutUrl: string | null = null

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

/** Starts every window afresh, the drum analysis's included. */
function clearWindows(): void {
  for (const band of bands) clearWindow(band)
  if (drums) {
    drums.tracker.reset()
    drums.lastReadAt = NaN
  }
}

function drumOf(channel: BeatChannel): VisualizerDrum | null {
  return channel.source === 'band' ? null : channel.source
}

function attachBand(band: Band): void {
  if (!scoutSource) return
  if (drumOf(band.channel)) {
    band.cursor ??= new DrumCursor()
    ensureDrums()
    return
  }
  if (band.analyser) return
  const context = scoutSource.context
  const analyser = context.createAnalyser()
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  scoutSource.connect(filter)
  filter.connect(analyser)
  band.analyser = analyser
  band.filter = filter
  tuneBand(band)
}

/** The drum analysis, built when the first drum channel needs it. */
function ensureDrums(): void {
  if (drums || !scoutSource) return
  const context = scoutSource.context
  const analyser = context.createAnalyser()
  analyser.fftSize = DRUM_TAP_SIZE
  // The tracker filters for itself, every drum's bands from one signal.
  scoutSource.connect(analyser)
  drums = { analyser, samples: new Float32Array(DRUM_TAP_SIZE), tracker: new DrumTracker(context.sampleRate), lastReadAt: NaN, trace: null }
}

/** Takes the drum analysis down once no channel follows a drum. */
function releaseDrums(): void {
  if (!drums || [...bands].some((band) => drumOf(band.channel))) return
  scoutSource?.disconnect(drums.analyser)
  drums = null
}

/** Points a band's filter and analyser at its channel's frequency and width. */
function tuneBand(band: Band): void {
  const { filter, analyser } = band
  if (!analyser || !filter) return
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
  band.cursor = null
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
    clearWindows()
  }
  for (const band of bands) attachBand(band)
  return scout
}

function teardownScout(): void {
  for (const band of bands) detachBand(band)
  if (drums) scoutSource?.disconnect(drums.analyser)
  drums = null
  if (scout) {
    scout.pause()
    scout.removeAttribute('src')
    scout.load()
  }
  scoutSource?.disconnect()
  scout = null
  scoutSource = null
  scoutUrl = null
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
  if (isBeatTraceOn()) appendBeatTrace(`beat RESYNC at=${listenerTime.toFixed(3)} scout=${element.currentTime.toFixed(3)} target=${target.toFixed(3)}`)
  element.currentTime = target
  clearWindows()
  return true
}

/** Takes one reading from the scout into each band's window. */
function sample(scoutTime: number): void {
  if (drums) feedDrums(drums, scoutTime)
  for (const band of bands) {
    if (!band.analyser || !band.samples) continue
    const db = levelDb(band.analyser, band.samples)
    if (band.count === CAPACITY) dropOldest(band)
    const at = (band.head + band.count) % CAPACITY
    band.times[at] = scoutTime
    band.levels[at] = db
    band.count++
    band.bins[binOf(db)]++
  }
}

/**
 * Hands the drum tracker the samples its analyser gained since the last
 * read: the context's clock says how many, and the analyser holds the latest
 * DRUM_TAP_SIZE of them. A frame longer than that loses the oldest; the
 * context's clock says exactly how many, and the tracker fills them with
 * silence. The media time only aligns the tracker's sample count with the
 * music: it is the element's reported position, which jitters.
 */
function feedDrums(analysis: DrumAnalysis, scoutTime: number): void {
  const { analyser, samples, tracker } = analysis
  const now = analyser.context.currentTime
  const fresh = Number.isNaN(analysis.lastReadAt)
    ? samples.length
    : Math.round((now - analysis.lastReadAt) * analyser.context.sampleRate)
  analysis.lastReadAt = now
  if (fresh <= 0) return
  analyser.getFloatTimeDomainData(samples)
  const lost = Math.max(0, fresh - samples.length)
  tracker.feed(samples, Math.max(0, samples.length - fresh), scoutTime, lost)
  if (isBeatTraceOn()) (analysis.trace ??= new BeatTraceWindow()).record(tracker, lost, scoutTime)
  else analysis.trace = null
}

/** An analyser's current level in dB, floored at FLOOR_DB. */
function levelDb(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)
  return rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB
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
  const drum = drumOf(band.channel)
  const raw = drum
    ? (drums && band.cursor ? drums.tracker.hitBetween(drum, band.cursor, listenerTime, band.channel.contrast) : 0)
    : stretched(band, listenerTime)
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

/** A level band's response: its level at `listenerTime`, stretched over the window around it. */
function stretched(band: Band, listenerTime: number): number {
  while (band.count > 0 && band.times[band.head] < listenerTime - LEAD_SEC) dropOldest(band)
  // Right after a resync the scout's readings all lie ahead of the listener:
  // nothing has been heard yet that the window can describe.
  if (band.count === 0 || band.times[band.head] > listenerTime) return 0
  // The level at the listener's moment, interpolated between the readings
  // either side of it, so a frame between two readings does not hold the
  // older one and then step.
  let level = band.levels[band.head]
  let before = band.head
  for (let k = 1; k < band.count; k++) {
    const at = (band.head + k) % CAPACITY
    if (band.times[at] > listenerTime) {
      const span = band.times[at] - band.times[before]
      const share = span > 0 ? (listenerTime - band.times[before]) / span : 0
      level = band.levels[before] + (band.levels[at] - band.levels[before]) * share
      break
    }
    before = at
    level = band.levels[at]
  }
  const floor = percentile(band, band.channel.contrast)
  const top = Math.max(floor + MIN_SPAN_DB, percentile(band, 1 - TOP_SHARE))
  return Math.max(0, Math.min(1, (level - floor) / (top - floor)))
}

function publish(band: Band, response: number): void {
  if (Math.abs(response - band.published) < MIN_STEP && !(response === 0 && band.published !== 0)) return
  band.published = response
  band.listener(response)
}

let visualDelaySec = 0

/**
 * Draws the pulse this much later than the latency the audio stack reports
 * (the reader's per-device delay, `BeatSettings.delayMsByDevice`).
 */
export function setBeatVisualDelaySec(sec: number): void {
  visualDelaySec = sec
}

/** How far behind the media time the listener hears it: the context's processing and output latency. */
function outputLatencySec(): number {
  const context = scoutSource?.context
  if (!(context instanceof AudioContext)) return 0
  return (context.baseLatency || 0) + (context.outputLatency || 0)
}

/**
 * A media element's position, read every frame. An element routed into Web
 * Audio reports its position in steps (a chunk of the graph's pulls at a
 * time), so between two reports the position is carried forward on the
 * audio context's clock, which is the clock the element is played by. A new
 * report is taken as it comes.
 */
class ElementClock {
  private reported = NaN
  private reportedAt = 0

  reset(): void {
    this.reported = NaN
  }

  read(reported: number, now: number): number {
    if (reported !== this.reported) {
      this.reported = reported
      this.reportedAt = now
      return reported
    }
    return reported + Math.max(0, now - this.reportedAt)
  }
}

const listenerClock = new ElementClock()
const scoutClock = new ElementClock()

function tick(): void {
  frame = null
  if (!musicPlayerService.isPlaying || document.hidden || bands.size === 0) {
    stop()
    return
  }
  const now = scoutSource?.context.currentTime ?? 0
  const listenerTime = listenerClock.read(musicPlayerService.currentTime, now)
  if (keepScoutAhead(musicPlayerService.currentTime)) scoutClock.reset()
  // Every frame, not only when the scout's reported position moves: an
  // element routed into Web Audio reports its position in steps of the
  // chunks the graph pulls (about seven a second, read off the beat trace),
  // and sampling only on a step lost nearly half the audio to the kick
  // tracker and read the level bands at seven frames a second.
  sample(scoutClock.read(scout?.currentTime ?? 0, now))
  const heardTime = listenerTime - outputLatencySec() - visualDelaySec
  for (const band of bands) publish(band, respond(band, heardTime))
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
export function subscribeMusicBand(channel: BeatChannel, listener: BeatListener): MusicBandSubscription {
  const band: Band = {
    channel,
    listener,
    filter: null,
    analyser: null,
    samples: null,
    cursor: null,
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
    const rebuild = next.source !== band.channel.source
    band.channel = next
    if (rebuild) {
      // A level and a drum's hits are different quantities, and two drums'
      // hits different hits: the band starts over on its new source.
      detachBand(band)
      clearWindow(band)
      attachBand(band)
      releaseDrums()
    } else if (retune) tuneBand(band)
  }
  const unsubscribe = () => {
    bands.delete(band)
    detachBand(band)
    releaseDrums()
    if (bands.size > 0) return
    stop()
    teardownScout()
    unsubscribePlaying?.()
    unsubscribePlaying = null
    document.removeEventListener('visibilitychange', onVisibility)
  }
  return { update, unsubscribe }
}

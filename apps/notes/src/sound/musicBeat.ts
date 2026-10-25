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
 * The window looks AHEAD as well as back, and is filled from the track
 * DECODED (`musicDecodeStream.ts`), never from what is playing: decoding is
 * far faster than playback, so whenever the analysis starts over (a new
 * track, a seek, a changed setting) the whole window either side of the
 * listener is decoded and measured at once, and from then on the decoding is
 * kept `LEAD_SEC` (and a margin) ahead of the listener. Memory is a few
 * kilobytes per band and a few decoded chunks, whatever the track's length.
 * A second, silent copy of the track played `LEAD_SEC` ahead stood here,
 * and as it could only be heard in real time, every new start left the
 * pulse absent for the whole of the look-ahead.
 *
 * A CLOCK channel (the caret's, `subscribeMusicClock`) follows no band and
 * no hit: it pulses on a steady `BeatClock` (`beatClock.ts`) steered by the
 * drum analysis's tempo grid, so it keeps time through fills and breaks and
 * glides to each new tempo of a compilation. Its pulse is the same fall a
 * hit makes (`pulseCurve`), restarted on every beat and never longer than
 * one.
 *
 * A level band is measured by `BandLevelMeter` (a bandpass and an RMS).
 * A channel whose source is a DRUM (kick, snare or hat) follows that drum's
 * HITS instead of a band's level. Every drum channel reads ONE analysis
 * (`drums`): every decoded sample goes to one `DrumTracker`
 * (`drumTracker.ts`), which finds the tempo and each drum's hits in the same
 * look-ahead window; each channel holds only its place in the hits (a
 * `DrumCursor`) and asks, per frame, whether its drum was heard since it
 * last asked, at its own GROOVE (how steadily the answer holds the drum's
 * learned pattern against what is heard; `drumTracker.ts`'s header), read
 * live from the channel, so changing it restarts nothing and two channels
 * following one drum at two grooves each get their own. The decoded samples carry exact media times, so the tracker's
 * sample count and the music agree by construction.
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
import type { VisualizerChannel as BeatChannel, VisualizerCaret, VisualizerDrum } from '@thockdown/look/visualizer'
import { pulseCurve } from '@thockdown/look/visualizer'
import { BandLevelMeter, LEVEL_FLOOR_DB } from './bandLevel'
import { BeatClock } from './beatClock'
import { DrumCursor, DrumTracker } from './drumTracker'
import { appendBeatTrace, BeatTraceWindow, isBeatTraceOn } from './beatTrace'
import { musicPlayerService } from './MusicPlayerService'
import { MusicDecodeStream } from './musicDecodeStream'

/** How far either side of the listener the window reaches, in seconds. */
const LEAD_SEC = 5
/** How far past the window's leading edge the decoding is let run, so it never trails the listener. */
const DECODE_MARGIN_SEC = 1
/** A listener this far from where its clock put it has jumped (a seek, a stall), and the analysis starts over. */
const RESYNC_SEC = 0.75
/** The share of the window's moments that give a full response. */
const TOP_SHARE = 0.02
/** The narrowest span the stretch may use, so a near-constant band is not blown up into noise. */
const MIN_SPAN_DB = 3
/** Histogram resolution, in dB. */
const BIN_DB = 0.5
const BINS = Math.ceil(-LEVEL_FLOOR_DB / BIN_DB) + 1
/** Readings kept per band: twice `LEAD_SEC` and the margin at a hundred a second, with room to spare. */
const CAPACITY = 4096
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.001

type BeatListener = (response: number) => void

interface Band {
  channel: BeatChannel
  listener: BeatListener
  /** A level band's meter, for the current analysis run; null for a drum or before a run. */
  meter: BandLevelMeter | null
  /** A drum channel's place in the shared tracker's hits; null for a band. */
  cursor: DrumCursor | null
  /** The last peak of the response and the listener time it was reached at, for the fall (`pulseCurve`). */
  peak: number
  peakTime: number
  /** Ring of readings: media time and level in dB, oldest at `head`. */
  times: Float64Array
  levels: Float32Array
  head: number
  count: number
  bins: Uint32Array
  published: number
}

const bands = new Set<Band>()

/** A CLOCK subscriber (the caret's): a steady beat and the fall each beat makes. */
interface Clock {
  clock: BeatClock
  caret: VisualizerCaret
  listener: BeatListener
  published: number
}

const clocks = new Set<Clock>()

/** Everything the frame loop answers. */
function subscriberCount(): number {
  return bands.size + clocks.size
}
let frame: number | null = null
let unsubscribePlaying: (() => void) | null = null

/** The one drum analysis every drum channel reads, for the current run. */
interface DrumAnalysis {
  tracker: DrumTracker
  /** The beat trace's running window, while the trace is on (`beatTrace.ts`). */
  trace: BeatTraceWindow | null
}
let drums: DrumAnalysis | null = null

/** The playing track, decoded; replaced when the track changes. */
let stream: MusicDecodeStream | null = null
/** Bumped by every restart, so a restart still waiting for its file to open is dropped by a later one. */
let run = 0
/** Something the analysis depends on changed (a band added, a source or band moved): the next frame starts it over. */
let stale = true
/** The listener's position at the last frame, and the context time then (NaN while stopped). */
let lastListener = NaN
let lastNow = NaN

function drumOf(channel: BeatChannel): VisualizerDrum | null {
  return channel.source === 'band' ? null : channel.source
}

/** Whether anything reads the drum analysis: a drum channel for its hits, a clock for its grid. */
function needsDrums(): boolean {
  return clocks.size > 0 || [...bands].some((band) => drumOf(band.channel) !== null)
}

function clearWindow(band: Band): void {
  band.head = 0
  band.count = 0
  band.bins.fill(0)
  band.peak = 0
}

function binOf(db: number): number {
  return Math.min(BINS - 1, Math.max(0, Math.round((db - LEVEL_FLOOR_DB) / BIN_DB)))
}

function dropOldest(band: Band): void {
  band.bins[binOf(band.levels[band.head])]--
  band.head = (band.head + 1) % CAPACITY
  band.count--
}

function record(band: Band, time: number, db: number): void {
  if (band.count === CAPACITY) dropOldest(band)
  const at = (band.head + band.count) % CAPACITY
  band.times[at] = time
  band.levels[at] = db
  band.count++
  band.bins[binOf(db)]++
}

/**
 * Starts the analysis over at the listener: every window emptied, the
 * decoding put back to `LEAD_SEC` behind `listenerTime` and run to the
 * window's leading edge at once.
 */
function restartAnalysis(listenerTime: number): void {
  stale = false
  const url = musicPlayerService.trackUrl
  for (const band of bands) clearWindow(band)
  drums = null
  // Every restart supersedes one still waiting for its file to open, whether or not it gets as far as starting one of its own.
  const id = ++run
  // A new track's beat is not the last one's; a seek in the same track keeps the tempo and seats on the next grid.
  const newTrack = stream?.url !== url
  for (const { clock } of clocks) {
    if (newTrack) clock.reset()
    else clock.restart()
  }
  if (newTrack) {
    stream?.dispose()
    stream = url ? new MusicDecodeStream(url) : null
  }
  if (!stream) return
  stream.halt()
  const target = stream
  if (isBeatTraceOn()) appendBeatTrace(`beat RESYNC at=${listenerTime.toFixed(3)}`)
  void target.sampleRate().then((sampleRate) => {
    if (id !== run || sampleRate === null) return
    for (const band of bands) {
      if (drumOf(band.channel)) {
        band.cursor ??= new DrumCursor()
        band.meter = null
      } else {
        band.cursor = null
        band.meter = new BandLevelMeter(sampleRate, band.channel.frequencyHz, band.channel.octaves)
      }
    }
    drums = needsDrums() ? { tracker: new DrumTracker(sampleRate), trace: null } : null
    // The file may have taken a moment to open: start from where the listener is now.
    const at = Number.isNaN(lastListener) ? listenerTime : lastListener
    target.run(Math.max(0, at - LEAD_SEC), at + LEAD_SEC + DECODE_MARGIN_SEC, (samples, startTime) => analyse(samples, startTime, sampleRate))
  })
}

/** Measures one decoded chunk into the drum analysis and every level band. */
function analyse(samples: Float32Array, startTime: number, sampleRate: number): void {
  if (drums) {
    const endTime = startTime + (samples.length - 1) / sampleRate
    drums.tracker.feed(samples, 0, endTime)
    if (isBeatTraceOn()) (drums.trace ??= new BeatTraceWindow()).record(drums.tracker, 0, endTime)
    else drums.trace = null
  }
  for (const band of bands) {
    band.meter?.process(samples, startTime, (time, db) => record(band, time, db))
  }
}

function percentile(band: Band, share: number): number {
  const target = share * (band.count - 1)
  let seen = 0
  for (let b = 0; b < BINS; b++) {
    seen += band.bins[b]
    if (seen > target) return LEVEL_FLOOR_DB + b * BIN_DB
  }
  return 0
}

/** The response for what the listener hears at `listenerTime`, from the window around it. */
function respond(band: Band, listenerTime: number): number {
  const drum = drumOf(band.channel)
  const raw = drum
    ? (drums && band.cursor ? drums.tracker.hitBetween(drum, band.cursor, listenerTime, band.channel.contrast, band.channel.groove) : 0)
    : stretched(band, listenerTime)
  // The fall: a response never drops faster than its last peak fades, on
  // the block's own curve and length. A rise is taken at once.
  const { fallSec, shape } = band.channel
  const held = band.peak * pulseCurve((listenerTime - band.peakTime) / fallSec, shape)
  if (raw >= held) {
    band.peak = raw
    band.peakTime = listenerTime
    return raw
  }
  return held
}

/** A clock's response: its fall, restarted on each of its beats and cut at the next. */
function pulse(subscriber: Clock, listenerTime: number): number {
  const { clock } = subscriber
  const tracker = drums?.tracker
  clock.advance(listenerTime, tracker ? tracker.gridPeriodSec : NaN, tracker ? tracker.gridBeatTime : NaN)
  const phase = clock.phase
  if (Number.isNaN(phase)) return 0
  const { fallSec, shape } = subscriber.caret
  return pulseCurve((phase * clock.period) / Math.min(fallSec, clock.period), shape)
}

/** A level band's response: its level at `listenerTime`, stretched over the window around it. */
function stretched(band: Band, listenerTime: number): number {
  while (band.count > 0 && band.times[band.head] < listenerTime - LEAD_SEC) dropOldest(band)
  // Before a restart's decoding has reached the listener, every reading
  // lies ahead of it (or there are none): nothing heard yet to describe.
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

function publish(subscriber: Band | Clock, response: number): void {
  if (Math.abs(response - subscriber.published) < MIN_STEP && !(response === 0 && subscriber.published !== 0)) return
  subscriber.published = response
  subscriber.listener(response)
}

let visualDelaySec = 0

/**
 * Draws the pulse this much later than the latency the audio stack reports
 * (the reader's per-device delay, `BeatSettings.delayMsByDevice`).
 */
export function setBeatVisualDelaySec(sec: number): void {
  visualDelaySec = sec
}

/** How far behind the media time the listener hears it: the output context's processing and output latency. */
function outputLatencySec(): number {
  const context = outputContext()
  return (context.baseLatency || 0) + (context.outputLatency || 0)
}

/**
 * The position the LISTENER is at, for drawing: the element's position run on
 * the FRAME's clock (the `requestAnimationFrame` timestamp, the moment the
 * frame is shown), and steered toward each report rather than set to it.
 * The element reports its position in steps (a chunk of the graph's pulls at
 * a time), and taking each report as it comes jumps the time back and forth
 * by up to a chunk several times a second; a fall read off a time that jumps
 * is drawn in steps. The audio context's clock stood here as the time between
 * reports and steps the same way: it advances once per audio callback (ten
 * milliseconds and more, far more over Bluetooth), so frames between two
 * callbacks read one time, and a fall drawn off it repeated a value and then
 * jumped. The frame's clock advances by exactly one frame per frame. A report
 * further off than `SNAP_SEC` is a seek and is taken at once; anything nearer
 * closes a share of the gap per report, and the time never runs backwards.
 * Reset while the music is stopped, as the frame's clock runs on through a
 * pause.
 */
class SmoothClock {
  private static readonly SNAP_SEC = 0.5
  private static readonly STEER = 0.1
  private offset = NaN
  private reported = NaN
  private last = -Infinity

  reset(): void {
    this.offset = NaN
    this.reported = NaN
    this.last = -Infinity
  }

  read(reported: number, now: number): number {
    if (reported !== this.reported) {
      this.reported = reported
      const gap = reported - now - this.offset
      if (!Number.isFinite(this.offset) || Math.abs(gap) > SmoothClock.SNAP_SEC) {
        this.offset = reported - now
        this.last = -Infinity
      } else {
        this.offset += gap * SmoothClock.STEER
      }
    }
    this.last = Math.max(this.last, now + this.offset)
    return this.last
  }
}

const listenerClock = new SmoothClock()

function tick(frameTimeMs: number): void {
  frame = null
  if (!musicPlayerService.isPlaying || document.hidden || subscriberCount() === 0) {
    stop()
    return
  }
  const now = frameTimeMs / 1000
  const listenerTime = listenerClock.read(musicPlayerService.currentTime, now)
  // Where the listener would be had nothing jumped: carried on by the
  // clock from the last frame, or where it was when the music stopped.
  const expected = Number.isNaN(lastNow) ? lastListener : lastListener + (now - lastNow)
  const jumped = !(Math.abs(listenerTime - expected) <= RESYNC_SEC)
  lastListener = listenerTime
  lastNow = now
  if (stale || jumped || (stream?.url ?? null) !== musicPlayerService.trackUrl) restartAnalysis(listenerTime)
  else stream?.want(listenerTime + LEAD_SEC + DECODE_MARGIN_SEC)
  const heardTime = listenerTime - outputLatencySec() - visualDelaySec
  for (const band of bands) publish(band, respond(band, heardTime))
  for (const subscriber of clocks) publish(subscriber, pulse(subscriber, heardTime))
  frame = requestAnimationFrame(tick)
}

function start(): void {
  if (frame !== null || subscriberCount() === 0 || !musicPlayerService.isPlaying || document.hidden) return
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  lastNow = NaN
  listenerClock.reset()
  for (const band of bands) publish(band, 0)
  for (const subscriber of clocks) publish(subscriber, 0)
}

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

export interface MusicBandSubscription {
  /** Follows the channel's new settings; a new source or band starts the analysis over. */
  update: (channel: BeatChannel) => void
  unsubscribe: () => void
}

export interface MusicClockSubscription {
  /** Follows a new fall (and effect, which the clock does not read); nothing starts over, as the beat does not depend on either. */
  update: (caret: VisualizerCaret) => void
  unsubscribe: () => void
}

/** The first subscriber starts listening for play state and visibility; every new one marks the analysis stale. */
function added(): void {
  stale = true
  if (subscriberCount() === 1) {
    unsubscribePlaying = musicPlayerService.subscribePlaying((playing) => (playing ? start() : stop()))
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
}

/** After a subscriber left: drops the drum analysis if nothing reads it, and everything once nothing is left. */
function removed(): void {
  if (subscriberCount() > 0) {
    if (!needsDrums()) drums = null
    return
  }
  stop()
  run++
  stream?.dispose()
  stream = null
  drums = null
  stale = true
  lastListener = NaN
  unsubscribePlaying?.()
  unsubscribePlaying = null
  document.removeEventListener('visibilitychange', onVisibility)
}

/** Follows one band of the music; `listener` gets the response whenever it moves. */
export function subscribeMusicBand(channel: BeatChannel, listener: BeatListener): MusicBandSubscription {
  const band: Band = {
    channel,
    listener,
    meter: null,
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
  added()
  const update = (next: BeatChannel) => {
    // A new source, frequency or width is a different quantity: the window
    // is measured again from the decoded track, which is immediate.
    if (next.source !== band.channel.source || next.frequencyHz !== band.channel.frequencyHz || next.octaves !== band.channel.octaves) stale = true
    band.channel = next
  }
  const unsubscribe = () => {
    bands.delete(band)
    removed()
  }
  return { update, unsubscribe }
}

/** Pulses on a steady beat that follows the music's tempo (the header's CLOCK); of `caret` only the fall is read. */
export function subscribeMusicClock(caret: VisualizerCaret, listener: BeatListener): MusicClockSubscription {
  const subscriber: Clock = { clock: new BeatClock(), caret, listener, published: 0 }
  const update = (next: VisualizerCaret) => {
    subscriber.caret = next
  }
  clocks.add(subscriber)
  added()
  const unsubscribe = () => {
    clocks.delete(subscriber)
    removed()
  }
  return { update, unsubscribe }
}

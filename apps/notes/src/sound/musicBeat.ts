/**
 * The beat pulse's model: each subscriber names one band of the playing
 * music (`BeatChannel`) and is told a RESPONSE, 0..1, once a frame it moved.
 *
 * The response is a LEVELS STRETCH of the band's level, the way an image
 * editor's auto-contrast stretches brightness: over a window of
 * twice `LEAD_SEC` centred on the moment being heard, the `contrast` percentile
 * of the band's levels is no response and its top `TOP_SHARE` is a full one.
 * So a full response always means "as loud as this band gets around here",
 * on any track at any volume, unless around here is near silence
 * (`SILENCE_DB`, `stretchLevel`), which gives none.
 *
 * Everything that reads the decoded samples runs in a WORKER
 * (`musicAnalysis.ts`), which this module asks once a frame, one frame
 * ahead, for every reader's raw response, the tempo grid and the window's
 * peak; what stays here is the frame: the listener's clock, the falls, the
 * hits, the loudness gain and the caret's steady beat.
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
 * no hit: it pulses on the beats of the ROLLING BEAT MAP (`beatMap.ts`),
 * planned up to half a minute ahead, so it lands on every beat through a
 * ritardando and glides across a silence to the tempo after it, in the
 * caret's octave of tempo (`beatPhase.ts`). It replaced a clock STEERED
 * toward the drum tracker's tempo grid after the fact, which could only
 * catch up with a change of tempo, never land on it. Its pulse is the same fall a
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
import type { VisualizerChannel as BeatChannel, VisualizerCaret } from '@thockdown/look/visualizer'
import { pulseCurve } from '@thockdown/look/visualizer'
import { CaretFold } from './beatPhase'
import { appendBeatTrace, isBeatTraceOn } from './beatTrace'
import { musicPlayerService } from './MusicPlayerService'
import type { AnalysisAnswer, AnalysisRequest, ReaderSource } from './musicAnalysis'
import { loudnessGain } from './peakWindow'

/** A listener this far from where its clock put it has jumped (a seek, a stall), and the analysis starts over. */
const RESYNC_SEC = 0.75
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.001

type BeatListener = (response: number) => void

interface Band {
  /** The reader's id in the analysis (`musicAnalysis.ts`). */
  id: number
  channel: BeatChannel
  listener: BeatListener
  /** The last peak of the response and the listener time it was reached at, for the fall (`pulseCurve`). */
  peak: number
  peakTime: number
  published: number
  /** Told of each HIT (`respond`): the response rising to a new peak after falling, with that peak. */
  onHit: ((strength: number) => void) | null
  /** Whether the response rose at the last frame, so a hit is the first rising frame after a fall. */
  rising: boolean
}

const bands = new Set<Band>()
const bandsById = new Map<number, Band>()
let nextBandId = 1

/** A CLOCK subscriber (the caret's): a steady beat and the fall each beat makes. */
interface Clock {
  caret: VisualizerCaret
  listener: BeatListener
  published: number
  /** Told whenever the clock gains or loses a beat (`locked`). */
  lockListener: LockListener
  /** Whether the clock has a beat to follow: music playing and a tempo found since the last track started. */
  locked: boolean
}

type LockListener = (locked: boolean) => void

function setLocked(subscriber: Clock, locked: boolean): void {
  if (subscriber.locked === locked) return
  subscriber.locked = locked
  subscriber.lockListener(locked)
}

const clocks = new Set<Clock>()

/** A TEMPO subscriber: the heard media time and the steady beat's period, every frame (NaN while there is no beat). */
interface Counter {
  listener: (timeSec: number, periodSec: number) => void
}

const counters = new Set<Counter>()

/** Everything the frame loop answers. */
function subscriberCount(): number {
  return bands.size + clocks.size + counters.size
}
let frame: number | null = null
let unsubscribePlaying: (() => void) | null = null

/** The loudness gain the last frame read (`tick`). */
let gain = 1
/** How far below full scale a window's peak may be and still give a full response (`loudnessGain`); the reader's Response setting. */
let headroomDb = 5

/** The analysis worker, created with the first subscriber and ended with the last. */
let worker: Worker | null = null
/** The track the analysis was last restarted on. */
let analysedUrl: string | null | undefined
/** Bumped by every restart, so answers to an older run's asks are dropped. */
let run = 0
/** Something the analysis depends on changed (a band added, a source or band moved): the next frame starts it over. */
let stale = true
/** The listener's position at the last frame, and the context time then (NaN while stopped). */
let lastListener = NaN
let lastNow = NaN

/**
 * What the answers received since the last frame say. A drum's raw response
 * is a hit since its last ask, so two answers landing between two frames
 * are both kept (the larger); a level band's is a level, and the latest
 * stands. NaN grid and peak until an answer says otherwise.
 */
const pendingRaw = new Map<number, number>()
/** The beat map's beats around the moment last asked for, and the number of the first (`BeatMap.beatsAround`). */
let beatBefore = NaN
let beatAfter = NaN
let beatIndex = NaN
/** The caret's octave, held between beats (`CaretFold`). */
const fold = new CaretFold()

function send(request: AnalysisRequest): void {
  worker?.postMessage(request)
}

function receive(answer: AnalysisAnswer): void {
  if (answer.run !== run) return
  for (let i = 0; i < answer.ids.length; i++) {
    const id = answer.ids[i]
    const raw = answer.raws[i]
    const band = bandsById.get(id)
    if (!band) continue
    const isDrum = band.channel.source !== 'band'
    pendingRaw.set(id, isDrum ? Math.max(pendingRaw.get(id) ?? 0, raw) : raw)
  }
  beatBefore = answer.beatBefore
  beatAfter = answer.beatAfter
  beatIndex = answer.beatIndex
  // Until the decoding has reached the listener there is no peak to read:
  // the last gain holds rather than reading as silence.
  if (!Number.isNaN(answer.peak)) gain = loudnessGain(answer.peak, headroomDb)
  for (const line of answer.traceLines) appendBeatTrace(line)
}

function ensureWorker(): void {
  if (worker) return
  worker = new Worker(new URL('./musicAnalysis.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<AnalysisAnswer>) => receive(event.data)
  // A worker that fails to load answers nothing, and the pulse would go flat with no word why.
  worker.onerror = (event) => console.error('beat analysis worker failed', event.message)
}

/** Whether anything reads the drum analysis: a drum channel for its hits, a clock for its grid. */
function needsDrums(): boolean {
  return clocks.size > 0 || counters.size > 0 || [...bands].some((band) => band.channel.source !== 'band')
}

/**
 * Starts the analysis over at the listener: every window emptied, the
 * decoding put back to `LEAD_SEC` behind `listenerTime` and run to the
 * window's leading edge at once (`musicAnalysis.ts`).
 */
function restartAnalysis(listenerTime: number): void {
  stale = false
  const url = musicPlayerService.trackUrl
  for (const band of bands) band.peak = 0
  pendingRaw.clear()
  beatBefore = NaN
  beatAfter = NaN
  beatIndex = NaN
  const id = ++run
  analysedUrl = url
  if (isBeatTraceOn() && url) appendBeatTrace(`beat RESYNC at=${listenerTime.toFixed(3)}`)
  const readers: ReaderSource[] = [...bands].map(({ id: readerId, channel }) => ({ id: readerId, source: channel.source, frequencyHz: channel.frequencyHz, octaves: channel.octaves }))
  send({ type: 'restart', run: id, url, listenerTime, readers, drums: needsDrums() })
}

/**
 * The response for what the listener hears at `listenerTime`, from the raw
 * response the analysis gave (`raw`: a drum's hit, a level band's stretched
 * level), at `gain` (`loudnessGain`: how near full scale the track's peak
 * around the listener comes), so a track mixed quiet, or a quiet passage
 * between loud ones, pulses less than one at full scale. Every band and drum
 * source is scaled alike, and a hit's strength (`onHit`) with it; a clock
 * (the caret's beat) is not, being a beat rather than a level.
 */
function respond(band: Band, raw: number, listenerTime: number, gain: number): number {
  // The fall: a response never drops faster than its last peak fades, on
  // the block's own curve and length. A rise is taken at once.
  const { fallSec, shape } = band.channel
  const held = band.peak * pulseCurve((listenerTime - band.peakTime) / fallSec, shape)
  if (raw > 0 && raw >= held) {
    // A hit is where a rise begins: a drum's every hit (between hits it
    // reads 0), a level band's every climb out of its fall. One rule, so
    // whatever the block follows, what pulses is what makes it rise.
    // Judged before the gain, which only scales what is shown: a gain that
    // moves (the decoding reaching the listener, a loud passage coming into
    // the window) must not read as the music rising.
    if (!band.rising) band.onHit?.(gain * raw)
    band.rising = true
    band.peak = raw
    band.peakTime = listenerTime
    return gain * raw
  }
  band.rising = false
  return gain * held
}

/** A clock's response: its fall, restarted on each of its beats and cut at the next. */
function pulse(subscriber: Clock, listenerTime: number): number {
  const { phase, period } = fold.beat(beatBefore, beatAfter, beatIndex, listenerTime)
  setLocked(subscriber, !Number.isNaN(phase))
  if (Number.isNaN(phase)) return 0
  const { fallSec, shape } = subscriber.caret
  return pulseCurve((phase * period) / Math.min(fallSec, period), shape)
}

/** A tempo subscriber's frame: the time heard and the period of the same steady beat the caret follows. */
function count(counter: Counter, listenerTime: number): void {
  counter.listener(listenerTime, fold.beat(beatBefore, beatAfter, beatIndex, listenerTime).period)
}

function publish(subscriber: Band | Clock, response: number): void {
  if (Math.abs(response - subscriber.published) < MIN_STEP && !(response === 0 && subscriber.published !== 0)) return
  subscriber.published = response
  subscriber.listener(response)
}

let visualDelaySec = 0

/** Sets how far below full scale a track's peak may be and still give a full response (`BeatSettings.responseDb`). */
export function setBeatResponseHeadroomDb(db: number): void {
  headroomDb = db
}

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
 * How long after the audio graph handles a sample it should be DRAWN: what
 * the audio stack reports plus the reader's per-device delay. The beat pulse
 * and the visualizer mode's spectrum (`visualizer/spectrumTap.ts`) both draw
 * on it, so they cannot disagree about when the listener hears something.
 */
export function heardLagSec(): number {
  return outputLatencySec() + visualDelaySec
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
  const frameSec = Number.isNaN(lastNow) ? 0 : now - lastNow
  const expected = Number.isNaN(lastNow) ? lastListener : lastListener + frameSec
  const jumped = !(Math.abs(listenerTime - expected) <= RESYNC_SEC)
  lastListener = listenerTime
  lastNow = now
  if (stale || jumped || analysedUrl !== musicPlayerService.trackUrl) restartAnalysis(listenerTime)
  const heardTime = listenerTime - heardLagSec()
  // What the answers since the last frame said, asked for this frame's
  // heard moment one frame ago (below).
  for (const band of bands) {
    const raw = pendingRaw.get(band.id) ?? 0
    if (band.channel.source !== 'band') pendingRaw.delete(band.id)
    publish(band, respond(band, raw, heardTime, gain))
  }
  for (const subscriber of clocks) publish(subscriber, pulse(subscriber, heardTime))
  for (const counter of counters) count(counter, heardTime)
  // Asked one frame AHEAD: the answer is back before the next frame, which
  // shows the moment it is for, so the worker costs no lag.
  send({
    type: 'ask',
    run,
    listenerTime,
    heardTime: heardTime + frameSec,
    readers: [...bands].map(({ id, channel }) => ({ id, contrast: channel.contrast, groove: channel.groove })),
    trace: isBeatTraceOn(),
  })
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
  // An answer to the last ask before the stop describes a moment that has passed.
  pendingRaw.clear()
  for (const band of bands) publish(band, 0)
  for (const subscriber of clocks) {
    publish(subscriber, 0)
    setLocked(subscriber, false)
  }
  for (const counter of counters) counter.listener(NaN, NaN)
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
  ensureWorker()
  if (subscriberCount() === 1) {
    unsubscribePlaying = musicPlayerService.subscribePlaying((playing) => (playing ? start() : stop()))
    document.addEventListener('visibilitychange', onVisibility)
  }
  start()
}

/** After a subscriber left: drops the drum analysis if nothing reads it, and everything once nothing is left. */
function removed(): void {
  if (subscriberCount() > 0) {
    if (!needsDrums()) send({ type: 'dropDrums' })
    return
  }
  stop()
  run++
  send({ type: 'dispose' })
  worker?.terminate()
  worker = null
  analysedUrl = undefined
  stale = true
  lastListener = NaN
  unsubscribePlaying?.()
  unsubscribePlaying = null
  document.removeEventListener('visibilitychange', onVisibility)
}

/** Follows one band of the music; `listener` gets the response whenever it moves, and `onHit` each hit (`respond`: where a rise begins). */
export function subscribeMusicBand(channel: BeatChannel, listener: BeatListener, onHit: ((strength: number) => void) | null = null): MusicBandSubscription {
  const band: Band = {
    id: nextBandId++,
    channel,
    listener,
    peak: 0,
    peakTime: 0,
    published: 0,
    onHit,
    rising: false,
  }
  bands.add(band)
  bandsById.set(band.id, band)
  added()
  const update = (next: BeatChannel) => {
    // A new source, frequency or width is a different quantity: the window
    // is measured again from the decoded track, which is immediate.
    if (next.source !== band.channel.source || next.frequencyHz !== band.channel.frequencyHz || next.octaves !== band.channel.octaves) stale = true
    band.channel = next
  }
  const unsubscribe = () => {
    bands.delete(band)
    bandsById.delete(band.id)
    pendingRaw.delete(band.id)
    removed()
  }
  return { update, unsubscribe }
}

/**
 * Pulses on a steady beat that follows the music's tempo (the header's CLOCK); of `caret` only the fall is read.
 * `lockListener` is told when the clock gains a beat (music playing and a
 * tempo found since the track started; a break is carried through on the
 * beat it had) and when it loses it (paused, hidden, a new track not yet
 * read), so the caret can blink whenever there is no beat to follow.
 */
export function subscribeMusicClock(caret: VisualizerCaret, listener: BeatListener, lockListener: LockListener): MusicClockSubscription {
  const subscriber: Clock = { caret, listener, published: 0, lockListener, locked: false }
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

/**
 * The steady beat's TEMPO every frame while music plays: the media time heard
 * and the period, in seconds, of the beat the caret follows (the header's
 * CLOCK), with NaN for both whenever there is no beat: paused, hidden, or a
 * track not yet read. Tempo and not position, deliberately: after a seek the
 * beat lands at whatever phase the music has there, a jump of up to half a
 * beat, while the period carries on. A reader that only needs to move at the
 * music's rate integrates time over period and never sees the jump.
 */
export function subscribeMusicTempo(listener: (timeSec: number, periodSec: number) => void): () => void {
  const counter: Counter = { listener }
  counters.add(counter)
  added()
  return () => {
    counters.delete(counter)
    removed()
  }
}


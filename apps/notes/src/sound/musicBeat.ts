/**
 * The beat pulse's model. THREE TRACKERS listen to the playing music, once
 * each whatever reads them (`VisualizerTrackers`, set by `setVisualizerTrackers`):
 * the THUMP, the PIERCE and the TICK, the channels of the drum score
 * (`drumScore.ts`). Each subscriber (an element: the edge, the pane, the grid wave, the
 * centre pulse) names a MIX of the three (`VisualizerMix`, `mixResponse`) and
 * is told its RESPONSE, 0..1, once a frame it moved. A tracker no mix reads is
 * not analysed at all.
 *
 * Everything that reads the decoded samples runs in a WORKER
 * (`musicAnalysis.ts`), which this module asks once a frame, one frame
 * ahead, for every reader's raw response, the caret's beat and the window's
 * peak; what stays here is the frame: the listener's clock, the falls, the
 * hits, the loudness gain and the caret's steady beat.
 *
 * The window looks AHEAD as well as back, and is filled from the track
 * DECODED (`musicDecodeStream.ts`), never from what is playing: decoding is
 * far faster than playback, so whenever the analysis starts over (a new
 * track, a seek, a changed setting) the whole window either side of the
 * listener is decoded and measured at once, and from then on the decoding is
 * kept `LEAD_SEC` (and a margin) ahead of the listener. Memory is a few
 * a few decoded chunks, whatever the track's length.
 * A second, silent copy of the track played `LEAD_SEC` ahead stood here,
 * and as it could only be heard in real time, every new start left the
 * pulse absent for the whole of the look-ahead.
 *
 * A CLOCK channel (the caret's, `subscribeMusicClock`) follows no tracker: it
 * runs the flashing curve (`shared/flashing.ts`) on the beat map's counted beat
 * (`BeatMap.barBeatAt`, planned in the worker `MAP_AHEAD_SEC` ahead), which
 * lands on every beat through tempo changes and carries across a gap, and is
 * held here through a missing beat for up to `MAP_BEAT_LOSS_SEC`. The map's
 * folded caret beat (`caretAt`) is what the TEMPO subscribers read.
 *
 * The trackers detect nothing: they read the DRUM SCORE (`drumScore.ts`),
 * every onset of the music written ahead of the listener with its strength
 * in each channel. Each asks, per frame, for the strongest instance of its
 * channel heard since it last asked, past its contrast, which is read live,
 * so changing it restarts nothing. The decoded samples carry exact media
 * times, so the score and the music agree by construction.
 *
 * Each element's FALL (its shape and length) is its own and applies to its
 * mixed response (`respond`), so a hit the trackers report once is drawn as
 * that element's decay.
 *
 * What the listener HEARS trails the element's media time by the output's
 * latency (`AudioContext.outputLatency` and `baseLatency`, tens of
 * milliseconds, far more over Bluetooth), so every tracker is answered for the
 * heard moment rather than the reported one.
 *
 * Runs only while there is a subscriber, the music is playing and the window
 * is visible: the frame loop is started by the play-state and visibility
 * events and stops itself otherwise. A subscriber is told of every change
 * of at least `MIN_STEP` (finer than a subscriber's own output resolution,
 * which decides what is worth writing), and of 0 when the loop stops.
 */

import { outputContext } from '@thockdown/soundscape/audioOutputBus'
import type { VisualizerMix, VisualizerTrackerName, VisualizerTrackers } from '@thockdown/look/visualizer'
import { DEFAULT_VISUALIZER_TRACKERS, mixResponse, pulseCurve, VISUALIZER_TRACKERS } from '@thockdown/look/visualizer'
import { appendBeatTrace, isBeatTraceOn } from './beatTrace'
import { musicPlayerService } from './MusicPlayerService'
import type { AnalysisAnswer, AnalysisRequest, ReaderSettings, ReaderSource } from './musicAnalysis'
import { loudnessGain } from './peakWindow'
import { flashLevelAt, flashPhaseAt, FLASH_BEATS_REPEAT } from '../shared/flashing'

/** A listener this far from where its clock put it has jumped (a seek, a stall), and the analysis starts over. */
const RESYNC_SEC = 0.75
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.001

/** What an element follows: its mix and the fall its response takes. */
export interface MusicMixChannel {
  mix: VisualizerMix
  shape: number
  /** Seconds; 0 is no fall, so every rise from nothing is a hit and a response is only ever this frame's. */
  fallSec: number
}

/**
 * Reads the decoded track's semitone score at the heard time and a short
 * lookahead after it. Subscribers of different widths share the widest score,
 * centered on the same A3, and receive the matching centered slice and the
 * peak-window sample magnitude.
 */
export function subscribeMusicSemitoneScore(
  bands: number,
  listener: (timeSec: number, at: Float32Array | null, after: Float32Array | null, peak: number) => void,
): { update: (bands: number) => void; unsubscribe: () => void } {
  if (!Number.isInteger(bands) || bands <= 0) throw new RangeError('Semitone score row width must be a positive integer')
  const subscriber: SemitoneSubscriber = {
    bands,
    listener,
    sourceAt: null,
    sourceAfter: null,
    viewBands: 0,
    viewAt: null,
    viewAfter: null,
  }
  semitoneSubscribers.add(subscriber)
  added()
  return {
    update(nextBands) {
      if (!Number.isInteger(nextBands) || nextBands <= 0) throw new RangeError('Semitone score row width must be a positive integer')
      subscriber.bands = nextBands
    },
    unsubscribe() {
      semitoneSubscribers.delete(subscriber)
      removed()
    },
  }
}

/** A tracker's id in the analysis (`musicAnalysis.ts`'s reader id), and its index in `trackerRaw`. */
const TRACKER_INDEX: Record<VisualizerTrackerName, number> = { thump: 0, pierce: 1, tick: 2 }

let trackers: VisualizerTrackers = DEFAULT_VISUALIZER_TRACKERS

type BeatListener = (response: number) => void

interface Band {
  channel: MusicMixChannel
  listener: BeatListener
  /** The last peak of the response and the listener time it was reached at, for the fall (`pulseCurve`). */
  peak: number
  peakTime: number
  published: number
  /** Told of each HIT (`respond`): the response rising to a new peak after falling, with that peak. */
  onHit: ((strength: number, timeSec: number) => void) | null
  /** Whether the response rose at the last frame, so a hit is the first rising frame after a fall. */
  rising: boolean
}

const bands = new Set<Band>()

/** What a CLOCK follows: the flashing curve over one cycle (`flashLevels`) and how many cycles run per beat. */
export interface FlashClock {
  levels: ArrayLike<number>
  cyclesPerBeat: number
}

/** A CLOCK subscriber (the caret's): the flashing curve run at the music's beat. */
interface Clock {
  flash: FlashClock
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
interface SemitoneSubscriber {
  bands: number
  listener: (timeSec: number, at: Float32Array | null, after: Float32Array | null, peak: number) => void
  sourceAt: Float32Array | null
  sourceAfter: Float32Array | null
  viewBands: number
  viewAt: Float32Array | null
  viewAfter: Float32Array | null
}
const semitoneSubscribers = new Set<SemitoneSubscriber>()
let latestSemitoneScore: NonNullable<AnalysisAnswer['semitones']> | null = null

function semitoneBandCount(): number {
  let bands = 0
  for (const subscriber of semitoneSubscribers) bands = Math.max(bands, subscriber.bands)
  return bands
}

/** Everything the frame loop answers. */
function subscriberCount(): number {
  return bands.size + clocks.size + counters.size + semitoneSubscribers.size
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
/** Something the analysis depends on changed (a tracker newly read, the beat map newly needed): the next frame starts it over. */
let stale = true
/** The listener's position at the last frame, and the context time then (NaN while stopped). */
let lastListener = NaN
let lastNow = NaN

/**
 * What the answers received since the last frame say, per tracker
 * (`TRACKER_INDEX`). A raw response is a hit since the tracker's last ask,
 * so two answers landing between two frames are both kept (the larger).
 */
const pendingRaw = new Float64Array(VISUALIZER_TRACKERS.length)
/** This frame's response of each tracker, read by every element's mix. */
const trackerRaw = new Float64Array(VISUALIZER_TRACKERS.length)
/** The trackers the analysis was last restarted with (`readsOf`), as a bit mask by `TRACKER_INDEX`. */
let analysedTrackers = 0
/** Whether the analysis was last restarted with the beat map (`needsDrums`). */
let analysedDrums = false

/** How long the map may answer no beat before the caret is let go to its own blink. */
const MAP_BEAT_LOSS_SEC = 4

/** The map's caret as last answered: its phase at media time `mapTime` and its period (`BeatMap.caretAt`). */
let mapTime = NaN
let mapPhase = NaN
let mapPeriod = NaN

/** The map's counted beat as last answered (`BeatMap.barBeatAt`): the beat at media time `barBeatTime` and the beat's period. */
let barBeatTime = NaN
let barBeat = NaN
let barBeatPeriod = NaN

/** The counted beat at `time`, run on from the last answer at its period; NaN where there is no beat. */
function mapBarBeatAt(time: number): number {
  if (Number.isNaN(barBeat) || !(barBeatPeriod > 0)) return NaN
  const at = barBeat + (time - barBeatTime) / barBeatPeriod
  return at - FLASH_BEATS_REPEAT * Math.floor(at / FLASH_BEATS_REPEAT)
}

/** The map's caret at `time`, run on from the last answer at its period; NaN where there is no beat. */
function mapCaretAt(time: number): { phase: number; period: number } {
  if (Number.isNaN(mapPhase) || !(mapPeriod > 0)) return { phase: NaN, period: NaN }
  const at = mapPhase + (time - mapTime) / mapPeriod
  return { phase: at - Math.floor(at), period: mapPeriod }
}

/** Dips the caret's clock subscribers drew since the last caret trace line (a jump up in the published response). */
let drawnDips = 0
/** Frames ticked since the last caret trace line. */
let framesSinceTrace = 0

/** When the last side-by-side caret line was traced (`traceCaret`). */
let lastCaretTrace = -Infinity

/**
 * One trace line a second while the beat trace is on: where the playback
 * element is, the time heard, and the beat each caret source puts before it
 * with its period (the map's, which drives the caret), and how many dips the
 * caret drew. A drift between the map and the music shows as `mapBeat`
 * walking against the thumps heard (the `score thump` lines) while `el` and
 * `heard` keep their constant offset.
 */
function traceCaret(listenerTime: number, heardTime: number): void {
  if (!isBeatTraceOn() || Math.abs(heardTime - lastCaretTrace) < 1) return
  lastCaretTrace = heardTime
  const map = mapCaretAt(heardTime)
  appendBeatTrace(`caret el=${musicPlayerService.currentTime.toFixed(3)} listener=${listenerTime.toFixed(3)} heard=${heardTime.toFixed(3)} mapBeat=${(heardTime - map.phase * map.period).toFixed(3)} mapPer=${map.period.toFixed(4)} drawn=${drawnDips} clocks=${clocks.size} frames=${framesSinceTrace}`)
  drawnDips = 0
  framesSinceTrace = 0
}

function send(request: AnalysisRequest): void {
  worker?.postMessage(request)
}

function receive(answer: AnalysisAnswer): void {
  if (answer.run !== run) return
  if ('semitones' in answer) latestSemitoneScore = answer.semitones ?? null
  for (let i = 0; i < answer.ids.length; i++) {
    const index = answer.ids[i]
    const raw = answer.raws[i]
    pendingRaw[index] = Math.max(pendingRaw[index], raw)
  }
  // A beat the map answers is taken at once. A missing one (an unconfident
  // stretch, a frame between replans) does not drop the caret back to its
  // own blink: the last beat runs on at its period until the map has had no
  // beat for MAP_BEAT_LOSS_SEC, so only a sustained absence lets it go.
  if (!Number.isNaN(answer.caretPhase) && answer.caretPeriod > 0) {
    mapTime = answer.heardTime
    mapPhase = answer.caretPhase
    mapPeriod = answer.caretPeriod
  } else if (!(answer.heardTime - mapTime < MAP_BEAT_LOSS_SEC)) {
    mapTime = mapPhase = mapPeriod = NaN
  }
  if (!Number.isNaN(answer.barBeat) && answer.beatPeriod > 0) {
    barBeatTime = answer.heardTime
    barBeat = answer.barBeat
    barBeatPeriod = answer.beatPeriod
  } else if (!(answer.heardTime - barBeatTime < MAP_BEAT_LOSS_SEC)) {
    barBeatTime = barBeat = barBeatPeriod = NaN
  }
  // Until the decoding has reached the listener there is no peak to read:
  // the last gain holds rather than reading as silence.
  if (!Number.isNaN(answer.peak)) gain = loudnessGain(answer.peak, headroomDb)
  for (const line of answer.traceLines) appendBeatTrace(line)
  if (semitoneSubscribers.size > 0) {
    for (const subscriber of semitoneSubscribers) {
      const score = latestSemitoneScore
      if (!score || score.at.length < subscriber.bands) {
        subscriber.listener(answer.heardTime, null, null, answer.peak)
        continue
      }
      if (
        subscriber.sourceAt !== score.at ||
        subscriber.sourceAfter !== score.after ||
        subscriber.viewBands !== subscriber.bands
      ) {
        const offset = Math.floor(score.at.length / 2) - Math.floor(subscriber.bands / 2)
        subscriber.sourceAt = score.at
        subscriber.sourceAfter = score.after
        subscriber.viewBands = subscriber.bands
        subscriber.viewAt = score.at.subarray(offset, offset + subscriber.bands)
        subscriber.viewAfter = score.after.subarray(offset, offset + subscriber.bands)
      }
      subscriber.listener(
        answer.heardTime,
        subscriber.viewAt,
        subscriber.viewAfter,
        answer.peak,
      )
    }
  }
}

function ensureWorker(): void {
  if (worker) return
  worker = new Worker(new URL('./musicAnalysis.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<AnalysisAnswer>) => receive(event.data)
  // A worker that fails to load answers nothing, and the pulse would go flat with no word why.
  worker.onerror = (event) => console.error('beat analysis worker failed', event.message)
}

/** The trackers some element's mix reads, as a bit mask by `TRACKER_INDEX`. */
function readsOf(): number {
  let mask = 0
  for (const band of bands) {
    const { mix } = band.channel
    for (const name of VISUALIZER_TRACKERS) if (mix[name] > 0) mask |= 1 << TRACKER_INDEX[name]
  }
  return mask
}

/** Whether anything reads the beat map: a tracker some mix reads (the score is written from it), or a clock for its beat. */
function needsDrums(): boolean {
  return clocks.size > 0 || counters.size > 0 || readsOf() !== 0
}

/** The asks' reader settings, rebuilt only when the trackers or what reads them change (`readersAsked`). */
let askReaders: ReaderSettings[] = []

function rebuildAskReaders(): void {
  askReaders = []
  for (const name of VISUALIZER_TRACKERS) {
    const index = TRACKER_INDEX[name]
    if (!(analysedTrackers & (1 << index))) continue
    const tracker = trackers[name]
    askReaders.push({ id: index, contrast: tracker.contrast, pattern: tracker.pattern })
  }
}

/**
 * Starts the analysis over at the listener: every window emptied, the
 * decoding put back to `LEAD_SEC` behind `listenerTime` and run to the
 * window's leading edge at once (`musicAnalysis.ts`).
 */
function restartAnalysis(listenerTime: number): void {
  stale = false
  latestSemitoneScore = null
  const url = musicPlayerService.trackUrl
  for (const band of bands) band.peak = 0
  pendingRaw.fill(0)
  trackerRaw.fill(0)
  mapTime = mapPhase = mapPeriod = NaN
  const id = ++run
  analysedUrl = url
  if (isBeatTraceOn() && url) appendBeatTrace(`beat RESYNC at=${listenerTime.toFixed(3)}`)
  analysedTrackers = readsOf()
  analysedDrums = needsDrums()
  rebuildAskReaders()
  const readers: ReaderSource[] = []
  for (const name of VISUALIZER_TRACKERS) {
    const index = TRACKER_INDEX[name]
    if (!(analysedTrackers & (1 << index))) continue
    readers.push({ id: index, channel: name })
  }
  send({
    type: 'restart',
    run: id,
    url,
    listenerTime,
    readers,
    drums: needsDrums(),
    semitoneBands: semitoneBandCount(),
  })
}

/**
 * The response for what the listener hears at `listenerTime`, from the
 * element's mixed response (`raw`, `mixResponse` of the trackers'), at `gain` (`loudnessGain`: how near full scale the track's peak
 * around the listener comes), so a track mixed quiet, or a quiet passage
 * between loud ones, pulses less than one at full scale. Every tracker is
 * scaled alike, and a hit's strength (`onHit`) with it; a clock
 * (the caret's beat) is not, being a beat rather than a level.
 */
function respond(band: Band, raw: number, listenerTime: number, gain: number): number {
  // The fall: a response never drops faster than its last peak fades, on
  // the block's own curve and length. A rise is taken at once.
  const { fallSec, shape } = band.channel
  const held = fallSec > 0 ? band.peak * pulseCurve((listenerTime - band.peakTime) / fallSec, shape) : 0
  if (raw > 0 && raw >= held) {
    // A hit is where a rise begins: every instance a tracker reports
    // (between instances it reads 0) that climbs out of the fall.
    // Judged before the gain, which only scales what is shown: a gain that
    // moves (the decoding reaching the listener, a loud passage coming into
    // the window) must not read as the music rising.
    if (!band.rising)     band.onHit?.(gain * raw, listenerTime)
    band.rising = true
    band.peak = raw
    band.peakTime = listenerTime
    return gain * raw
  }
  band.rising = false
  return gain * held
}

/** A clock's response: how far the flashing curve dips below full, at the cycle's phase on the counted beat. */
function pulse(subscriber: Clock, listenerTime: number): number {
  const beat = mapBarBeatAt(listenerTime)
  setLocked(subscriber, !Number.isNaN(beat))
  if (Number.isNaN(beat)) return 0
  const { levels, cyclesPerBeat } = subscriber.flash
  return 1 - flashLevelAt(levels, flashPhaseAt(beat, cyclesPerBeat))
}

/** A tempo subscriber's frame: the time heard and the period of the same steady beat the caret follows. */
function count(counter: Counter, listenerTime: number): void {
  const { phase, period } = mapCaretAt(listenerTime)
  counter.listener(listenerTime, Number.isNaN(phase) ? NaN : period)
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
 * Sets the visual timing offset added to the latency the audio stack reports:
 * the internal calibration plus the reader's per-device adjustment.
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
 * the audio stack reports plus the visual timing offset. The beat pulse and
 * the visualizer mode's spectrum (`visualizer/spectrumTap.ts`) both draw on
 * it, so they cannot disagree about when the listener hears something.
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
  // What the answers since the last frame said, each hit taken once (and cleared, so the next frame reads none unless
  // another lands).
  trackerRaw.set(pendingRaw)
  pendingRaw.fill(0)
  const [thump, pierce, ticks] = trackerRaw
  for (const band of bands) publish(band, respond(band, mixResponse(band.channel.mix, thump, pierce, ticks), heardTime, gain))
  for (const subscriber of clocks) {
    const response = pulse(subscriber, heardTime)
    // A dip as DRAWN: the response jumping up, which is a beat starting on screen.
    if (response - subscriber.published > 0.3) drawnDips++
    publish(subscriber, response)
  }
  for (const counter of counters) count(counter, heardTime)
  framesSinceTrace++
  traceCaret(listenerTime, heardTime)
  // Asked one frame AHEAD: the answer is back before the next frame, which
  // shows the moment it is for, so the worker costs no lag.
  send({
    type: 'ask',
    run,
    listenerTime,
    heardTime: heardTime + frameSec,
    readers: askReaders,
    trace: isBeatTraceOn(),
    semitoneBands: semitoneBandCount(),
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
  latestSemitoneScore = null
  // An answer to the last ask before the stop describes a moment that has passed.
  pendingRaw.fill(0)
  trackerRaw.fill(0)
  for (const band of bands) publish(band, 0)
  for (const subscriber of clocks) {
    publish(subscriber, 0)
    setLocked(subscriber, false)
  }
  for (const counter of counters) counter.listener(NaN, NaN)
  for (const subscriber of semitoneSubscribers) subscriber.listener(NaN, null, null, NaN)
}

function onVisibility(): void {
  if (document.hidden) stop()
  else start()
}

export interface MusicMixSubscription {
  /** Follows the element's new mix and fall; a mix that reads a tracker nothing read before starts the analysis over. */
  update: (channel: MusicMixChannel) => void
  unsubscribe: () => void
}

export interface MusicClockSubscription {
  /** Follows a new curve or matching; nothing starts over, as the beat does not depend on either. */
  update: (flash: FlashClock) => void
  unsubscribe: () => void
}

/** The first subscriber starts listening for play state and visibility; every new one marks the analysis stale. */
function added(): void {
  // A subscriber that reads only what is already analysed changes nothing: restarting would throw away the beat map
  // and the score planned ahead every time an element mounts (entering the visualizer mounts
  // three). One reading a tracker, or the beat map, the analysis was not started with starts it over.
  if ((readsOf() & ~analysedTrackers) !== 0 || (needsDrums() && !analysedDrums)) stale = true
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
    if (!needsDrums() && analysedDrums) {
      analysedDrums = false
      send({ type: 'dropDrums' })
    }
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

/** Sets the three trackers (`VisualizerTrackers`); their contrast is read live with every ask, so nothing starts over. */
export function setVisualizerTrackers(next: VisualizerTrackers): void {
  trackers = next
  rebuildAskReaders()
}

/** Follows one element's mix of the trackers; `listener` gets the response whenever it moves, and `onHit` each hit (`respond`: where a rise begins). */
export function subscribeMusicMix(
  channel: MusicMixChannel,
  listener: BeatListener,
  onHit: ((strength: number, timeSec: number) => void) | null = null,
): MusicMixSubscription {
  const band: Band = {
    channel,
    listener,
    peak: 0,
    peakTime: 0,
    published: 0,
    onHit,
    rising: false,
  }
  bands.add(band)
  added()
  const update = (next: MusicMixChannel) => {
    band.channel = next
    // A tracker no element read before is not being analysed: the window is
    // measured again from the decoded track, which is immediate. One no
    // longer read is simply ignored until the next restart.
    if ((readsOf() & ~analysedTrackers) !== 0 || (needsDrums() && !analysedDrums)) stale = true
  }
  const unsubscribe = () => {
    bands.delete(band)
    removed()
  }
  return { update, unsubscribe }
}

/**
 * Runs the flashing curve on the music's counted beat (the header's CLOCK),
 * `flash.cyclesPerBeat` cycles a beat, and publishes how far it dips below
 * full. `lockListener` is told when the clock gains a beat (music playing and
 * a tempo found since the track started; a break is carried through on the
 * beat it had) and when it loses it (paused, hidden, a new track not yet
 * read), so the caret can run its own cycle whenever there is no beat.
 */
export function subscribeMusicClock(flash: FlashClock, listener: BeatListener, lockListener: LockListener): MusicClockSubscription {
  const subscriber: Clock = { flash, listener, published: 0, lockListener, locked: false }
  const update = (next: FlashClock) => {
    subscriber.flash = next
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
 * track not yet read. Tempo and not position, deliberately: a clock that
 * re-seats after a seek or a change of section takes the new grid's PHASE as
 * it is, so its position jumps by up to half a beat, while its period is
 * continuous apart from a change of tempo. A reader that only needs to move
 * at the music's rate integrates time over period and never sees the jump.
 */
export function subscribeMusicTempo(listener: (timeSec: number, periodSec: number) => void): () => void {
  const counter: Counter = { listener: (timeSec, periodSec) => listener(timeSec, periodSec) }
  counters.add(counter)
  added()
  return () => {
    counters.delete(counter)
    removed()
  }
}

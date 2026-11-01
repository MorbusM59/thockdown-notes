/**
 * The beat pulse's model. THREE TRACKERS listen to the playing music, once
 * each whatever reads them (`VisualizerTrackers`, set by `setVisualizerTrackers`):
 * the KICKS and the HITS (the kick's and the snare's hits) and a BAND's live
 * level. Each subscriber (an element: the edge, the pane, the grid wave, the
 * centre pulse) names a MIX of the three (`VisualizerMix`, `mixResponse`) and
 * is told its RESPONSE, 0..1, once a frame it moved. A tracker no mix reads is
 * not analysed at all.
 *
 * The band's response is a LEVELS STRETCH of its level, the way an image
 * editor's auto-contrast stretches brightness: over a window of
 * twice `LEAD_SEC` centred on the moment being heard, the `contrast` percentile
 * of the band's levels is no response and its top `TOP_SHARE` is a full one.
 * So a full response always means "as loud as this band gets around here",
 * on any track at any volume, unless around here is near silence
 * (`SILENCE_DB`, `stretchLevel`), which gives none.
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
 * kilobytes per band and a few decoded chunks, whatever the track's length.
 * A second, silent copy of the track played `LEAD_SEC` ahead stood here,
 * and as it could only be heard in real time, every new start left the
 * pulse absent for the whole of the look-ahead.
 *
 * A CLOCK channel (the caret's, `subscribeMusicClock`) follows no band and
 * no hit: it pulses on the beat map's caret (`beatMap.ts`, planned in the
 * worker `MAP_AHEAD_SEC` ahead), which lands on every beat through tempo changes and
 * carries across a gap, and is held here through a missing beat for up to
 * `MAP_BEAT_LOSS_SEC`. Its pulse is the same fall a
 * hit makes (`pulseCurve`), restarted on every beat and never longer than
 * one.
 *
 * The band is measured by `BandLevelMeter` (a bandpass and an RMS), and its
 * stretched level is SMOOTHED here (`BAND_ATTACK_SEC`, `BAND_RELEASE_SEC`), a
 * fixed one-pole attack and release, so a level that wavers frame to frame
 * does not flicker the elements it drives. The two hit trackers detect
 * nothing: they read the SCORE (`musicScore.ts`), the music's recurring
 * sounds written ahead of the listener (`signalMap.ts`), each instance with
 * its intensity, and a sound flagged a kick or a hit drives the tracker of
 * that name. Each asks, per frame, for the loudest instance of its drum
 * heard since it last asked, past its contrast, which is read live, so
 * changing it restarts nothing. The decoded samples carry exact media times,
 * so the score and the music agree by construction.
 *
 * Each element's FALL (its shape and length) is its own and applies to its
 * mixed response (`respond`), so a hit the trackers report once is drawn as
 * that element's decay.
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
import type { VisualizerCaret, VisualizerMix, VisualizerTrackerName, VisualizerTrackers } from '@thockdown/look/visualizer'
import { DEFAULT_VISUALIZER_TRACKERS, mixResponse, pulseCurve, VISUALIZER_TRACKERS } from '@thockdown/look/visualizer'
import { appendBeatTrace, isBeatTraceOn } from './beatTrace'
import { musicPlayerService } from './MusicPlayerService'
import type { AnalysisAnswer, AnalysisRequest, ReaderSettings, ReaderSource } from './musicAnalysis'
import { loudnessGain } from './peakWindow'

/** A listener this far from where its clock put it has jumped (a seek, a stall), and the analysis starts over. */
const RESYNC_SEC = 0.75
/** The smallest change a subscriber is told of. */
const MIN_STEP = 0.001
/**
 * The band tracker's smoothing: the time constants of a one-pole follower
 * rising and falling. Fast enough to take a swell within a frame or two, slow
 * enough on the way down that a level wavering between frames reads as one.
 */
const BAND_ATTACK_SEC = 0.02
const BAND_RELEASE_SEC = 0.15

/** What an element follows: its mix and the fall its response takes. */
export interface MusicMixChannel {
  mix: VisualizerMix
  shape: number
  /** Seconds; 0 is no fall, so every rise from nothing is a hit and a response is only ever this frame's. */
  fallSec: number
}

/** A tracker's id in the analysis (`musicAnalysis.ts`'s reader id), and its index in `trackerRaw`. */
const TRACKER_INDEX: Record<VisualizerTrackerName, number> = { kicks: 0, hits: 1, band: 2 }

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
  onHit: ((strength: number) => void) | null
  /** Whether the response rose at the last frame, so a hit is the first rising frame after a fall. */
  rising: boolean
}

const bands = new Set<Band>()

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
 * What the answers received since the last frame say, per tracker
 * (`TRACKER_INDEX`). A drum's raw response is a hit since its last ask, so
 * two answers landing between two frames are both kept (the larger); the
 * band's is a level, and the latest stands.
 */
const pendingRaw = new Float64Array(VISUALIZER_TRACKERS.length)
/** This frame's response of each tracker, read by every element's mix: a hit's, or the band's smoothed level. */
const trackerRaw = new Float64Array(VISUALIZER_TRACKERS.length)
/** The trackers the analysis was last restarted with (`readsOf`), as a bit mask by `TRACKER_INDEX`. */
let analysedTrackers = 0

/** How long the map may answer no beat before the caret is let go to its own blink. */
const MAP_BEAT_LOSS_SEC = 4

/** The map's caret as last answered: its phase at media time `mapTime` and its period (`BeatMap.caretAt`). */
let mapTime = NaN
let mapPhase = NaN
let mapPeriod = NaN

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
 * walking against the kicks heard (the `score kicks` lines) while `el` and
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
  for (let i = 0; i < answer.ids.length; i++) {
    const index = answer.ids[i]
    const raw = answer.raws[i]
    pendingRaw[index] = index === TRACKER_INDEX.band ? raw : Math.max(pendingRaw[index], raw)
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

/** The trackers some element's mix reads, as a bit mask by `TRACKER_INDEX`. */
function readsOf(): number {
  let mask = 0
  for (const band of bands) {
    const { mix } = band.channel
    if (mix.kicks > 0) mask |= 1 << TRACKER_INDEX.kicks
    if (mix.hits > 0) mask |= 1 << TRACKER_INDEX.hits
    if (mix.band > 0) mask |= 1 << TRACKER_INDEX.band
  }
  return mask
}

const DRUM_MASK = (1 << TRACKER_INDEX.kicks) | (1 << TRACKER_INDEX.hits)

/** Whether anything reads the beat map or the score: a hit tracker some mix reads, or a clock for its beat. */
function needsDrums(): boolean {
  return clocks.size > 0 || counters.size > 0 || (readsOf() & DRUM_MASK) !== 0
}

/** The asks' reader settings, rebuilt only when the trackers or what reads them change (`readersAsked`). */
let askReaders: ReaderSettings[] = []

function rebuildAskReaders(): void {
  askReaders = []
  for (const name of VISUALIZER_TRACKERS) {
    const index = TRACKER_INDEX[name]
    if (!(analysedTrackers & (1 << index))) continue
    const tracker = trackers[name]
    askReaders.push({ id: index, contrast: tracker.contrast })
  }
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
  pendingRaw.fill(0)
  trackerRaw.fill(0)
  mapTime = mapPhase = mapPeriod = NaN
  const id = ++run
  analysedUrl = url
  if (isBeatTraceOn() && url) appendBeatTrace(`beat RESYNC at=${listenerTime.toFixed(3)}`)
  analysedTrackers = readsOf()
  rebuildAskReaders()
  const readers: ReaderSource[] = []
  for (const name of VISUALIZER_TRACKERS) {
    const index = TRACKER_INDEX[name]
    if (!(analysedTrackers & (1 << index))) continue
    const { frequencyHz, octaves } = trackers.band
    readers.push({ id: index, source: name, frequencyHz, octaves })
  }
  send({ type: 'restart', run: id, url, listenerTime, readers, drums: needsDrums() })
}

/**
 * The response for what the listener hears at `listenerTime`, from the
 * element's mixed response (`raw`, `mixResponse` of the trackers'), at `gain` (`loudnessGain`: how near full scale the track's peak
 * around the listener comes), so a track mixed quiet, or a quiet passage
 * between loud ones, pulses less than one at full scale. Every band and drum
 * source is scaled alike, and a hit's strength (`onHit`) with it; a clock
 * (the caret's beat) is not, being a beat rather than a level.
 */
function respond(band: Band, raw: number, listenerTime: number, gain: number): number {
  // The fall: a response never drops faster than its last peak fades, on
  // the block's own curve and length. A rise is taken at once.
  const { fallSec, shape } = band.channel
  const held = fallSec > 0 ? band.peak * pulseCurve((listenerTime - band.peakTime) / fallSec, shape) : 0
  if (raw > 0 && raw >= held) {
    // A hit is where a rise begins: a drum's every hit (between hits it
    // reads 0), the band's every climb out of the fall. One rule, so
    // whatever the mix follows, what pulses is what makes it rise.
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
  const { phase, period } = mapCaretAt(listenerTime)
  setLocked(subscriber, !Number.isNaN(phase))
  if (Number.isNaN(phase)) return 0
  const { fallSec, shape } = subscriber.caret
  return pulseCurve((phase * period) / Math.min(fallSec, period), shape)
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
  readTrackers(frameSec)
  const kicks = trackerRaw[TRACKER_INDEX.kicks]
  const hits = trackerRaw[TRACKER_INDEX.hits]
  const level = trackerRaw[TRACKER_INDEX.band]
  for (const band of bands) publish(band, respond(band, mixResponse(band.channel.mix, kicks, hits, level), heardTime, gain))
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
  })
  frame = requestAnimationFrame(tick)
}

/**
 * This frame's tracker responses from the answers since the last: a drum's
 * hit taken once (and cleared, so the next frame reads none unless another
 * lands), the band's level eased toward the latest answer (`BAND_ATTACK_SEC`,
 * `BAND_RELEASE_SEC`) over the frame's length, so the follower is the same at
 * any frame rate.
 */
function readTrackers(frameSec: number): void {
  trackerRaw[TRACKER_INDEX.kicks] = pendingRaw[TRACKER_INDEX.kicks]
  trackerRaw[TRACKER_INDEX.hits] = pendingRaw[TRACKER_INDEX.hits]
  pendingRaw[TRACKER_INDEX.kicks] = 0
  pendingRaw[TRACKER_INDEX.hits] = 0
  const target = pendingRaw[TRACKER_INDEX.band]
  const level = trackerRaw[TRACKER_INDEX.band]
  const tau = target > level ? BAND_ATTACK_SEC : BAND_RELEASE_SEC
  trackerRaw[TRACKER_INDEX.band] = level + (target - level) * (1 - Math.exp(-Math.max(0, frameSec) / tau))
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
  pendingRaw.fill(0)
  trackerRaw.fill(0)
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

export interface MusicMixSubscription {
  /** Follows the element's new mix and fall; a mix that reads a tracker nothing read before starts the analysis over. */
  update: (channel: MusicMixChannel) => void
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

/**
 * Sets the three trackers (`VisualizerTrackers`). A new band (frequency or
 * width) is a different quantity and starts the analysis over, which is
 * immediate; contrast is read live with every ask.
 */
export function setVisualizerTrackers(next: VisualizerTrackers): void {
  if (next.band.frequencyHz !== trackers.band.frequencyHz || next.band.octaves !== trackers.band.octaves) stale = true
  trackers = next
  rebuildAskReaders()
}

/** Follows one element's mix of the trackers; `listener` gets the response whenever it moves, and `onHit` each hit (`respond`: where a rise begins). */
export function subscribeMusicMix(channel: MusicMixChannel, listener: BeatListener, onHit: ((strength: number) => void) | null = null): MusicMixSubscription {
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
    if (readsOf() & ~analysedTrackers) stale = true
  }
  const unsubscribe = () => {
    bands.delete(band)
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
 * track not yet read. Tempo and not position, deliberately: a clock that
 * re-seats after a seek or a change of section takes the new grid's PHASE as
 * it is, so its position jumps by up to half a beat, while its period is
 * continuous apart from a change of tempo. A reader that only needs to move
 * at the music's rate integrates time over period and never sees the jump.
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


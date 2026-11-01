/**
 * The beat pulse's ANALYSIS, run in a worker (`musicAnalysis.worker.ts`) so
 * that decoding and measuring the music never takes a frame from the page:
 * every restart (a new track, a seek, a changed source or band) decodes and
 * measures the whole window either side of the listener at once, which on
 * the page's thread blocked it for a fifth of a second and more.
 *
 * It owns everything that reads the decoded samples: the decoding
 * (`MusicDecodeStream`), the one drum analysis (`DrumTracker`) with each drum
 * reader's place in its hits (`DrumCursor`), each level band's meter and its
 * window of readings, and the window's peak (`PeakWindow`). The page
 * (`musicBeat.ts`) keeps what a FRAME needs: the listener's clock, each
 * subscriber's fall, the hits it reports, the loudness gain and the caret's
 * phase. The beat map (`beatMap.ts`) is planned here too, from the samples
 * as they are decoded, `MAP_AHEAD_SEC` ahead; everything measuring the ±5s
 * window is handed them from a delay ring when the listener comes in reach.
 *
 * The two talk in ASKS. Once a frame the page asks for the moment it will
 * draw next (`AnalysisAsk`): every reader's RAW response there (a drum's hit
 * since its last ask, a level band's stretched level), the beat map's beats around it
 * (`beatMap.ts`), and the window's peak. The answer arrives before that frame, so the
 * worker adds no lag beyond the one frame the page asks ahead by. Every
 * reader's settings (contrast, groove) come with the ask, so a slider acts
 * at once and nothing restarts, exactly as when this ran on the page.
 */

import type { VisualizerDrum } from '@thockdown/look/visualizer'
import { BandLevelMeter, LEVEL_FLOOR_DB } from './bandLevel'
import { DrumCursor, DrumTracker } from './drumTracker'
import { BeatTraceWindow } from './beatTrace'
import { BeatMap, MAP_AHEAD_SEC } from './beatMap'
import { MusicDecodeStream } from './musicDecodeStream'
import { PeakWindow } from './peakWindow'

/** How far either side of the listener the window reaches, in seconds. */
export const LEAD_SEC = 5
/** How far past the window's leading edge the decoding is let run, so it never trails the listener. */
const DECODE_MARGIN_SEC = 1
/** The share of the window's moments that give a full response. */
const TOP_SHARE = 0.02
/** The narrowest span the stretch may use, so a near-constant band is not blown up into noise. */
const MIN_SPAN_DB = 3
/**
 * A band's RMS level (dBFS, of the decoded track, before the player's volume)
 * that is silence to the stretch (`stretchLevel`): no response at or below
 * it. Well under any audible part of a band in a mastered track, and over a
 * hiss or dither floor, which a narrow band reads further down still.
 */
const SILENCE_DB = -70
/** Histogram resolution, in dB. */
const BIN_DB = 0.5
const BINS = Math.ceil(-LEVEL_FLOOR_DB / BIN_DB) + 1
/** Readings kept per band: twice `LEAD_SEC` and the margin at a hundred a second, with room to spare. */
const CAPACITY = 4096

/** What a reader follows: a drum's hits, or a band's level. */
export interface ReaderSource {
  id: number
  source: VisualizerDrum | 'band'
  frequencyHz: number
  octaves: number
}

/** A reader's live settings, sent with every ask. */
export interface ReaderSettings {
  id: number
  contrast: number
  groove: number
}

/** Starts the analysis over: decoding from `LEAD_SEC` before `listenerTime`, every window emptied. */
export interface AnalysisRestart {
  type: 'restart'
  run: number
  url: string | null
  listenerTime: number
  readers: ReaderSource[]
  /** Whether anything reads the drum analysis (a drum reader, or the caret's clock for its grid). */
  drums: boolean
  /** Whether to plan the beat map and answer the caret from it (the `thockdown:beat-map` flag, `musicBeat.ts`). */
  beatMap?: boolean
}

export interface AnalysisAsk {
  type: 'ask'
  run: number
  /** The page's position now, which the decoding is kept `LEAD_SEC` and a margin ahead of. */
  listenerTime: number
  /** The heard moment the answer is for. */
  heardTime: number
  readers: ReaderSettings[]
  trace: boolean
}

/** Nothing reads the drum analysis any more: it is dropped until the next restart asks for it. */
export interface AnalysisDropDrums {
  type: 'dropDrums'
}

export interface AnalysisDispose {
  type: 'dispose'
}

export type AnalysisRequest = AnalysisRestart | AnalysisAsk | AnalysisDropDrums | AnalysisDispose

export interface AnalysisAnswer {
  type: 'answer'
  run: number
  heardTime: number
  /** Each asked reader's raw response, in the ask's order (`ids`). */
  ids: number[]
  raws: number[]
  /** The window's peak sample magnitude before `heardTime` (`PeakWindow.peakSince`), NaN while nothing is decoded. */
  peak: number
  /** The drum tracker's tempo grid (`DrumTracker.gridPeriodSec`/`gridBeatTime`), which the caret's `BeatClock` follows unless the beat map is on. */
  gridPeriodSec: number
  gridBeatTime: number
  /** The caret's beat at `heardTime` (`BeatMap.caretAt`): how far into it, 0..1, and its period (s); NaN where there is none. */
  caretPhase: number
  caretPeriod: number
  traceLines: string[]
}

interface Band {
  meter: BandLevelMeter | null
  cursor: DrumCursor | null
  drum: VisualizerDrum | null
  frequencyHz: number
  octaves: number
  times: Float64Array
  levels: Float32Array
  head: number
  count: number
  bins: Uint32Array
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

function percentile(band: Band, share: number): number {
  const target = share * (band.count - 1)
  let seen = 0
  for (let b = 0; b < BINS; b++) {
    seen += band.bins[b]
    if (seen > target) return LEVEL_FLOOR_DB + b * BIN_DB
  }
  return 0
}

/** A level band's response: its level at `listenerTime`, stretched over the window around it. */
function stretched(band: Band, listenerTime: number, contrast: number): number {
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
  return stretchLevel(level, percentile(band, contrast), percentile(band, 1 - TOP_SHARE))
}

/**
 * The levels stretch (`musicBeat.ts`'s header) of `level` between the
 * window's `floor` and `top` percentiles, in dB. Neither end is taken below
 * SILENCE_DB: a window of near silence (a track's lead-in, the gap between
 * two songs, a hiss or dither floor) is not stretched into a full response,
 * which would make its noise pulse like the music. Above it the stretch is
 * the window's own, so a quiet but audible passage still reaches a full
 * response.
 */
export function stretchLevel(level: number, floor: number, top: number): number {
  const from = Math.max(SILENCE_DB, floor)
  const to = Math.max(from + MIN_SPAN_DB, top)
  return Math.max(0, Math.min(1, (level - from) / (to - from)))
}

/**
 * The decoded samples between the window's leading edge and the beat map's
 * (`MAP_AHEAD_SEC`): decoded once, for the map, and handed on to everything
 * that measures the ±`LEAD_SEC` window when the listener comes within reach
 * of them. A ring of samples counted from the run's first, so nothing is
 * allocated per chunk.
 */
class DelayRing {
  private readonly ring: Float32Array
  /** Samples written and released since the run began. */
  private written = 0
  private released = 0
  private origin = NaN

  constructor(readonly sampleRate: number) {
    this.ring = new Float32Array(Math.ceil((MAP_AHEAD_SEC + 4) * sampleRate))
  }

  write(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    const size = this.ring.length
    for (let i = 0; i < samples.length; i++) this.ring[(this.written + i) % size] = samples[i]
    this.written += samples.length
    // The stream is never asked further ahead than MAP_AHEAD_SEC and a
    // margin, and the ring holds more than that, so nothing unreleased is
    // ever overwritten.
  }

  /** Hands every sample before media time `until` to `take`, in at most two contiguous parts. */
  release(until: number, take: (samples: Float32Array, startTime: number) => void): void {
    if (Number.isNaN(this.origin)) return
    const end = Math.min(this.written, Math.max(this.released, Math.floor((until - this.origin) * this.sampleRate)))
    const size = this.ring.length
    while (this.released < end) {
      const from = this.released % size
      const count = Math.min(end - this.released, size - from)
      take(this.ring.subarray(from, from + count), this.origin + this.released / this.sampleRate)
      this.released += count
    }
  }
}

/** The worker's whole state; `handle` takes each request in arrival order. */
export class MusicAnalysis {
  private stream: MusicDecodeStream | null = null
  /** The run the page last restarted; chunks and asks of an older one are dropped. */
  private run = 0
  /** The run whose file is open and whose decoding has started (`restart` waits for the sample rate). */
  private started = -1
  private readonly bands = new Map<number, Band>()
  private tracker: DrumTracker | null = null
  private trace: BeatTraceWindow | null = null
  private traceOn = false
  private traceLines: string[] = []
  private readonly peaks = new PeakWindow()
  private map: BeatMap | null = null
  private delay: DelayRing | null = null

  constructor(private readonly createStream: (url: string) => MusicDecodeStream = (url) => new MusicDecodeStream(url)) {}

  /** Handles one request; an ask is answered, everything else returns null. */
  handle(request: AnalysisRequest): AnalysisAnswer | null {
    switch (request.type) {
      case 'restart':
        this.restart(request)
        return null
      case 'ask':
        return this.ask(request)
      case 'dropDrums':
        this.tracker = null
        this.map = null
        this.trace = null
        return null
      case 'dispose':
        this.run++
        this.stream?.dispose()
        this.stream = null
        this.tracker = null
        this.map = null
        this.delay = null
        this.bands.clear()
        return null
    }
  }

  private restart(request: AnalysisRestart): void {
    const id = (this.run = request.run)
    this.peaks.reset()
    this.map = null
    this.delay = null
    this.tracker = null
    this.trace = null
    // A new track is a new stream; a seek in the same one keeps it.
    if (this.stream?.url !== request.url) {
      this.stream?.dispose()
      this.stream = request.url ? this.createStream(request.url) : null
    }
    // A reader that stays keeps its cursor: a seek in the same track carries
    // its place in the hits over (the tracker's epoch resets the rest).
    const previous = new Map(this.bands)
    this.bands.clear()
    for (const reader of request.readers) {
      const drum = reader.source === 'band' ? null : reader.source
      this.bands.set(reader.id, {
        meter: null,
        cursor: drum ? (previous.get(reader.id)?.cursor ?? null) : null,
        drum,
        frequencyHz: reader.frequencyHz,
        octaves: reader.octaves,
        times: new Float64Array(CAPACITY),
        levels: new Float32Array(CAPACITY),
        head: 0,
        count: 0,
        bins: new Uint32Array(BINS),
      })
    }
    const stream = this.stream
    if (!stream) return
    stream.halt()
    void stream.sampleRate().then((sampleRate) => {
      if (id !== this.run || sampleRate === null) return
      for (const band of this.bands.values()) {
        if (band.drum) band.cursor ??= new DrumCursor()
        else band.meter = new BandLevelMeter(sampleRate, band.frequencyHz, band.octaves)
      }
      this.tracker = request.drums ? new DrumTracker(sampleRate) : null
      this.map = request.drums && request.beatMap ? new BeatMap(sampleRate) : null
      this.delay = this.map ? new DelayRing(sampleRate) : null
      this.started = id
      // The file may have taken a moment to open: start from where the listener is now.
      const at = Number.isNaN(this.listenerTime) ? request.listenerTime : this.listenerTime
      stream.run(Math.max(0, at - LEAD_SEC), at + this.aheadSec() + DECODE_MARGIN_SEC, (samples, startTime) => {
        // A chunk decoded for a run a later restart replaced is not this window's.
        if (id !== this.run) return
        if (!this.delay) return this.analyse(samples, startTime, sampleRate)
        this.map?.feed(samples, startTime)
        this.delay?.write(samples, startTime)
        this.releaseUpTo(at + LEAD_SEC + DECODE_MARGIN_SEC)
      })
    })
    this.listenerTime = NaN
  }

  /** The listener's position at the last ask of this run (NaN before one). */
  private listenerTime = NaN

  /** How far ahead of the listener to decode: the beat map's reach while it is on, else the window's. */
  private aheadSec(): number {
    return this.map ? MAP_AHEAD_SEC : LEAD_SEC
  }

  /** Measures the decoded samples up to media time `until` into the ±LEAD_SEC window. */
  private releaseUpTo(until: number): void {
    const sampleRate = this.delay?.sampleRate
    if (sampleRate === undefined) return
    this.delay?.release(until, (samples, startTime) => this.analyse(samples, startTime, sampleRate))
  }

  /** Measures one decoded chunk into the drum analysis and every level band. */
  private analyse(samples: Float32Array, startTime: number, sampleRate: number): void {
    this.peaks.add(samples, startTime, sampleRate)
    const tracker = this.tracker
    if (tracker) {
      const endTime = startTime + (samples.length - 1) / sampleRate
      tracker.feed(samples, 0, endTime)
      if (this.traceOn) (this.trace ??= new BeatTraceWindow((line) => this.traceLines.push(line))).record(tracker, 0, endTime)
      else this.trace = null
    }
    for (const band of this.bands.values()) {
      band.meter?.process(samples, startTime, (time, db) => record(band, time, db))
    }
  }

  private ask(request: AnalysisAsk): AnalysisAnswer | null {
    if (request.run !== this.run) return null
    this.listenerTime = request.listenerTime
    this.traceOn = request.trace
    const { heardTime } = request
    if (this.started === this.run) {
      this.stream?.want(request.listenerTime + this.aheadSec() + DECODE_MARGIN_SEC)
      this.releaseUpTo(request.listenerTime + LEAD_SEC + DECODE_MARGIN_SEC)
      this.map?.update(heardTime)
    }
    const caret = this.map ? this.map.caretAt(heardTime) : { phase: NaN, period: NaN }
    const tracker = this.tracker
    const ids: number[] = []
    const raws: number[] = []
    for (const reader of request.readers) {
      const band = this.bands.get(reader.id)
      if (!band) continue
      ids.push(reader.id)
      if (band.drum) {
        raws.push(tracker && band.cursor ? tracker.hitBetween(band.drum, band.cursor, heardTime, reader.contrast, reader.groove) : 0)
      } else {
        raws.push(stretched(band, heardTime, reader.contrast))
      }
    }
    const traceLines = this.traceLines
    this.traceLines = []
    return {
      type: 'answer',
      run: this.run,
      heardTime,
      ids,
      raws,
      gridPeriodSec: tracker ? tracker.gridPeriodSec : NaN,
      gridBeatTime: tracker ? tracker.gridBeatTime : NaN,
      peak: this.peaks.isEmpty ? NaN : this.peaks.peakSince(heardTime - LEAD_SEC),
      caretPhase: caret.phase,
      caretPeriod: caret.period,
      traceLines,
    }
  }
}

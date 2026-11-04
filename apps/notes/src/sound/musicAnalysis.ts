/**
 * The beat pulse's ANALYSIS, run in a worker (`musicAnalysis.worker.ts`) so
 * that decoding and measuring the music never takes a frame from the page.
 *
 * It owns everything that reads the decoded samples: the decoding
 * (`MusicDecodeStream`), the beat map (`beatMap.ts`) and the drum score
 * written from it (`drumScore.ts`), both planned from the samples as they are
 * decoded, `MAP_AHEAD_SEC` ahead, the time-indexed semitone energy score,
 * each reader's place in the drum score, and the peak of the window either
 * side of the listener (`PeakWindow`), handed its samples from a delay ring
 * when the listener comes in reach. The page
 * (`musicBeat.ts`) keeps what a FRAME needs: the listener's clock, each
 * subscriber's fall, the hits it reports, the loudness gain and the caret's
 * phase.
 *
 * The two talk in ASKS. Once a frame the page asks for the moment it will
 * draw next (`AnalysisAsk`): every reader's RAW response there (the strongest
 * instance of its channel in the score since its last ask, past its
 * contrast), the beat map's caret phase, the window's peak, and the
 * semitone score at that audio time and a short future time. The answer
 * arrives before that frame, so the worker adds no lag beyond the one frame
 * the page asks ahead by. Every reader's settings (its contrast) come with
 * the ask, so a slider acts at once and nothing restarts.
 */

import { BeatMap, MAP_AHEAD_SEC } from './beatMap'
import { DEFAULT_PATTERN, writeDrumScore, type DrumChannel, type DrumInstance } from './drumScore'
import { MusicDecodeStream } from './musicDecodeStream'
import {
  MUSIC_SEMITONE_AHEAD_SEC,
  MUSIC_SEMITONE_CONFIRM_SEC,
  MusicSemitoneScore,
} from './musicSemitoneScore'
import { PeakWindow } from './peakWindow'

/** How far either side of the listener the window reaches, in seconds. */
export const LEAD_SEC = 5
/** The look-ahead a start or a seek decodes first, in seconds (`aheadSec`). */
const AHEAD_START_SEC = 10
/** How many seconds the look-ahead grows per second played. */
const AHEAD_GROWTH = 2
/** How far past the window's leading edge the decoding is let run, so it never trails the listener. */
const DECODE_MARGIN_SEC = 1
/** The share of a channel's instances that give a full response. */
const TOP_SHARE = 0.02
/**
 * The narrowest span a reader's stretch may use, in the score's strengths (natural logs of a flux): a channel whose
 * instances are all alike (a programmed kick) shows each in full rather than blowing their tiny differences up.
 */
const MIN_SPAN = Math.log(1.5)

/** What a reader follows: one channel of the drum score. */
export interface ReaderSource {
  id: number
  channel: DrumChannel
}

/** A reader's live settings, sent with every ask. */
export interface ReaderSettings {
  id: number
  contrast: number
  /** How far the score of the reader's channel follows the bar's pattern rather than the signal alone (`drumScore.ts`), 0..1. */
  pattern: number
}

/** Starts the analysis over: decoding from `LEAD_SEC` before `listenerTime`, every window emptied. */
export interface AnalysisRestart {
  type: 'restart'
  run: number
  url: string | null
  listenerTime: number
  readers: ReaderSource[]
  /** Whether anything reads the beat map (a reader, or the caret's clock). */
  drums: boolean
  /** Number of semitone boxes to score, or 0 when the key row is not subscribed. */
  semitoneBands: number
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
  /** Number of semitone boxes to score, or 0 when the key row is not subscribed. */
  semitoneBands: number
}

/** Nothing reads the beat map any more: it is dropped until the next restart asks for it. */
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
  /** The caret's beat at `heardTime` (`BeatMap.caretAt`): how far into it, 0..1, and its period (s); NaN where there is none. */
  caretPhase: number
  caretPeriod: number
  /** The decoded-track semitone levels at `heardTime` and after the lookahead confirmation window. */
  semitones: { at: Float32Array; after: Float32Array } | null
  traceLines: string[]
}

interface Reader {
  channel: DrumChannel
  /** The heard moment the reader has read the score up to (NaN before its first ask). */
  heardTo: number
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

/**
 * A reader's response to one instance of its channel: `strength` stretched
 * over `strengths` (that channel's in the score around the listener,
 * ascending), so `contrast` means one thing for every channel and every
 * track: the `contrast` share of the channel's instances shows nothing and
 * its top `TOP_SHARE` shows in full, whether the track is mastered loud or
 * quiet. Raising it is what keeps a channel to what is MOSTLY that channel:
 * a snare's slight thump is among the thumps' weakest.
 */
export function instanceResponse(strength: number, strengths: readonly number[], contrast: number): number {
  if (strengths.length === 0) return 0
  const at = (share: number) => strengths[Math.min(strengths.length - 1, Math.floor(share * strengths.length))]
  const top = at(1 - TOP_SHARE)
  // At least MIN_SPAN below the top, measured DOWN from it: instances of one loudness are all full.
  const floor = Math.min(at(contrast), top - MIN_SPAN)
  return Math.max(0, Math.min(1, (strength - floor) / (top - floor)))
}

/** The worker's whole state; `handle` takes each request in arrival order. */
export class MusicAnalysis {
  private stream: MusicDecodeStream | null = null
  private semitoneStream: MusicDecodeStream | null = null
  private semitoneScore: MusicSemitoneScore | null = null
  private semitoneBands = 0
  private semitoneGeneration = 0
  /** The run the page last restarted; chunks and asks of an older one are dropped. */
  private run = 0
  /** The run whose file is open and whose decoding has started (`restart` waits for the sample rate). */
  private started = -1
  private readonly readers = new Map<number, Reader>()
  private traceOn = false
  private traceLines: string[] = []
  private tracedAt = NaN
  private readonly peaks = new PeakWindow()
  private map: BeatMap | null = null
  private delay: DelayRing | null = null
  /** The beat map's plan the score was last written from. */
  private scoredRevision = -1
  /** Each channel's pattern the score is written with: the latest its reader asked with. A change rewrites the score at once. */
  private readonly pattern: Record<DrumChannel, number> = { thump: DEFAULT_PATTERN, pierce: DEFAULT_PATTERN, tick: DEFAULT_PATTERN }
  /**
   * Every instance of the score no reader has passed. Each writing replaces what lies from the moment heard on, so an
   * instance is correctable until it is heard (the beats around it move as the map plans further ahead).
   */
  private held: DrumInstance[] = []
  /**
   * Each channel's strengths among the held instances, ascending: the range a reader's contrast stretches over. Built
   * when first read and kept until the held instances change, so once per heard instance at most.
   */
  private readonly ranges = new Map<DrumChannel, number[]>()
  /** The listener's media time when this run started decoding: the look-ahead grows from it (`aheadSec`). */
  private startedAt = NaN
  /** The listener's position at the last ask of this run (NaN before one). */
  private listenerTime = NaN

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
        this.dropMap()
        return null
      case 'dispose':
        this.run++
        this.stream?.dispose()
        this.stream = null
        this.disposeSemitoneStream()
        this.dropMap()
        this.readers.clear()
        return null
    }
  }

  private dropMap(): void {
    this.map = null
    this.delay = null
    this.scoredRevision = -1
    this.held = []
    this.ranges.clear()
  }

  private restart(request: AnalysisRestart): void {
    const id = (this.run = request.run)
    this.semitoneBands = request.semitoneBands
    this.peaks.reset()
    this.dropMap()
    // A new track is a new stream; a seek in the same one keeps it.
    if (this.stream?.url !== request.url) {
      this.stream?.dispose()
      this.stream = request.url ? this.createStream(request.url) : null
    }
    this.readers.clear()
    for (const reader of request.readers) this.readers.set(reader.id, { channel: reader.channel, heardTo: NaN })
    this.restartSemitone(request.url, request.listenerTime, request.semitoneBands)
    const stream = this.stream
    if (!stream) return
    stream.halt()
    void stream.sampleRate().then((sampleRate) => {
      if (id !== this.run || sampleRate === null) return
      this.map = request.drums ? new BeatMap(sampleRate) : null
      this.delay = this.map ? new DelayRing(sampleRate) : null
      this.started = id
      // The file may have taken a moment to open: start from where the listener is now.
      const at = Number.isNaN(this.listenerTime) ? request.listenerTime : this.listenerTime
      this.startedAt = at
      stream.run(Math.max(0, at - LEAD_SEC), at + this.aheadSec() + DECODE_MARGIN_SEC, (samples, startTime) => {
        // A chunk decoded for a run a later restart replaced is not this window's.
        if (id !== this.run) return
        if (!this.delay) return this.peaks.add(samples, startTime, sampleRate)
        this.map?.feed(samples, startTime)
        this.delay.write(samples, startTime)
        this.releaseUpTo(at + LEAD_SEC + DECODE_MARGIN_SEC)
      })
    })
    this.listenerTime = NaN
  }

  /**
   * How far ahead of the listener to decode. With the beat map it starts at AHEAD_START_SEC and grows AHEAD_GROWTH
   * times as fast as the music plays, to MAP_AHEAD_SEC, so a start or a seek is planned within moments rather than
   * after a minute of music has been decoded.
   */
  private aheadSec(): number {
    if (!this.map) return LEAD_SEC
    const played = Number.isNaN(this.startedAt) || Number.isNaN(this.listenerTime) ? 0 : Math.max(0, this.listenerTime - this.startedAt)
    return Math.min(MAP_AHEAD_SEC, AHEAD_START_SEC + AHEAD_GROWTH * played)
  }

  /** Hands the decoded samples up to media time `until` to the window's peak. */
  private releaseUpTo(until: number): void {
    const delay = this.delay
    if (delay) delay.release(until, (samples, startTime) => this.peaks.add(samples, startTime, delay.sampleRate))
  }

  /** Writes the score again from `heardTime` on, if the beat map has planned since it was last written. */
  private writeScore(heardTime: number): void {
    const map = this.map
    if (!map || map.revision === this.scoredRevision) return
    this.scoredRevision = map.revision
    const written = writeDrumScore(map.onsets, map.beatsBetween(-Infinity, Infinity), heardTime, this.pattern)
    let keep = 0
    while (keep < this.held.length && this.held[keep].time < heardTime) keep++
    this.held = [...this.held.slice(0, keep), ...written.filter((x) => x.time >= heardTime)]
    this.ranges.clear()
  }

  /** A reader's response at `heardTime`: the strongest instance of its channel heard since its last ask. */
  private response(reader: Reader, heardTime: number, contrast: number): number {
    const from = reader.heardTo
    reader.heardTo = heardTime
    if (Number.isNaN(from) || heardTime <= from) return 0
    let raw = 0
    for (const x of this.held) {
      if (x.time <= from) continue
      if (x.time > heardTime) break
      const strength = x[reader.channel]
      if (Number.isNaN(strength)) continue
      const response = instanceResponse(strength, this.rangeOf(reader.channel), contrast)
      raw = Math.max(raw, response)
      if (this.traceOn) this.traceLines.push(`score ${reader.channel} at=${x.time.toFixed(3)} heard=${heardTime.toFixed(3)}${x.one ? ' one' : ''} strength=${strength.toFixed(2)} contrast=${contrast.toFixed(2)} response=${response.toFixed(2)}`)
    }
    return raw
  }

  private rangeOf(channel: DrumChannel): number[] {
    let range = this.ranges.get(channel)
    if (!range) {
      range = this.held.map((x) => x[channel]).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b)
      this.ranges.set(channel, range)
    }
    return range
  }

  private ask(request: AnalysisAsk): AnalysisAnswer | null {
    if (request.run !== this.run) return null
    this.listenerTime = request.listenerTime
    this.traceOn = request.trace
    if (request.semitoneBands !== this.semitoneBands) {
      this.semitoneBands = request.semitoneBands
      this.restartSemitone(this.stream?.url ?? null, request.listenerTime, request.semitoneBands)
    }
    const { heardTime } = request
    for (const settings of request.readers) {
      const reader = this.readers.get(settings.id)
      if (!reader || this.pattern[reader.channel] === settings.pattern) continue
      this.pattern[reader.channel] = settings.pattern
      this.scoredRevision = -1
    }
    if (this.started === this.run) {
      this.stream?.want(request.listenerTime + this.aheadSec() + DECODE_MARGIN_SEC)
      this.releaseUpTo(request.listenerTime + LEAD_SEC + DECODE_MARGIN_SEC)
      this.map?.update(heardTime)
      if (this.readers.size > 0) this.writeScore(heardTime)
    }
    this.semitoneStream?.want(request.listenerTime + MUSIC_SEMITONE_AHEAD_SEC)
    const caret = this.map ? this.map.caretAt(heardTime) : { phase: NaN, period: NaN }
    let semitones: AnalysisAnswer['semitones'] = null
    if (this.semitoneScore && this.semitoneBands > 0) {
      const at = new Float32Array(this.semitoneBands)
      const after = new Float32Array(this.semitoneBands)
      this.semitoneScore.levelsAt(heardTime, at)
      this.semitoneScore.levelsAt(heardTime + MUSIC_SEMITONE_CONFIRM_SEC, after)
      semitones = { at, after }
    }
    const ids: number[] = []
    const raws: number[] = []
    for (const settings of request.readers) {
      const reader = this.readers.get(settings.id)
      if (!reader) continue
      ids.push(settings.id)
      raws.push(this.response(reader, heardTime, settings.contrast))
    }
    // What every reader has passed is never read again.
    let passed = Infinity
    for (const reader of this.readers.values()) passed = Math.min(passed, Number.isNaN(reader.heardTo) ? -Infinity : reader.heardTo)
    if (this.held.length > 0 && this.held[0].time <= passed) {
      this.held = this.held.filter((x) => x.time > passed)
      this.ranges.clear()
    }
    if (this.traceOn && this.map && !(Math.abs(heardTime - this.tracedAt) < 1)) {
      this.tracedAt = heardTime
      const count = (channel: DrumChannel) => this.held.filter((x) => !Number.isNaN(x[channel])).length
      const last = this.held.length > 0 ? this.held[this.held.length - 1].time : heardTime
      this.traceLines.push(`score sec heard=${heardTime.toFixed(3)} ahead=${(last - heardTime).toFixed(1)}s thump=${count('thump')} pierce=${count('pierce')} tick=${count('tick')}`)
    }
    const traceLines = this.traceLines
    this.traceLines = []
    return {
      type: 'answer',
      run: this.run,
      heardTime,
      ids,
      raws,
      peak: this.peaks.isEmpty ? NaN : this.peaks.peakSince(heardTime - LEAD_SEC),
      caretPhase: caret.phase,
      caretPeriod: caret.period,
      semitones,
      traceLines,
    }
  }

  private restartSemitone(url: string | null, at: number, bands: number): void {
    if (!Number.isInteger(bands) || bands < 0) throw new RangeError('Semitone band count must be non-negative')
    const generation = ++this.semitoneGeneration
    this.semitoneScore = null
    if (bands === 0 || !url) {
      this.disposeSemitoneStream()
      return
    }
    if (this.semitoneStream?.url !== url) {
      this.semitoneStream?.dispose()
      this.semitoneStream = this.createStream(url)
    }
    const stream = this.semitoneStream
    if (!stream) return
    void stream.sampleRate().then((sampleRate) => {
      if (generation !== this.semitoneGeneration || stream !== this.semitoneStream || sampleRate === null) return
      const score = new MusicSemitoneScore(sampleRate, bands)
      this.semitoneScore = score
      const from = Math.max(0, at - 1)
      stream.run(from, at + MUSIC_SEMITONE_AHEAD_SEC, (samples, startTime) => {
        if (generation !== this.semitoneGeneration || score !== this.semitoneScore) return
        score.feed(samples, startTime)
      })
    })
  }

  private disposeSemitoneStream(): void {
    this.semitoneGeneration += 1
    this.semitoneStream?.dispose()
    this.semitoneStream = null
    this.semitoneScore = null
  }
}

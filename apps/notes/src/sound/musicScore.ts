/**
 * The SCORE of the music: the signal map (`signalMap.ts`) written ahead of
 * the listener, and the port it is written through.
 *
 * Writing it is heavy (a ten-second stretch of music takes a couple of
 * seconds to factorize), so it runs in a worker of its own
 * (`musicScore.worker.ts`), started by the analysis worker
 * (`musicAnalysis.ts`), which keeps answering the page once a frame while
 * the score is written. The analysis worker hands it the decoded samples, the
 * beat map's beats and the moment being heard, and receives every instance
 * not yet heard, re-sent whenever the analysis changed them: an instance is
 * correctable until it is heard, and the analysis worker reads each one once,
 * when the listener reaches it.
 *
 * `ScoreWriter` is the PORT: the analysis worker knows only it, so a test
 * writes the score in-thread (`SignalScore` itself), and a future writer for
 * a live stream (the phone app) is another implementation of it.
 */

import { SIGNAL_RATE, SignalMap, type SignalInstance, type SignalSummary } from './signalMap'
import { StreamResampler } from './streamResampler'

/** How much newly fed music the score waits for before it analyses again, in seconds. */
const ANALYSE_STEP_SEC = 1
/** How far behind the listener the score keeps its frames and instances, in seconds: as far as the beat map keeps beats. */
export const SCORE_BEHIND_SEC = 30
/** Instances this far before the moment heard are re-sent too, so one landing between two of the reader's asks is not missed. */
const SEND_BEHIND_SEC = 1

/** What the score sends: every instance from `from` on, replacing what was sent before for this run. */
export interface ScoreUpdate {
  run: number
  from: number
  instances: SignalInstance[]
  signals: SignalSummary[]
  /** The media time analysed up to. */
  frontier: number
}

/** Where the score is written. Every call names its run; one for a run a later `reset` replaced is ignored. */
export interface ScoreWriter {
  /** Starts the score over at a seek (`newTrack` false: the learned signals stay true) or for a new track. */
  reset(run: number, sampleRate: number, newTrack: boolean): void
  /** Mono samples at the track's own rate, contiguous since the last `reset`, the first at media time `startTime`. */
  feed(run: number, samples: Float32Array, startTime: number): void
  /** The beat map's beats, every one it holds (they place the instances on the grid that flags them). */
  beats(run: number, times: number[]): void
  /** The moment being heard: instances at or before it are final. */
  heard(run: number, time: number): void
  dispose(): void
}

/** The score written in the calling thread. The worker hosts one; a test uses one directly. */
export class SignalScore implements ScoreWriter {
  private beatTimes: number[] = []
  private readonly map = new SignalMap({ beatsBetween: (from, to) => this.beatTimes.filter((t) => t >= from && t <= to) })
  private run = -1
  private resampler: StreamResampler | null = null
  /** Media time of the first sample fed since the reset, and how many samples at SIGNAL_RATE have been fed. */
  private startTime = NaN
  private fed = 0
  private heardTime = -Infinity
  private analysedFrontier = -Infinity

  constructor(private readonly publish: (update: ScoreUpdate) => void) {}

  reset(run: number, sampleRate: number, newTrack: boolean): void {
    this.run = run
    this.map.reset()
    if (newTrack) this.map.forgetSignals()
    this.resampler = sampleRate === SIGNAL_RATE ? null : new StreamResampler(sampleRate, SIGNAL_RATE)
    this.startTime = NaN
    this.fed = 0
    this.heardTime = -Infinity
    this.analysedFrontier = -Infinity
    this.beatTimes = []
  }

  feed(run: number, samples: Float32Array, startTime: number): void {
    if (run !== this.run) return
    if (Number.isNaN(this.startTime)) this.startTime = startTime
    // The resampler's output sample k lies exactly k / SIGNAL_RATE after the first input sample.
    const out = this.resampler ? this.resampler.process(samples, 0).samples : samples
    this.map.feed(out, this.startTime + this.fed / SIGNAL_RATE)
    this.fed += out.length
    if (this.map.frontier - this.analysedFrontier >= ANALYSE_STEP_SEC) this.analyse()
  }

  beats(run: number, times: number[]): void {
    if (run !== this.run) return
    this.beatTimes = times
    // The flags read the beats, so new beats re-judge them, even where no more music is fed (the track's end lies
    // inside the look-ahead).
    if (Number.isFinite(this.map.frontier)) this.analyse()
  }

  heard(run: number, time: number): void {
    if (run === this.run) this.heardTime = Math.max(this.heardTime, time)
  }

  dispose(): void {
    this.run = -1
  }

  private analyse(): void {
    this.analysedFrontier = this.map.frontier
    if (Number.isFinite(this.heardTime)) this.map.forgetBefore(this.heardTime - SCORE_BEHIND_SEC)
    this.map.analyse(this.heardTime)
    const from = this.heardTime - SEND_BEHIND_SEC
    this.publish({
      run: this.run,
      from,
      instances: this.map.instancesBetween(from, Infinity),
      signals: this.map.signalList(),
      frontier: this.map.frontier,
    })
  }
}

/** Messages to the score's worker: one per `ScoreWriter` call. */
export type ScoreRequest =
  | { type: 'reset'; run: number; sampleRate: number; newTrack: boolean }
  | { type: 'feed'; run: number; samples: Float32Array; startTime: number }
  | { type: 'beats'; run: number; times: number[] }
  | { type: 'heard'; run: number; time: number }

/** The score written in a worker of its own (`musicScore.worker.ts`). */
export class WorkerScore implements ScoreWriter {
  private readonly worker = new Worker(new URL('./musicScore.worker.ts', import.meta.url), { type: 'module' })

  constructor(publish: (update: ScoreUpdate) => void) {
    this.worker.onmessage = (event: MessageEvent<ScoreUpdate>) => publish(event.data)
  }

  reset(run: number, sampleRate: number, newTrack: boolean): void {
    this.post({ type: 'reset', run, sampleRate, newTrack })
  }

  feed(run: number, samples: Float32Array, startTime: number): void {
    // A copy: the decoder's chunk is also written to the delay ring.
    const copy = samples.slice()
    this.worker.postMessage({ type: 'feed', run, samples: copy, startTime } satisfies ScoreRequest, [copy.buffer])
  }

  beats(run: number, times: number[]): void {
    this.post({ type: 'beats', run, times })
  }

  heard(run: number, time: number): void {
    this.post({ type: 'heard', run, time })
  }

  dispose(): void {
    this.worker.terminate()
  }

  private post(request: ScoreRequest): void {
    this.worker.postMessage(request)
  }
}

/**
 * The ROLLING BEAT MAP: every beat of the music around the listener, planned
 * from the decoded track up to `MAP_AHEAD_SEC` ahead, so the caret's pulse
 * lands on each beat by design rather than steering toward a tempo after
 * the fact. Built in the analysis worker (`musicAnalysis.ts`) from the same
 * decoded samples as everything else, and bounded in memory to a window of
 * `MAP_BEHIND_SEC` + `MAP_AHEAD_SEC` whatever the track's length (an
 * eight-hour ambient track and a three-hour set cost the same as a song).
 *
 * Three stages, each a function of what the one before produced:
 *
 * 1. An ONSET ENVELOPE, one value per hop (`HOP_SEC`): how much the music's
 *    energy rose, low end and top end each measured on its own (a kick
 *    rises in the first, a hat or a strum in the second), half-wave
 *    rectified so a decay is not an event.
 * 2. A LOCAL TEMPO CURVE, one estimate a second (`TEMPO_STEP_SEC`): the
 *    autocorrelation of the envelope over `TEMPO_WINDOW_SEC` centred on that
 *    second, weighted towards `PRIOR_BPM` (a listener's preferred tempo, as
 *    in Ellis 2007) and towards the estimate before it (one octave error
 *    between neighbouring seconds is a doubt, not a tempo change). Each
 *    estimate carries a CONFIDENCE: the autocorrelation's peak against its
 *    zero lag, so a passage with no repeating pulse (ambient, a spoken
 *    intro) says so.
 * 3. BEATS by dynamic programming (Ellis, "Beat Tracking by Dynamic
 *    Programming", JNMR 36(1), 2007): the best chain of beats through the
 *    envelope, where each beat scores its onset and each gap is penalised
 *    by how far its length strays from the local tempo's period, on a log
 *    scale (`TIGHTNESS`). The chain is read back from the far end of what
 *    is decoded, so every beat is placed knowing the music on BOTH sides of
 *    it: a ritardando slows the chain beat by beat, and through a silence
 *    (no onsets to score) the chain simply keeps the period, gliding from
 *    the tempo before to the tempo after.
 *
 * Beats are COMMITTED once they are within `COMMIT_SEC` of the listener and
 * never move again: every later chain must pass through the last committed
 * beat, so the pulse already drawn and the one about to be drawn are one
 * chain. Beyond that the plan is revised as more of the track is decoded.
 *
 * WHERE THERE IS A BEAT is decided from the confidence (`judge`), with the look-ahead:
 * a passage whose tempo estimates are confident has beats; a gap of
 * unconfident estimates (a silence, a break, a breakdown) no longer than
 * `GLIDE_MAX_SEC` between two confident passages is carried through on the
 * chain; anything longer, or a track with no pulse at all, has none, and the
 * caret blinks there.
 */

/** The envelope's resolution, in seconds. */
export const HOP_SEC = 256 / 48000
/** How far ahead of the listener the map is planned. */
export const MAP_AHEAD_SEC = 30
/** How far behind the listener the map keeps what it planned. */
export const MAP_BEHIND_SEC = 30
/** Beats this close to the listener (or behind it) are final. */
export const COMMIT_SEC = 2
/** The span each tempo estimate is measured over, and how often one is made. */
const TEMPO_WINDOW_SEC = 4
const TEMPO_STEP_SEC = 1
/** The tempo estimate's smoothing of the envelope, in hops either side. */
const SMOOTH_HOPS = 4
/** The tempos considered, in beats a minute. */
const MIN_BPM = 50
const MAX_BPM = 220
/** The tempo prior: a log-Gaussian centred here, `PRIOR_OCTAVES` wide. */
const PRIOR_BPM = 120
const PRIOR_OCTAVES = 1
/** How much a tempo estimate is drawn to the last one: a log-Gaussian this many octaves wide. */
const CONTINUITY_OCTAVES = 0.15
/** Least strength (autocorrelation peak against zero lag) an estimate needs to count at all. */
const MIN_STRENGTH = 0.2
/**
 * How far two estimates' periods may differ, octaves aside, and still agree.
 * A tempo ramp of a couple of beats a minute per second moves about this
 * much between two estimates `AGREE_STEP` apart.
 */
const AGREE_RATIO = 0.06
/** Estimates this many steps apart look at windows that do not overlap. */
const AGREE_STEP = Math.round(TEMPO_WINDOW_SEC / TEMPO_STEP_SEC)
/** The longest unconfident gap carried through on the beat between two confident passages. */
export const GLIDE_MAX_SEC = 16
/** How strongly a gap is held to the local period (Ellis's alpha, for an envelope of unit spread). */
const TIGHTNESS = 1600
/**
 * The KICK band: below this the envelope's second, low-only measure
 * (`kickEnvelope`), which decides where the caret's beat falls in the bar.
 */
const KICK_HZ = 90
/**
 * How many beats either side a beat's time is SMOOTHED over (`regularize`):
 * a local quadratic fit through the chain, so a steady tempo is a rigid grid
 * however busy the break played over it, while a ritardando, which is
 * smooth over that span, is followed.
 */
const SMOOTH_BEATS = 8
/** How many beats of look-ahead decide where the caret's beat falls (`decideCaret`). */
const CARET_DECIDE_BEATS = 32
/** How much stronger another placement of the caret's beat must read to replace the held one. */
const CARET_SWITCH_RATIO = 1.5
/** How much more of the track must be decoded before the chain is planned again. */
const REPLAN_SEC = 1
/** The energy smoothing per hop for each band (one-pole, the hop's share). */
const LOW_HZ = 150
const ENERGY_FLOOR = 1e-10

/** One planned beat: its media time and whether it is final. */
export interface MapBeat {
  time: number
  committed: boolean
}

/**
 * One tempo estimate: the second it is centred on, the period (s) and the
 * strength; then, judged against its neighbours (`judge`), whether it is
 * CONFIDENT and its period folded onto the octave of the beat before it.
 */
interface TempoFrame {
  time: number
  period: number
  strength: number
  confident: boolean
  folded: number
}

/** The caret's tempo range, in beats a minute: from CARET_MIN_BPM up to but not including twice it. */
export const CARET_MIN_BPM = 70

/**
 * Where the caret's beat falls from map beat number `from` on: a caret beat
 * at every map beat position `from + phase + m / scale` (whole m), `scale`
 * being the caret's beats per map beat (a power of two) and `phase` in map
 * beats, in halves. `period` is the map's beat period (s) it was decided at.
 */
interface CaretPlacement {
  from: number
  scale: number
  phase: number
  period: number
}

/** The caret's beat at a moment: how far into it, 0..1, and its period (s); NaN for both where there is none. */
export interface CaretBeat {
  phase: number
  period: number
}

/** The value at `at` of the least-squares quadratic through (j, values[j]) for j in lo..hi. */
function quadraticAt(values: number[], lo: number, hi: number, at: number): number {
  // Centred on `at` for conditioning: fit y = a + b x + c x^2 with x = j - at, and a is the answer.
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0
  for (let j = lo; j <= hi; j++) {
    const x = j - at
    const y = values[j] - values[at]
    const x2 = x * x
    s0 += 1; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2
    t0 += y; t1 += x * y; t2 += x2 * y
  }
  // Cramer's rule on the normal equations, for a.
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2)
  if (Math.abs(det) < 1e-9) return values[at]
  const a = t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)
  return values[at] + a / det
}

function logGaussian(x: number, centre: number, octaves: number): number {
  const d = Math.log2(x / centre) / octaves
  return Math.exp(-0.5 * d * d)
}

export class BeatMap {
  private readonly hopFrames: number
  private readonly lowCoeff: number
  /** The envelope, a ring; `envStart` is the media time of the hop at index `envHead`'s position 0. */
  private readonly capacity: number
  private readonly envelope: Float32Array
  /** Index (in hops since the map started) of the oldest hop kept, and of the next to be written. */
  private first = 0
  private next = 0
  /** Media time of hop 0. */
  private origin = NaN
  /** The open hop's accumulators. */
  private filled = 0
  private low = 0
  private lastX = 0
  private lowEnergy = 0
  private highEnergy = 0
  private prevLowDb = NaN
  private prevHighDb = NaN
  private readonly tempos: TempoFrame[] = []
  /** Committed beats, as hop indices (fractional, from the chain's whole hops), oldest first; trimmed behind. */
  private committed: number[] = []
  /** Beats ever committed: the count of the one after the last committed, so every beat has a number. */
  private committedCount = 0
  /** The last plan read back: provisional beats after the last committed one. */
  private planned: number[] = []
  private dirty = false
  /** The kick band's rise per hop, a ring alongside `envelope`, and its filter state. */
  private readonly kickEnvelope: Float32Array
  private readonly kickCoeff: number
  private kick1 = 0
  private kick2 = 0
  private kickEnergy = 0
  private prevKickDb = NaN
  /** Where the CARET's beat falls (`decideCaret`), each decision from its beat on, oldest first. */
  private carets: CaretPlacement[] = []
  /** Scratch for one tempo window's smoothed envelope. */
  private readonly smoothed: Float64Array
  /** The frontier the last plan was made at. */
  private plannedAt = NaN

  constructor(readonly sampleRate: number) {
    this.hopFrames = Math.max(1, Math.round(HOP_SEC * sampleRate))
    this.lowCoeff = 1 - Math.exp((-2 * Math.PI * LOW_HZ) / sampleRate)
    this.capacity = Math.ceil((MAP_AHEAD_SEC + MAP_BEHIND_SEC + TEMPO_WINDOW_SEC + 4) / this.hopSec)
    this.envelope = new Float32Array(this.capacity)
    this.kickEnvelope = new Float32Array(this.capacity)
    this.kickCoeff = 1 - Math.exp((-2 * Math.PI * KICK_HZ) / sampleRate)
    this.smoothed = new Float64Array(Math.round(TEMPO_WINDOW_SEC / this.hopSec) + 1)
  }

  get hopSec(): number {
    return this.hopFrames / this.sampleRate
  }

  /** The media time the map has heard up to: the end of the last whole hop. */
  get frontier(): number {
    return Number.isNaN(this.origin) ? NaN : this.timeOf(this.next)
  }

  private timeOf(hop: number): number {
    return this.origin + hop * this.hopSec
  }

  private env(hop: number): number {
    return this.envelope[hop % this.capacity]
  }

  /** Takes decoded mono `samples`, the first at media time `startTime`, contiguous with what came before. */
  feed(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]
      this.low += (x - this.low) * this.lowCoeff
      const high = x - this.lastX
      this.lastX = x
      this.lowEnergy += this.low * this.low
      this.highEnergy += high * high
      this.kick1 += (x - this.kick1) * this.kickCoeff
      this.kick2 += (this.kick1 - this.kick2) * this.kickCoeff
      this.kickEnergy += this.kick2 * this.kick2
      if (++this.filled === this.hopFrames) this.closeHop()
    }
    this.dirty = true
  }

  private closeHop(): void {
    const lowDb = 10 * Math.log10(ENERGY_FLOOR + this.lowEnergy / this.hopFrames)
    const highDb = 10 * Math.log10(ENERGY_FLOOR + this.highEnergy / this.hopFrames)
    const rise = (Number.isNaN(this.prevLowDb) ? 0 : Math.max(0, lowDb - this.prevLowDb)) + (Number.isNaN(this.prevHighDb) ? 0 : Math.max(0, highDb - this.prevHighDb))
    // Below the floor of anything audible a rise is noise, not an onset.
    const audible = Math.max(lowDb, highDb) > -70
    this.prevLowDb = lowDb
    this.prevHighDb = highDb
    this.envelope[this.next % this.capacity] = audible ? rise : 0
    const kickDb = 10 * Math.log10(ENERGY_FLOOR + this.kickEnergy / this.hopFrames)
    this.kickEnvelope[this.next % this.capacity] = audible && !Number.isNaN(this.prevKickDb) ? Math.max(0, kickDb - this.prevKickDb) : 0
    this.prevKickDb = kickDb
    this.kickEnergy = 0
    this.next++
    if (this.next - this.first > this.capacity) this.first = this.next - this.capacity
    this.filled = 0
    this.lowEnergy = 0
    this.highEnergy = 0
  }

  /**
   * Brings the plan up to date for a listener at `listenerTime`: tempo
   * estimates for every whole window decoded, the chain re-planned from the
   * last committed beat, and every beat within COMMIT_SEC of the listener
   * committed. Cheap when nothing new was decoded.
   */
  update(listenerTime: number): void {
    if (Number.isNaN(this.origin)) return
    this.trim(listenerTime)
    // Re-planned once a REPLAN_SEC more of the track is decoded, not per
    // chunk: a plan spans the whole look-ahead, and what a quarter second
    // more adds to it is at its far end.
    if (this.dirty && (Number.isNaN(this.plannedAt) || this.frontier - this.plannedAt >= REPLAN_SEC)) {
      this.dirty = false
      this.plannedAt = this.frontier
      this.estimateTempos()
      this.judge()
      this.plan()
    }
    this.commit(listenerTime)
  }

  /** Forgets what lies further behind the listener than MAP_BEHIND_SEC. */
  private trim(listenerTime: number): void {
    const keepFrom = listenerTime - MAP_BEHIND_SEC
    while (this.tempos.length > 0 && this.tempos[0].time < keepFrom - TEMPO_WINDOW_SEC) this.tempos.shift()
    // The newest committed beat anchors the chain, so it is kept whatever its age.
    while (this.committed.length > 1 && this.timeOf(this.committed[0]) < keepFrom) this.committed.shift()
    // Every decision but the one in force at the oldest beat kept.
    const oldest = this.committedCount - this.committed.length
    while (this.carets.length > 1 && this.carets[1].from <= oldest) this.carets.shift()
  }

  private estimateTempos(): void {
    const window = Math.round(TEMPO_WINDOW_SEC / this.hopSec)
    const minLag = Math.floor(60 / MAX_BPM / this.hopSec)
    const maxLag = Math.ceil(60 / MIN_BPM / this.hopSec)
    // Lags up to twice the slowest beat, for the half bar each candidate is judged with.
    const maxLag2 = Math.min(2 * maxLag + 1, window - 1)
    const scores = new Float64Array(maxLag2 + 2)
    for (;;) {
      const last = this.tempos.length > 0 ? this.tempos[this.tempos.length - 1].time : this.timeOf(this.first) + TEMPO_WINDOW_SEC / 2 - TEMPO_STEP_SEC
      const centre = last + TEMPO_STEP_SEC
      const from = Math.round((centre - this.origin) / this.hopSec) - (window >> 1)
      if (from < this.first || from + window > this.next) {
        if (from < this.first && from + window <= this.next) {
          // The first window after a start: the envelope began later than it reaches.
          this.tempos.push({ time: centre, period: NaN, strength: 0, confident: false, folded: NaN })
          continue
        }
        return
      }
      // Smoothed (a triangle SMOOTH_HOPS either side), so an onset a few hops
      // early or late against the beat before it (a tempo moving under the
      // window) still correlates; and mean-removed, so a dense passage does
      // not correlate with itself at every lag.
      const smooth = this.smoothed
      for (let i = 0; i < window; i++) {
        let sum = 0
        let weights = 0
        for (let d = -SMOOTH_HOPS; d <= SMOOTH_HOPS; d++) {
          const h = from + i + d
          if (h < this.first || h >= this.next) continue
          const w = SMOOTH_HOPS + 1 - Math.abs(d)
          sum += w * this.env(h)
          weights += w
        }
        smooth[i] = sum / weights
      }
      let mean = 0
      for (let i = 0; i < window; i++) mean += smooth[i]
      mean /= window
      for (let i = 0; i < window; i++) smooth[i] -= mean
      let zero = 0
      for (let i = 0; i < window; i++) zero += smooth[i] ** 2
      const previous = this.lastPeriod()
      let best = -Infinity
      let bestLag = NaN
      let bestRaw = 0
      for (let lag = minLag; lag <= maxLag2; lag++) {
        let sum = 0
        for (let i = lag; i < window; i++) sum += smooth[i] * smooth[i - lag]
        scores[lag] = sum / (window - lag)
      }
      for (let lag = minLag + 1; lag < maxLag; lag++) {
        // A peak of the autocorrelation, not a shoulder of one.
        if (scores[lag] < scores[lag - 1] || scores[lag] < scores[lag + 1] || scores[lag] <= 0) continue
        const period = lag * this.hopSec
        const weight = logGaussian(period, 60 / PRIOR_BPM, PRIOR_OCTAVES) * (Number.isNaN(previous) ? 1 : 0.25 + 0.75 * logGaussian(period, previous, CONTINUITY_OCTAVES))
        // A beat is judged with everything it builds: its lag AND every whole
        // multiple of it the window holds (the k-th weighed 1/k). A
        // syncopated loop can correlate as strongly at one and a half beats
        // as at one, and the lag alone cannot tell them apart (a seek into
        // such a loop locked onto 1.5 beats); the real pulse's multiples
        // land on the half bar and the bar, one and a half's do not.
        let comb = scores[lag]
        for (let k = 2; k * lag <= maxLag2; k++) comb += Math.max(0, this.peakNear(scores, k * lag, maxLag2)) / k
        if (comb * weight > best) {
          best = comb * weight
          // The peak's position refined between hops by a parabola through it and its neighbours.
          const l = scores[lag - 1]
          const c = scores[lag]
          const r = scores[lag + 1]
          const denominator = l - 2 * c + r
          bestLag = lag + (denominator < 0 ? (0.5 * (l - r)) / denominator : 0)
          bestRaw = c
        }
      }
      const strength = zero > 0 ? bestRaw / (zero / window) : 0
      this.tempos.push({ time: centre, period: Number.isNaN(bestLag) ? NaN : bestLag * this.hopSec, strength, confident: false, folded: NaN })
    }
  }

  /** The autocorrelation's largest value within one hop of `lag` (a doubled lag lands between hops). */
  private peakNear(scores: Float64Array, lag: number, top: number): number {
    let best = -Infinity
    for (let l = Math.max(0, lag - 1); l <= Math.min(top, lag + 1); l++) best = Math.max(best, scores[l])
    return best
  }

  private lastPeriod(): number {
    for (let i = this.tempos.length - 1; i >= 0; i--) {
      if (this.tempos[i].strength >= MIN_STRENGTH && !Number.isNaN(this.tempos[i].period)) return this.tempos[i].period
    }
    return NaN
  }

  /**
   * Which estimates are CONFIDENT: a strong one whose period AGREES (octaves
   * aside) with estimates over windows that do not overlap it, two steps of
   * AGREE_STEP in a row, on either side or one each. Strength alone does not
   * tell a pulse from chance: a dense mix's true beat and a random scatter of
   * hits both peak at about a third of the zero lag, but only the pulse
   * names the same period window after window. Every confident period is
   * folded onto the octave of the confident one before it, so a window that
   * reads the beat at half or double speed does not halve or double the chain.
   */
  private judge(): void {
    const frames = this.tempos
    const usable = (i: number) => i >= 0 && i < frames.length && frames[i].strength >= MIN_STRENGTH && !Number.isNaN(frames[i].period)
    const agree = (i: number, j: number) => {
      if (!usable(i) || !usable(j)) return false
      const octaves = Math.log2(frames[i].period / frames[j].period)
      return Math.abs(octaves - Math.round(octaves)) <= Math.log2(1 + AGREE_RATIO)
    }
    const k = AGREE_STEP
    let previous = NaN
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]
      frame.confident = (agree(i, i - k) && agree(i - k, i - 2 * k)) || (agree(i, i - k) && agree(i, i + k)) || (agree(i, i + k) && agree(i + k, i + 2 * k))
      if (!frame.confident) {
        frame.folded = NaN
        continue
      }
      frame.folded = Number.isNaN(previous) ? frame.period : frame.period * 2 ** Math.round(Math.log2(previous / frame.period))
      previous = frame.folded
    }
  }

  /**
   * Whether media time `time` lies in a passage with a beat (header, WHERE
   * THERE IS A BEAT), and the period there: a confident estimate's own, or
   * across a gap short enough to carry through, the two sides' periods
   * blended on a log scale by where in the gap `time` falls.
   */
  periodAt(time: number): number {
    const frames = this.tempos
    if (frames.length === 0) return NaN
    const confident = (f: TempoFrame) => f.confident
    // The estimate nearest `time`.
    let i = Math.round((time - frames[0].time) / TEMPO_STEP_SEC)
    i = Math.max(0, Math.min(frames.length - 1, i))
    if (confident(frames[i])) {
      // Between two confident estimates, the period moves smoothly from one to the other.
      const j = time >= frames[i].time ? i + 1 : i - 1
      if (j < 0 || j >= frames.length || !confident(frames[j])) return frames[i].folded
      const share = Math.abs(time - frames[i].time) / TEMPO_STEP_SEC
      return frames[i].folded * (frames[j].folded / frames[i].folded) ** share
    }
    let before = i
    while (before >= 0 && !confident(frames[before])) before--
    let after = i
    while (after < frames.length && !confident(frames[after])) after++
    if (before < 0 || after >= frames.length) return NaN
    const gap = frames[after].time - frames[before].time
    if (gap > GLIDE_MAX_SEC + TEMPO_STEP_SEC) return NaN
    const share = (time - frames[before].time) / gap
    return frames[before].folded * (frames[after].folded / frames[before].folded) ** Math.max(0, Math.min(1, share))
  }

  /**
   * Plans the chain (header, 3) from the last committed beat, or from the
   * oldest hop kept, to the frontier, and reads it back from the best beat
   * near the frontier. The envelope is scaled to unit spread over the span,
   * so TIGHTNESS means the same on a quiet track as on a loud one.
   */
  private plan(): void {
    // The last committed beat anchors the chain, unless a gap no chain can
    // carry across lies between it and the frontier (a long silence, a
    // stretch with no pulse): then the chain starts afresh, and the plan
    // never spans more than the look-ahead and that gap.
    const lastCommitted = this.committed.length > 0 ? Math.round(this.committed[this.committed.length - 1]) : -1
    const fresh = lastCommitted < 0 || lastCommitted < this.first || this.next - lastCommitted > (MAP_AHEAD_SEC + COMMIT_SEC + GLIDE_MAX_SEC) / this.hopSec
    const anchor = fresh ? -1 : lastCommitted
    const start = anchor >= 0 ? anchor : Math.max(this.first, this.next - Math.ceil((MAP_AHEAD_SEC + COMMIT_SEC + GLIDE_MAX_SEC) / this.hopSec))
    const end = this.next - 1
    if (end - start < 2) {
      this.planned = []
      return
    }
    const n = end - start + 1
    let mean = 0
    for (let h = start; h <= end; h++) mean += this.env(h)
    mean /= n
    let spread = 0
    for (let h = start; h <= end; h++) spread += (this.env(h) - mean) ** 2
    spread = Math.sqrt(spread / n) || 1
    const score = new Float64Array(n)
    const from = new Int32Array(n).fill(-1)
    const periods = new Float64Array(n)
    for (let k = 0; k < n; k++) periods[k] = this.periodAt(this.timeOf(start + k)) / this.hopSec
    for (let k = 0; k < n; k++) {
      const onset = this.env(start + k) / spread
      const period = periods[k]
      if (anchor >= 0 && k === 0) {
        score[k] = onset
        continue
      }
      if (Number.isNaN(period)) {
        // No beat here: a chain may start afresh on the far side.
        score[k] = anchor >= 0 ? -Infinity : onset
        continue
      }
      let best = -Infinity
      let bestFrom = -1
      const lo = Math.max(0, Math.floor(k - 2 * period))
      const hi = Math.min(k - 1, Math.ceil(k - period / 2))
      for (let j = lo; j <= hi; j++) {
        if (score[j] === -Infinity) continue
        const stray = Math.log((k - j) / period)
        const value = score[j] - TIGHTNESS * stray * stray
        if (value > best) {
          best = value
          bestFrom = j
        }
      }
      if (bestFrom < 0) {
        score[k] = anchor >= 0 && k < 2 * period ? -Infinity : onset
        continue
      }
      score[k] = onset + best
      from[k] = bestFrom
    }
    // Read back from the best beat within the last period before the frontier.
    const lastPeriod = periods[n - 1]
    const reach = Number.isNaN(lastPeriod) ? 1 : Math.ceil(lastPeriod)
    let best = -Infinity
    let k = -1
    for (let j = Math.max(0, n - reach); j < n; j++) {
      if (score[j] > best) {
        best = score[j]
        k = j
      }
    }
    const chain: number[] = []
    while (k > 0 && from[k] >= 0) {
      chain.push(start + k)
      k = from[k]
    }
    // The chain's first beat: the anchor itself (already committed) or the
    // start of a fresh chain, whether at the plan's start or after a gap.
    if (k >= 0 && start + k !== anchor) chain.push(start + k)
    chain.reverse()
    // A fresh chain never reaches back over beats already committed.
    if (lastCommitted >= 0) {
      const after = lastCommitted
      while (chain.length > 0 && chain[0] <= after) chain.shift()
    }
    // Only the parts of the chain in a passage with a beat are beats.
    this.planned = this.regularize(chain.filter((h) => !Number.isNaN(this.periodAt(this.timeOf(h)))))
  }

  /**
   * The planned beats SMOOTHED (header of SMOOTH_BEATS): each moved onto a
   * quadratic fitted by least squares through the beats within SMOOTH_BEATS
   * of it, committed ones included, in the same run (no gap of more than
   * twice the local period between neighbours). The chain says where the
   * beats are; the fit says where a steady hand would put them, which is
   * what a break's ghost notes and flams must not move.
   */
  private regularize(chain: number[]): number[] {
    const context = Math.min(this.committed.length, SMOOTH_BEATS)
    const all = [...this.committed.slice(this.committed.length - context), ...chain]
    const out = new Array<number>(chain.length)
    for (let i = 0; i < chain.length; i++) {
      const at = context + i
      // The run around beat `at`: stop at a gap no beat bridges.
      let lo = at
      while (lo > 0 && at - lo < SMOOTH_BEATS && all[lo] - all[lo - 1] < 2 * this.periodHopsAt(all[lo])) lo--
      let hi = at
      while (hi < all.length - 1 && hi - at < SMOOTH_BEATS && all[hi + 1] - all[hi] < 2 * this.periodHopsAt(all[hi])) hi++
      out[i] = hi - lo >= 4 ? quadraticAt(all, lo, hi, at) : chain[i]
    }
    return out
  }

  private periodHopsAt(hop: number): number {
    const period = this.periodAt(this.timeOf(hop))
    return Number.isNaN(period) ? Infinity : period / this.hopSec
  }

  private kickAt(hop: number): number {
    // The strongest rise within two hops: a beat's time and its kick's onset differ by the envelope's smear.
    const h = Math.round(hop)
    let most = 0
    for (let j = h - 2; j <= h + 2; j++) if (j >= this.first && j < this.next) most = Math.max(most, this.kickEnvelope[j % this.capacity])
    return most
  }

  /**
   * Decides where the caret's beat falls, from map beat number `from` on
   * (whose time is `beats[0]`, the beats after it following): the caret's
   * octave (a power of two of the map's tempo inside MIN_BPM..MAX_BPM), and
   * of the placements that octave allows (every map beat or half beat in one
   * caret beat), the one whose positions carry the most KICK over the next
   * CARET_DECIDE_BEATS map beats: the bar's one and three, wherever the
   * loudest onsets fall. A held placement is kept unless another reads
   * CARET_SWITCH_RATIO stronger, so a break that drops the kick for a bar
   * does not move it.
   */
  private decideCaret(from: number, beats: number[], keep: boolean): void {
    // The look-ahead stops at a gap no beat bridges: past it is another passage.
    let reach = 1
    while (reach < beats.length && reach <= CARET_DECIDE_BEATS && beats[reach] - beats[reach - 1] < 2 * this.periodHopsAt(beats[reach - 1])) reach++
    const count = reach - 1
    if (count < 1) return
    const period = ((beats[count] - beats[0]) / count) * this.hopSec
    const scale = 2 ** -Math.floor(Math.log2(60 / period / CARET_MIN_BPM))
    // The placements one caret beat allows, in halves of a map beat.
    const placements = Math.max(1, Math.round(2 / scale))
    const strength = new Float64Array(placements)
    for (let i = 0; i < count; i++) {
      strength[(2 * i) % placements] += this.kickAt(beats[i])
      strength[(2 * i + 1) % placements] += this.kickAt((beats[i] + beats[i + 1]) / 2)
    }
    let best = 0
    for (let p = 1; p < placements; p++) if (strength[p] > strength[best]) best = p
    const last = this.carets[this.carets.length - 1]
    if (keep && last && last.scale === scale) {
      // The held placement, in this decision's terms.
      const held = (((Math.round(2 * (last.from + last.phase - from)) % placements) + placements) % placements)
      if (!(strength[best] > CARET_SWITCH_RATIO * strength[held])) {
        last.period = period
        return
      }
    }
    this.carets.push({ from, scale, phase: best / 2, period })
  }

  /**
   * The caret's beat at media time `time` (`CaretBeat`): the map's beats
   * either side of it, read through the caret placement in force there.
   */
  caretAt(time: number): CaretBeat {
    const { previous, next, index } = this.beatsAround(time)
    if (Number.isNaN(previous) || Number.isNaN(next) || Number.isNaN(index)) return { phase: NaN, period: NaN }
    let placement: CaretPlacement | undefined
    for (const c of this.carets) if (c.from <= index) placement = c
    if (!placement) return { phase: NaN, period: NaN }
    const position = index - placement.from + (time - previous) / (next - previous)
    const caret = (position - placement.phase) * placement.scale
    return { phase: caret - Math.floor(caret), period: (next - previous) / placement.scale }
  }

  private commit(listenerTime: number): void {
    const limit = listenerTime + COMMIT_SEC
    let taken = 0
    while (taken < this.planned.length && this.timeOf(this.planned[taken]) <= limit) {
      const beat = this.planned[taken]
      const before = this.committed.length > 0 ? this.committed[this.committed.length - 1] : NaN
      const period = this.periodHopsAt(beat)
      // A new passage (the first beat, or one after a gap no beat bridges)
      // decides the caret afresh; within one, only a real change of tempo
      // reopens the decision, and then the held placement is preferred.
      const ahead = this.planned.slice(taken)
      const held = this.carets[this.carets.length - 1]
      if (!held || !(beat - before < 2 * period)) this.decideCaret(this.committedCount, ahead, false)
      else if (Math.abs(Math.log2((period * this.hopSec) / held.period)) > Math.log2(1 + AGREE_RATIO)) this.decideCaret(this.committedCount, ahead, true)
      this.committed.push(beat)
      this.committedCount++
      taken++
    }
    if (taken > 0) this.planned = this.planned.slice(taken)
  }

  /**
   * The beats either side of media time `time` (the last at or before it
   * and the first after it, committed or planned) or NaN where there is
   * none (no beat there, or not decoded that far), and the NUMBER of the one
   * before (beats counted since the map began), so a reader can take every
   * other beat or halve each one consistently.
   */
  beatsAround(time: number): { previous: number; next: number; index: number } {
    let previous = NaN
    let next = NaN
    let index = NaN
    const beats = this.committed.length
    const visit = (hop: number, at: number) => {
      const t = this.timeOf(hop)
      if (t <= time) {
        previous = t
        index = at
      } else if (Number.isNaN(next)) next = t
    }
    for (let i = 0; i < beats; i++) visit(this.committed[i], this.committedCount - beats + i)
    for (let i = 0; i < this.planned.length; i++) visit(this.planned[i], this.committedCount + i)
    // Two beats a gap with no beat in it apart are not one beat's span.
    if (!Number.isNaN(previous) && !Number.isNaN(next)) {
      const period = this.periodAt(time)
      if (Number.isNaN(period) || next - previous > 2.5 * period) return { previous: NaN, next: NaN, index: NaN }
    }
    return { previous, next, index }
  }

  /** Every beat between `from` and `to`, for tests and the trace. */
  beatsBetween(from: number, to: number): MapBeat[] {
    const out: MapBeat[] = []
    for (const h of this.committed) if (this.timeOf(h) >= from && this.timeOf(h) <= to) out.push({ time: this.timeOf(h), committed: true })
    for (const h of this.planned) if (this.timeOf(h) >= from && this.timeOf(h) <= to) out.push({ time: this.timeOf(h), committed: false })
    return out
  }
}

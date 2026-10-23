/**
 * Finds the kick drum in a stream of samples, for the beat pulse's BEAT
 * position (`musicBeat.ts`). Pure: it is fed samples and media times and
 * answered with media times, so it is tested on synthesized music
 * (`kickTracker.test.ts`) with no audio stack.
 *
 * Three stages, each answering a question the one before cannot:
 *
 * 1. ONSET STRENGTH, at a fixed rate (`HOP` samples, ~5ms), independent of
 *    the display's frame rate. A kick and a bass line share the sub band,
 *    so the sub band alone cannot tell them apart (a bass note starting
 *    from silence climbs as steeply as a kick). What a kick has and they do
 *    not is BREADTH: its attack is a pitch falling from a couple of hundred
 *    Hz into the sub, with the beater's click on top, so it climbs in three
 *    bands at once (`ONSET_BANDS`: sub, body, click) where a bass note climbs
 *    in the low ones and a hat or clap in the high one. Each band's energy is
 *    averaged over `ENVELOPE_HOPS` hops (about two cycles of the kick, so the
 *    reading does not ripple with the phase of one cycle in the window); its
 *    rise is how far that stands above its lowest over the last `RISE_HOPS`,
 *    in linear energy so a sound starting from silence is not an infinite
 *    climb; and each rise is measured against that band's own recent PEAK
 *    rises (one per climb, each fading with a half-life of
 *    `BAND_MEMORY_SEC`), capped at 1, so the bands' loudness in a given mix
 *    does not matter. The yardstick is the `REFERENCE_RANK`-th largest of
 *    them rather than the largest: against the largest, one kick louder than
 *    the rest became the yardstick and the ordinary kicks after it read as
 *    faint for seconds. The fade is what keeps a breakdown faint: the bass
 *    line is measured against kicks that are fading, not forgotten. The onset is the weighted GEOMETRIC MEAN of the three:
 *    large only when all three climb together.
 *
 * 2. TEMPO AND PHASE, from the whole window (`musicBeat.ts` keeps the scout
 *    seconds ahead, so the window reaches past the listener as well as
 *    behind). The onset strength's autocorrelation over 70..180 BPM, weighted
 *    towards 120 so a half or double tempo does not win on a tie, gives the
 *    beat period; a comb over the window gives the phase. Recomputed every
 *    `GRID_EVERY_HOPS`, not per frame.
 *
 * 3. HITS. When the grid is confident (its autocorrelation peak against the
 *    signal's own energy, `MIN_CONFIDENCE`), a hit is a grid beat and its
 *    strength is the strongest onset within `SNAP_HOPS` of it, so an
 *    off-beat bass note or a stray onset between kicks never fires, and a
 *    breakdown with no kick gives beats of no strength. When it is not, a
 *    hit is any local maximum of the onset strength (picked over `PEAK_HOPS`
 *    either side), which still follows a kick pattern that is not on a
 *    regular grid.
 *
 * A hit's response is its strength in dB against the window's strong hits
 * (`TOP_SHARE` of them), over a floor `contrast` sets: contrast 0 shows
 * hits down to `CONTRAST_RANGE_DB` below the strong ones, contrast 1 only
 * the strong ones.
 */

const HOP = 256
const ENVELOPE_HOPS = 8
const RISE_HOPS = 6
/**
 * The bands a kick's attack climbs in together: centre in Hz, Q, and weight
 * in the geometric mean (summing to 1). The click weighs least: it says the
 * attack is percussive, but how loud a click is varies most between kicks,
 * and a clap or a hat landing on the kick would otherwise decide how strong
 * that kick reads.
 */
const ONSET_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [55, 0.9, 0.45],
  [140, 0.9, 0.35],
  [3500, 0.7, 0.2],
]
/** The first bands of ONSET_BANDS, which alone say how strong a kick is. */
const LOW_BANDS = 2
/** The half-life of a band's remembered peak rises, for normalising the next. */
const BAND_MEMORY_SEC = 4
/**
 * Which of a band's remembered peak rises (largest first, as faded) a rise
 * is measured against: the third, so up to two outliers do not set it.
 */
const REFERENCE_RANK = 3
/** Window kept, in hops: a little over ten seconds at 48kHz. */
const CAPACITY = 2048
const MIN_BPM = 70
const MAX_BPM = 180
/** The tempo the weighting prefers, and how wide its preference is, in octaves. */
const PREFERRED_BPM = 120
const PREFERENCE_OCTAVES = 1
const GRID_EVERY_HOPS = 48
const MIN_CONFIDENCE = 0.25
/** Hops the grid needs before it is trusted: four seconds at 48kHz. */
const MIN_GRID_HOPS = 750
const SNAP_HOPS = 6
const PEAK_HOPS = 12
const TOP_SHARE = 0.25
/** The span of strengths, in dB below the strong hits, that contrast 0 lets through; contrast 1 lets through only the strong hits. */
const CONTRAST_RANGE_DB = 20
/** How slowly the strong hits' remembered level fades once the window holds nothing as strong. */
const STRONG_HIT_HALF_LIFE_SEC = 20
/** Samples lost in one go beyond this restart the tracker rather than being filled with silence. */
const MAX_GAP_SEC = 1
/** Media time this far from where the samples fed put it (a stall or a seek) restarts the tracker. */
const MAX_DRIFT_SEC = 0.25
/**
 * How many feeds the media-time alignment averages over: each feed moves it
 * by this share of how far its stamp disagrees. The stamps jitter by several
 * milliseconds, more than a hop; the samples themselves do not.
 */
const ALIGN_FEEDS = 60

/** The REFERENCE_RANK largest of `keys`, largest first (all of them, while fewer). */
function topKeys(keys: readonly number[]): number[] {
  return [...keys].sort((a, b) => b - a).slice(0, REFERENCE_RANK)
}

/** One band's band-pass, envelope and rise. */
class OnsetBand {
  private readonly b0: number
  private readonly b2: number
  private readonly a1: number
  private readonly a2: number
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private hopEnergy = 0
  private readonly recentEnergy = new Float64Array(ENVELOPE_HOPS)
  private readonly recentLevel = new Float64Array(RISE_HOPS)
  /** The last two rises, to find the hop a climb peaked at. */
  private lastRise = 0
  private riseBefore = 0
  /**
   * The band's remembered peak rises, oldest first, each as a KEY: log2 of
   * the rise plus the hop it peaked at over `memoryHops` (the half-life in
   * hops). A peak's faded value now is 2^(key - hop / memoryHops), so the
   * keys compare peaks as faded at any moment, and one peak older and
   * smaller than another stays smaller for good.
   */
  private peakKeys: number[] = []
  /** Hops closed since the last reset; unlike a closeHop index, not restarted by a gap. */
  private hop = 0

  constructor(sampleRate: number, hz: number, q: number, private readonly memoryHops: number) {
    // RBJ band-pass, constant 0dB peak gain.
    const w = (2 * Math.PI * hz) / sampleRate
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    this.b0 = alpha / a0
    this.b2 = -alpha / a0
    this.a1 = (-2 * Math.cos(w)) / a0
    this.a2 = (1 - alpha) / a0
  }

  reset(): void {
    this.settle()
    this.hopEnergy = 0
    this.lastRise = 0
    this.riseBefore = 0
    this.peakKeys = []
    this.hop = 0
  }

  /** Clears the filter's memory, after a gap whose samples were never seen. */
  settle(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }

  add(x: number): void {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    this.hopEnergy += y * y
  }

  /** Closes hop number `index` (from 0 since the last reset): the band's rise, as a share of its strong rises. */
  closeHop(index: number): number {
    this.recentEnergy[index % ENVELOPE_HOPS] = this.hopEnergy / HOP
    this.hopEnergy = 0
    let energy = 0
    const filled = Math.min(index + 1, ENVELOPE_HOPS)
    for (let k = 0; k < filled; k++) energy += this.recentEnergy[k]
    const level = energy / filled
    let trough = level
    const levels = Math.min(index, RISE_HOPS)
    for (let k = 0; k < levels; k++) trough = Math.min(trough, this.recentLevel[k])
    this.recentLevel[index % RISE_HOPS] = level
    // Until the envelope spans its full window the first hops would read as a climb from nothing.
    const rise = index >= ENVELOPE_HOPS ? level - trough : 0
    // The previous hop was a climb's peak when it stood above the hop before
    // it and at least as high as this one.
    if (this.lastRise > 0 && this.lastRise > this.riseBefore && this.lastRise >= rise) {
      this.remember(Math.log2(this.lastRise) + (this.hop - 1) / this.memoryHops)
    }
    this.riseBefore = this.lastRise
    this.lastRise = rise
    this.hop++
    if (rise <= 0) return 0
    const keys = this.peakKeys
    if (keys.length === 0) return 1
    // The REFERENCE_RANK-th largest key, or the smallest while fewer are remembered.
    const largest = topKeys(keys)
    const reference = 2 ** (largest[largest.length - 1] - this.hop / this.memoryHops)
    return Math.min(1, rise / reference)
  }

  /**
   * Adds a peak's key, forgetting every older peak that REFERENCE_RANK newer
   * ones now outrank: it can never be among the largest again, so the list
   * stays a handful long however many small climbs a band makes.
   */
  private remember(key: number): void {
    this.peakKeys.push(key)
    const kept: number[] = []
    let newer: number[] = []
    for (let i = this.peakKeys.length - 1; i >= 0; i--) {
      const own = this.peakKeys[i]
      if (newer.length < REFERENCE_RANK || own > newer[REFERENCE_RANK - 1]) kept.push(own)
      newer = topKeys([...newer, own])
    }
    this.peakKeys = kept.reverse()
  }
}

/** Why a feed restarted the tracker: too many samples lost, or a stamp too far from the clock. */
export type KickRestart = 'gap' | 'drift'

export class KickTracker {
  /**
   * For diagnostics (`beatTrace.ts`): how far the last feed's stamp was from
   * where the sample count put it, in seconds (the jitter the alignment
   * averages away), and whether that feed restarted the tracker and why.
   */
  lastDriftSec = 0
  lastRestart: KickRestart | null = null

  private readonly hopSec: number
  private readonly bands: OnsetBand[]
  private readonly weights: number[]
  private hopFill = 0
  /** Hops closed since the last reset or gap. */
  private hopIndex = 0
  /** Onset strength per hop, oldest at `head`; `firstTime` is the media time of hop index `start`. */
  private readonly onset = new Float32Array(CAPACITY)
  /**
   * The same hops' STRENGTH: the low bands alone (sub and body). The click
   * decides WHERE the kicks are; how strong one is, it does not, or a clap
   * landing on every other kick would make the pulse alternate.
   */
  private readonly strength = new Float32Array(CAPACITY)
  /** The last grid beat reported, in absolute hops, so a grid nudged between two calls cannot report it twice. */
  private lastBeat = NaN
  private head = 0
  private count = 0
  /** Absolute index of the oldest kept hop, and the media time at absolute index 0. */
  private start = 0
  private originTime = 0
  /** Samples taken since the last reset, lost ones (filled with silence) included: the hop clock. */
  private fedSamples = 0
  /** The media time of sample 0 since the last reset, as the stamps average out. */
  private sampleOriginTime = 0
  private hopsSinceGrid = 0
  /** The grid, in absolute hop indices (period may be fractional); NaN while there is none. */
  private period = NaN
  private phase = NaN
  private confidence = 0
  private strongHit = 0
  /** The media time `strongHit` was last raised at, for its decay. */
  private strongHitTime = 0
  /** The media time the last answer was given for, so each hit is reported once. */
  private lastAsked = NaN

  constructor(sampleRate: number) {
    this.hopSec = HOP / sampleRate
    const memoryHops = Math.round(BAND_MEMORY_SEC / this.hopSec)
    this.bands = ONSET_BANDS.map(([hz, q]) => new OnsetBand(sampleRate, hz, q, memoryHops))
    this.weights = ONSET_BANDS.map(([, , weight]) => weight)
  }

  reset(): void {
    for (const band of this.bands) band.reset()
    this.hopFill = 0
    this.hopIndex = 0
    this.head = 0
    this.count = 0
    this.start = 0
    this.fedSamples = 0
    this.hopsSinceGrid = 0
    this.period = NaN
    this.phase = NaN
    this.confidence = 0
    this.strongHit = 0
    this.strongHitTime = 0
    this.lastAsked = NaN
    this.lastBeat = NaN
  }

  /**
   * Takes samples whose LAST one plays at media time `endTime`, after `lost`
   * samples that were never seen (filled with silence). Samples already fed
   * are the caller's to leave out.
   *
   * The hop clock is the COUNT of samples, which is exact; `endTime` only
   * aligns that count with the music, averaged over `ALIGN_FEEDS` feeds. A
   * media element's reported position jitters by more than a hop, and taken
   * at its word each late stamp read as a gap and pushed the clock forward
   * while an early one was ignored, so the clock walked off the music until
   * the next seek. A stamp further off than `MAX_DRIFT_SEC` is a real stall
   * or seek, and restarts the tracker.
   */
  feed(samples: Float32Array, from: number, endTime: number, lost = 0): void {
    const n = Math.max(0, samples.length - from)
    if (n === 0 && lost <= 0) return
    const sampleSec = this.hopSec / HOP
    this.lastDriftSec = 0
    this.lastRestart = null
    if (this.fedSamples > 0) {
      const expected = this.sampleOriginTime + (this.fedSamples + lost + n - 1) * sampleSec
      const drift = endTime - expected
      this.lastDriftSec = drift
      if (lost * sampleSec > MAX_GAP_SEC || Math.abs(drift) > MAX_DRIFT_SEC) {
        this.lastRestart = lost * sampleSec > MAX_GAP_SEC ? 'gap' : 'drift'
        this.reset()
      } else {
        this.sampleOriginTime += drift / ALIGN_FEEDS
        this.originTime = this.sampleOriginTime - (ENVELOPE_HOPS / 2 - 1) * this.hopSec
        if (lost > 0) {
          this.take(new Float32Array(lost), 0)
          // The silence is the clock's, not the music's: the bands start
          // over from the next real sample rather than read it as a climb.
          for (const band of this.bands) band.settle()
          this.hopIndex = 0
        }
      }
    }
    if (this.fedSamples === 0) {
      // A hop's time is the centre of the envelope it closes, the moment its reading describes.
      this.sampleOriginTime = endTime - (n - 1) * sampleSec
      this.originTime = this.sampleOriginTime - (ENVELOPE_HOPS / 2 - 1) * this.hopSec
    }
    this.take(samples, from)
  }

  /** Runs samples through the bands, closing a hop every HOP of them. */
  private take(samples: Float32Array, from: number): void {
    this.fedSamples += samples.length - from
    const bands = this.bands
    for (let i = from; i < samples.length; i++) {
      const x = samples[i]
      for (const band of bands) band.add(x)
      if (++this.hopFill === HOP) {
        this.hopFill = 0
        let product = 1
        let low = 1
        let lowWeight = 0
        for (let b = 0; b < bands.length; b++) {
          const rise = bands[b].closeHop(this.hopIndex)
          product *= rise ** this.weights[b]
          if (b < LOW_BANDS) {
            low *= rise ** this.weights[b]
            lowWeight += this.weights[b]
          }
        }
        this.hopIndex++
        this.pushOnset(product, low ** (1 / lowWeight))
      }
    }
  }

  private pushOnset(value: number, strength: number): void {
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY
      this.count--
      this.start++
    }
    this.onset[(this.head + this.count) % CAPACITY] = value
    this.strength[(this.head + this.count) % CAPACITY] = strength
    this.count++
    if (++this.hopsSinceGrid >= GRID_EVERY_HOPS) {
      this.hopsSinceGrid = 0
      this.updateGrid()
    }
  }

  /** The onset strength at absolute hop index `index`, 0 outside the window. */
  private at(index: number): number {
    const k = index - this.start
    return k >= 0 && k < this.count ? this.onset[(this.head + k) % CAPACITY] : 0
  }

  private updateGrid(): void {
    const n = this.count
    if (n < MIN_GRID_HOPS) {
      this.period = NaN
      this.confidence = 0
      return
    }
    let mean = 0
    for (let k = 0; k < n; k++) mean += this.onset[(this.head + k) % CAPACITY]
    mean /= n
    let zero = 0
    for (let k = 0; k < n; k++) {
      const d = this.onset[(this.head + k) % CAPACITY] - mean
      zero += d * d
    }
    if (zero <= 0) {
      this.period = NaN
      this.confidence = 0
      return
    }
    const hopsPerMinute = 60 / this.hopSec
    const minLag = Math.floor(hopsPerMinute / MAX_BPM)
    const maxLag = Math.ceil(hopsPerMinute / MIN_BPM)
    const raw = new Float64Array(maxLag + 2)
    let best = -1
    let bestScore = -Infinity
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let sum = 0
      for (let k = lag; k < n; k++) {
        sum += (this.onset[(this.head + k) % CAPACITY] - mean) * (this.onset[(this.head + k - lag) % CAPACITY] - mean)
      }
      // Normalised by the overlap, so a long lag is not penalised for having fewer terms.
      raw[lag] = sum / (n - lag)
      if (lag < minLag || lag > maxLag) continue
      const octaves = Math.log2(hopsPerMinute / lag / PREFERRED_BPM) / PREFERENCE_OCTAVES
      const score = raw[lag] * Math.exp(-0.5 * octaves * octaves)
      if (score > bestScore) {
        bestScore = score
        best = lag
      }
    }
    // Parabolic refinement: a period between two whole hops is the norm (128 BPM at 48kHz is 87.9 hops).
    const l = raw[best - 1]
    const c = raw[best]
    const r = raw[best + 1]
    const curvature = l - 2 * c + r
    const period = best + (curvature < 0 ? (0.5 * (l - r)) / curvature : 0)
    this.confidence = c / (zero / n)
    this.period = period
    // Phase: the offset whose comb of beats across the window collects the most onset.
    const steps = Math.ceil(period)
    let bestPhase = 0
    let bestSum = -Infinity
    for (let p = 0; p < steps; p++) {
      let sum = 0
      for (let beat = this.start + p; beat < this.start + n; beat += period) sum += this.at(Math.round(beat))
      if (sum > bestSum) {
        bestSum = sum
        bestPhase = p
      }
    }
    this.phase = this.start + bestPhase
    // The strong hits' level: the TOP_SHARE quantile of the grid beats' strengths.
    const strengths: number[] = []
    for (let beat = this.phase; beat < this.start + n; beat += period) strengths.push(this.snapped(beat))
    strengths.sort((a, b) => b - a)
    const current = strengths[Math.min(strengths.length - 1, Math.floor(strengths.length * TOP_SHARE))] ?? 0
    // Remembered with a slow decay, so through a breakdown the bass line is
    // still measured against the kick it stood beside rather than becoming the
    // strongest thing in a window the kick has left.
    const now = this.originTime + (this.start + n) * this.hopSec
    const remembered = this.strongHit * 0.5 ** ((now - this.strongHitTime) / STRONG_HIT_HALF_LIFE_SEC)
    if (current >= remembered) {
      this.strongHit = current
      this.strongHitTime = now
    }
  }

  /** The strength of the strongest onset within SNAP_HOPS of a grid beat. */
  private snapped(beat: number): number {
    const centre = Math.round(beat)
    let best = centre
    for (let k = centre - SNAP_HOPS; k <= centre + SNAP_HOPS; k++) if (this.at(k) > this.at(best)) best = k
    return this.strengthAt(best)
  }

  private strengthAt(index: number): number {
    const k = index - this.start
    return k >= 0 && k < this.count ? this.strength[(this.head + k) % CAPACITY] : 0
  }

  /** True when the grid is trusted, for tests and diagnostics. */
  get tempoBpm(): number {
    return this.isLocked() ? 60 / (this.period * this.hopSec) : NaN
  }

  /** The grid's confidence (its autocorrelation peak against the signal's energy), for diagnostics. */
  get gridConfidence(): number {
    return this.confidence
  }

  private isLocked(): boolean {
    return !Number.isNaN(this.period) && this.confidence >= MIN_CONFIDENCE
  }

  /**
   * The response of a hit heard between the last call and media time `time`
   * (0..1), or 0 when none was. `contrast` (0..1) is the least share of the
   * strong hits' strength a hit must have to show.
   */
  hitBetween(time: number, contrast: number): number {
    const previous = this.lastAsked
    this.lastAsked = time
    if (Number.isNaN(previous) || time <= previous || time - previous > 0.25 || this.count === 0) return 0
    const from = (previous - this.originTime) / this.hopSec
    const to = (time - this.originTime) / this.hopSec
    let strength = 0
    if (this.isLocked()) {
      // The first grid beat after `from`, and every one up to `to`.
      let beat = this.phase + Math.ceil((from - this.phase) / this.period) * this.period
      if (beat <= from) beat += this.period
      for (; beat <= to; beat += this.period) {
        if (beat - this.lastBeat < this.period / 2) continue
        this.lastBeat = beat
        strength = Math.max(strength, this.snapped(beat))
      }
    } else {
      for (let k = Math.floor(from) + 1; k <= Math.floor(to); k++) {
        const value = this.at(k)
        if (value <= 0) continue
        let isPeak = true
        for (let j = k - PEAK_HOPS; j <= k + PEAK_HOPS && isPeak; j++) {
          if (j !== k && (this.at(j) > value || (this.at(j) === value && j < k))) isPeak = false
        }
        if (isPeak) strength = Math.max(strength, this.strengthAt(k))
      }
    }
    if (strength <= 0) return 0
    // In dB against the strong hits, so a kick that reads somewhat weaker
    // (interfering with the bass line's tail, say) still reads as a kick.
    const top = this.strongHit > 0 ? this.strongHit : strength
    const floorDb = -(1 - contrast) * CONTRAST_RANGE_DB
    const db = 10 * Math.log10(strength / top)
    return Math.max(0, Math.min(1, (db - floorDb) / -floorDb))
  }
}

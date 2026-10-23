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
 *    line is measured against kicks that are fading, not forgotten. The
 *    onset is the weighted GEOMETRIC MEAN of the three: large only when all
 *    three climb together.
 *
 * 2. TEMPO AND PHASE, from the whole window (`musicBeat.ts` keeps the scout
 *    seconds ahead, so the window reaches past the listener as well as
 *    behind). Read from the PULSE, the bands' arithmetic mean, not the
 *    onset: a snare or hat lifts it too, and those are what tell a break's
 *    meter from the syncopation of its kicks. A candidate period over
 *    70..180 BPM is scored by its COMB (the autocorrelation at one to
 *    `COMB_BEATS` periods), weighted towards 120 so a half or double tempo
 *    does not win on a tie; a beat and a half (a dotted pattern) repeats at
 *    two of the four and loses. The comb's mean against the pulse's energy
 *    is the CONFIDENCE, and an estimate below `MIN_CONFIDENCE` does not
 *    replace the grid: it holds for `GRID_HOLD_SEC` through a breakdown or a
 *    busy passage. Recomputed every `GRID_EVERY_HOPS`, not per frame.
 *
 * 3. PATTERN. The onset is folded onto one bar of the grid
 *    (`PATTERN_BINS`, twelve to a beat, so sixteenths and triplet swing
 *    each have their own positions); the positions it collects at are the
 *    bar's SLOTS, and each remembers how strong its kicks are
 *    (`PATTERN_MEMORY_SEC`, rising at once and falling slowly). So a break
 *    learns its syncopated kicks, a swung groove its late eighth, a ghost
 *    kick a faint slot, and the bar is EXPECTATION: a slot with no kick on
 *    it this time gives nothing.
 *
 * 4. HITS, only while the grid is locked (before it, nothing tells a kick
 *    from what surrounds it). A hit is an onset peak (the largest within
 *    `PEAK_SEC` either side) on a slot, with the low-band strength the slot
 *    usually carries (`PRESENCE_SHARE`) and an onset shaped like the
 *    track's kick (`SHAPE_SHARE`), so a breakdown's bass or clap landing on
 *    a kick slot does not pass. It reports its slot's remembered strength
 *    when it is within `STEADY_DB` of it, so identical kicks pulse
 *    identically, and otherwise the lesser of the two.
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
const GRID_EVERY_HOPS = 96
/**
 * The comb confidence (its mean autocorrelation against the pulse's energy)
 * a tempo estimate needs to replace the grid. Chance alone, over a window of
 * some 2,800 hops, reaches about 0.02; a four-on-the-floor track reads 0.8
 * and up, a break with its kicks off the beat about a quarter.
 */
const MIN_CONFIDENCE = 0.1
/** Periods a tempo's comb spans. */
const COMB_BEATS = 4
/** How long a grid is held without a confident estimate before the tracker drops to unlocked. */
const GRID_HOLD_SEC = 20
/** Hops the grid needs before it is trusted: four seconds at 48kHz. */
const MIN_GRID_HOPS = 750
const SNAP_HOPS = 6
/** Beats in the bar the pattern is learned over. */
const BEATS_PER_BAR = 4
/**
 * Positions in a bar the pattern is learned at: twelve a beat, so straight
 * sixteenths (every third) and triplets and swung eighths (every fourth) all
 * fall on a bin of their own.
 */
const PATTERN_BINS = BEATS_PER_BAR * 12
/** A pattern position counts as a place kicks land when it holds this share of the strongest. */
const SLOT_SHARE = 0.2
/** An onset at a slot is a kick when its strength is this share of the slot's remembered strength. */
const PRESENCE_SHARE = 0.35
/**
 * A hit within this many dB of its slot's remembered strength is reported AT
 * that strength, so identical kicks pulse identically despite the measurement
 * noise of a few dB; one further off (a ghost note, a breakdown's bass or
 * clap landing on a kick slot) is reported at the lesser of the two.
 */
const STEADY_DB = 2
/**
 * The share of the track's kick onset (its strongest remembered slot's) an
 * onset needs to count as a kick at all. Tighter than PRESENCE_SHARE: a
 * track's kick is one sample played again and again, so its onset shape
 * varies far less than its loudness, while a bass note's slow attack reaches
 * about a third of it once a breakdown has lowered the references.
 */
const SHAPE_SHARE = 0.5
/** How long the pattern remembers a position's strength, as a half-life. */
const PATTERN_MEMORY_SEC = 30
/**
 * How far either side an onset must be the largest to be a kick's peak, in
 * seconds: half a sixteenth at MAX_BPM. Wider, and two kicks a sixteenth
 * apart (a break's doubled kick) merge into one; narrower, and the click's
 * early maximum is a peak of its own ahead of the low bands'. Fixed in time
 * rather than read off the tempo, which can lock at half or double.
 */
const PEAK_SEC = 60 / MAX_BPM / 4 / 2
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
  /** This hop's rise in the band's energy, as closeHop last measured it. */
  get rise(): number {
    return this.lastRise
  }

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
  /** PEAK_SEC in hops. */
  private readonly peakHops: number
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
  /**
   * Per hop, the weighted ARITHMETIC mean of every band's normalised rise:
   * the broadband pulse the tempo is read from. Unlike the onset (a geometric
   * mean, which only a kick lifts in all three bands at once) a snare or hat
   * lifts it too, and those are what tell a break's meter from the
   * syncopation of its kicks alone.
   */
  private readonly pulse = new Float32Array(CAPACITY)
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
  /** The absolute hop the grid was last confidently estimated at. */
  private confidentAt = -Infinity
  /**
   * The learned bar, per PATTERN_BINS position: whether kicks land there
   * (`slotOnset` above 0), the onset a kick there typically shows, and the
   * strength it typically has. A slot's hits are reported at its TYPICAL
   * strength, so identical kicks pulse identically whatever the bass line
   * under one of them did to its measurement.
   */
  private readonly slotOnset = new Float32Array(PATTERN_BINS)
  private readonly slotStrength = new Float32Array(PATTERN_BINS)
  /**
   * The pattern's MEMORY: each position's strength, averaged over
   * PATTERN_MEMORY_SEC rather than over the window. A hit is reported at
   * this level, so the groove the track has established is what is
   * expected: through a breakdown the bass line landing on new positions
   * comes up only as slowly as it persists, and the kicks are at full
   * strength the moment they return.
   */
  private readonly slotMemory = new Float32Array(PATTERN_BINS)
  private readonly onsetMemorySum = new Float64Array(PATTERN_BINS)
  private readonly onsetMemory = new Float32Array(PATTERN_BINS)
  /** The onset of the bar's strongest remembered slot: what a kick looks like in this track. */
  private kickShape = 0
  private readonly slotMemorySum = new Float64Array(PATTERN_BINS)
  private memoryWeight = 0
  /** The grid hop the bar is folded from, kept on the same beat of the bar across updates (NaN: none yet). */
  private barPhase = NaN
  /** The last onset reported, in absolute hops, so a grid nudged between two calls cannot report it twice. */
  private lastPeak = NaN
  private strongHit = 0
  /** The media time `strongHit` was last raised at, for its decay. */
  private strongHitTime = 0
  /** The media time the last answer was given for, so each hit is reported once. */
  private lastAsked = NaN

  constructor(sampleRate: number) {
    this.hopSec = HOP / sampleRate
    this.peakHops = Math.max(2, Math.round(PEAK_SEC / this.hopSec))
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
    this.confidentAt = -Infinity
    this.strongHit = 0
    this.strongHitTime = 0
    this.lastAsked = NaN
    this.lastPeak = NaN
    this.slotOnset.fill(0)
    this.slotStrength.fill(0)
    this.slotMemory.fill(0)
    this.onsetMemorySum.fill(0)
    this.onsetMemory.fill(0)
    this.kickShape = 0
    this.slotMemorySum.fill(0)
    this.memoryWeight = 0
    this.barPhase = NaN
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
        let pulse = 0
        let low = 1
        let lowWeight = 0
        for (let b = 0; b < bands.length; b++) {
          const rise = bands[b].closeHop(this.hopIndex)
          product *= rise ** this.weights[b]
          pulse += rise * this.weights[b]
          if (b < LOW_BANDS) {
            // Strength is in the band's own energy, not normalised: it is
            // compared across the window and against a remembered level,
            // which a reference that moves with the music would make drift.
            low *= bands[b].rise ** this.weights[b]
            lowWeight += this.weights[b]
          }
        }
        this.hopIndex++
        this.pushOnset(product, pulse, low ** (1 / lowWeight))
      }
    }
  }

  private pushOnset(value: number, pulse: number, strength: number): void {
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY
      this.count--
      this.start++
    }
    this.onset[(this.head + this.count) % CAPACITY] = value
    this.pulse[(this.head + this.count) % CAPACITY] = pulse
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
    for (let k = 0; k < n; k++) mean += this.pulse[(this.head + k) % CAPACITY]
    mean /= n
    let zero = 0
    for (let k = 0; k < n; k++) {
      const d = this.pulse[(this.head + k) % CAPACITY] - mean
      zero += d * d
    }
    if (zero <= 0) {
      // Silence: nothing to estimate from, and the grid holds as for any unconfident window.
      this.confidence = 0
      return
    }
    const hopsPerMinute = 60 / this.hopSec
    const minLag = Math.floor(hopsPerMinute / MAX_BPM)
    const maxLag = Math.ceil(hopsPerMinute / MIN_BPM)
    // The autocorrelation out to COMB_BEATS periods of the slowest tempo.
    const lastLag = Math.min(n - 1, COMB_BEATS * maxLag + 1)
    const raw = new Float64Array(lastLag + 1)
    for (let lag = minLag - 1; lag <= lastLag; lag++) {
      let sum = 0
      for (let k = lag; k < n; k++) {
        sum += (this.pulse[(this.head + k) % CAPACITY] - mean) * (this.pulse[(this.head + k - lag) % CAPACITY] - mean)
      }
      // Normalised by the overlap, so a long lag is not penalised for having fewer terms.
      raw[lag] = sum / (n - lag)
    }
    const at = (lag: number): number => {
      const below = Math.floor(lag)
      if (below + 1 > lastLag) return 0
      return raw[below] + (raw[below + 1] - raw[below]) * (lag - below)
    }
    // A candidate period is scored by its COMB: the autocorrelation at one,
    // two, three and four periods. A true beat repeats at every multiple; a
    // period of a beat and a half (the syncopation of a break, or a dotted
    // pattern) repeats at two of them and not at one or three, which on the
    // autocorrelation alone it can win (a trace locked 84 BPM onto a 125 BPM
    // track exactly so).
    let best = -1
    let bestScore = -Infinity
    let bestComb = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let comb = 0
      for (let m = 1; m <= COMB_BEATS; m++) comb += at(m * lag)
      const octaves = Math.log2(hopsPerMinute / lag / PREFERRED_BPM) / PREFERENCE_OCTAVES
      const score = comb * Math.exp(-0.5 * octaves * octaves)
      if (score > bestScore) {
        bestScore = score
        best = lag
        bestComb = comb
      }
    }
    // Parabolic refinement: a period between two whole hops is the norm (128 BPM at 48kHz is 87.9 hops).
    const l = raw[best - 1]
    const c = raw[best]
    const r = raw[best + 1]
    const curvature = l - 2 * c + r
    const period = best + (curvature < 0 ? (0.5 * (l - r)) / curvature : 0)
    // Confidence in the quantity that chose the period: the comb's mean
    // against the signal's energy. The autocorrelation at one period alone
    // reads a break, whose kicks do not repeat every beat, as no beat at all.
    this.confidence = bestComb / COMB_BEATS / (zero / n)
    // An estimate the window is not confident of does not replace the grid:
    // the grid holds (period and phase both) for GRID_HOLD_SEC, so a
    // breakdown or a busy passage carries the established beat through
    // rather than dropping to unlocked and back on every update.
    if (this.confidence < MIN_CONFIDENCE) {
      if (!Number.isNaN(this.period)) {
        this.placeBar()
        this.learnPattern()
      }
      return
    }
    this.confidentAt = this.start + n
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
    this.placeBar()
    this.learnPattern()
    // The strong hits' level: the TOP_SHARE quantile of the strengths of the
    // onsets the pattern accepts.
    const strengths: number[] = []
    for (let k = this.start; k < this.start + n; k++) {
      const accepted = this.acceptedStrength(k)
      if (accepted > 0) strengths.push(accepted)
    }
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

  /**
   * Learns where in the bar kicks land and how strong each is. The onset
   * strength is folded onto one bar of the grid and averaged per position; a
   * position that is a local maximum holding SLOT_SHARE of the strongest is
   * a SLOT. Each onset peak in the window is then matched to the nearest slot
   * within SNAP_HOPS, and a slot learns the mean onset and strength of its
   * matches. A straight four-on-the-floor learns four slots, a break its
   * syncopated kicks, a swung groove the late eighth where it actually
   * falls, and a ghost kick a slot of small strength. The bar's first beat
   * is wherever the fold starts: the pattern is matched in the frame it was
   * learned in, so which beat is called the first does not matter.
   */
  private learnPattern(): void {
    const sums = new Float64Array(PATTERN_BINS)
    const counts = new Float64Array(PATTERN_BINS)
    for (let k = 0; k < this.count; k++) {
      const bin = this.binOf(this.start + k)
      sums[bin] += this.onset[(this.head + k) % CAPACITY]
      counts[bin]++
    }
    let strongest = 0
    const means = new Float64Array(PATTERN_BINS)
    for (let b = 0; b < PATTERN_BINS; b++) {
      means[b] = counts[b] > 0 ? sums[b] / counts[b] : 0
      strongest = Math.max(strongest, means[b])
    }
    const isSlot = new Uint8Array(PATTERN_BINS)
    for (let b = 0; b < PATTERN_BINS; b++) {
      const before = means[(b + PATTERN_BINS - 1) % PATTERN_BINS]
      const after = means[(b + 1) % PATTERN_BINS]
      isSlot[b] = strongest > 0 && means[b] >= before && means[b] > after && means[b] >= SLOT_SHARE * strongest ? 1 : 0
    }
    const onsetSum = new Float64Array(PATTERN_BINS)
    const strengthSum = new Float64Array(PATTERN_BINS)
    const matches = new Float64Array(PATTERN_BINS)
    for (let k = this.start; k < this.start + this.count; k++) {
      if (!this.isOnsetPeak(k)) continue
      const slot = this.nearestSlot(k, isSlot)
      if (slot < 0) continue
      onsetSum[slot] += this.at(k)
      strengthSum[slot] += this.strengthAt(k)
      matches[slot]++
    }
    // An exponential average with its start-up bias divided out (the weight
    // the average has accumulated so far), so the memory describes the
    // pattern from the first update rather than ramping up from nothing over
    // PATTERN_MEMORY_SEC, which made every onset at a slot pass as present.
    const keep = 0.5 ** ((GRID_EVERY_HOPS * this.hopSec) / PATTERN_MEMORY_SEC)
    this.memoryWeight = keep * this.memoryWeight + 1
    let kickShape = 0
    for (let b = 0; b < PATTERN_BINS; b++) {
      this.slotOnset[b] = matches[b] > 0 ? onsetSum[b] / matches[b] : 0
      this.slotStrength[b] = matches[b] > 0 ? strengthSum[b] / matches[b] : 0
      // Rises at once, falls over PATTERN_MEMORY_SEC: a slot hit at full
      // strength is unambiguous evidence (a drop lands at full strength on its
      // first kick), while a quiet one may only be a breakdown.
      this.slotMemorySum[b] = Math.max(keep * this.slotMemorySum[b] + this.slotStrength[b], this.slotStrength[b] * this.memoryWeight)
      this.slotMemory[b] = this.slotMemorySum[b] / this.memoryWeight
      this.onsetMemorySum[b] = Math.max(keep * this.onsetMemorySum[b] + this.slotOnset[b], this.slotOnset[b] * this.memoryWeight)
      this.onsetMemory[b] = this.onsetMemorySum[b] / this.memoryWeight
      kickShape = Math.max(kickShape, this.onsetMemory[b])
    }
    this.kickShape = kickShape
  }

  /**
   * Places the bar on the new grid: of the four beats the new phase could
   * call the first, the one nearest the bar's previous first beat, so the
   * pattern's memory keeps describing the same positions. A grid whose
   * period moved is still matched this way; the positions are shares of a
   * bar, so they scale with it.
   */
  private placeBar(): void {
    const bar = BEATS_PER_BAR * this.period
    if (Number.isNaN(this.barPhase)) {
      this.barPhase = this.phase
      return
    }
    let best = this.phase
    let bestDistance = Infinity
    for (let j = 0; j < BEATS_PER_BAR; j++) {
      const candidate = this.phase + j * this.period
      const offset = (((candidate - this.barPhase) % bar) + bar) % bar
      const distance = Math.min(offset, bar - offset)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
    this.barPhase = best
  }

  /** The pattern position of absolute hop `index`. */
  private binOf(index: number): number {
    const bar = BEATS_PER_BAR * this.period
    const position = (((index - this.barPhase) % bar) + bar) % bar
    return Math.floor((position / bar) * PATTERN_BINS) % PATTERN_BINS
  }

  /**
   * How many bins either side a hit may land from its slot: SNAP_HOPS of timing.
   */
  private slotReach(): number {
    return Math.ceil((SNAP_HOPS / (BEATS_PER_BAR * this.period)) * PATTERN_BINS)
  }

  /** The slot nearest hop `index` within SNAP_HOPS (`isSlot` marks them), or -1. */
  private nearestSlot(index: number, isSlot: ArrayLike<number>): number {
    const reach = this.slotReach()
    const centre = this.binOf(index)
    for (let d = 0; d <= reach; d++) {
      for (const b of d === 0 ? [centre] : [centre - d, centre + d]) {
        const bin = (b + PATTERN_BINS) % PATTERN_BINS
        if (isSlot[bin]) return bin
      }
    }
    return -1
  }

  /**
   * The strength the pattern grants an onset peak at hop `index`, or 0: the
   * peak must land on a slot, with the strength that slot usually carries
   * and the shape of the track's kick (header, stage 4). So a kick the track
   * leaves out gives nothing, a ghost kick its slot's faint level, and an
   * onset between the learned positions never fires.
   */
  private acceptedStrength(index: number): number {
    if (!this.isOnsetPeak(index)) return 0
    const slot = this.nearestSlot(index, this.slotOnset)
    if (slot < 0) return 0
    // Read over the same reach a hit is matched within, so the memory moves
    // with a slot that moves a bin between folds.
    const reach = this.slotReach()
    let remembered = 0
    let usualShape = 0
    for (let d = -reach; d <= reach; d++) {
      const b = (slot + d + PATTERN_BINS) % PATTERN_BINS
      remembered = Math.max(remembered, this.slotMemory[b])
      usualShape = Math.max(usualShape, this.onsetMemory[b])
    }
    // The hit must also BELONG to its slot: no sharper than twice what the
    // slot usually holds (SHAPE_SHARE inverted). The off-beat's bass and hats
    // make slots too, and a fill's toms (a falling pitch, kick-shaped)
    // landing on them pulsed just before the downbeat the fill leads into,
    // so that kick, still inside the pulse's fall, read as missed.
    if (this.at(index) * SHAPE_SHARE > usualShape) return 0
    // Present only with the low-band strength the slot usually carries AND an
    // onset shaped like the bar's kick (its strongest remembered slot, not
    // this one, which in a breakdown learns whatever lands on it): the
    // breakdown's bass rises in the kick's band about as hard as the kick,
    // but slowly and without the click, so its onset is a fraction of one.
    const measured = this.strengthAt(index)
    if (measured < PRESENCE_SHARE * remembered || this.at(index) < SHAPE_SHARE * this.kickShape) return 0
    // Never more than the slot usually carries, never more than was measured.
    return Math.abs(10 * Math.log10(measured / remembered)) <= STEADY_DB ? remembered : Math.min(measured, remembered)
  }

  /** True when the onset at `index` is the largest within a sixteenth's half either side (ties to the earlier). */
  private isOnsetPeak(index: number): boolean {
    const value = this.at(index)
    if (value <= 0) return false
    const reach = this.peakHops
    for (let j = index - reach; j <= index + reach; j++) {
      if (j !== index && (this.at(j) > value || (this.at(j) === value && j < index))) return false
    }
    return true
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
    return !Number.isNaN(this.period) && (this.start + this.count - this.confidentAt) * this.hopSec < GRID_HOLD_SEC
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
    // Until the beat is known there is nothing to tell a kick from the hats
    // and bass around it, so nothing is shown: every onset peak, each its own
    // reference, is the erratic flicker a beat display must never be.
    if (!this.isLocked()) return 0
    for (let k = Math.max(Math.floor(from) + 1, Number.isNaN(this.lastPeak) ? -Infinity : this.lastPeak + 1); k <= Math.floor(to); k++) {
      const value = this.acceptedStrength(k)
      if (value <= 0) continue
      this.lastPeak = k
      strength = Math.max(strength, value)
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

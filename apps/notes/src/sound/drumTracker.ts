/**
 * Finds the drums in a stream of samples: the KICK, the SNARE (claps and rim
 * shots with it) and the HAT (any short bright hit), for the visualizer's
 * drum sources (`musicBeat.ts`). Pure: it is fed samples and media times and
 * answered with media times, so it is tested on synthesized music
 * (`drumTracker.test.ts`) with no audio stack.
 *
 * ONE analysis serves every drum: the bands are filtered once, the tempo
 * grid is one, and each drum is a VOICE (`VOICES`) with its own onset, its
 * own learned bar and its own strong hits. Stages 1, 3 and 4 below are
 * described for the kick, which they were built for; each voice runs them
 * on its own bands, and `VOICES` says how the snare and the hat differ.
 * Several readers may follow one drum; each keeps its own place in the hits
 * (`DrumCursor`).
 *
 * Four stages, each answering a question the one before cannot:
 *
 * 1. ONSET STRENGTH, at a fixed rate (`HOP` samples, ~5ms), independent of
 *    the display's frame rate. A kick and a bass line share the sub band,
 *    so the sub band alone cannot tell them apart (a bass note starting
 *    from silence climbs as steeply as a kick). What a kick has and they do
 *    not is BREADTH: its attack is a pitch falling from a couple of hundred
 *    Hz into the sub, with the beater's click on top, so it climbs in three
 *    bands at once (`VOICES.kick`: sub, body, click) where a bass note climbs
 *    in the low ones and a hat or clap in the high one. Each band's energy is
 *    averaged over `ENVELOPE_HOPS` hops (about two cycles of the kick, so the
 *    reading does not ripple with the phase of one cycle in the window); its
 *    rise is how far that stands above its lowest over the last `riseHopsOf` of them,
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
 * 2. TEMPO AND PHASE, from the whole window (`musicBeat.ts` decodes the track
 *    seconds ahead, so the window reaches past the listener as well as
 *    behind). Read from the PULSE, the kick's bands' arithmetic mean, not
 *    the onset: a snare or hat lifts it too, and those are what tell a break's
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
 *    a kick slot does not pass. It reports the drum's full-hit strength
 *    (its strongest slot's) when within `STEADY_DB` of it, so identical
 *    kicks pulse identically wherever in the bar they land, and otherwise
 *    the lesser of the two.
 *
 * A hit's response is its strength in dB against the window's strong hits
 * (`TOP_SHARE` of them), over a floor `contrast` sets: contrast 0 shows
 * hits down to `CONTRAST_RANGE_DB` below the strong ones, contrast 1 only
 * the strong ones.
 */

import type { VisualizerDrum } from '@thockdown/look/visualizer'
import { StreamResampler } from './streamResampler'

/**
 * The rate every figure here was tuned and tested at, in samples per second:
 * a band's filters, the hop and every count of hops. Audio at another rate is
 * resampled to it on the way in (`StreamResampler`), because a hop of 256
 * samples is a different length of time at 44.1kHz and the tempo search, the
 * pattern's bins and the envelopes all shift with it (measured: at 44.1kHz the
 * grid flipped between a tempo and its octave and never settled).
 */
const ANALYSIS_RATE = 48000
const HOP = 256
const ENVELOPE_HOPS = 8
/** The hops a rise is measured over, for an envelope of `envelopeHops`: three quarters of it, six for the kick's eight. */
function riseHopsOf(envelopeHops: number): number {
  return Math.ceil((envelopeHops * 3) / 4)
}
/** A drum the tracker follows. */
export type Drum = VisualizerDrum

/** A band: centre in Hz, Q, weight, and how many band-passes in cascade (one when left out; `OnsetBand`). */
type BandSpec = readonly [number, number, number, number?]

/**
 * How one drum shows in the bands. Its ONSET is the weighted geometric mean
 * of the `onset` bands' rises (weights summing to 1), and nothing where an
 * `exclude` band (its third number a LIMIT, not a weight) climbs too, which
 * says the sound is something else (`DrumTracker.settle`). Its STRENGTH is
 * the geometric mean of the first `strengthBands` of `onset`, in raw energy.
 */
interface VoiceSpec {
  onset: readonly BandSpec[]
  /**
   * Whether the onset is read in the bands' raw energy rather than their
   * normalised rises. A drum that is the loudest thing in its bands (the
   * kick, the snare) is normalised, so how loud each band is in a given mix
   * does not matter; one that shares its bands with something louder (a hat
   * under a snare's noise) is not, because its rises would be measured
   * against the louder sound's and read as a few hundredths, scaled by
   * whatever that sound last did. The exclusion is always judged on the
   * normalised rises, where a snare reads as large in each band as the other.
   */
  raw: boolean
  /**
   * SHAPE_SHARE for this drum: the share of its strongest slot's onset a hit
   * needs, and the inverse of how much sharper than its own slot's it may be.
   * A kick or a snare is one sample played again and again, so its onset
   * varies little; a played hat varies with every stroke.
   */
  shapeShare: number
  /**
   * The hops its onset bands' envelopes span (header, stage 1): about two
   * cycles of a kick's sub, and far shorter for a hat, whose whole sound is
   * shorter than a kick's envelope and would be averaged into the tail of
   * whatever rang before it.
   */
  envelopeHops: number
  strengthBands: number
  exclude: readonly BandSpec[]
}

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
 * A hit within this many dB of the drum's full hit (its strongest remembered
 * slot) is reported AT that strength, so identical hits pulse identically
 * despite the measurement noise of a few dB, wherever in the bar they land;
 * one further off (a ghost note) is reported at the lesser of the two.
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
/**
 * How far on from an onset an exclude band's level is read, in hops (about
 * 50ms): past the envelope's span (ENVELOPE_HOPS) of a kick's beater click,
 * within a snare's noise.
 */
const EXCLUDE_AFTER_HOPS = 10
/** An excluded sound rings until its exclude band's level falls below this share of what it climbed to (-6dB). */
const RING_SHARE = 0.25
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

/**
 * - KICK: a pitch falling from a couple of hundred Hz into the sub with the
 *   beater's click on top, so it climbs in sub, body and click at once
 *   where a bass note climbs in the low ones and a hat or clap in the high
 *   one. The click weighs least: it says the attack is percussive, but how
 *   loud a click is varies most between kicks, and a clap or a hat landing
 *   on the kick would otherwise decide how strong that kick reads. Its
 *   strength is the sub and body alone.
 * - SNARE (and clap, rim shot): a body of a couple of hundred Hz under a
 *   burst of noise across the upper mids, so it climbs in the body and the
 *   noise together; a hat has no body and a kick barely reaches the noise.
 *   Its strength is the body and the lower noise band: the top is where the
 *   hats are, and they would decide its strength where they coincide.
 * - HAT (and shaker, ride, any short bright tick): energy above 6kHz and
 *   little below, so it climbs in the top two bands, and a climb in the
 *   snare's noise band says the sound is a snare instead. On a snare the
 *   snare wins, so a hat on the backbeat is not seen there.
 */
const VOICES: Record<Drum, VoiceSpec> = {
  kick: {
    onset: [[55, 0.9, 0.45], [140, 0.9, 0.35], [3500, 0.7, 0.2]],
    raw: false,
    shapeShare: SHAPE_SHARE,
    envelopeHops: ENVELOPE_HOPS,
    strengthBands: 2,
    exclude: [],
  },
  snare: {
    onset: [[210, 1.2, 0.3], [1800, 0.8, 0.4], [5000, 0.8, 0.3]],
    raw: false,
    shapeShare: SHAPE_SHARE,
    envelopeHops: ENVELOPE_HOPS,
    strengthBands: 2,
    exclude: [],
  },
  hat: {
    onset: [[8000, 0.9, 0.55, 2], [13000, 0.9, 0.45, 2]],
    raw: true,
    shapeShare: 0.25,
    envelopeHops: 2,
    strengthBands: 2,
    exclude: [[1800, 0.8, 0.25, 2]],
  },
}

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
  /** Per stage of the cascade: x1, x2, y1, y2. */
  private readonly state: Float64Array
  private hopEnergy = 0
  private readonly recentEnergy: Float64Array
  private readonly recentLevel: Float64Array
  /** The envelope's level at the last hop closed. */
  private lastLevel = 0
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

  /**
   * `stages` band-passes in cascade: one for a band read on its own, two
   * for one whose energy is compared with a band far above or below it,
   * since a single band-pass lets a strong kick through to the upper mids
   * at a level that rivals a hat's in its own band.
   */
  constructor(sampleRate: number, hz: number, q: number, private readonly memoryHops: number, stages = 1, private readonly envelopeHops = ENVELOPE_HOPS) {
    this.state = new Float64Array(4 * stages)
    this.recentEnergy = new Float64Array(envelopeHops)
    this.recentLevel = new Float64Array(riseHopsOf(envelopeHops))
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
    this.lastLevel = 0
    this.riseBefore = 0
    this.peakKeys = []
    this.hop = 0
  }

  /** Clears the filter's memory, after a gap whose samples were never seen. */
  settle(): void {
    this.state.fill(0)
  }

  add(x: number): void {
    const s = this.state
    let y = x
    for (let k = 0; k < s.length; k += 4) {
      const input = y
      y = this.b0 * input + this.b2 * s[k + 1] - this.a1 * s[k + 2] - this.a2 * s[k + 3]
      s[k + 1] = s[k]
      s[k] = input
      s[k + 3] = s[k + 2]
      s[k + 2] = y
    }
    this.hopEnergy += y * y
  }

  /** Closes hop number `index` (from 0 since the last reset): the band's rise, as a share of its strong rises. */
  /** This hop's rise in the band's energy, as closeHop last measured it. */
  get rise(): number {
    return this.lastRise
  }

  /** This hop's envelope level, as closeHop last measured it. */
  get level(): number {
    return this.lastLevel
  }

  closeHop(index: number): number {
    const envelopeHops = this.envelopeHops
    const riseHops = this.recentLevel.length
    this.recentEnergy[index % envelopeHops] = this.hopEnergy / HOP
    this.hopEnergy = 0
    let energy = 0
    const filled = Math.min(index + 1, envelopeHops)
    for (let k = 0; k < filled; k++) energy += this.recentEnergy[k]
    const level = energy / filled
    let trough = level
    const levels = Math.min(index, riseHops)
    for (let k = 0; k < levels; k++) trough = Math.min(trough, this.recentLevel[k])
    this.recentLevel[index % riseHops] = level
    // Until the envelope spans its full window the first hops would read as a climb from nothing.
    const rise = index >= envelopeHops ? level - trough : 0
    // The previous hop was a climb's peak when it stood above the hop before
    // it and at least as high as this one.
    if (this.lastRise > 0 && this.lastRise > this.riseBefore && this.lastRise >= rise) {
      this.remember(Math.log2(this.lastRise) + (this.hop - 1) / this.memoryHops)
    }
    this.riseBefore = this.lastRise
    this.lastRise = rise
    this.lastLevel = level
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
export type DrumRestart = 'gap' | 'drift'

/**
 * One reader's place in the hits: the last media time it asked about and the
 * last hit it was told of, so each hit is reported to it once whoever else
 * reads the same drum. `epoch` names the run of hops it was last used in;
 * a cursor meeting another run forgets both, since its hop index belongs to
 * the old one's numbering.
 */
/** The next run's `epoch`, shared by every tracker. */
let nextEpoch = 0

export class DrumCursor {
  lastAsked = NaN
  lastPeak = NaN
  epoch = -1
}

/** One drum's readings and learned bar (stages 1, 3 and 4 of the header). */
class Voice {
  /** Onset per hop, in the tracker's ring. */
  readonly onset = new Float32Array(CAPACITY)
  /**
   * The same hops' STRENGTH: the voice's strength bands alone. For the kick
   * the click decides WHERE the kicks are, not how strong one is, or a clap
   * landing on every other kick would make the pulse alternate.
   */
  readonly strength = new Float32Array(CAPACITY)
  /**
   * The learned bar, per PATTERN_BINS position: whether hits land there
   * (`slotOnset` above 0), the onset a hit there typically shows, and the
   * strength it typically has.
   */
  readonly slotOnset = new Float32Array(PATTERN_BINS)
  readonly slotStrength = new Float32Array(PATTERN_BINS)
  /**
   * The pattern's MEMORY: each position's strength, averaged over
   * PATTERN_MEMORY_SEC rather than over the window. A hit is reported at
   * this level, so the groove the track has established is what is
   * expected: through a breakdown what lands on new positions comes up only
   * as slowly as it persists, and the drum is at full strength the moment it
   * returns.
   */
  readonly slotMemory = new Float32Array(PATTERN_BINS)
  readonly slotMemorySum = new Float64Array(PATTERN_BINS)
  readonly onsetMemorySum = new Float64Array(PATTERN_BINS)
  readonly onsetMemory = new Float32Array(PATTERN_BINS)
  /** The onset of the bar's strongest remembered slot: what this drum looks like in this track. */
  shape = 0
  /** The strength of the bar's strongest remembered slot: how strong this drum's full hit is in this track. */
  level = 0
  strongHit = 0
  /** The media time `strongHit` was last raised at, for its decay. */
  strongHitTime = 0
  /**
   * Whether anybody reads this drum: only then is its bar learned (the
   * costly part, against which storing its onset per hop is nothing). The
   * kick's is always learned, since the bar's phase is read from it; another
   * voice starts learning at the first grid update after it is first asked
   * about, from the onsets the window already holds.
   */
  followed = false

  /** Per hop, the onset bands' climb as energy per Hz, which an exclude band's is compared with. */
  readonly density = new Float32Array(CAPACITY)
  /** Per hop, each exclude band's envelope level as energy per Hz. */
  readonly excludeLevel: Float32Array[]
  /** Per exclude band, the level an excluded sound climbed to while it still rings, 0 once it has died away (`DrumTracker.settle`). */
  readonly ringing: Float64Array

  constructor(readonly spec: VoiceSpec, readonly onsetBands: number[], readonly excludeBands: number[]) {
    this.excludeLevel = excludeBands.map(() => new Float32Array(CAPACITY))
    this.ringing = new Float64Array(excludeBands.length)
  }

  /** Hops after its own that a hop waits for before its onset is final: its exclusion looks that far on. */
  get settleHops(): number {
    return this.excludeBands.length > 0 ? EXCLUDE_AFTER_HOPS : 0
  }

  reset(): void {
    this.slotOnset.fill(0)
    this.slotStrength.fill(0)
    this.slotMemory.fill(0)
    this.slotMemorySum.fill(0)
    this.onsetMemorySum.fill(0)
    this.onsetMemory.fill(0)
    this.shape = 0
    this.level = 0
    this.strongHit = 0
    this.strongHitTime = 0
    this.ringing.fill(0)
  }
}

export class DrumTracker {
  /**
   * For diagnostics (`beatTrace.ts`): how far the last feed's stamp was from
   * where the sample count put it, in seconds (the jitter the alignment
   * averages away), and whether that feed restarted the tracker and why.
   */
  lastDriftSec = 0
  lastRestart: DrumRestart | null = null

  private readonly hopSec: number
  /** PEAK_SEC in hops. */
  private readonly peakHops: number
  /** Every distinct band the voices read, each filtered once. */
  private readonly bands: OnsetBand[]
  private readonly voices: Record<Drum, Voice>
  /** The bands' normalised rises and raw rises at the hop being closed. */
  private readonly rises: Float64Array
  private readonly rawRises: Float64Array
  private hopFill = 0
  /** Hops closed since the last reset or gap. */
  private hopIndex = 0
  /**
   * Per hop, the weighted ARITHMETIC mean of the kick's bands' normalised
   * rises: the broadband pulse the tempo is read from. Unlike the kick's
   * onset (a geometric mean, which only a kick lifts in all three bands at
   * once) a snare or hat lifts it too, and those are what tell a break's
   * meter from the syncopation of its kicks alone.
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
  /** The bar's memory weight: how much an exponential average over PATTERN_MEMORY_SEC has accumulated, shared by every voice. */
  private memoryWeight = 0
  /** The grid hop the bar is folded from, kept on the same beat of the bar across updates (NaN: none yet). */
  private barPhase = NaN
  /**
   * The absolute hop the bands started over at after samples were lost
   * (-Infinity: never). An exclusion judges a climb against the level before
   * it, which for the hops after a gap is the silence the gap was filled with.
   */
  private resumedAt = -Infinity
  /** The absolute hop the silence filling that gap began at. */
  private gapFrom = -Infinity
  /**
   * This run of hops, unique across EVERY tracker (`nextEpoch`), so a
   * reader's cursor knows its place belongs to another run. A count per
   * tracker repeated across trackers: a cursor carried from one tracker to
   * a fresh one (`musicBeat.ts` keeps its cursors across every restart of
   * the analysis) kept the old run's last hop index and skipped every hit
   * until the new run's hops counted past it, which was as long as the
   * music had played before the restart.
   */
  private epoch = nextEpoch++
  /** Brings the input to ANALYSIS_RATE; null when it is already there. */
  private readonly resampler: StreamResampler | null

  constructor(readonly sampleRate: number) {
    this.resampler = sampleRate === ANALYSIS_RATE ? null : new StreamResampler(sampleRate, ANALYSIS_RATE)
    this.hopSec = HOP / ANALYSIS_RATE
    this.peakHops = Math.max(2, Math.round(PEAK_SEC / this.hopSec))
    const memoryHops = Math.round(BAND_MEMORY_SEC / this.hopSec)
    const keys: string[] = []
    this.bands = []
    const bandOf = ([hz, q, , stages = 1]: BandSpec, envelopeHops = ENVELOPE_HOPS): number => {
      const key = `${hz}/${q}/${stages}/${envelopeHops}`
      let index = keys.indexOf(key)
      if (index < 0) {
        index = keys.length
        keys.push(key)
        this.bands.push(new OnsetBand(ANALYSIS_RATE, hz, q, memoryHops, stages, envelopeHops))
      }
      return index
    }
    const voiceOf = (spec: VoiceSpec) => new Voice(spec, spec.onset.map((band) => bandOf(band, spec.envelopeHops)), spec.exclude.map((band) => bandOf(band)))
    this.voices = { kick: voiceOf(VOICES.kick), snare: voiceOf(VOICES.snare), hat: voiceOf(VOICES.hat) }
    this.voices.kick.followed = true
    this.rises = new Float64Array(this.bands.length)
    this.rawRises = new Float64Array(this.bands.length)
  }

  reset(): void {
    this.resampler?.reset()
    this.resetAnalysis()
  }

  private resetAnalysis(): void {
    for (const band of this.bands) band.reset()
    for (const voice of Object.values(this.voices)) voice.reset()
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
    this.memoryWeight = 0
    this.barPhase = NaN
    this.resumedAt = -Infinity
    this.gapFrom = -Infinity
    this.epoch = nextEpoch++
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
    const resampler = this.resampler
    if (!resampler) {
      this.feedAnalysis(samples, from, endTime, lost)
      return
    }
    // Interpolation cannot span samples it never saw: after a gap it starts over.
    if (lost > 0) resampler.reset()
    const { samples: out, behind } = resampler.process(samples, from)
    this.feedAnalysis(out, 0, endTime - behind / this.sampleRate, Math.round((lost * ANALYSIS_RATE) / this.sampleRate))
  }

  /** `feed` at ANALYSIS_RATE. */
  private feedAnalysis(samples: Float32Array, from: number, endTime: number, lost: number): void {
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
        this.resetAnalysis()
      } else {
        this.sampleOriginTime += drift / ALIGN_FEEDS
        this.originTime = this.sampleOriginTime - (ENVELOPE_HOPS / 2 - 1) * this.hopSec
        if (lost > 0) {
          this.gapFrom = this.start + this.count
          this.take(new Float32Array(lost), 0)
          // The silence is the clock's, not the music's: the bands start
          // over from the next real sample rather than read it as a climb.
          for (const band of this.bands) band.settle()
          this.hopIndex = 0
          this.resumedAt = this.start + this.count
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
        for (let b = 0; b < bands.length; b++) {
          this.rises[b] = bands[b].closeHop(this.hopIndex)
          this.rawRises[b] = bands[b].rise
        }
        this.hopIndex++
        this.pushHop()
      }
    }
  }

  /** Stores the hop just closed: each voice's onset and strength, and the pulse. */
  private pushHop(): void {
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY
      this.count--
      this.start++
    }
    const at = (this.head + this.count) % CAPACITY
    for (const voice of Object.values(this.voices)) {
      const { spec, onsetBands, excludeBands } = voice
      let onset = 1
      let density = 1
      let low = 1
      let lowWeight = 0
      for (let k = 0; k < onsetBands.length; k++) {
        const weight = spec.onset[k][2]
        density *= (this.rawRises[onsetBands[k]] / spec.onset[k][0]) ** weight
        onset *= (spec.raw ? this.rawRises[onsetBands[k]] : this.rises[onsetBands[k]]) ** weight
        if (k < spec.strengthBands) {
          // Strength is in the band's own energy, not normalised: it is
          // compared across the window and against a remembered level,
          // which a reference that moves with the music would make drift.
          low *= this.rawRises[onsetBands[k]] ** weight
          lowWeight += weight
        }
      }
      voice.onset[at] = onset
      voice.strength[at] = low ** (1 / lowWeight)
      voice.density[at] = density
      for (let k = 0; k < excludeBands.length; k++) voice.excludeLevel[k][at] = this.bands[excludeBands[k]].level / spec.exclude[k][0]
    }
    this.count++
    for (const voice of Object.values(this.voices)) if (voice.settleHops > 0) this.settle(voice, this.start + this.count - 1 - voice.settleHops)
    const kick = this.voices.kick
    let pulse = 0
    for (let k = 0; k < kick.onsetBands.length; k++) pulse += this.rises[kick.onsetBands[k]] * kick.spec.onset[k][2]
    this.pulse[at] = pulse
    if (++this.hopsSinceGrid >= GRID_EVERY_HOPS) {
      this.hopsSinceGrid = 0
      this.updateGrid()
    }
  }

  /**
   * Applies a voice's exclusions to hop `index`, now that the hops after it
   * have arrived. An exclude band's climb is its level EXCLUDE_AFTER_HOPS on
   * against its level before the onset: a snare's noise is still there
   * that long after it struck, while a kick's beater click has gone, and a
   * voice or pad holding the band through the onset does not climb at all.
   * Both as energy per Hz (a band's level over its centre, which with a
   * constant Q is in proportion to its width), so noise with a flat
   * spectrum, a snare's, climbs as far in the excluded band as in the
   * voice's own, and a hat barely at all; a share of the voice's climb past
   * the exclude band's `limit` is not this drum.
   */
  private settle(voice: Voice, index: number): void {
    const k = index - this.start
    if (k < 0) return
    const slot = (this.head + k) % CAPACITY
    const density = voice.density[slot]
    // In a gap's silence, and within the reach a climb's start is looked for
    // after it, what the level climbed from is that silence: nothing there
    // can be told from what is excluded, so nothing there is accepted, and
    // whatever sounds there is taken to ring as an excluded sound would, so
    // its decay after the span is not read as this drum either.
    if (index >= this.gapFrom && index - this.resumedAt < 2 * ENVELOPE_HOPS) {
      if (index >= this.resumedAt) {
        for (let e = 0; e < voice.excludeBands.length; e++) voice.ringing[e] = Math.max(voice.ringing[e], voice.excludeLevel[e][slot])
      }
      voice.onset[slot] = 0
      voice.strength[slot] = 0
      return
    }
    let excluded = 1
    for (let e = 0; e < voice.excludeBands.length; e++) {
      const levels = voice.excludeLevel[e]
      // The level it climbed from: the least over twice the envelope's span
      // before this hop, so a hop late in a snare's climb (whose own onset is
      // still well above a hat's) reaches back past where the snare began.
      let before = Infinity
      for (let j = Math.max(0, k - 2 * ENVELOPE_HOPS); j <= k; j++) before = Math.min(before, levels[(this.head + j) % CAPACITY])
      const after = levels[(this.head + k + EXCLUDE_AFTER_HOPS) % CAPACITY]
      const share = density > 0 ? Math.max(0, after - before) / density : Infinity
      const limit = voice.spec.exclude[e][2]
      if (density > 0 && share >= limit) voice.ringing[e] = Math.max(voice.ringing[e], after)
      // While what was excluded still rings (its level falling from what it
      // climbed to, and not yet below RING_SHARE of it), nothing in it is
      // this drum either: in a snare's decaying noise, a short envelope's
      // fluctuations climb like a hat. A level above what it climbed to is a
      // new sound, judged on its own climb.
      const now = levels[slot]
      if (now < RING_SHARE * voice.ringing[e]) voice.ringing[e] = 0
      const rings = voice.ringing[e] > 0 && now <= voice.ringing[e]
      excluded *= rings ? 0 : Math.max(0, 1 - share / limit)
    }
    // A sound excluded is not this drum at all, so it has no strength as one either.
    voice.onset[slot] *= excluded
    voice.strength[slot] *= excluded
  }

  /** A voice's onset at absolute hop index `index`, 0 outside the window or before it has settled. */
  private at(voice: Voice, index: number): number {
    const k = index - this.start
    return k >= 0 && k < this.count - voice.settleHops ? voice.onset[(this.head + k) % CAPACITY] : 0
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
        this.learnPatterns()
      }
      return
    }
    this.confidentAt = this.start + n
    this.period = period
    // Phase: the offset whose comb of beats across the window collects the
    // most KICK onset. Which beat it picks only names the bar's first; every
    // voice's pattern is learned and matched in that one frame.
    const kick = this.voices.kick
    const steps = Math.ceil(period)
    let bestPhase = 0
    let bestSum = -Infinity
    for (let p = 0; p < steps; p++) {
      let sum = 0
      for (let beat = this.start + p; beat < this.start + n; beat += period) sum += this.at(kick, Math.round(beat))
      if (sum > bestSum) {
        bestSum = sum
        bestPhase = p
      }
    }
    this.phase = this.start + bestPhase
    this.placeBar()
    this.learnPatterns()
    const now = this.originTime + (this.start + n) * this.hopSec
    for (const voice of Object.values(this.voices)) {
      if (!voice.followed) continue
      // The strong hits' level: the TOP_SHARE quantile of the strengths of the
      // onsets the pattern accepts.
      const strengths: number[] = []
      for (let k = this.start; k < this.start + n; k++) {
        const accepted = this.acceptedStrength(voice, k)
        if (accepted > 0) strengths.push(accepted)
      }
      strengths.sort((a, b) => b - a)
      const current = strengths[Math.min(strengths.length - 1, Math.floor(strengths.length * TOP_SHARE))] ?? 0
      // Remembered with a slow decay, so through a breakdown the bass line is
      // still measured against the drum it stood beside rather than becoming the
      // strongest thing in a window the drum has left.
      const remembered = voice.strongHit * 0.5 ** ((now - voice.strongHitTime) / STRONG_HIT_HALF_LIFE_SEC)
      if (current >= remembered) {
        voice.strongHit = current
        voice.strongHitTime = now
      }
    }
  }

  /** Learns every voice's pattern, after one step of the shared memory weight. */
  private learnPatterns(): void {
    const keep = 0.5 ** ((GRID_EVERY_HOPS * this.hopSec) / PATTERN_MEMORY_SEC)
    this.memoryWeight = keep * this.memoryWeight + 1
    for (const voice of Object.values(this.voices)) if (voice.followed) this.learnPattern(voice, keep)
  }

  /**
   * Learns where in the bar a voice's hits land and how strong each is. The
   * onset is folded onto one bar of the grid and averaged per position; a
   * position that is a local maximum holding SLOT_SHARE of the strongest is
   * a SLOT. Each onset peak in the window is then matched to the nearest slot
   * within SNAP_HOPS, and a slot learns the mean onset and strength of its
   * matches. A straight four-on-the-floor learns four kick slots, a break its
   * syncopated kicks, a swung groove the late eighth where it actually
   * falls, and a ghost note a slot of small strength. The bar's first beat
   * is wherever the fold starts: the pattern is matched in the frame it was
   * learned in, so which beat is called the first does not matter.
   */
  private learnPattern(voice: Voice, keep: number): void {
    const sums = new Float64Array(PATTERN_BINS)
    const counts = new Float64Array(PATTERN_BINS)
    for (let k = 0; k < this.count - voice.settleHops; k++) {
      const bin = this.binOf(this.start + k)
      sums[bin] += voice.onset[(this.head + k) % CAPACITY]
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
      if (!this.isOnsetPeak(voice, k)) continue
      const slot = this.nearestSlot(k, isSlot)
      if (slot < 0) continue
      onsetSum[slot] += this.at(voice, k)
      strengthSum[slot] += this.strengthAt(voice, k)
      matches[slot]++
    }
    // An exponential average with its start-up bias divided out (the weight
    // the average has accumulated so far), so the memory describes the
    // pattern from the first update rather than ramping up from nothing over
    // PATTERN_MEMORY_SEC, which made every onset at a slot pass as present.
    let shape = 0
    let level = 0
    for (let b = 0; b < PATTERN_BINS; b++) {
      voice.slotOnset[b] = matches[b] > 0 ? onsetSum[b] / matches[b] : 0
      voice.slotStrength[b] = matches[b] > 0 ? strengthSum[b] / matches[b] : 0
      // Rises at once, falls over PATTERN_MEMORY_SEC: a slot hit at full
      // strength is unambiguous evidence (a drop lands at full strength on its
      // first kick), while a quiet one may only be a breakdown.
      voice.slotMemorySum[b] = Math.max(keep * voice.slotMemorySum[b] + voice.slotStrength[b], voice.slotStrength[b] * this.memoryWeight)
      voice.slotMemory[b] = voice.slotMemorySum[b] / this.memoryWeight
      voice.onsetMemorySum[b] = Math.max(keep * voice.onsetMemorySum[b] + voice.slotOnset[b], voice.slotOnset[b] * this.memoryWeight)
      voice.onsetMemory[b] = voice.onsetMemorySum[b] / this.memoryWeight
      shape = Math.max(shape, voice.onsetMemory[b])
      level = Math.max(level, voice.slotMemory[b])
    }
    voice.shape = shape
    voice.level = level
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
   * The strength the pattern grants a voice's onset peak at hop `index`, or
   * 0: the peak must land on a slot, with the strength that slot usually
   * carries and the shape of the track's hits of this drum (header, stage
   * 4). So a hit the track leaves out gives nothing, a ghost note its slot's
   * faint level, and an onset between the learned positions never fires.
   */
  private acceptedStrength(voice: Voice, index: number): number {
    if (!this.isOnsetPeak(voice, index)) return 0
    const slot = this.nearestSlot(index, voice.slotOnset)
    if (slot < 0) return 0
    // Read over the same reach a hit is matched within, so the memory moves
    // with a slot that moves a bin between folds.
    const reach = this.slotReach()
    let remembered = 0
    let usualShape = 0
    for (let d = -reach; d <= reach; d++) {
      const b = (slot + d + PATTERN_BINS) % PATTERN_BINS
      remembered = Math.max(remembered, voice.slotMemory[b])
      usualShape = Math.max(usualShape, voice.onsetMemory[b])
    }
    const onset = this.at(voice, index)
    // The hit must also BELONG to its slot: no sharper than twice what the
    // slot usually holds (SHAPE_SHARE inverted). The off-beat's bass and hats
    // make kick slots too, and a fill's toms (a falling pitch, kick-shaped)
    // landing on them pulsed just before the downbeat the fill leads into,
    // so that kick, still inside the pulse's fall, read as missed.
    if (onset * voice.spec.shapeShare > usualShape) return 0
    // Present only with the strength the slot usually carries AND an onset
    // shaped like the bar's strongest hit of this drum (its strongest
    // remembered slot, not this one, which in a breakdown learns whatever
    // lands on it): the breakdown's bass rises in the kick's band about as
    // hard as the kick, but slowly and without the click, so its onset is a
    // fraction of one.
    const measured = this.strengthAt(voice, index)
    if (measured < PRESENCE_SHARE * remembered || onset < voice.spec.shapeShare * voice.shape) return 0
    // Never more than the drum's full hit, never more than was measured.
    // Measured against the drum's FULL hit, never its slot's: a slot's
    // memory is smeared across neighbouring bins by a grid a fraction of a
    // hop off, so in a syncopated groove some slots remember far less than
    // the identical hits that land on them, and capping at the slot pulsed
    // the same hit weaker for where in the bar it fell.
    const level = voice.level
    return Math.abs(10 * Math.log10(measured / level)) <= STEADY_DB ? level : Math.min(measured, level)
  }

  /** True when a voice's onset at `index` is the largest within a sixteenth's half either side (ties to the earlier). */
  private isOnsetPeak(voice: Voice, index: number): boolean {
    const value = this.at(voice, index)
    if (value <= 0) return false
    const reach = this.peakHops
    for (let j = index - reach; j <= index + reach; j++) {
      if (j !== index && (this.at(voice, j) > value || (this.at(voice, j) === value && j < index))) return false
    }
    return true
  }

  private strengthAt(voice: Voice, index: number): number {
    const k = index - this.start
    return k >= 0 && k < this.count - voice.settleHops ? voice.strength[(this.head + k) % CAPACITY] : 0
  }

  /** The tempo while the grid is trusted, NaN otherwise; for tests and diagnostics. */
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
   * The response of a hit of `drum` heard between `cursor`'s last call and
   * media time `time` (0..1), or 0 when none was. `contrast` (0..1) is the
   * least share of that drum's strong hits' strength a hit must have to show.
   */
  hitBetween(drum: Drum, cursor: DrumCursor, time: number, contrast: number): number {
    if (cursor.epoch !== this.epoch) {
      cursor.epoch = this.epoch
      cursor.lastAsked = NaN
      cursor.lastPeak = NaN
    }
    const previous = cursor.lastAsked
    cursor.lastAsked = time
    if (Number.isNaN(previous) || time <= previous || time - previous > 0.25 || this.count === 0) return 0
    // Until the beat is known there is nothing to tell a drum from what
    // surrounds it, so nothing is shown: every onset peak, each its own
    // reference, is the erratic flicker a beat display must never be.
    if (!this.isLocked()) return 0
    const voice = this.voices[drum]
    voice.followed = true
    // A hop's time is the centre of the envelope it closes (`feed`), which
    // for a voice with a shorter envelope lies later in the hop.
    const shift = (ENVELOPE_HOPS - voice.spec.envelopeHops) / 2
    const from = (previous - this.originTime) / this.hopSec - shift
    const to = (time - this.originTime) / this.hopSec - shift
    let strength = 0
    for (let k = Math.max(Math.floor(from) + 1, Number.isNaN(cursor.lastPeak) ? -Infinity : cursor.lastPeak + 1); k <= Math.floor(to); k++) {
      const value = this.acceptedStrength(voice, k)
      if (value <= 0) continue
      cursor.lastPeak = k
      strength = Math.max(strength, value)
    }
    if (strength <= 0) return 0
    // In dB against the strong hits, so a hit that reads somewhat weaker
    // (interfering with the bass line's tail, say) still reads as one.
    const top = voice.strongHit > 0 ? voice.strongHit : strength
    const floorDb = -(1 - contrast) * CONTRAST_RANGE_DB
    const db = 10 * Math.log10(strength / top)
    return Math.max(0, Math.min(1, (db - floorDb) / -floorDb))
  }
}

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
 *    busy passage. The confidence is scale-free, so what a window may say is
 *    also bounded by its DRIVE, the kick's raw strength: a stretch without
 *    the drums the last grid was found in is silence to the estimate
 *    (`GRID_DRIVE_SHARE`), an estimate contradicting a held grid has to
 *    explain the window `CLEARLY_BETTER`, and one agreeing with it keeps its
 *    beat. Recomputed every `GRID_EVERY_HOPS`, not per frame.
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
 *
 * GROOVE (`hitBetween`'s `groove`, 0..1, per reader) is how steadily the
 * answer holds the learned bar against what is heard. It weighs the
 * evidence hit by hit and never touches the learning: every stage above
 * runs the same at every groove, so a new pattern is learned from the
 * window as fast at groove 1 as at 0. At 0 the answer is stage 4 exactly.
 * Above 0, each OCCURRENCE of a slot (its turn in one bar) is judged once:
 *
 * - EVIDENCE E: the strongest hit stage 4 accepts on that slot near it.
 * - CLIMBED: the drum's own bands rose there as a hit of it does
 *   (`climbAt`: the shape and strength tests of stage 4 without the slot's
 *   and without the exclusion), so a hat a strum masks still climbs, and
 *   wherever E > 0 this reads CLIMBED. Tri-state: a span outside the settled
 *   window (not decoded yet, or forgotten) is UNKNOWN, never "not playing".
 * - PROVEN: they climbed on that slot a half, one, one and a half or two
 *   bars before, so a grid that flips between a tempo and its double (79 and
 *   158 BPM) still proves a slot that repeats every bar of either. A slot the
 *   evidence accepted more than once in the window is never treated as a
 *   one-off either way.
 * - A DRUM SLOT is one on which the evidence accepts most of the onset
 *   peaks and a hit in most of the window's bars (`isDrumSlot`), not the
 *   bass's or a kick's body's; only those are played from the pattern
 *   alone, and only where the evidence accepted a hit on it within the last
 *   four bars (so music ahead of the drums does not start the pattern).
 * - A BREAK starts at a proven drum slot with no evidence where the bands
 *   climbed neither there nor on that slot a bar on (the window reaches
 *   seconds past the listener, so a masked hit is told from a stopped drum
 *   before anything is shown), and ends at the first FULL hit the evidence
 *   accepts. Through it, and for two bars after it while the pattern cannot
 *   be proven again, the answer is the evidence alone, as at groove 0.
 *
 * The strength shown, with X the slot's EXPECTED strength (the drum's full
 * hit, or a ghost slot's remembered strength; `expectedStrength`):
 *
 *   proven drum slot, playing   max(E, (1 - g) E + g X)  at E's peak, or when due
 *   proven, not a drum slot     E
 *   recurring but not proven    E
 *   a one-off                   E min(1, 2(1 - g))  in full to the middle, gone at the top
 *   onset off every slot        A min(1, 2g, 2(1 - g))
 *
 * So a hit the evidence shows on the pattern is never shown weaker at a
 * higher groove. Nothing fires twice: a slot due with no evidence is not
 * shown within an occurrence's reach of a hit already shown on it, and
 * evidence is not shown within that of a hit the pattern supplied
 * (`DrumCursor.answered`, `expected`), while two distinct accepted peaks
 * are each shown, as at groove 0.
 *
 * where A is an ACCENT: an onset peak on no slot, shaped like the drum's
 * full hit and within ACCENT_DB of it (`accentStrength`). Stage 4 never shows
 * one, the middle of the groove shows it in full, and its top holds the
 * pattern over it. A hit shown from the pattern alone is timed where the
 * slot's hits actually peak (`slotPosition`), so it lands where the evidence
 * would have; one the evidence shows stays where it peaked. And the response
 * is measured against the drum's full hit in the share the pattern is shown
 * (`hitBetween`), so at groove 1 every hit the pattern carries is a full one.
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
 * `exclude` band climbs too far against the TOP onset band, which says the
 * sound is something else (`DrumTracker.settle`; the exclude band's third
 * number is the limit used until the track's own is learned, not a weight).
 * Its STRENGTH is the geometric mean of the first `strengthBands` of `onset`,
 * in raw energy.
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
  /**
   * The drum whose own onset has to confirm an exclusion (`DrumTracker.settle`):
   * a sound coloured like what is excluded, but which that drum does not hear,
   * is this drum with something else landing on it (a hat on a guitar's
   * strum), not the excluded sound.
   */
  confirmedBy?: Drum
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
/**
 * How far (in octaves) an estimate's period may sit from the held grid's, or
 * from its double or half, and still be the SAME beat: the parabolic
 * refinement wanders by a few tenths of a BPM between updates, and a tempo
 * read an octave off is the clock's to fold (`beatClock.ts`), not a new beat.
 */
const AGREE_OCTAVES = 0.03
/**
 * The share of the last grid's DRIVE (the mean of the kick's strength over the
 * window it was found in, as it fades) the drums around a hop need for that
 * hop to count towards the tempo; a window with fewer than `MIN_GRID_HOPS`
 * such hops holds the grid as an unconfident one does, however periodic it is. The confidence cannot say
 * this: it is the comb against the pulse's own energy, and the pulse is made
 * of rises normalised to the band's fading peaks, so in a riser or a
 * breakdown, where the peaks have faded, a pad's ripple or a noise sweep is
 * as periodic as a kick and read 0.2 to 0.9 at a tempo the music does not
 * have (measured: 129 to 150 BPM on a 128 BPM track, the caret dragged a
 * quarter beat off in the run-up to every break). The drive is raw band
 * energy, which a fading reference cannot inflate.
 */
const GRID_DRIVE_SHARE = 0.25
/** The half-life of the drive remembered for the held grid, so a track whose drums get quieter can still move it. */
const GRID_DRIVE_HALF_LIFE_SEC = 10
/**
 * How much better a reading has to be than the held grid's, as a multiple,
 * to replace it: a tempo that is not the held one (or an octave of it) has to
 * score this much above the held tempo on the same window, and a phase off
 * the held beat has to collect this much more kick than the best phase near
 * it. A roll (kicks on every eighth or sixteenth before a drop) fits three
 * sixteenths as well as four and every subdivision as well as the beat, and
 * taking whichever won by a hair moved the grid to 171 BPM and by up to a
 * quarter beat. The beat of a piece does not move; a new piece's does, by
 * far more than this.
 */
const CLEARLY_BETTER = 1.5
/** How near the held grid's extrapolated beat a phase counts as the same beat, as a share of the period either way. */
const PHASE_HOLD_SHARE = 0.125
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
 * wherever in the bar they land; one further off (a ghost note) is reported
 * at the lesser of the two. A hit's strength is its CLIMB, which reads short
 * where something else in the band changes as it lands (a kick on the stop
 * of a bass note read about 2.5dB under an identical kick over silence),
 * so this is set wide: a beat the pattern has established showing at full
 * strength matters more than a ghost note a few dB down showing as one.
 */
const STEADY_DB = 6
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
/**
 * The colour histogram an exclusion's limit is learned from (`learnColour`):
 * log10 of the exclude band's climb against the top onset band's, over
 * LOWEST_COLOUR..HIGHEST_COLOUR in COLOUR_BINS. Below LOWEST_COLOUR (a
 * thirtieth) the excluded band hardly moved, and every such hit is one class.
 */
const LOWEST_COLOUR = -1.5
const HIGHEST_COLOUR = 3
const COLOUR_BINS = 45
/** Onset peaks below this share of the window's strong ones (its 90th percentile) say nothing about colour. */
const COLOUR_FLOOR = 0.1
/** The least colour peaks a window must hold before a limit is learned from it. */
const COLOUR_MIN_PEAKS = 16
/** A histogram peak this share of the highest counts as a class (`learnColour`). */
const COLOUR_MODE_SHARE = 0.15
/** Two classes closer than this, in decades of colour, are one class: no limit is learned. */
const COLOUR_MIN_SEPARATION = 0.4
/**
 * How far past the limit, in decades, a sound may be coloured and still be
 * this drum with something else landing on it (`settle`). A hat struck with a
 * strum measured up to 1.3 decades past the limit; a voice's syllable on its
 * own, 1.6 and more.
 */
const MIXTURE_DECADES = 1.4
/** The share of the confirming drum's usual onset (its `shape`) that says it struck, within CONFIRM_HOPS either side. */
const CONFIRM_SHARE = 0.3
const CONFIRM_HOPS = 3
/**
 * The share of the track's usual TILT (the top onset band's climb over the
 * lowest's) a mixed sound needs to be this drum: a sibilant or a pick's
 * noise is a hat's colour in the low band but falls off well below a hat's
 * top.
 */
const TILT_SHARE = 0.5
/** What `DrumTracker.climbAt` reads at a slot: the drum's bands climbed, they did not, or the window does not reach that far. */
const CLIMBED = 1
const FLAT = 0
const UNKNOWN = -1
/** The share of a slot's onset peaks, and of the window's bars, on which the evidence must accept a hit for the groove to play the slot (`isDrumSlot`). */
const DRUM_SLOT_ACCEPTANCE = 0.5
/** How far below the drum's full hit an ACCENT (an onset off every slot) may measure, in dB (`accentStrength`). */
const ACCENT_DB = 3
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
 * - HAT (and shaker, ride, any short bright tick): energy above 6kHz, so it
 *   climbs in the top two bands. What tells it from a snare is its COLOUR:
 *   how far the band below (5.5kHz) climbs against the top one. A hat's
 *   top is its loudest part and a snare's noise is flat or falls off, and
 *   where the line between them lies is learned from each track
 *   (`learnColour`), since a closed hat, an open hat, a ride and a shaker
 *   each sit somewhere else. A sound past the line counts as a snare only
 *   where the snare's own onset agrees, so a hat landing with a strum or a
 *   chord stays a hat. On a snare the snare wins, so a hat on the backbeat
 *   is not seen there.
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
    exclude: [[5500, 1, 0.25, 2]],
    confirmedBy: 'snare',
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
  /**
   * With groove above 0 (`DrumTracker.hitBetween`): per pattern position,
   * the hop of the last hit this reader was shown on it, from evidence or
   * from the pattern (`answered`), and of the last shown from the pattern
   * alone (`expected`). A slot due with no evidence is not shown within
   * `occurrenceSpan` of a hit already shown on it, and evidence is not
   * shown within that of a hit the pattern already supplied for it -- so
   * one occurrence never fires twice -- while two distinct onset peaks the
   * evidence accepts are each shown, as at groove 0. Two slots close
   * together each keep their own.
   */
  readonly answered = new Float64Array(PATTERN_BINS).fill(-Infinity)
  readonly expected = new Float64Array(PATTERN_BINS).fill(-Infinity)
  /**
   * With groove above 0: the drum has stopped (a break) -- an established
   * slot came round and nothing climbed in the drum's own bands there. The
   * pattern is not played into a break; it resumes at the next hit the
   * evidence accepts. Per reader, since each reader walks the hops in order.
   */
  resting = false
  /** With groove above 0: the hop of the occurrence that ended the last break (`resting`), -Infinity when none has. */
  resumedAt = -Infinity
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
  /**
   * Where in the bar each slot's hits actually peak, in fractional bins (the
   * mean of the window's matched onset peaks): what the groove times a hit
   * shown from the pattern alone by, so it lands where the evidence would
   * have, not at the start of a bin a twelfth of a beat wide.
   */
  readonly slotPosition = new Float32Array(PATTERN_BINS)
  /** The share of the window's onset peaks on each slot that the evidence accepts (`acceptedStrength`): whether the slot is this drum's (`DrumTracker.isDrumSlot`). */
  readonly slotAcceptance = new Float32Array(PATTERN_BINS)
  /** How many hits the evidence accepts on each slot in the window. */
  readonly slotAccepted = new Float64Array(PATTERN_BINS)
  /** How many hits the evidence accepts on each slot per bar of the window. */
  readonly slotAcceptedPerBar = new Float32Array(PATTERN_BINS)
  /** The strengths of the hits the evidence accepted in the window at the last `learnPattern`, the first `acceptedCount` of them. */
  readonly acceptedStrengths = new Float64Array(CAPACITY)
  acceptedCount = 0
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

  /** Per hop, the top onset band's climb as energy per Hz, which an exclude band's is compared with. */
  readonly density = new Float32Array(CAPACITY)
  /** Per hop, the lowest onset band's climb as energy per Hz, which the top band's is compared with for the TILT (`TILT_SHARE`). */
  readonly lowDensity = new Float32Array(CAPACITY)
  /** Per hop, the onset before any exclusion, and its colour (log10 of the first exclude band's climb against `density`), for `learnColour`. */
  readonly rawOnset = new Float32Array(CAPACITY)
  readonly colour = new Float32Array(CAPACITY)
  /** The colour (log10) past which a sound is excluded, as learned from the track; NaN until learned, when the spec's limit applies. */
  split = NaN
  /** The track's usual tilt of this drum's clean hits, NaN until learned. */
  usualTilt = NaN
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
    this.slotPosition.fill(0)
    this.slotAcceptance.fill(0)
    this.slotAcceptedPerBar.fill(0)
    this.slotAccepted.fill(0)
    this.acceptedCount = 0
    this.shape = 0
    this.level = 0
    this.strongHit = 0
    this.strongHitTime = 0
    this.ringing.fill(0)
    this.split = NaN
    this.usualTilt = NaN
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
  /** `updateGrid`'s scratch: the kick's strength summed up to each hop of the window, and the pulse weighed by the drive around it. */
  private readonly drives = new Float64Array(CAPACITY + 1)
  private readonly tempoPulse = new Float64Array(CAPACITY)
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
  /**
   * The DRIVE of the window the grid was last established or confirmed in
   * (the mean of the kick's strength, in raw band energy, which a fading
   * reference cannot inflate) and the absolute hop it was measured at.
   */
  private gridDrive = 0
  private gridDriveAt = -Infinity
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
    this.gridDrive = 0
    this.gridDriveAt = -Infinity
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
      let low = 1
      let lowWeight = 0
      for (let k = 0; k < onsetBands.length; k++) {
        const weight = spec.onset[k][2]
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
      // The exclusion compares against the TOP band alone: a strum or a
      // chord landing with a hat reaches the lower one, never the top.
      const top = onsetBands.length - 1
      voice.density[at] = this.rawRises[onsetBands[top]] / spec.onset[top][0]
      voice.lowDensity[at] = this.rawRises[onsetBands[0]] / spec.onset[0][0]
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
   * It is compared with the TOP onset band's climb, the largest over the
   * sound's climb so far (`eventMax`) so every hop of one sound is judged on
   * that sound's whole climb, not on how far up it has got; both as energy
   * per Hz (a band's level over its centre, which with a constant Q is in
   * proportion to its width), so noise with a flat spectrum, a snare's,
   * climbs as far in the excluded band as in the top one. The log10 of that
   * share is the sound's COLOUR, and a colour past the voice's limit (the
   * track's, `learnColour`, or the spec's until then) is not this drum --
   * unless it is the drum with something else landing on it: a colour no
   * further than MIXTURE_DECADES past the limit, which the `confirmedBy`
   * drum does not hear and whose top end is this drum's (`TILT_SHARE`).
   */
  private settle(voice: Voice, index: number): void {
    const k = index - this.start
    if (k < 0) return
    const slot = (this.head + k) % CAPACITY
    const density = this.eventMax(voice.density, k)
    voice.rawOnset[slot] = voice.onset[slot]
    voice.colour[slot] = NaN
    // In a gap's silence, and within the reach a climb's start is looked for
    // after it, what the level climbed from is that silence: nothing there
    // can be told from what is excluded, so nothing there is accepted, and
    // whatever sounds there is taken to ring as an excluded sound would, so
    // its decay after the span is not read as this drum either.
    if (index >= this.gapFrom && index - this.resumedAt < 2 * ENVELOPE_HOPS) {
      if (index >= this.resumedAt) {
        for (let e = 0; e < voice.excludeBands.length; e++) voice.ringing[e] = Math.max(voice.ringing[e], voice.excludeLevel[e][slot])
      }
      voice.rawOnset[slot] = 0
      voice.onset[slot] = 0
      voice.strength[slot] = 0
      return
    }
    let excluded = false
    for (let e = 0; e < voice.excludeBands.length; e++) {
      const levels = voice.excludeLevel[e]
      // The level it climbed from: the least over twice the envelope's span
      // before this hop, so a hop late in a snare's climb (whose own onset is
      // still well above a hat's) reaches back past where the snare began.
      let before = Infinity
      for (let j = Math.max(0, k - 2 * ENVELOPE_HOPS); j <= k; j++) before = Math.min(before, levels[(this.head + j) % CAPACITY])
      const after = levels[(this.head + k + EXCLUDE_AFTER_HOPS) % CAPACITY]
      const colour = density > 0 ? Math.log10(Math.max(0, after - before) / density) : Infinity
      if (e === 0) voice.colour[slot] = colour
      const limit = e === 0 && !Number.isNaN(voice.split) ? voice.split : Math.log10(voice.spec.exclude[e][2])
      const other = colour >= limit && !this.isMixture(voice, k, colour - limit)
      // Only a sound of this drum's strength rings over it afterwards: the
      // tail of a sound too faint to read as this drum cannot read as it either.
      if (other && voice.strength[slot] >= voice.level) voice.ringing[e] = Math.max(voice.ringing[e], after)
      // While what was excluded still rings (its level falling from what it
      // climbed to, and not yet below RING_SHARE of it), nothing in it is
      // this drum either: in a snare's decaying noise, a short envelope's
      // fluctuations climb like a hat. A level above what it climbed to is a
      // new sound, judged on its own climb.
      const now = levels[slot]
      if (now < RING_SHARE * voice.ringing[e]) voice.ringing[e] = 0
      const rings = voice.ringing[e] > 0 && now <= voice.ringing[e]
      excluded ||= rings || other
    }
    // A sound excluded is not this drum at all, so it has no strength as one either.
    if (excluded) {
      voice.onset[slot] = 0
      voice.strength[slot] = 0
    }
  }

  /**
   * Whether a sound at hop `k` (window-relative) coloured `past` decades
   * beyond the voice's limit is this drum with something else landing on
   * it, rather than what the limit excludes (`settle`).
   */
  private isMixture(voice: Voice, k: number, past: number): boolean {
    const by = voice.spec.confirmedBy
    if (by === undefined || past >= MIXTURE_DECADES) return false
    if (this.isHeardBy(this.voices[by], k)) return false
    return this.tiltAt(voice, k) >= TILT_SHARE * voice.usualTilt
  }

  /** Whether `confirming` hears a sound at hop `k` (window-relative): its onset within CONFIRM_HOPS reaches CONFIRM_SHARE of its usual hit. */
  private isHeardBy(confirming: Voice, k: number): boolean {
    for (let j = Math.max(0, k - CONFIRM_HOPS); j <= Math.min(this.count - 1, k + CONFIRM_HOPS); j++) {
      if (confirming.onset[(this.head + j) % CAPACITY] >= CONFIRM_SHARE * confirming.shape) return true
    }
    return false
  }

  /**
   * A sound's TILT at hop `k` (window-relative): its top onset band's climb
   * over its lowest's, per Hz, each the largest over the sound's climb
   * (`eventMax`) so the sound is judged whole. Infinite where the lowest band
   * did not climb at all.
   */
  private tiltAt(voice: Voice, k: number): number {
    const low = this.eventMax(voice.lowDensity, k)
    return low > 0 ? this.eventMax(voice.density, k) / low : Infinity
  }

  /**
   * The largest of `values` over the climb of the sound whose onset peaks at
   * hop `k` (window-relative): from a peak's reach before it to the hop after.
   * Never later, so a sound starting just after this one (a hat a sixteenth
   * after a strum) does not lend this one its climb.
   */
  private eventMax(values: Float32Array, k: number): number {
    let most = 0
    for (let j = Math.max(0, k - this.peakHops); j <= Math.min(this.count - 1, k + 1); j++) most = Math.max(most, values[(this.head + j) % CAPACITY])
    return most
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
    const hopsPerMinute = 60 / this.hopSec
    const minLag = Math.floor(hopsPerMinute / MAX_BPM)
    const maxLag = Math.ceil(hopsPerMinute / MIN_BPM)
    // The window's DRIVE, and the last grid's as it has faded (GRID_DRIVE_SHARE).
    const kick = this.voices.kick
    const end = this.start + n
    const drives = this.drives
    drives[0] = 0
    for (let k = 0; k < n; k++) drives[k + 1] = drives[k] + this.strengthAt(kick, this.start + k)
    const heldDrive = this.gridDrive * 0.5 ** (((end - this.gridDriveAt) * this.hopSec) / GRID_DRIVE_HALF_LIFE_SEC)
    // The pulse the tempo is read from, each hop weighed by the drive around
    // it (over the slowest beat) against that share of the last grid's: a
    // stretch of the window without drums is silence to the estimate rather
    // than a pulse as loud as a kick's (the rises are normalised to peaks
    // that fade), so a window reaching from a breakdown into the drop reads
    // the drop's tempo and not the breakdown pad's.
    const tempoPulse = this.tempoPulse
    const reach = Math.ceil(maxLag / 2)
    const floor = GRID_DRIVE_SHARE * heldDrive
    let drivenHops = 0
    for (let k = 0; k < n; k++) {
      const from = Math.max(0, k - reach)
      const to = Math.min(n, k + reach + 1)
      const local = (drives[to] - drives[from]) / (to - from)
      if (local >= floor) drivenHops++
      tempoPulse[k] = this.pulse[(this.head + k) % CAPACITY] * (floor > 0 ? Math.min(1, local / floor) : 1)
    }
    let mean = 0
    for (let k = 0; k < n; k++) mean += tempoPulse[k]
    mean /= n
    let zero = 0
    for (let k = 0; k < n; k++) {
      const d = tempoPulse[k] - mean
      zero += d * d
    }
    if (zero <= 0) {
      // Silence: nothing to estimate from, and the grid holds as for any unconfident window.
      this.confidence = 0
      return
    }
    // The autocorrelation out to COMB_BEATS periods of the slowest tempo.
    const lastLag = Math.min(n - 1, COMB_BEATS * maxLag + 1)
    const raw = new Float64Array(lastLag + 1)
    for (let lag = minLag - 1; lag <= lastLag; lag++) {
      let sum = 0
      for (let k = lag; k < n; k++) {
        sum += (tempoPulse[k] - mean) * (tempoPulse[k - lag] - mean)
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
    const combOf = (lag: number): number => {
      let comb = 0
      for (let m = 1; m <= COMB_BEATS; m++) comb += at(m * lag)
      return comb
    }
    const preference = (lag: number): number => {
      const octaves = Math.log2(hopsPerMinute / lag / PREFERRED_BPM) / PREFERENCE_OCTAVES
      return Math.exp(-0.5 * octaves * octaves)
    }
    let best = -1
    let bestScore = -Infinity
    let bestComb = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      const comb = combOf(lag)
      const score = comb * preference(lag)
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
    //
    // A window without the drums the last grid was found in (GRID_DRIVE_SHARE,
    // against that grid's drive as it fades) says nothing about the beat,
    // held or not: after a long breakdown has outlasted the hold, a pad's
    // ripple is still no beat to take. A HELD grid is a hypothesis the
    // window is weighed against: an estimate that agrees with it (the same
    // tempo or an octave of it) refines it; one that contradicts it replaces
    // it only when it explains the window CLEARLY_BETTER than the held tempo
    // does.
    const held = !Number.isNaN(this.period)
    const octaves = held ? Math.log2(period / this.period) : NaN
    const agrees = held && Math.abs(octaves - Math.round(octaves)) <= AGREE_OCTAVES && Math.abs(Math.round(octaves)) <= 1
    const silent = drivenHops < MIN_GRID_HOPS
    const explained = held && !agrees && bestScore <= CLEARLY_BETTER * combOf(this.period) * preference(this.period)
    if (this.confidence < MIN_CONFIDENCE || silent || explained) {
      // A quiet window that still reads the held tempo keeps the grid locked
      // without moving it: drums twenty dB down cannot be told from a pad by
      // their energy, but they do not contradict the beat, and dropping the
      // lock for the fifteen seconds the remembered drive takes to fade left
      // a quieter verse with no hits.
      if (silent && agrees && this.confidence >= MIN_CONFIDENCE) this.confidentAt = end
      if (!Number.isNaN(this.period)) {
        this.placeBar()
        this.learnPatterns()
      }
      return
    }
    this.confidentAt = end
    this.gridDrive = Math.max(drives[n] / n, heldDrive)
    this.gridDriveAt = end
    // Phase: the offset whose comb of beats across the window collects the
    // most KICK onset. Which beat it picks only names the bar's first; every
    // voice's pattern is learned and matched in that one frame. While the
    // estimate agrees with a held grid, the held grid's own beat (carried
    // forward to this window) is kept unless another offset clearly collects
    // more (CLEARLY_BETTER): the beat of a piece does not move, and an
    // offset winning by a hair on a roll is the subdivision, not the beat.
    const steps = Math.ceil(period)
    const heldOffset = agrees ? (((this.phase - this.start) % period) + period) % period : NaN
    let bestPhase = 0
    let bestSum = -Infinity
    let nearPhase = -1
    let nearSum = -Infinity
    for (let p = 0; p < steps; p++) {
      let sum = 0
      for (let beat = this.start + p; beat < end; beat += period) sum += this.at(kick, Math.round(beat))
      if (sum > bestSum) {
        bestSum = sum
        bestPhase = p
      }
      const away = Math.abs(p - heldOffset)
      if (Math.min(away, period - away) <= PHASE_HOLD_SHARE * period && sum > nearSum) {
        nearSum = sum
        nearPhase = p
      }
    }
    this.period = period
    this.phase = this.start + (nearPhase >= 0 && bestSum <= CLEARLY_BETTER * nearSum ? nearPhase : bestPhase)
    this.placeBar()
    this.learnPatterns()
    const now = this.originTime + (this.start + n) * this.hopSec
    for (const voice of Object.values(this.voices)) {
      if (!voice.followed) continue
      // The strong hits' level: the TOP_SHARE quantile of the strengths of the
      // onsets the pattern accepts (`learnPattern` collected them).
      const count = voice.acceptedCount
      const strengths = voice.acceptedStrengths.subarray(0, count).sort()
      const current = count > 0 ? strengths[count - 1 - Math.min(count - 1, Math.floor(count * TOP_SHARE))] : 0
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
    for (const voice of Object.values(this.voices)) if (voice.followed && voice.excludeBands.length > 0) this.learnColour(voice)
  }

  /**
   * Learns where a voice's exclusion lies in this track: the colour (log10
   * of the first exclude band's climb against the top onset band's, `settle`)
   * past which a sound is not this drum. A closed hat, an open hat, a ride
   * and a shaker each have their own, and a fixed line either cut a track's
   * open hats in half or let a bright snare through. The colours of the
   * window's onset peaks (before any exclusion) form a histogram; this drum
   * is the class with the LEAST climb below its top, so its mode is the
   * lowest well-populated peak, and the limit is the least-populated point
   * between it and the next peak above. With one class only, or two closer
   * than COLOUR_MIN_SEPARATION, nothing here tells them apart and the
   * spec's limit applies. The tilt of the clean hits below the limit
   * becomes the usual tilt a mixed sound is measured by (`isMixture`).
   */
  private learnColour(voice: Voice): void {
    const settled = this.count - voice.settleHops
    const raw = (k: number) => (k >= 0 && k < settled ? voice.rawOnset[(this.head + k) % CAPACITY] : 0)
    const peaks: number[] = []
    for (let k = 0; k < settled; k++) {
      const value = raw(k)
      if (value <= 0) continue
      let isPeak = true
      for (let j = k - this.peakHops; j <= k + this.peakHops && isPeak; j++) if (j !== k && (raw(j) > value || (raw(j) === value && j < k))) isPeak = false
      if (isPeak) peaks.push(k)
    }
    if (peaks.length < COLOUR_MIN_PEAKS) return
    const values = peaks.map(raw).sort((a, b) => a - b)
    const floor = COLOUR_FLOOR * values[Math.floor(0.9 * (values.length - 1))]
    const strong = peaks.filter((k) => raw(k) >= floor)
    const width = (HIGHEST_COLOUR - LOWEST_COLOUR) / COLOUR_BINS
    const counts = new Float64Array(COLOUR_BINS)
    let total = 0
    for (const k of strong) {
      const colour = voice.colour[(this.head + k) % CAPACITY]
      // No climb at all in the excluded band is unambiguously this drum and
      // says nothing about where the line lies; neither does no climb on top.
      if (!Number.isFinite(colour)) continue
      counts[Math.min(COLOUR_BINS - 1, Math.max(0, Math.floor((colour - LOWEST_COLOUR) / width)))]++
      total++
    }
    if (total >= COLOUR_MIN_PEAKS) voice.split = this.colourSplit(counts, width)
    // The line must fall below what the confirming drum hears: in a track
    // with no hats the lowest class is that drum itself (or a voice under
    // it), and a line above it would let every one of its hits through.
    const by = voice.spec.confirmedBy
    if (by !== undefined && !Number.isNaN(voice.split) && this.voices[by].shape > 0) {
      const heard = strong.filter((k) => this.isHeardBy(this.voices[by], k)).map((k) => voice.colour[(this.head + k) % CAPACITY]).filter(Number.isFinite).sort((a, b) => a - b)
      if (heard.length >= COLOUR_MIN_PEAKS / 2 && voice.split >= heard[heard.length >> 1]) voice.split = NaN
    }
    const limit = Number.isNaN(voice.split) ? Math.log10(voice.spec.exclude[0][2]) : voice.split
    const tilts = strong.filter((k) => voice.colour[(this.head + k) % CAPACITY] < limit).map((k) => this.tiltAt(voice, k)).filter(Number.isFinite)
    if (tilts.length >= COLOUR_MIN_PEAKS / 2) voice.usualTilt = tilts.sort((a, b) => a - b)[tilts.length >> 1]
  }

  /** The colour between the lowest class of a colour histogram and the next (`learnColour`), or NaN where there is no second class. */
  private colourSplit(counts: Float64Array, width: number): number {
    // Smoothed with a triangle five bins wide, so a class is a peak and not every ripple in one.
    const smooth = new Float64Array(COLOUR_BINS)
    for (let b = 0; b < COLOUR_BINS; b++) for (let d = -2; d <= 2; d++) smooth[b] += (counts[b + d] ?? 0) * (3 - Math.abs(d))
    const highest = Math.max(...smooth)
    const modes: number[] = []
    for (let b = 0; b < COLOUR_BINS && modes.length < 2; b++) {
      if (smooth[b] >= COLOUR_MODE_SHARE * highest && (b === 0 || smooth[b] > smooth[b - 1]) && (b === COLOUR_BINS - 1 || smooth[b] >= smooth[b + 1])) modes.push(b)
    }
    if (modes.length < 2 || (modes[1] - modes[0]) * width < COLOUR_MIN_SEPARATION) return NaN
    // The middle of the least-populated stretch between the two.
    let first = modes[0] + 1
    let last = first
    for (let b = first; b < modes[1]; b++) {
      if (smooth[b] < smooth[first]) first = last = b
      else if (smooth[b] === smooth[first] && last === b - 1) last = b
    }
    return LOWEST_COLOUR + ((first + last) / 2 + 0.5) * width
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
    const offsetSum = new Float64Array(PATTERN_BINS)
    const strengthSum = new Float64Array(PATTERN_BINS)
    const matches = new Float64Array(PATTERN_BINS)
    for (let k = this.start; k < this.start + this.count; k++) {
      if (!this.isOnsetPeak(voice, k)) continue
      const slot = this.nearestSlot(k, isSlot)
      if (slot < 0) continue
      onsetSum[slot] += this.at(voice, k)
      offsetSum[slot] += ((((this.positionOf(k) - slot) % PATTERN_BINS) + 1.5 * PATTERN_BINS) % PATTERN_BINS) - PATTERN_BINS / 2
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
      voice.slotPosition[b] = matches[b] > 0 ? (b + offsetSum[b] / matches[b] + PATTERN_BINS) % PATTERN_BINS : b + 0.5
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
    // What the evidence accepts in the window, now that the bar it is judged
    // by is learned: how often per slot (`isDrumSlot`), and each hit's
    // strength, for the strong hits' level (`updateGrid`).
    const accepted = voice.slotAccepted
    accepted.fill(0)
    voice.acceptedCount = 0
    for (let k = this.start; k < this.start + this.count; k++) {
      const strength = this.acceptedStrength(voice, k)
      if (strength <= 0) continue
      accepted[this.acceptedSlotOf(voice, k)]++
      voice.acceptedStrengths[voice.acceptedCount++] = strength
    }
    const bars = this.count / (BEATS_PER_BAR * this.period)
    for (let b = 0; b < PATTERN_BINS; b++) {
      voice.slotAcceptance[b] = matches[b] > 0 ? accepted[b] / matches[b] : 0
      voice.slotAcceptedPerBar[b] = accepted[b] / bars
    }
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
    return Math.floor(this.positionOf(index)) % PATTERN_BINS
  }

  /** Where in the bar absolute hop `index` falls, in fractional bins (0..PATTERN_BINS). */
  private positionOf(index: number): number {
    const bar = BEATS_PER_BAR * this.period
    const position = (((index - this.barPhase) % bar) + bar) % bar
    return (position / bar) * PATTERN_BINS
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

  /** The slot `acceptedStrength` judges a peak at `index` against (whether or not it accepts it), or -1. */
  private acceptedSlotOf(voice: Voice, index: number): number {
    return this.nearestSlot(index, voice.slotOnset)
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

  /**
   * The grid's beat period in seconds while it is trusted, NaN otherwise
   * (the visualizer caret's clock, `beatClock.ts`). Two numbers rather than
   * an object, as it is read every frame.
   */
  get gridPeriodSec(): number {
    return this.isLocked() ? this.period * this.hopSec : NaN
  }

  /** The media time of one of the grid's beats while it is trusted, NaN otherwise. */
  get gridBeatTime(): number {
    return this.isLocked() ? this.originTime + this.phase * this.hopSec : NaN
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
   * `groove` (0..1) is how steadily the answer holds the learned pattern
   * against what is heard (header, GROOVE): 0 is the evidence alone, the
   * pattern only its filter. Each reader asks at its own groove.
   */
  hitBetween(drum: Drum, cursor: DrumCursor, time: number, contrast: number, groove = 0): number {
    if (cursor.epoch !== this.epoch) {
      cursor.epoch = this.epoch
      cursor.lastAsked = NaN
      cursor.lastPeak = NaN
      cursor.answered.fill(-Infinity)
      cursor.expected.fill(-Infinity)
      cursor.resting = false
      cursor.resumedAt = -Infinity
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
    // A drum whose exclusion another confirms needs that one's shape learned.
    if (voice.spec.confirmedBy !== undefined) this.voices[voice.spec.confirmedBy].followed = true
    // A hop's time is the centre of the envelope it closes (`feed`), which
    // for a voice with a shorter envelope lies later in the hop.
    const shift = (ENVELOPE_HOPS - voice.spec.envelopeHops) / 2
    const from = (previous - this.originTime) / this.hopSec - shift
    const to = (time - this.originTime) / this.hopSec - shift
    const g = Math.max(0, Math.min(1, groove))
    let strength = 0
    for (let k = Math.max(Math.floor(from) + 1, Number.isNaN(cursor.lastPeak) ? -Infinity : cursor.lastPeak + 1); k <= Math.floor(to); k++) {
      const value = g > 0 ? this.grooveStrength(voice, cursor, k, g) : this.acceptedStrength(voice, k)
      if (value <= 0) continue
      cursor.lastPeak = k
      strength = Math.max(strength, value)
    }
    if (strength <= 0) return 0
    // In dB against the strong hits, so a hit that reads somewhat weaker
    // (interfering with the bass line's tail, say) still reads as one.
    const strong = voice.strongHit > 0 ? voice.strongHit : strength
    // The pattern's full hit is the drum's level NOW, and the strong hits'
    // remembered level can stand above it for a while after the drum played
    // louder (it fades over STRONG_HIT_HALF_LIFE_SEC). The groove measures
    // against the pattern's full hit in the share it shows the pattern, so
    // at its top a hit the pattern carries shows in full.
    const top = g > 0 && voice.level > 0 ? (1 - g) * strong + g * Math.min(strong, voice.level) : strong
    const floorDb = -(1 - contrast) * CONTRAST_RANGE_DB
    const db = 10 * Math.log10(strength / top)
    return Math.max(0, Math.min(1, (db - floorDb) / -floorDb))
  }

  /**
   * The strength shown at hop `index` at groove `g` (above 0; header,
   * GROOVE), or 0. A slot's OCCURRENCE (one bar's turn of it) is answered
   * once: where the evidence's hit for it peaks when there is one, so the
   * groove never moves a heard hit, and otherwise when the slot is DUE (its
   * learned position, `slotPosition`). Once per occurrence, by construction
   * (`DrumCursor.answered`, `wasAnswered`), whichever of the two comes first.
   * An onset peak off every slot is answered as an ACCENT.
   */
  private grooveStrength(voice: Voice, cursor: DrumCursor, index: number, g: number): number {
    const evidence = this.acceptedStrength(voice, index)
    if (evidence > 0) {
      const slot = this.acceptedSlotOf(voice, index)
      const due = this.occurrenceNear(voice, slot, index)
      const occurrence = Number.isNaN(due) ? index : due
      if (Math.abs(index - cursor.expected[slot]) < this.occurrenceSpan()) return 0
      return this.answerOccurrence(voice, cursor, occurrence, slot, g, index, false)
    }
    const due = this.slotDueAt(voice, index)
    if (due >= 0) {
      if (this.wasAnswered(cursor, due, index)) return 0
      // A hit the evidence accepts still to come is answered where it peaks.
      if (this.evidenceFor(voice, due, index + 1, index + this.occurrenceSpan()) > 0) return 0
      return this.answerOccurrence(voice, cursor, index, due, g, index, true)
    }
    if (cursor.resting) return 0
    return this.accentStrength(voice, index) * Math.min(1, 2 * g, 2 * (1 - g))
  }

  /**
   * Whether `cursor` was shown a hit on slot `slot` within `occurrenceSpan`
   * of hop `occurrence`: the reach of one occurrence's evidence either side
   * of its due hop.
   */
  private wasAnswered(cursor: DrumCursor, slot: number, occurrence: number): boolean {
    return Math.abs(occurrence - cursor.answered[slot]) < this.occurrenceSpan()
  }

  /** How far either side of a slot's due hop its occurrence's hit is looked for, in hops: a snap and a bin. */
  private occurrenceSpan(): number {
    return SNAP_HOPS + Math.ceil((BEATS_PER_BAR * this.period) / PATTERN_BINS)
  }

  /**
   * The drum slot due at hop `index` -- its learned position (`slotPosition`)
   * falls after hop `index - 1` and no later than `index` -- or -1.
   */
  private slotDueAt(voice: Voice, index: number): number {
    const before = this.positionOf(index - 1)
    const step = (this.positionOf(index) - before + PATTERN_BINS) % PATTERN_BINS
    const bin = Math.floor(this.positionOf(index))
    for (let d = -1; d <= 1; d++) {
      const b = (bin + d + PATTERN_BINS) % PATTERN_BINS
      if (voice.slotOnset[b] <= 0) continue
      const ahead = (voice.slotPosition[b] - before + PATTERN_BINS) % PATTERN_BINS
      if (ahead > 0 && ahead <= step && this.isDrumSlot(voice, b)) return b
    }
    return -1
  }

  /** The hop slot `slot` is due at nearest hop `index` (within `occurrenceSpan`), or NaN where it is not due there. */
  private occurrenceNear(voice: Voice, slot: number, index: number): number {
    const span = this.occurrenceSpan()
    let best = NaN
    for (let j = index - span; j <= index + span; j++) {
      if (this.slotDueAt(voice, j) === slot && (Number.isNaN(best) || Math.abs(j - index) < Math.abs(best - index))) best = j
    }
    return best
  }

  /** The strongest hit the evidence accepts on slot `slot` between hops `from` and `to`, inclusive. */
  private evidenceFor(voice: Voice, slot: number, from: number, to: number): number {
    let evidence = 0
    for (let j = from; j <= to; j++) {
      const value = this.acceptedStrength(voice, j)
      if (value > evidence && this.acceptedSlotOf(voice, j) === slot) evidence = value
    }
    return evidence
  }

  /**
   * Whether a slot is THIS drum's: the evidence accepts at least
   * DRUM_SLOT_ACCEPTANCE of the onset peaks landing on it, and a hit on it
   * in at least that share of the window's bars. The off-beat's bass makes
   * kick slots too, and a kick's body snare slots, which the evidence turns
   * away hit by hit; and before a drum comes in, a slot a strum made can
   * hold one accepted peak of the few it matched. The pattern plays neither.
   */
  private isDrumSlot(voice: Voice, slot: number): boolean {
    return voice.slotAcceptance[slot] >= DRUM_SLOT_ACCEPTANCE && voice.slotAcceptedPerBar[slot] >= DRUM_SLOT_ACCEPTANCE
  }

  /**
   * One occurrence of a slot, due at hop `occurrence`, answered now (header,
   * GROOVE). It reads the strongest accepted hit belonging to it (the
   * EVIDENCE); whether the drum's own bands climbed there as a hit of it
   * does (`climbAt`; an accepted hit is such a climb by definition); whether
   * they climbed on the slot in the bars before (PROVEN: the slot is in the
   * pattern being played now, not a one-off); and whether the slot is the
   * drum's at all (`isDrumSlot`), since only those are played from the
   * pattern alone.
   */
  private answerOccurrence(voice: Voice, cursor: DrumCursor, occurrence: number, slot: number, g: number, shownAt: number, fromPattern: boolean): number {
    const strength = this.judgeOccurrence(voice, cursor, occurrence, slot, g)
    // Only a hit SHOWN answers the occurrence: one judged empty at its due
    // hop may still be answered by its evidence a few hops on, once the bar
    // it is judged by has been learned again (every GRID_EVERY_HOPS).
    if (strength > 0) {
      cursor.answered[slot] = shownAt
      if (fromPattern) cursor.expected[slot] = shownAt
    }
    return strength
  }

  /** `answerOccurrence`'s judgement, without recording it. */
  private judgeOccurrence(voice: Voice, cursor: DrumCursor, occurrence: number, slot: number, g: number): number {
    const span = this.occurrenceSpan()
    const evidence = this.evidenceFor(voice, slot, occurrence - span, occurrence + span)
    const bar = BEATS_PER_BAR * this.period
    // Looked for half a bar, a bar, a bar and a half and two bars back: the
    // grid's period can flip to half or double the beat between updates
    // (a 79 BPM groove read at 158 and back), which halves or doubles the
    // bar, and a pattern that repeats every bar of one octave repeats every
    // half or every second bar of the other.
    let proven = false
    for (let m = 1; m <= 4 && !proven; m++) proven = this.climbAt(voice, Math.round(occurrence - (m * bar) / 2), slot) === CLIMBED
    const drumSlot = this.isDrumSlot(voice, slot)
    // Where the drum's bands did not climb, the window ahead (which reaches
    // seconds past the listener) says why: if they climb on this slot a bar
    // on, this one was masked or played too softly to read and the pattern
    // carries it; if not, the drum has stopped or left this slot, and a
    // BREAK starts here, before anything is shown for it. A bar on that is
    // not decoded yet (just after a seek) is unknown, never "stopped".
    const playing = evidence > 0 || this.climbAt(voice, occurrence, slot) === CLIMBED || this.climbAt(voice, Math.round(occurrence + bar), slot) !== FLAT
    // A FULL hit the evidence accepts ends a break (`acceptedStrength`
    // reports one at the drum's level): a faint one is as likely the bass
    // line going on through it.
    if (cursor.resting && evidence >= voice.level) {
      cursor.resting = false
      cursor.resumedAt = occurrence
    } else if (evidence <= 0 && drumSlot && proven && !playing) cursor.resting = true
    // A break overrides the groove completely: the evidence alone.
    if (cursor.resting) return evidence
    if (!proven) {
      // Until two bars have passed since a break there is nothing to prove
      // the pattern by, and the break's override goes on.
      if (occurrence - cursor.resumedAt < 2 * bar) return evidence
      // A slot the evidence accepted a hit on more than once in the window
      // recurs, whatever its climbs read (a grid that flipped octave between
      // updates can put the bars before it anywhere): never taken away.
      if (voice.slotAccepted[slot] >= 2) return evidence
      // A one-off: shown in full up to the middle of the groove, then less
      // and less, and not at all at its top.
      return evidence * Math.min(1, 2 * (1 - g))
    }
    if (!(drumSlot && playing)) return evidence
    // Played from the pattern alone only where the evidence accepted a hit
    // on this slot within the last four bars: a slot the window learned from
    // music ahead of the drums (a strum in the hat's band) is not the drum
    // playing yet.
    if (evidence <= 0 && this.evidenceFor(voice, slot, Math.round(occurrence - 4 * bar), occurrence - span - 1) <= 0) return 0
    // Never below the evidence: holding the pattern adds, it does not take a played hit away.
    return Math.max(evidence, (1 - g) * evidence + g * this.expectedStrength(voice, slot))
  }

  /**
   * What a slot's hit is shown at from the pattern alone: the drum's full
   * hit for a slot remembered within STEADY_DB of it (as `acceptedStrength`
   * reports a measured one), the slot's remembered strength for a fainter
   * (ghost) one.
   */
  private expectedStrength(voice: Voice, slot: number): number {
    const remembered = this.rememberedAt(voice, slot)
    const level = voice.level
    if (remembered <= 0 || level <= 0) return 0
    return Math.abs(10 * Math.log10(remembered / level)) <= STEADY_DB ? level : Math.min(remembered, level)
  }

  /** A slot's remembered strength, read over the reach a hit is matched within (as `acceptedStrength` reads it). */
  private rememberedAt(voice: Voice, slot: number): number {
    const reach = this.slotReach()
    let remembered = 0
    for (let d = -reach; d <= reach; d++) remembered = Math.max(remembered, voice.slotMemory[(slot + d + PATTERN_BINS) % PATTERN_BINS])
    return remembered
  }

  /**
   * Whether the drum's own bands CLIMBED on slot `slot` as a hit of it does,
   * within `occurrenceSpan` of hop `index` (the span an occurrence's
   * evidence is looked for in): CLIMBED, FLAT, or UNKNOWN where part of that
   * span lies outside the settled window (not decoded yet, or forgotten).
   * The tests are `acceptedStrength`'s, less the ones about the peak and the
   * slot's sharpness: an onset BEFORE any exclusion (a hat under a strum is
   * excluded by its colour, yet its bands climbed) of at least `shapeShare`
   * of the drum's shape, and for a drum whose onset is normalised
   * (`VoiceSpec.raw` false) a strength of at least PRESENCE_SHARE of what
   * the slot remembers. So wherever the evidence accepts a hit on the slot,
   * this reads CLIMBED. The strength test matters through a break: a
   * normalised onset's band references fade, and a bass line going on under
   * the kick's slots climbs ever nearer a kick's onset while its strength
   * stays a bass note's.
   */
  private climbAt(voice: Voice, index: number, slot: number): number {
    const span = this.occurrenceSpan()
    const needed = voice.spec.shapeShare * voice.shape
    const strong = voice.spec.raw ? 0 : PRESENCE_SHARE * this.rememberedAt(voice, slot)
    const onsets = voice.excludeBands.length > 0 ? voice.rawOnset : voice.onset
    const settled = this.count - voice.settleHops
    let unknown = false
    for (let j = index - span; j <= index + span; j++) {
      const k = j - this.start
      if (k < 0 || k >= settled) {
        unknown = true
        continue
      }
      const at = (this.head + k) % CAPACITY
      if (onsets[at] >= needed && voice.strength[at] >= strong) return CLIMBED
    }
    return unknown ? UNKNOWN : FLAT
  }

  /**
   * An ACCENT at hop `index`: an onset peak on no slot, given the drum's
   * full hit, or 0. Nothing in the pattern vouches for it, so it needs more
   * than a hit on a slot does: an onset shaped like the drum's FULL hit
   * (SHAPE_SHARE of its shape either way, whatever the voice's own looser
   * share) and a strength within ACCENT_DB of it. A voice's syllable in the
   * hat's band measured a third of the hat's shape and 5dB down; a played
   * accent, its whole shape within half a dB.
   */
  private accentStrength(voice: Voice, index: number): number {
    if (!this.isOnsetPeak(voice, index) || this.nearestSlot(index, voice.slotOnset) >= 0) return 0
    const onset = this.at(voice, index)
    if (onset < SHAPE_SHARE * voice.shape || onset * SHAPE_SHARE > voice.shape) return 0
    const measured = this.strengthAt(voice, index)
    const level = voice.level
    if (level <= 0 || measured <= 0 || Math.abs(10 * Math.log10(measured / level)) > ACCENT_DB) return 0
    return level
  }
}

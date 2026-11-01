/**
 * The visualizer's SHEET MUSIC: an inventory of the recurring single-shot
 * sounds in the music ahead of the listener, which every element that reacts
 * to a hit reads instead of the live audio. Pure: fed samples and media
 * times, asked with media times, so it is tested on synthesized music
 * (`signalMap.test.ts`).
 *
 * The map is UNIVERSAL: it holds absolute measurements and nothing a reader
 * decides. Any scaling, threshold or lift relative to the surrounding music
 * is applied by whoever reads it.
 *
 * - A SIGNAL is one recurring sound: one TEMPLATE of a non-negative matrix
 *   factor deconvolution (`nmfd.ts`) of the music's spectrogram, a short
 *   spectrogram of its own (its ARCHETYPE). Its two flags, KICK and HIT,
 *   belong to the signal and not to an instance; a signal may carry one, both
 *   or neither.
 * - An INSTANCE is one peak of the template's activation: its time, its MATCH
 *   (0..1, the share of the music in the template's own bands that the
 *   template explains there) and its INTENSITY (0..1, linear in dB: 1 is
 *   0 dBFS, 0 is -60 dB or below).
 *
 * Overlapping sounds ADD in the model, so a kick under a snare or a crash is
 * the kick's activation plus the other's, and nothing has to decide which
 * sound owns which band.
 *
 * How the inventory is built:
 *
 * 1. SPECTROGRAM. A Hann-windowed FFT_SIZE FFT every HOP samples, summed into
 *    log bands (SPEC_BANDS_PER_OCTAVE an octave) as magnitudes.
 * 2. LEARN. The first LEARN_SEC are factorized into COMPONENTS templates of
 *    TEMPLATE_FRAMES frames, seeded from the strongest, most different
 *    onsets. Every RELEARN_SEC after, the templates are refined on the last
 *    LEARN_SEC, starting from where they are, so a new sound is taken up.
 * 3. FIT. New frames get their activations with the templates held.
 * 4. FLAG. Each template is judged on its sound (its octave balance and how
 *    each octave of it evolves, both read off the template itself) and on how
 *    its instances lie against the beat grid (`BeatPort`).
 *
 * Instances the listener has passed are FINAL; everything ahead is re-read
 * from the activations on every pass (`analyse`).
 */

import { fitActivations, factorize, normalize, type Templates } from './nmfd'

/** The rate every figure here is tuned at; audio at another rate is resampled to it on the way in. */
export const SIGNAL_RATE = 48000
export const HOP = 256
export const HOP_SEC = HOP / SIGNAL_RATE

/** The fewest frames `forgetBefore` drops at once (~10s). */
const FORGET_BLOCK = Math.round(10 / HOP_SEC)

/** Octave band centres, in Hz: the fingerprints and the flags are read in these. */
export const BANDS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800] as const
const BAND_COUNT = BANDS.length
/** How far below its peak a template's shape is followed, in dB. */
const SHAPE_FLOOR_DB = -40
/** Intensity 0 is this level, in dB; 1 is 0 dBFS. */
export const INTENSITY_FLOOR_DB = -60

/** The spectrogram: FFT size (~43ms) and its log bands. */
const FFT_SIZE = 2048
const SPEC_LOW_HZ = 35
const SPEC_HIGH_HZ = 18000
const SPEC_BANDS_PER_OCTAVE = 3
/** A Hann-windowed full-scale sine's FFT magnitude: 0 dBFS. */
const FULL_SCALE = FFT_SIZE / 4
/** Frames from a sound's first sample to the peak of its activation (measured: its window has taken in two hops of it). */
const FRAME_LAG = 2

/** Templates, and how many frames (~43ms) each spans. */
export const COMPONENTS = 12
const TEMPLATE_FRAMES = 16
/** Music the templates are first learned on, and how often they are refined after, in seconds. */
const LEARN_SEC = 10
const RELEARN_SEC = 10
const LEARN_ITERATIONS = 40
const RELEARN_ITERATIONS = 15
const FIT_ITERATIONS = 10
/** Frames before new ones that are held while fitting them, so a sound already sounding is explained by its own activation. */
const FIT_CONTEXT = 16
/** A peak of an activation: the highest within PEAK_HOPS either side, and PEAK_RISE times the lowest over the PEAK_BACK frames before it. */
const PEAK_HOPS = 4
const PEAK_BACK = 8
const PEAK_RISE = 2
/** Two instances with the same flags this close together are one sound (see `withoutDuplicates`). */
const DUPLICATE_SEC = 0.04
/** An instance within TAIL_SEC after one with the same flags and TAIL_DROP more intensity (12 dB) is its tail. */
const TAIL_SEC = 0.15
const TAIL_DROP = 0.2
/** How far either side of the template's onset an instance's start is searched for, in frames (~64ms: a template's own onset can be some 45ms off, and the next sixteenth is twice that away at 160 BPM). */
const ONSET_SEARCH = 12
/** The distance from the template's onset, in frames, at which a rise counts for 1/e of itself. */
const ONSET_SPREAD = 8
/** Frames from a sound's first sample to the frame its spectral rise is steepest in. */
const FLUX_LAG = 0
/** See `peaks`: where a template's sound begins. */
const ONSET_SHARE = 0.25
/**
 * A peak more than PEAK_FLOOR_DB under its template's typical strong peak (its
 * PEAK_REFERENCE quantile) is the template explaining a little of something
 * else, not an instance. On a real track the strays sit 10 to 20 dB under the
 * real hits of the same template, and a soft hit of the same drum as far as 11
 * dB (bladeloop1's pickup kicks, once the template has been re-learned over
 * forty seconds of the main kick): the floor keeps those.
 */
const PEAK_FLOOR_DB = 11
const PEAK_REFERENCE = 0.95
/**
 * A STRONG instance is within STRONG_DB of its template's PEAK_REFERENCE quantile: a signal's typical match is
 * judged by these (see `peaks`), so admitting soft instances does not move it.
 */
const STRONG_DB = 9
/** The least match an instance needs at all. */
const MIN_MATCH = 0.1
/** A peak matching under MATCH_SHARE of its template's typical match (its MATCH_REFERENCE quantile) is not an instance. */
const MATCH_SHARE = 0.6
const MATCH_REFERENCE = 0.5
/** A template's own bands: within this many dB of its loudest. */
const MASK_RANGE_DB = 30

/** The octave bands a signal is described by: within this many dB of its loudest (a real snare's noise sits 25 to 35 dB under its shell tone). */
const DESCRIBE_RANGE_DB = 40
/** Instances a signal needs before it can be flagged. */
export const MIN_FLAG_INSTANCES = 3
/** How far from the drum grid an instance may land and still count as on it, in seconds. */
const ON_GRID_SEC = 0.035
/** The share of a signal's instances that must land on the grid for it to be a kick or a hit. */
const ON_GRID_SHARE = 0.6
/** The share of a signal's power in the 50Hz and 100Hz bands (a kick's fundamental) that makes it a low sound; a snare's tonal body sits at 200Hz. */
const LOW_SHARE = 0.5
const LOW_TOP_HZ = 150
/**
 * A drum keeps to a PATTERN: folded onto a bar of four beats cut into
 * GRID_DIVISIONS, at least PATTERN_SHARE of a signal's instances fall on its
 * PATTERN_SLOTS busiest positions. A synth's notes landing on the grid are
 * spread over the bar; a kick's or a snare's return to the same few places.
 */
const PATTERN_SLOTS = 4
const PATTERN_SHARE = 0.6
/** Positions a beat is cut into for the drum grid: sixteenths and triplets (and so swung sixteenths) alike. */
const GRID_DIVISIONS = 12
/** A kick's CLICK: a band from 800Hz up within CLICK_DB of the top that has fallen CLICK_FALL_DB by CLICK_HOPS (~16ms). */
const CLICK_DB = -30
const CLICK_HOPS = 3
const CLICK_FALL_DB = 10
/** A kick's SWEEP: its highest band at or below 200Hz SWEEP_DB further down than its lowest SWEEP_HOPS (~64ms) on. */
const SWEEP_HOPS = 12
const SWEEP_DB = 6
/** The low bands a sweep is read across: within this many dB of the top (below it, a band is leakage). */
const SWEEP_LEVEL_DB = -12
/** A kick's 200Hz band is within KICK_REACH_DB of its loudest. */
const KICK_REACH_DB = 20
/** At most this many kicks a beat. */
const KICK_PER_BEAT = 2
/** A hit's NOISE: at least NOISE_BANDS bands from 800Hz up within NOISE_DB of its loudest band (see `flag`). */
const NOISE_BANDS = 2
const NOISE_DB = 30
/** A hit's BODY (see `flag`): from BODY_LOW_HZ (a real snare's shell tone at 200Hz) to 3.2kHz, within BODY_TOP_DB of the top and BODY_DB of the sizzle. */
const BODY_LOW_HZ = 200
const BODY_TOP_DB = -24
const BODY_DB = -12
/** A low sound's noise must be within this many dB of its loudest band for it to be a hit as well (see `flag`). */
const LAYERED_NOISE_DB = 12
/**
 * At most this many instances a beat for a hit: a hat plays on every eighth or sixteenth (two or four a beat), a
 * snare with its ghost notes and its soft instances (bladeloop1's) up to about one and a half.
 */
const HIT_PER_BEAT = 1.5

/**
 * How soft each kind of test is (`atLeast`): the span over which a test goes from not met (0) to met (1), centred on
 * its threshold. A level in dB, a share of instances or of power, and instances a beat.
 */
const DB_WIDTH = 6
const SHARE_WIDTH = 0.2
const PER_BEAT_WIDTH = 0.4

/** Where the beats fall: the beat times between two moments. A port, so the map does not own the beat grid. */
export interface BeatPort {
  beatsBetween(from: number, to: number): number[]
}

/** The FFT bins summed into each log band (at least one each), and the octave band each falls in. */
const SPEC_BINS: Array<[number, number]> = []
const SPEC_OCTAVE: number[] = []
{
  const binHz = SIGNAL_RATE / FFT_SIZE
  // Log-spaced edges, but never narrower than one bin: below ~400Hz a quarter octave holds less than a bin, and a bin counted in several bands would weigh its sound several times over.
  let a = Math.round(SPEC_LOW_HZ / binHz)
  while (a * binHz < SPEC_HIGH_HZ) {
    const b = Math.max(a + 1, Math.round(a * 2 ** (1 / SPEC_BANDS_PER_OCTAVE)))
    SPEC_BINS.push([a, b])
    const centre = Math.sqrt(a * b) * binHz
    SPEC_OCTAVE.push(Math.min(BAND_COUNT - 1, Math.max(0, Math.round(Math.log2(centre / BANDS[0])))))
    a = b
  }
}
const F = SPEC_BINS.length
const HANN = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE))

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** A recurring sound: a template, described. */
interface Signal {
  id: number
  mask: number
  /** Per octave band: the template's level under its loudest band, and its instances' mean shape. */
  balance: Float64Array
  shape: Float32Array[]
  /** How far it is a kick, and a hit, 0..1 (see `flag`). */
  kick: number
  hit: number
}

/** One instance, as held. */
interface Instance {
  frame: number
  time: number
  signal: number
  match: number
  intensity: number
}

/** A signal as a reader sees it. */
export interface SignalSummary {
  id: number
  bands: number[]
  kick: number
  hit: number
  instances: number
}

/** One instance as a reader sees it. */
export interface SignalInstance {
  time: number
  signal: number
  kick: number
  hit: number
  match: number
  intensity: number
}

function bandsOf(mask: number): number[] {
  const out: number[] = []
  for (let b = 0; b < BAND_COUNT; b++) if (mask & (1 << b)) out.push(b)
  return out
}

function dbToPower(db: number): number {
  return 10 ** (db / 10)
}

export class SignalMap {
  /** The spectrogram, frame-major ([hop * F + band]); frame i ends at hop i's last sample. */
  private spec = new Float32Array((1 << 14) * F)
  /** Frames the spectrogram and the activations have room for. */
  private get capacity(): number {
    return this.spec.length / F
  }
  /** Activations, per template, per frame. */
  private act: Float32Array[] = []
  private readonly ring = new Float32Array(FFT_SIZE)
  private ringAt = 0
  private readonly re = new Float64Array(FFT_SIZE)
  private readonly im = new Float64Array(FFT_SIZE)
  private hops = 0
  private filled = 0
  /** Media time of hop 0. */
  private origin = NaN
  private templates: Templates | null = null
  /** Frames whose activations are fitted, and the frame the templates were last learned up to. */
  private fittedTo = 0
  private learnedTo = 0
  private instances: Instance[] = []
  /** `instances` as readers see them (`withoutDuplicates`). */
  private published: Instance[] = []
  private signals: Signal[] = []
  private heardTime = -Infinity

  constructor(private readonly beats: BeatPort) {}

  /** Media time of hop `hop`'s start. */
  private timeOf(hop: number): number {
    return this.origin + hop * HOP_SEC
  }

  /** The media time analysed up to: the look-ahead's front. */
  get frontier(): number {
    return Number.isNaN(this.origin) ? NaN : this.timeOf(this.hops)
  }

  /** How much music the map holds, in seconds: from the oldest frame kept (`forgetBefore`) to the frontier. */
  get heldSec(): number {
    return this.hops * HOP_SEC
  }

  /** Forgets what was fed: a new track, or a seek outside what is held. The templates are kept (what was learned stays true). */
  reset(): void {
    this.ring.fill(0)
    this.ringAt = 0
    this.hops = 0
    this.filled = 0
    this.origin = NaN
    this.fittedTo = 0
    this.learnedTo = 0
    this.instances = []
    this.published = []
    this.heardTime = -Infinity
  }

  /**
   * Forgets the frames and instances before media time `time`, so a long track (an eight-hour mix) holds a bounded
   * span: the listener's past is final and nothing reads it again. Frames are dropped in blocks of at least
   * FORGET_BLOCK, so the copy is paid rarely, and never past what the fit still reads as context.
   */
  forgetBefore(time: number): void {
    if (Number.isNaN(this.origin)) return
    const drop = Math.min(Math.floor((time - this.origin) / HOP_SEC), this.fittedTo - FIT_CONTEXT - TEMPLATE_FRAMES)
    if (drop < FORGET_BLOCK) return
    this.spec.copyWithin(0, drop * F, this.hops * F)
    for (const a of this.act) a.copyWithin(0, drop, this.hops)
    this.hops -= drop
    this.fittedTo -= drop
    this.learnedTo = Math.max(0, this.learnedTo - drop)
    this.origin += drop * HOP_SEC
    const shift = (list: Instance[]) => list.filter((x) => x.frame >= drop).map((x) => ({ ...x, frame: x.frame - drop }))
    this.instances = shift(this.instances)
    this.published = shift(this.published)
  }

  /** Clears the learned templates, for a new track. */
  forgetSignals(): void {
    this.templates = null
    this.signals = []
  }

  /** Takes mono samples at SIGNAL_RATE, the first at media time `startTime`, contiguous with what came before (or the first after `reset`). */
  feed(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringAt] = samples[i]
      this.ringAt = (this.ringAt + 1) % FFT_SIZE
      if (++this.filled === HOP) this.closeHop()
    }
  }

  private closeHop(): void {
    this.filled = 0
    const index = this.hops
    if ((index + 1) * F > this.spec.length) this.grow()
    const re = this.re
    const im = this.im
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = this.ring[(this.ringAt + i) % FFT_SIZE] * HANN[i]; im[i] = 0 }
    fft(re, im)
    const o = index * F
    for (let j = 0; j < F; j++) {
      const [a, b] = SPEC_BINS[j]
      let p = 0
      for (let k = a; k < b; k++) p += re[k] * re[k] + im[k] * im[k]
      this.spec[o + j] = Math.sqrt(p)
    }
    this.hops++
  }

  private grow(): void {
    const size = this.capacity * 2
    const widen = (a: Float32Array, n: number) => { const x = new Float32Array(n); x.set(a); return x }
    this.spec = widen(this.spec, size * F)
    this.act = this.act.map((a) => widen(a, size))
  }

  /** Runs `run` on frames [from, to) as a window of their own: the spectrogram and the activations copied out and back. */
  private windowed(from: number, to: number, run: (v: Float32Array, n: number, h: Float32Array) => void): void {
    const n = to - from
    const K = this.act.length
    const h = new Float32Array(K * n)
    for (let k = 0; k < K; k++) h.set(this.act[k].subarray(from, to), k * n)
    run(this.spec.subarray(from * F, to * F), n, h)
    for (let k = 0; k < K; k++) this.act[k].set(h.subarray(k * n, (k + 1) * n), from)
  }

  /** A starting activation for frames [from, to): the frame's total shared evenly, so the fit starts near the right level. */
  private seedActivations(from: number, to: number): void {
    const K = this.act.length
    for (let i = from; i < to; i++) {
      let s = 0
      for (let j = 0; j < F; j++) s += this.spec[i * F + j]
      for (let k = 0; k < K; k++) this.act[k][i] = s / K + 1e-12
    }
  }

  /** Templates seeded from the strongest onsets of frames [0, n), each as unlike those already taken as possible. */
  private learn(n: number): void {
    // Every floor is relative to the music's own level, so the same music played quieter learns the same templates.
    let mean = 0
    for (let j = 0; j < n * F; j++) mean += this.spec[j]
    const floor = (1e-3 * mean) / (n * F) + 1e-12
    const flux = new Float32Array(n)
    for (let i = 1; i < n; i++) {
      let s = 0
      for (let j = 0; j < F; j++) s += Math.max(0, Math.log(floor + this.spec[i * F + j]) - Math.log(floor + this.spec[(i - 1) * F + j]))
      flux[i] = s
    }
    const onsets: number[] = []
    for (let i = 1; i + TEMPLATE_FRAMES < n; i++) {
      let peak = true
      for (let k = Math.max(0, i - PEAK_HOPS); k <= Math.min(n - 1, i + PEAK_HOPS); k++) if (flux[k] > flux[i] || (flux[k] === flux[i] && k < i)) { peak = false; break }
      if (peak && flux[i] > 0) onsets.push(i)
    }
    onsets.sort((a, b) => flux[b] - flux[a])
    const candidates = onsets.slice(0, COMPONENTS * 8)
    const spectrumOf = (i: number) => {
      const x = new Float32Array(F)
      for (let t = 0; t < TEMPLATE_FRAMES; t++) for (let j = 0; j < F; j++) x[j] += this.spec[(i + t) * F + j]
      for (let j = 0; j < F; j++) x[j] = Math.log(floor + x[j])
      return x
    }
    const prints = candidates.map(spectrumOf)
    const chosen: number[] = []
    const distance = new Float32Array(candidates.length).fill(Infinity)
    while (chosen.length < Math.min(COMPONENTS, candidates.length)) {
      // The first is the strongest; each next one the farthest from everything taken, weighed by its strength.
      let best = -1
      let bestScore = -Infinity
      for (let c = 0; c < candidates.length; c++) {
        if (chosen.includes(c)) continue
        const score = chosen.length === 0 ? flux[candidates[c]] : distance[c] * Math.sqrt(flux[candidates[c]])
        if (score > bestScore) { bestScore = score; best = c }
      }
      chosen.push(best)
      for (let c = 0; c < candidates.length; c++) {
        let d = 0
        for (let j = 0; j < F; j++) d += (prints[c][j] - prints[best][j]) ** 2
        distance[c] = Math.min(distance[c], d)
      }
    }
    const w = new Float32Array(COMPONENTS * TEMPLATE_FRAMES * F)
    for (let k = 0; k < COMPONENTS; k++) {
      // A template with no onset to start from starts from a frame spread evenly over the window.
      const at = k < chosen.length ? candidates[chosen[k]] : Math.floor(((k + 0.5) / COMPONENTS) * (n - TEMPLATE_FRAMES))
      for (let t = 0; t < TEMPLATE_FRAMES; t++) for (let j = 0; j < F; j++) w[(k * TEMPLATE_FRAMES + t) * F + j] = this.spec[(at + t) * F + j] + floor
    }
    this.templates = { K: COMPONENTS, T: TEMPLATE_FRAMES, F, w }
    this.act = Array.from({ length: COMPONENTS }, () => new Float32Array(this.capacity))
    this.normalizeTemplates()
    // As in `fit`, the window runs a template's length past the frames it decides.
    const end = Math.min(this.hops, n + TEMPLATE_FRAMES)
    this.seedActivations(0, end)
    this.windowed(0, end, (v, m, h) => factorize(this.templates!, v, m, h, LEARN_ITERATIONS))
    this.fittedTo = n
    this.learnedTo = n
  }

  private normalizeTemplates(): void {
    normalize(this.templates!, new Float32Array(COMPONENTS), 1)
  }

  /** Fits frames [from, to) with the templates held, the FIT_CONTEXT frames before them held as they are. */
  private fit(from: number, to: number): void {
    // The window runs a template's length past `to`, so the frames at its end see their sound's whole span: cut at `to`,
    // a sound beginning there is explained by whatever activations the cut leaves, an artefact peak at every chunk's edge.
    const end = Math.min(this.hops, to + TEMPLATE_FRAMES)
    this.seedActivations(from, end)
    const start = Math.max(0, from - FIT_CONTEXT)
    this.windowed(start, end, (v, n, h) => fitActivations(this.templates!, v, n, h, FIT_ITERATIONS, from - start))
  }

  /** Refines the templates on the LEARN_SEC before frame `to`, from where they are. */
  private relearn(to: number): void {
    const from = Math.max(0, to - Math.round(LEARN_SEC / HOP_SEC))
    // Only the templates are taken from it: a window's last frames see a sound's start without its end, so the
    // activations it leaves there are an edge artefact. The activations stay those the fit gave.
    const n = to - from
    const h = new Float32Array(this.act.length * n)
    for (let k = 0; k < this.act.length; k++) h.set(this.act[k].subarray(from, to), k * n)
    factorize(this.templates!, this.spec.subarray(from * F, to * F), n, h, RELEARN_ITERATIONS)
  }

  /** The instances of template `k` peaking in frames [from, to). */
  private peaks(k: number, from: number, to: number): Instance[] {
    const tpl = this.templates!
    const h = this.act[k]
    const out: Instance[] = []
    // The template's own bands, and its loudest frame (its level is read there).
    const power = new Float32Array(F)
    let loudPower = -1
    const framePower = new Float32Array(TEMPLATE_FRAMES)
    for (let t = 0; t < TEMPLATE_FRAMES; t++) {
      let p = 0
      for (let j = 0; j < F; j++) { const x = tpl.w[(k * TEMPLATE_FRAMES + t) * F + j]; power[j] += x * x; p += x * x }
      framePower[t] = p
      if (p > loudPower) loudPower = p
    }
    // Where the sound begins inside the template, the first frame rising at ONSET_SHARE of its steepest rise: a template may carry some of what precedes its
    // sound, and an instance is the sound, not the template's first frame.
    const riseAt = (t: number) => framePower[t] - (t > 0 ? framePower[t - 1] : 0)
    let steepest = 0
    for (let t = 0; t < TEMPLATE_FRAMES; t++) steepest = Math.max(steepest, riseAt(t))
    let onset = 0
    while (onset + 1 < TEMPLATE_FRAMES && riseAt(onset) < ONSET_SHARE * steepest) onset++
    let top = 0
    for (let j = 0; j < F; j++) top = Math.max(top, power[j])
    const own: number[] = []
    for (let j = 0; j < F; j++) if (power[j] >= top * dbToPower(-MASK_RANGE_DB)) own.push(j)
    for (let i = 0; i < to; i++) {
      const a = h[i]
      let peak = true
      for (let d = 1; d <= PEAK_HOPS && peak; d++) {
        if (i - d >= 0 && h[i - d] >= a) peak = false
        if (i + d < this.fittedTo && h[i + d] > a) peak = false
      }
      if (!peak) continue
      // Before the first frame is silence, so a sound at the very start still rises.
      let low = i < PEAK_BACK ? 0 : Infinity
      for (let d = 1; d <= PEAK_BACK && i - d >= 0; d++) low = Math.min(low, h[i - d])
      if (a < PEAK_RISE * low) continue
      // Intensity: the template's loudest frame at this activation, as dBFS.
      const db = 10 * Math.log10(1e-12 + (a * a * loudPower) / (FULL_SCALE * FULL_SCALE))
      const intensity = Math.min(1, Math.max(0, (db - INTENSITY_FLOOR_DB) / -INTENSITY_FLOOR_DB))
      if (intensity <= 0) continue
      // Match: the share of the music in the template's own bands, over its span, that the template explains,
      // with everything its activation contributes there (an activation is spread over a few frames). (The share
      // of the template's prediction the music holds says nothing: the fit never predicts more than is there.)
      let mine = 0
      let all = 0
      for (let t = 0; t < TEMPLATE_FRAMES && i + t < this.hops; t++) {
        for (const j of own) {
          let l = 0
          for (let u = 0; u < TEMPLATE_FRAMES && u <= i + t; u++) l += h[i + t - u] * tpl.w[(k * TEMPLATE_FRAMES + u) * F + j]
          const v = this.spec[(i + t) * F + j]
          mine += Math.min(v, l)
          all += v
        }
      }
      const match = all > 0 ? mine / all : 0
      if (match < MIN_MATCH) continue
      // The time is read off the music, not the template: the frame of the steepest rise in the template's own bands
      // near where the template puts the sound's start (a template's onset is only as sharp as its learned average).
      const guess = i + onset - FRAME_LAG
      let hop = guess
      let best = -Infinity
      for (let f = Math.max(1, guess - ONSET_SEARCH); f <= Math.min(this.hops - 1, guess + ONSET_SEARCH); f++) {
        let flux = 0
        for (const j of own) flux += Math.max(0, Math.log(this.spec[f * F + j] + 1e-9) - Math.log(this.spec[(f - 1) * F + j] + 1e-9))
        // A rise counts the less the further it lies from where the template puts the start, so a neighbouring sound's
        // onset inside the search wins only by being much the steeper.
        const score = flux * Math.exp(-(((f - guess) / ONSET_SPREAD) ** 2))
        if (score > best) { best = score; hop = f - FLUX_LAG }
      }
      out.push({ frame: i, time: this.timeOf(hop), signal: k, match, intensity })
    }
    if (out.length === 0) return out
    const levels = out.map((x) => x.intensity).sort((a, b) => a - b)
    const reference = levels[Math.floor(PEAK_REFERENCE * (levels.length - 1))]
    // A peak matching far worse than its template's typical instance is the template borrowed by another sound
    // (a kick's template lending its low end to a bass note). Relative, because overlap lowers every match of a
    // sound that always plays under others (a clap under sixteenth hats). Typical among its STRONG peaks, so how
    // many soft ones the floor lets in does not move it.
    const matches = out.filter((x) => x.intensity >= reference + STRONG_DB / INTENSITY_FLOOR_DB).map((x) => x.match).sort((a, b) => a - b)
    const typical = matches[Math.floor(MATCH_REFERENCE * (matches.length - 1))]
    const floor = reference + PEAK_FLOOR_DB / INTENSITY_FLOOR_DB
    return out.filter((x) => x.frame >= from && x.intensity >= floor && x.match >= MATCH_SHARE * typical)
  }

  /** Describes each template: its octave balance from the template, its shape from its instances' fingerprints. */
  private describe(): void {
    const tpl = this.templates!
    const byK = new Map<number, Instance[]>()
    for (const x of this.instances) { const l = byK.get(x.signal) ?? []; l.push(x); byK.set(x.signal, l) }
    this.signals = []
    for (let k = 0; k < tpl.K; k++) {
      const octave = new Float64Array(BAND_COUNT)
      for (let t = 0; t < TEMPLATE_FRAMES; t++) for (let j = 0; j < F; j++) octave[SPEC_OCTAVE[j]] += tpl.w[(k * TEMPLATE_FRAMES + t) * F + j] ** 2
      let top = 0
      for (let b = 0; b < BAND_COUNT; b++) top = Math.max(top, octave[b])
      const balance = Float64Array.from(octave, (p) => 10 * Math.log10((p + 1e-30) / (top + 1e-30)))
      let mask = 0
      for (let b = 0; b < BAND_COUNT; b++) if (balance[b] >= -DESCRIBE_RANGE_DB) mask |= 1 << b
      // The shape is the template's own: how each octave band of it evolves from the template's loudest frame on,
      // against that band's peak. Learned from every instance at once, it carries none of what other sounds laid over
      // any one of them. (The frames before the loudest are the FFT window filling: a sound takes FRAME_RISE frames
      // to be wholly inside it.)
      let loudest = 0
      let loudestPower = -1
      for (let t = 0; t < TEMPLATE_FRAMES; t++) {
        let p = 0
        for (let j = 0; j < F; j++) p += tpl.w[(k * TEMPLATE_FRAMES + t) * F + j] ** 2
        if (p > loudestPower) { loudestPower = p; loudest = t }
      }
      const shape = BANDS.map(() => new Float32Array(TEMPLATE_FRAMES - loudest))
      for (let t = loudest; t < TEMPLATE_FRAMES; t++) for (let j = 0; j < F; j++) shape[SPEC_OCTAVE[j]][t - loudest] += tpl.w[(k * TEMPLATE_FRAMES + t) * F + j] ** 2
      for (const band of shape) {
        let peak = 0
        for (let t = 0; t < band.length; t++) peak = Math.max(peak, band[t])
        for (let t = 0; t < band.length; t++) band[t] = Math.max(SHAPE_FLOOR_DB, 10 * Math.log10((band[t] + 1e-30) / (peak + 1e-30)))
      }
      this.signals.push({ id: k, mask, balance, shape, kick: 0, hit: 0 })
    }
  }

  /** The power share of `signal`'s archetype within `lo..hi` Hz (by band centre). */
  private shareIn(signal: Signal, lo: number, hi: number): number {
    let all = 0
    let inside = 0
    for (const b of bandsOf(signal.mask)) {
      const p = dbToPower(signal.balance[b])
      all += p
      if (BANDS[b] >= lo && BANDS[b] <= hi) inside += p
    }
    return all > 0 ? inside / all : 0
  }

  /**
   * Judges each signal's flags from its archetype's sound and from how its
   * instances lie against the beat grid. The grid is the beat cut into
   * GRID_DIVISIONS, so straight sixteenths and swung or triplet ones all lie
   * on it: a kick or a hit is a drum, and a drum plays on the grid, but not
   * necessarily on the beat (an 808 pattern or a two-step's kicks rarely are).
   *
   * - KICK: mostly low (LOW_SHARE of its power in the 50Hz and 100Hz
   *   bands, or up to 250Hz with a sweep), its body reaching the 200Hz band
   *   (KICK_REACH_DB; a bass note stays below it), with an attack a kick has
   *   and a held tail does not: a beater CLICK (a band from 800Hz to 3.2kHz
   *   within CLICK_DB of the top, gone within CLICK_HOPS) or a falling pitch
   *   (SWEEP: its upper low bands dying SWEEP_DB faster than its lowest). And
   *   no more than KICK_PER_BEAT.
   * - HIT: a BODY carried on NOISE (see BODY_TOP_DB and NOISE_DB), not a low
   *   sound unless its noise is loud (LAYERED_NOISE_DB), and no more than
   *   HIT_PER_BEAT.
   *
   * The shapes are the template's own, a frame (HOP samples) per step.
   *
   * Each flag is a CONFIDENCE, 0..1, not a yes or no: every test above is met
   * by degrees (`atLeast`, `atMost`: 0.5 at its threshold), "and" is the
   * least of its parts and "or" the most. A sound on the edge of a test (a
   * wide-band layer over a kick, half a hit by its spectrum) would otherwise
   * flip between nothing and a full hit each time the map is re-judged; as a
   * confidence it reads faintly, and a reader weighs each instance by it.
   */
  private flag(): void {
    const times = new Map<number, number[]>()
    for (const x of this.instances) { const l = times.get(x.signal) ?? []; l.push(x.time); times.set(x.signal, l) }
    for (const s of this.signals) {
      s.kick = 0
      s.hit = 0
      const list = times.get(s.id) ?? []
      if (list.length < MIN_FLAG_INSTANCES) continue
      const beats = this.beats.beatsBetween(list[0] - 2, list[list.length - 1] + 2)
      if (beats.length < 2) continue
      const grid: number[] = []
      for (let i = 0; i + 1 < beats.length; i++) {
        for (let k = 0; k < GRID_DIVISIONS; k++) grid.push(beats[i] + ((beats[i + 1] - beats[i]) * k) / GRID_DIVISIONS)
      }
      grid.push(beats[beats.length - 1])
      const onGrid = atLeast(list.filter((t) => nearest(grid, t) <= ON_GRID_SEC).length / list.length, ON_GRID_SHARE, SHARE_WIDTH)
      const patterned = Math.min(onGrid, atLeast(patternShare(list, beats), PATTERN_SHARE, SHARE_WIDTH))
      const spanBeats = Math.max(1, beats.filter((t) => t >= list[0] && t <= list[list.length - 1]).length)
      const perBeat = list.length / spanBeats
      const bands = bandsOf(s.mask)
      const level = (b: number, floor: number) => atLeast(s.balance[b], floor, DB_WIDTH)
      // A click is the top of the sound falling away above it; a hat landing with a bass note climbs toward 12.8kHz instead.
      let above = -Infinity
      for (const b of bands) if (BANDS[b] > 3200) above = Math.max(above, s.balance[b])
      let click = 0
      for (const b of bands) {
        if (BANDS[b] < 800 || BANDS[b] > 3200) continue
        click = Math.max(click, Math.min(level(b, CLICK_DB), atLeast(s.balance[b], above, DB_WIDTH), atLeast(-at(s.shape[b], CLICK_HOPS), CLICK_FALL_DB, DB_WIDTH)))
      }
      const lows = bands.filter((b) => BANDS[b] <= 200)
      const swept = lows.filter((b) => s.balance[b] >= SWEEP_LEVEL_DB)
      const sweep = swept.length >= 2 ? atLeast(at(s.shape[swept[0]], SWEEP_HOPS) - at(s.shape[swept[swept.length - 1]], SWEEP_HOPS), SWEEP_DB, DB_WIDTH) : 0
      const low = Math.max(atLeast(this.shareIn(s, 0, LOW_TOP_HZ), LOW_SHARE, SHARE_WIDTH), Math.min(atLeast(this.shareIn(s, 0, 250), LOW_SHARE, SHARE_WIDTH), sweep))
      // A kick's body reaches the 200Hz band; a bass note's stays in its two lowest octaves (and a bass note under a
      // hat leaves a gap between them).
      const reach = level(BANDS.indexOf(200), -KICK_REACH_DB)
      s.kick = Math.min(patterned, reach, low, Math.max(click, sweep), atMost(perBeat, KICK_PER_BEAT, PER_BEAT_WIDTH))
      // A hit is judged by its spectrum alone (a template's decay is not the sound's: the fit explains a long tail with
      // fresh activations, so a template ends early). Levels are read against the loudest band from BODY_LOW_HZ up,
      // not the whole sound's: where a hit always lands with a kick the two are one template, and the kick's
      // fundamental would make anything above it look faint.
      const loudestIn = (lo: number, hi: number) => {
        let found = -1
        for (const b of bands) if (BANDS[b] >= lo && BANDS[b] <= hi && (found < 0 || s.balance[b] > s.balance[found])) found = b
        return found
      }
      const top = loudestIn(BODY_LOW_HZ, Infinity)
      const hitTop = top >= 0 ? s.balance[top] : -Infinity
      // A BODY: a shell tone or a noise band between BODY_LOW_HZ and 3.2kHz, near the top, and no more than
      // BODY_DB under the sizzle above it (a hat's power lies far above its body).
      const bodyBand = loudestIn(BODY_LOW_HZ, 3200)
      const sizzle = loudestIn(800, Infinity)
      const body = bodyBand < 0 ? 0 : Math.min(atLeast(s.balance[bodyBand] - hitTop, BODY_TOP_DB, DB_WIDTH), sizzle < 0 ? 1 : atLeast(s.balance[bodyBand] - s.balance[sizzle], BODY_DB, DB_WIDTH))
      // NOISE: at least NOISE_BANDS bands from 800Hz up within NOISE_DB of the whole sound's top, one of them at 3.2kHz
      // or above (a kick's click lies further down than that, and so does a snare a kick's template sometimes absorbs).
      const noisy = bands.filter((b) => BANDS[b] >= 800).map((b) => level(b, -NOISE_DB)).sort((p, q) => q - p)
      const high = Math.max(0, ...bands.filter((b) => BANDS[b] >= 3200).map((b) => level(b, -NOISE_DB)))
      const noise = Math.min(noisy[NOISE_BANDS - 1] ?? 0, high)
      // A low sound carries a hit only where its noise is loud (a kick and a clap that always land together): a kick's
      // template that absorbed some of a snare landing with it now and then carries that noise too, but faintly.
      const loudNoise = sizzle < 0 ? 0 : level(sizzle, -LAYERED_NOISE_DB)
      s.hit = Math.min(patterned, Math.max(1 - low, loudNoise), body, noise, atMost(perBeat, HIT_PER_BEAT, PER_BEAT_WIDTH))
    }
  }


  /**
   * Brings the map up to date for a listener at `heardTime`: learns or
   * refines the templates, fits what was fed since, makes everything heard
   * final and re-reads the rest from the activations.
   */
  analyse(heardTime: number): void {
    if (Number.isNaN(this.origin)) return
    this.heardTime = Math.max(this.heardTime, heardTime)
    // A frame is fitted once the whole template after it has been fed.
    const ready = this.hops - TEMPLATE_FRAMES
    const learnFrames = Math.round(LEARN_SEC / HOP_SEC)
    const relearnFrames = Math.round(RELEARN_SEC / HOP_SEC)
    if (!this.templates) {
      if (ready < learnFrames) return
      this.learn(learnFrames)
    } else if (this.act.length === 0) {
      this.act = Array.from({ length: COMPONENTS }, () => new Float32Array(this.capacity))
    }
    while (this.fittedTo < ready) {
      const to = Math.min(ready, this.fittedTo + relearnFrames)
      this.fit(this.fittedTo, to)
      this.fittedTo = to
      // Re-learned every RELEARN_SEC of music, however it arrived: in one piece, or a second at a time as it streams.
      if (to - this.learnedTo >= relearnFrames) {
        this.relearn(to)
        this.learnedTo = to
      }
    }
    const final = this.instances.filter((x) => x.time <= this.heardTime)
    const fresh: Instance[] = []
    for (let k = 0; k < COMPONENTS; k++) {
      // Per template: an instance's time is read off the music, so one template's last heard frame says nothing about
      // where another's heard instances end.
      const lastFinal = final.reduce((m, x) => (x.signal === k ? Math.max(m, x.frame) : m), -1)
      for (const x of this.peaks(k, lastFinal + 1, this.fittedTo)) fresh.push(x)
    }
    this.instances = [...final, ...fresh].sort((a, b) => a.time - b.time)
    this.describe()
    this.flag()
    this.published = this.withoutDuplicates()
  }

  /**
   * The instances a reader sees: where two templates both explain one sound (the fit split it between them), the
   * two instances carry the same flags within DUPLICATE_SEC of each other, and only the louder is kept. A kick
   * and a snare landing together carry different flags and both stay.
   */
  private withoutDuplicates(): Instance[] {
    const flagsOf = (x: Instance) => { const s = this.signals[x.signal]; return (s.kick >= 0.5 ? 1 : 0) | (s.hit >= 0.5 ? 2 : 0) }
    const out: Instance[] = []
    for (const x of this.instances) {
      const f = flagsOf(x)
      if (f === 0) { out.push(x); continue }
      const twin = out.findIndex((y) => x.time - y.time <= DUPLICATE_SEC && y.signal !== x.signal && flagsOf(y) === f)
      if (twin >= 0) {
        if (x.intensity > out[twin].intensity) out[twin] = x
        continue
      }
      // Shortly after a much louder sound with the same flags, a faint one is that sound's tail, explained afresh.
      if (out.some((y) => x.time - y.time <= TAIL_SEC && flagsOf(y) === f && y.intensity - x.intensity >= TAIL_DROP)) continue
      out.push(x)
    }
    return out
  }

  /** The inventory's signals. */
  signalList(): SignalSummary[] {
    const counts = new Map<number, number>()
    for (const x of this.instances) counts.set(x.signal, (counts.get(x.signal) ?? 0) + 1)
    return this.signals.map((s) => ({ id: s.id, bands: bandsOf(s.mask).map((b) => BANDS[b]), kick: s.kick, hit: s.hit, instances: counts.get(s.id) ?? 0 }))
  }

  /** Every instance with a time in [from, to), oldest first. */
  instancesBetween(from: number, to: number): SignalInstance[] {
    const byId = new Map(this.signals.map((s) => [s.id, s]))
    const out: SignalInstance[] = []
    for (const x of this.published) {
      if (x.time < from || x.time >= to) continue
      const s = byId.get(x.signal)
      if (!s) continue
      out.push({ time: x.time, signal: s.id, kick: s.kick, hit: s.hit, match: x.match, intensity: x.intensity })
    }
    return out
  }
}

/** The share of `times` on their PATTERN_SLOTS busiest positions of a four-beat bar of `beats` (sorted), cut into GRID_DIVISIONS a beat. */
function patternShare(times: number[], beats: number[]): number {
  const counts = new Map<number, number>()
  let placed = 0
  let k = 0
  for (const t of times) {
    while (k + 1 < beats.length && beats[k + 1] <= t) k++
    if (k + 1 >= beats.length || beats[k] > t) continue
    const slot = (k % 4) * GRID_DIVISIONS + Math.round(((t - beats[k]) / (beats[k + 1] - beats[k])) * GRID_DIVISIONS)
    const key = slot % (4 * GRID_DIVISIONS)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    placed++
  }
  if (placed === 0) return 0
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, PATTERN_SLOTS)
  return top.reduce((a, b) => a + b, 0) / placed
}

/** A shape's level `t` frames on, or its last where it is shorter. */
function at(shape: Float32Array, t: number): number {
  return shape[Math.min(t, shape.length - 1)]
}

/**
 * How far `x` meets "at least `floor`", 0..1: 0.5 at the floor itself, rising linearly to 1 half a `width` above it
 * and falling to 0 half a `width` below. The flags are measurements, not decisions (see `flag`).
 */
function atLeast(x: number, floor: number, width: number): number {
  return Math.max(0, Math.min(1, 0.5 + (x - floor) / width))
}

/** How far `x` meets "at most `ceiling`", 0..1 (see `atLeast`). */
function atMost(x: number, ceiling: number, width: number): number {
  return atLeast(-x, -ceiling, width)
}

/** The distance from `t` to the nearest of the sorted `times`. */
function nearest(times: number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  let best = Infinity
  if (lo < times.length) best = times[lo] - t
  if (lo > 0) best = Math.min(best, t - times[lo - 1])
  return best
}

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
 * 4. FLAG. Each template is judged on its sound (its octave balance, and the
 *    averaged octave-band fingerprints of its instances, `printAt`) and on how
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

/** Octave band centres, in Hz: the fingerprints and the flags are read in these. */
export const BANDS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800] as const
const BAND_COUNT = BANDS.length
const BAND_Q = Math.SQRT2
/** Hops a band's energy is averaged over: about two cycles of its centre, at least two hops. */
const ENVELOPE_HOPS = BANDS.map((hz) => Math.max(2, Math.ceil((2 * SIGNAL_RATE) / hz / HOP)))
/** Hops a fingerprint's shape spans, from the sound's start: ~128ms. */
export const SHAPE_HOPS = 24
/** How far below its peak a shape is followed, in dB. */
const SHAPE_FLOOR_DB = -40
/** Intensity 0 is this level, in dB; 1 is 0 dBFS. */
export const INTENSITY_FLOOR_DB = -60

/** The spectrogram: FFT size (~43ms) and its log bands. */
const FFT_SIZE = 2048
const SPEC_LOW_HZ = 35
const SPEC_HIGH_HZ = 18000
const SPEC_BANDS_PER_OCTAVE = 4
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
const LEARN_ITERATIONS = 60
const RELEARN_ITERATIONS = 15
const FIT_ITERATIONS = 30
/** Frames before new ones that are held while fitting them, so a sound already sounding is explained by its own activation. */
const FIT_CONTEXT = 16
/** A peak of an activation: the highest within PEAK_HOPS either side, and PEAK_RISE times the lowest over the PEAK_BACK frames before it. */
const PEAK_HOPS = 4
const PEAK_BACK = 8
const PEAK_RISE = 2
/** A peak below this share of its template's strongest is the template explaining a little of something else, not an instance. */
const PEAK_FLOOR = 0
/** The least match an instance needs. */
const MIN_MATCH = 0.25
/** A template's own bands: within this many dB of its loudest. */
const MASK_RANGE_DB = 30

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
/** A kick's DECAY: its loudest low band DECAY_DB down by the end of the shape (~128ms), where a bass note holds. */
const DECAY_DB = 8
/** At most this many kicks a beat. */
const KICK_PER_BEAT = 2
/** A hit's noise: at least this many bands from 800Hz up. */
const NOISE_BANDS = 3
/**
 * A hit's BODY: its loudest band between 800Hz and 3.2kHz within this many
 * dB of its loudest band from 800Hz up (a hat's power lies above the body),
 * and still within BODY_SUSTAIN_DB of its peak BODY_SUSTAIN_HOPS later (~64ms:
 * a kick's beater click and a closed hat have died away by then, a snare's or
 * a clap's noise has not).
 */
const BODY_DB = -12
/** And within this many dB of the whole sound's loudest band: a faint upper edge of a low sound is not a body. */
const BODY_TOP_DB = -24
const BODY_SUSTAIN_HOPS = 12
const BODY_SUSTAIN_DB = -10
/** And then dying away: at least BODY_DECAY_DB down by the end of the shape (~128ms), where a pad or a held chord is not. */
const BODY_DECAY_DB = 6
/** At most this many instances a beat for a hit; a hat plays on every eighth or sixteenth. */
const HIT_PER_BEAT = 1.1

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

/** One band's part of a fingerprint: its peak level and its level over SHAPE_HOPS relative to it. */
interface BandPrint {
  peakDb: number
  shape: Float32Array
}

/** A recurring sound: a template, described. */
interface Signal {
  id: number
  mask: number
  /** Per octave band: the template's level under its loudest band, and its instances' mean shape. */
  balance: Float64Array
  shape: Float32Array[]
  kick: boolean
  hit: boolean
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
  kick: boolean
  hit: boolean
  instances: number
}

/** One instance as a reader sees it. */
export interface SignalInstance {
  time: number
  signal: number
  kick: boolean
  hit: boolean
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

/** Two-stage RBJ band-pass, 0 dB peak gain. */
class BandFilter {
  private readonly b0: number
  private readonly b2: number
  private readonly a1: number
  private readonly a2: number
  private readonly s = new Float64Array(8)
  energy = 0

  constructor(hz: number) {
    const w = (2 * Math.PI * hz) / SIGNAL_RATE
    const alpha = Math.sin(w) / (2 * BAND_Q)
    const a0 = 1 + alpha
    this.b0 = alpha / a0
    this.b2 = -alpha / a0
    this.a1 = (-2 * Math.cos(w)) / a0
    this.a2 = (1 - alpha) / a0
  }

  add(x: number): void {
    const s = this.s
    let y = x
    for (let k = 0; k < 8; k += 4) {
      const input = y
      y = this.b0 * input + this.b2 * s[k + 1] - this.a1 * s[k + 2] - this.a2 * s[k + 3]
      s[k + 1] = s[k]
      s[k] = input
      s[k + 3] = s[k + 2]
      s[k + 2] = y
    }
    this.energy += y * y
  }

  reset(): void {
    this.s.fill(0)
    this.energy = 0
  }
}

export class SignalMap {
  private readonly filters = BANDS.map((hz) => new BandFilter(hz))
  /** Per octave band, per hop: the raw hop energy and the enveloped level in dB. */
  private raw: Float32Array[] = BANDS.map(() => new Float32Array(1 << 14))
  private level: Float32Array[] = BANDS.map(() => new Float32Array(1 << 14))
  /** The spectrogram, frame-major ([hop * F + band]); frame i ends at hop i's last sample. */
  private spec = new Float32Array((1 << 14) * F)
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
  private instances: Instance[] = []
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

  /** Forgets what was fed: a new track, or a seek outside what is held. The templates are kept (what was learned stays true). */
  reset(): void {
    for (const f of this.filters) f.reset()
    this.ring.fill(0)
    this.ringAt = 0
    this.hops = 0
    this.filled = 0
    this.origin = NaN
    this.fittedTo = 0
    this.instances = []
    this.heardTime = -Infinity
  }

  /** Clears the learned templates, for a new track. */
  forgetSignals(): void {
    this.templates = null
    this.signals = []
  }

  /** Takes mono samples at SIGNAL_RATE, the first at media time `startTime`, contiguous with what came before (or the first after `reset`). */
  feed(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    const filters = this.filters
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]
      for (let b = 0; b < BAND_COUNT; b++) filters[b].add(x)
      this.ring[this.ringAt] = x
      this.ringAt = (this.ringAt + 1) % FFT_SIZE
      if (++this.filled === HOP) this.closeHop()
    }
  }

  private closeHop(): void {
    this.filled = 0
    const index = this.hops
    if (index >= this.raw[0].length) this.grow()
    for (let b = 0; b < BAND_COUNT; b++) {
      const f = this.filters[b]
      const raw = this.raw[b]
      raw[index] = f.energy / HOP
      f.energy = 0
      const span = ENVELOPE_HOPS[b]
      let sum = 0
      for (let k = 0; k < Math.min(span, index + 1); k++) sum += raw[index - k]
      // A full-scale sine in the band reads 0 dB (mean square 1/2).
      this.level[b][index] = 10 * Math.log10(1e-12 + (2 * sum) / span)
    }
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
    const size = this.raw[0].length * 2
    const widen = (a: Float32Array, n: number) => { const x = new Float32Array(n); x.set(a); return x }
    this.raw = this.raw.map((a) => widen(a, size))
    this.level = this.level.map((a) => widen(a, size))
    this.spec = widen(this.spec, size * F)
    this.act = this.act.map((a) => widen(a, size))
  }

  /** The octave-band fingerprint of a sound starting at hop `start`. */
  private printAt(start: number): BandPrint[] {
    const out: BandPrint[] = []
    for (let b = 0; b < BAND_COUNT; b++) {
      const lv = this.level[b]
      // The band's own clock: its level lags the sound by its envelope.
      const from = start + ENVELOPE_HOPS[b] - 1
      let peakDb = -Infinity
      for (let k = from; k <= from + 6 && k < this.hops; k++) peakDb = Math.max(peakDb, lv[k])
      const shape = new Float32Array(SHAPE_HOPS)
      for (let k = 0; k < SHAPE_HOPS; k++) shape[k] = from + k < this.hops ? Math.max(SHAPE_FLOOR_DB, lv[from + k] - peakDb) : SHAPE_FLOOR_DB
      out.push({ peakDb, shape })
    }
    return out
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
      for (let k = 0; k < K; k++) this.act[k][i] = s / K + 1e-6
    }
  }

  /** Templates seeded from the strongest onsets of frames [0, n), each as unlike those already taken as possible. */
  private learn(n: number): void {
    const flux = new Float32Array(n)
    for (let i = 1; i < n; i++) {
      let s = 0
      for (let j = 0; j < F; j++) s += Math.max(0, Math.log(1e-3 + this.spec[i * F + j]) - Math.log(1e-3 + this.spec[(i - 1) * F + j]))
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
      for (let j = 0; j < F; j++) x[j] = Math.log(1e-3 + x[j])
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
      for (let t = 0; t < TEMPLATE_FRAMES; t++) for (let j = 0; j < F; j++) w[(k * TEMPLATE_FRAMES + t) * F + j] = this.spec[(at + t) * F + j] + 1e-3
    }
    this.templates = { K: COMPONENTS, T: TEMPLATE_FRAMES, F, w }
    this.act = Array.from({ length: COMPONENTS }, () => new Float32Array(this.raw[0].length))
    this.normalizeTemplates()
    this.seedActivations(0, n)
    this.windowed(0, n, (v, m, h) => factorize(this.templates!, v, m, h, LEARN_ITERATIONS))
    this.fittedTo = n
  }

  private normalizeTemplates(): void {
    normalize(this.templates!, new Float32Array(COMPONENTS), 1)
  }

  /** Fits frames [from, to) with the templates held, the FIT_CONTEXT frames before them held as they are. */
  private fit(from: number, to: number): void {
    this.seedActivations(from, to)
    const start = Math.max(0, from - FIT_CONTEXT)
    this.windowed(start, to, (v, n, h) => fitActivations(this.templates!, v, n, h, FIT_ITERATIONS, from - start))
  }

  /** Refines the templates on the LEARN_SEC before frame `to`, from where they are. */
  private relearn(to: number): void {
    const from = Math.max(0, to - Math.round(LEARN_SEC / HOP_SEC))
    this.windowed(from, to, (v, n, h) => factorize(this.templates!, v, n, h, RELEARN_ITERATIONS))
  }

  /** The instances of template `k` peaking in frames [from, to). */
  private peaks(k: number, from: number, to: number, strongest: number): Instance[] {
    const tpl = this.templates!
    const h = this.act[k]
    const out: Instance[] = []
    // The template's own bands, and its loudest frame (its level is read there).
    const power = new Float32Array(F)
    let loudPower = -1
    for (let t = 0; t < TEMPLATE_FRAMES; t++) {
      let p = 0
      for (let j = 0; j < F; j++) { const x = tpl.w[(k * TEMPLATE_FRAMES + t) * F + j]; power[j] += x * x; p += x * x }
      if (p > loudPower) loudPower = p
    }
    let top = 0
    for (let j = 0; j < F; j++) top = Math.max(top, power[j])
    const own: number[] = []
    for (let j = 0; j < F; j++) if (power[j] >= top * dbToPower(-MASK_RANGE_DB)) own.push(j)
    for (let i = Math.max(0, from); i < to; i++) {
      const a = h[i]
      if (a < strongest * PEAK_FLOOR) continue
      let peak = true
      for (let d = 1; d <= PEAK_HOPS && peak; d++) {
        if (i - d >= 0 && h[i - d] >= a) peak = false
        if (i + d < this.fittedTo && h[i + d] > a) peak = false
      }
      if (!peak) continue
      let low = Infinity
      for (let d = 1; d <= PEAK_BACK && i - d >= 0; d++) low = Math.min(low, h[i - d])
      if (low !== Infinity && a < PEAK_RISE * low) continue
      // Intensity: the template's loudest frame at this activation, as dBFS.
      const db = 10 * Math.log10(1e-12 + (a * a * loudPower) / (FULL_SCALE * FULL_SCALE))
      const intensity = Math.min(1, Math.max(0, (db - INTENSITY_FLOOR_DB) / -INTENSITY_FLOOR_DB))
      if (intensity <= 0) continue
      // Match: the share of the music in the template's bands, over its span, that the template explains,
      // with everything its activation contributes there (an activation is spread over a few frames).
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
      const hop = i - FRAME_LAG
      out.push({ frame: i, time: this.timeOf(hop), signal: k, match, intensity })
    }
    return out
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
      for (let b = 0; b < BAND_COUNT; b++) if (balance[b] >= -MASK_RANGE_DB) mask |= 1 << b
      const shape = BANDS.map(() => new Float32Array(SHAPE_HOPS))
      const list = byK.get(k) ?? []
      let weight = 0
      for (const x of list) {
        const print = this.printAt(x.frame - FRAME_LAG)
        for (let b = 0; b < BAND_COUNT; b++) for (let s = 0; s < SHAPE_HOPS; s++) shape[b][s] += x.match * print[b].shape[s]
        weight += x.match
      }
      if (weight > 0) for (const s of shape) for (let i = 0; i < SHAPE_HOPS; i++) s[i] /= weight
      this.signals.push({ id: k, mask, balance, shape, kick: false, hit: false })
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
   * - KICK: two bands or more, mostly low (LOW_SHARE of its power in the
   *   50Hz and 100Hz bands), with something a kick has and a bass note does
   *   not: a beater CLICK (a band from 800Hz to 3.2kHz within CLICK_DB of the
   *   top, gone within CLICK_HOPS), a falling pitch (SWEEP: its upper low
   *   bands dying SWEEP_DB faster than its lowest) or a percussive DECAY. And
   *   no more than KICK_PER_BEAT.
   * - HIT: a BODY (see BODY_DB) carried on noise (at least NOISE_BANDS bands
   *   from 800Hz up, one of them at or above 3.2kHz), and no more than
   *   HIT_PER_BEAT.
   */
  private flag(): void {
    const times = new Map<number, number[]>()
    for (const x of this.instances) { const l = times.get(x.signal) ?? []; l.push(x.time); times.set(x.signal, l) }
    for (const s of this.signals) {
      const list = times.get(s.id) ?? []
      if (list.length < MIN_FLAG_INSTANCES) continue
      const beats = this.beats.beatsBetween(list[0] - 2, list[list.length - 1] + 2)
      if (beats.length < 2) continue
      const grid: number[] = []
      for (let i = 0; i + 1 < beats.length; i++) {
        for (let k = 0; k < GRID_DIVISIONS; k++) grid.push(beats[i] + ((beats[i + 1] - beats[i]) * k) / GRID_DIVISIONS)
      }
      grid.push(beats[beats.length - 1])
      const onGrid = list.filter((t) => nearest(grid, t) <= ON_GRID_SEC).length / list.length >= ON_GRID_SHARE
      if (!onGrid || patternShare(list, beats) < PATTERN_SHARE) continue
      const spanBeats = Math.max(1, beats.filter((t) => t >= list[0] && t <= list[list.length - 1]).length)
      const perBeat = list.length / spanBeats
      const bands = bandsOf(s.mask)
      // A click is the top of the sound falling away above it; a hat landing with a bass note climbs toward 12.8kHz instead.
      let above = -Infinity
      for (const b of bands) if (BANDS[b] > 3200) above = Math.max(above, s.balance[b])
      const click = bands.some((b) => BANDS[b] >= 800 && BANDS[b] <= 3200 && s.balance[b] >= CLICK_DB && s.balance[b] >= above && s.shape[b][CLICK_HOPS] <= -CLICK_FALL_DB)
      const lows = bands.filter((b) => BANDS[b] <= 200)
      const swept = lows.filter((b) => s.balance[b] >= SWEEP_LEVEL_DB)
      const sweep = swept.length >= 2 && s.shape[swept[swept.length - 1]][SWEEP_HOPS] <= s.shape[swept[0]][SWEEP_HOPS] - SWEEP_DB
      let lowTop = -1
      for (const b of lows) if (lowTop < 0 || s.balance[b] > s.balance[lowTop]) lowTop = b
      const percussive = lowTop >= 0 && s.shape[lowTop][SHAPE_HOPS - 1] <= -DECAY_DB
      const low = this.shareIn(s, 0, LOW_TOP_HZ) >= LOW_SHARE || (this.shareIn(s, 0, 250) >= LOW_SHARE && sweep)
      s.kick = bands.length >= 2 && low && (click || sweep || percussive) && perBeat <= KICK_PER_BEAT
      let bright = -Infinity
      for (const b of bands) if (BANDS[b] >= 800) bright = Math.max(bright, s.balance[b])
      let bodyBand = -1
      for (const b of bands) if (BANDS[b] >= 800 && BANDS[b] <= 3200 && (bodyBand < 0 || s.balance[b] > s.balance[bodyBand])) bodyBand = b
      const body = bodyBand >= 0 && s.balance[bodyBand] - bright >= BODY_DB && s.balance[bodyBand] >= BODY_TOP_DB && s.shape[bodyBand][BODY_SUSTAIN_HOPS] >= BODY_SUSTAIN_DB && s.shape[bodyBand][SHAPE_HOPS - 1] <= -BODY_DECAY_DB
      const noise = bands.filter((b) => BANDS[b] >= 800).length >= NOISE_BANDS && bands.some((b) => BANDS[b] >= 3200)
      s.hit = body && noise && perBeat <= HIT_PER_BEAT
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
      this.act = Array.from({ length: COMPONENTS }, () => new Float32Array(this.raw[0].length))
    }
    while (this.fittedTo < ready) {
      const to = Math.min(ready, this.fittedTo + relearnFrames)
      this.fit(this.fittedTo, to)
      if (to - this.fittedTo === relearnFrames) this.relearn(to)
      this.fittedTo = to
    }
    const final = this.instances.filter((x) => x.time <= this.heardTime)
    const lastFinal = final.reduce((m, x) => Math.max(m, x.frame), -1)
    const fresh: Instance[] = []
    for (let k = 0; k < COMPONENTS; k++) {
      let strongest = 0
      for (let i = 0; i < this.fittedTo; i++) strongest = Math.max(strongest, this.act[k][i])
      for (const x of this.peaks(k, lastFinal + 1, this.fittedTo, strongest)) if (x.time > this.heardTime) fresh.push(x)
    }
    this.instances = [...final, ...fresh].sort((a, b) => a.time - b.time)
    this.describe()
    this.flag()
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
    for (const x of this.instances) {
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

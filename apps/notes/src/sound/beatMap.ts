/**
 * The ROLLING BEAT MAP: every beat of the music around the listener, and
 * which of them is the ONE of its bar, planned from the decoded track up to
 * `MAP_AHEAD_SEC` ahead, so the caret's pulse lands on each beat by design
 * rather than steering toward a tempo after the fact. Built in the analysis
 * worker (`musicAnalysis.ts`) from the same decoded samples as everything
 * else, and bounded in memory to a window of `MAP_BEHIND_SEC` +
 * `MAP_AHEAD_SEC` whatever the track's length.
 *
 * It is a BAR-POINTER tracker (Whiteley, Cemgil and Godsill 2006; the state
 * space of Krebs, Böck and Widmer 2015): a hidden state is a tempo and a
 * position inside a four-beat bar, the state advances one position per
 * frame, and a Viterbi pass finds the one path of states that best explains
 * the music. Tempo, beat and bar are therefore decided TOGETHER, which is
 * what keeps the beat off the off-beat and the one off beat three.
 *
 * 1. FEATURES, one frame every 1/`FRAME_RATE` s, from one short-time
 *    spectrum: how much each of three bands rose since the frame before
 *    (spectral flux, half-wave rectified, on a log magnitude): LOW (a kick,
 *    a bass note), SHARP (a snare, a clap: what cuts through) and ALL (every
 *    onset, the hats included); plus HARMONY, how much the bass register's
 *    spectrum differs between the quarter second after the frame and the
 *    quarter second before (a chord or bass note changing). Each feature is
 *    normalised against its own spread over the `NORM_SEC` before it, so the
 *    weights below mean the same thing in a quiet intro and a loud drop.
 * 2. WHAT A BAR SOUNDS LIKE, scored at each beat of the path: low on beats
 *    one and three, sharp on two and four (the backbeat every genre here
 *    shares), every onset on each beat AND each half beat (so hats hold the
 *    tempo through a hats-only intro without pulling the beat onto the
 *    off-beat, which an on-beat-only weight did in house), and harmony on
 *    the one (which is what tells beat one from beat three, the two being
 *    alike in drums alone).
 * 3. THE PATH: each beat may change the tempo by a little, at a cost of
 *    `TEMPO_CHANGE_COST` per octave, and pays a log-Gaussian prior around
 *    `PRIOR_BPM`. The cost is what stops a broken beat being read as a
 *    4:3 of itself for a few bars; a DJ's slow pitch ramp costs almost
 *    nothing and is followed.
 *
 * The forward pass runs once per frame as the track is decoded; the path is
 * read back from the far end of what is decoded every `REPLAN_SEC`, so every
 * beat is placed knowing the music on both sides of it. Beats are COMMITTED
 * once within `COMMIT_SEC` of the listener and never move again; the read
 * back stops at the last committed beat.
 *
 * WHERE THERE IS A BEAT: the path always has beats, so each carries a
 * CONFIDENCE, the median of its own and its neighbours' bar scores: a median, because a few loud events at random moments score high on whatever path crosses them, while a pulse scores on most of its beats. A beat is
 * shown when it is confident, or when it lies in a gap of unconfident beats
 * no longer than `GLIDE_MAX_SEC` between two confident ones (a break or a
 * silence is carried on the beat); a longer gap, or a passage with no pulse,
 * has none and the caret blinks there.
 */

/** How far ahead of the listener the map is planned, and the drum score written from it (`drumScore.ts`). */
export const MAP_AHEAD_SEC = 60
/** How far behind the listener the map keeps what it planned. */
export const MAP_BEHIND_SEC = 30
/** Beats this close to the listener (or behind it) are final. */
export const COMMIT_SEC = 2
/** The longest stretch of unconfident beats carried through between two confident ones. */
export const GLIDE_MAX_SEC = 16
/** The caret's tempo range, in beats a minute: from CARET_MIN_BPM up to but not including twice it. */
export const CARET_MIN_BPM = 70

/** Feature frames a second. */
const FRAME_RATE = 100
/** The spectrum's length in samples at 48 kHz (scaled with the sample rate): about 43 ms. */
const FFT_SIZE_48K = 2048
/**
 * How long after the centre of the spectrum whose flux it peaks an onset happened. The log magnitude takes most of a
 * transient's rise as soon as it enters the window, so the flux peaks while the onset is still in the window's later
 * half: an impulse fed through these features peaks the flux 9 to 16 ms (the frame's quantisation) before it, 12 ms
 * on average.
 */
const ONSET_DELAY_SEC = 0.012
/** The bands, in Hz. */
const LOW_BAND: readonly [number, number] = [30, 150]
const SHARP_BAND: readonly [number, number] = [1000, 8000]
const ALL_BAND: readonly [number, number] = [30, 16000]
const HARMONY_BAND: readonly [number, number] = [40, 500]
/** Only the drum score's (`drumScore.ts`): the hats and shakers above a snare's body. */
const TICK_BAND: readonly [number, number] = [8000, 16000]
/** How far either side of a frame its harmony compares, in seconds. */
const HARMONY_SEC = 0.25
/** How far back from a frame its features are normalised over, in seconds. */
const NORM_SEC = 8
/** The tempos considered, in beats a minute. */
const MIN_BPM = 70
const MAX_BPM = 180
/** The tempo prior: a log-Gaussian in octaves around this, weighted by TEMPO_PRIOR_WEIGHT per beat. */
const PRIOR_BPM = 120
const TEMPO_PRIOR_WEIGHT = 2
/** What changing tempo costs at a beat, per octave of change. */
const TEMPO_CHANGE_COST = 100
/** The most a beat may change the period by, in frames. */
const TEMPO_STEP_FRAMES = 2
/** Weights of the bar's score (see the overview): every onset at each beat and half beat, harmony on the one. */
const TICK_WEIGHT = 0.5
/** How much a beat's drum score loses for the OTHER drum sounding there: a kick on the backbeat or a snare on the one counts against the bar. */
const CONTRAST = 0.5
const HARMONY_WEIGHT = 1
/** A beat's confidence is the median of its bar score over this many beats either side, and it is confident at this. */
const CONFIDENCE_BEATS = 8
/** How many beats either side a beat's time is smoothed over (`smooth`). */
const SMOOTH_BEATS = 4
const MIN_CONFIDENCE = 0.5
/** How much more of the track must be decoded before the path is read back again. */
const REPLAN_SEC = 1
/** A feature's spread below this is silence: it is 0 there rather than amplified noise. */
const MIN_SPREAD = 1e-3

/** One planned beat: its media time, whether it is final, and whether it is the one of its bar. */
export interface MapBeat {
  time: number
  committed: boolean
  one: boolean
  /** Its place in its bar, 0 (the one) to 3. */
  position: number
}

/**
 * The onset features the drum score reads (`drumScore.ts`): per BAND (`OnsetBand`), each frame's RISE, how much the
 * band's total amplitude (the root of its summed linear power) grew since the frame before, 0 where it fell. Total
 * and linear on purpose, unlike the beat map's own flux (per bin, on a log spectrum): a drum is a burst of energy
 * whatever its pitch, so a toneless kick repeating at one pitch rises as much as one that starts a bass note, a bass
 * line moving between notes (energy leaving one bin for another) barely rises at all, and a hit at a quarter of the
 * volume rises a quarter as much.
 */
export interface OnsetFeatures {
  /** The first frame still held and one past the last normalised. */
  frames(): readonly [number, number]
  /** The media time of an onset peaking at `frame`, and the frame nearest an onset at `time`. */
  timeOf(frame: number): number
  frameOf(time: number): number
  rise(band: OnsetBand, frame: number): number
}

/** The bands an onset is read in: LOW (a kick, a bass note), SHARP (a snare, a clap), TICK (hats, shakers). */
export type OnsetBand = 0 | 1 | 2

/** The caret's beat at a moment: how far into it, 0..1, and its period (s); NaN for both where there is none. */
export interface CaretBeat {
  phase: number
  period: number
}

/** A beat of the path: its frame and time, its place in the bar (0 is the one), its bar score and whether it is shown. */
interface PathBeat {
  frame: number
  /** Its media time: the frame's, smoothed over its neighbours (`smooth`). */
  time: number
  position: number
  score: number
  shown: boolean
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const r = re[i]
      re[i] = re[j]
      re[j] = r
      const m = im[i]
      im[i] = im[j]
      im[j] = m
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr
        im[b] = im[a] - vi
        re[a] += vr
        im[a] += vi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

export class BeatMap {
  private readonly hop: number
  private readonly size: number
  private readonly frameSec: number
  private readonly window: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  /** The last `size` samples, a ring, and how many samples were fed in all. */
  private readonly samples: Float32Array
  private fed = 0
  /** Media time of sample 0. */
  private origin = NaN
  private readonly bins: {
    low: [number, number]
    sharp: [number, number]
    all: [number, number]
    harmony: [number, number]
    tick: [number, number]
  }
  private previous: Float64Array
  private current: Float64Array
  /** Frames of every ring below; frame f lives at f % capacity. */
  private readonly capacity: number
  /** Raw features (low, sharp, all, harmony, tick), the harmony band's spectrum per frame, and the normalised features. */
  private readonly raw: Float32Array[]
  /** The drum score's rises per `OnsetBand` (`OnsetFeatures`), and each band's amplitude at the last frame. */
  private readonly rises: Float32Array[]
  private readonly amplitude = [0, 0, 0]
  private readonly spectrum: Float32Array
  private readonly z: Float32Array[]
  /** Frames with a spectrum, frames with harmony, frames normalised, frames through the forward pass. */
  private spectra = 0
  private harmonised = 0
  private normalised = 0
  private passed = 0
  private readonly harmonyFrames: number
  private readonly normFrames: number
  /** The state space: periods minPeriod..minPeriod+periods-1 frames, each with 4 * period positions from `offsets[i]`. */
  private readonly minPeriod: number
  private readonly periods: number
  private readonly offsets: Int32Array
  private readonly prior: Float64Array
  private score: Float64Array
  private nextScore: Float64Array
  /** For each frame, period and beat in the bar: the period index the beat was entered from. */
  private readonly back: Int16Array
  /** Committed beats then planned ones, in order; `committedCount` counts every beat ever committed. */
  private committed: PathBeat[] = []
  private committedCount = 0
  private planned: PathBeat[] = []
  private plannedAt = -Infinity
  /** Counts the plans read back: the beats can have moved only when it has changed. */
  revision = 0

  constructor(readonly sampleRate: number) {
    this.hop = Math.max(1, Math.round(sampleRate / FRAME_RATE))
    this.frameSec = this.hop / sampleRate
    this.size = 2 ** Math.round(Math.log2((FFT_SIZE_48K * sampleRate) / 48000))
    this.window = new Float64Array(this.size)
    for (let i = 0; i < this.size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.size)
    this.re = new Float64Array(this.size)
    this.im = new Float64Array(this.size)
    this.samples = new Float32Array(this.size)
    const bin = (hz: number) => Math.min(this.size / 2, Math.max(1, Math.round((hz * this.size) / sampleRate)))
    const band = (b: readonly [number, number]): [number, number] => [bin(b[0]), bin(b[1])]
    this.bins = {
      low: band(LOW_BAND),
      sharp: band(SHARP_BAND),
      all: band(ALL_BAND),
      harmony: band(HARMONY_BAND),
      tick: band(TICK_BAND),
    }
    this.previous = new Float64Array(this.bins.all[1])
    this.current = new Float64Array(this.bins.all[1])
    const fps = 1 / this.frameSec
    this.harmonyFrames = Math.max(1, Math.round(HARMONY_SEC * fps))
    this.normFrames = Math.round(NORM_SEC * fps)
    this.capacity = Math.ceil((MAP_AHEAD_SEC + MAP_BEHIND_SEC + 2 * NORM_SEC + GLIDE_MAX_SEC + 10) * fps)
    this.raw = [0, 1, 2, 3].map(() => new Float32Array(this.capacity))
    this.z = [0, 1, 2, 3].map(() => new Float32Array(this.capacity))
    this.rises = [0, 1, 2].map(() => new Float32Array(this.capacity))
    this.spectrum = new Float32Array(this.capacity * (this.bins.harmony[1] - this.bins.harmony[0]))
    this.minPeriod = Math.round((60 * fps) / MAX_BPM)
    const maxPeriod = Math.round((60 * fps) / MIN_BPM)
    this.periods = maxPeriod - this.minPeriod + 1
    this.offsets = new Int32Array(this.periods + 1)
    for (let i = 0; i < this.periods; i++) this.offsets[i + 1] = this.offsets[i] + 4 * (this.minPeriod + i)
    this.prior = new Float64Array(this.periods)
    for (let i = 0; i < this.periods; i++) this.prior[i] = TEMPO_PRIOR_WEIGHT * Math.log2((60 * fps) / (this.minPeriod + i) / PRIOR_BPM) ** 2
    this.score = new Float64Array(this.offsets[this.periods])
    this.nextScore = new Float64Array(this.offsets[this.periods])
    this.back = new Int16Array(this.capacity * this.periods * 4)
  }

  /**
   * The media time an onset that peaks the flux at frame `frame` happened: the centre of its spectrum, plus
   * ONSET_DELAY_SEC.
   */
  private timeOf(frame: number): number {
    return this.origin + (frame * this.hop + this.size / 2) / this.sampleRate + ONSET_DELAY_SEC
  }

  /** Takes decoded mono `samples`, the first at media time `startTime`, contiguous with what came before. */
  feed(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    for (let i = 0; i < samples.length; i++) {
      this.samples[this.fed % this.size] = samples[i]
      this.fed++
      if (this.fed >= this.size && (this.fed - this.size) % this.hop === 0) this.addSpectrum()
    }
  }

  private addSpectrum(): void {
    const f = this.spectra
    const start = this.fed - this.size
    for (let i = 0; i < this.size; i++) {
      this.re[i] = this.samples[(start + i) % this.size] * this.window[i]
      this.im[i] = 0
    }
    fft(this.re, this.im)
    const top = this.bins.all[1]
    for (let k = 0; k < top; k++) this.current[k] = Math.log1p(100 * Math.hypot(this.re[k], this.im[k]))
    const flux = (b: [number, number]) => {
      let d = 0
      if (f > 0) for (let k = b[0]; k < b[1]; k++) d += Math.max(0, this.current[k] - this.previous[k])
      return d
    }
    const at = f % this.capacity
    this.raw[0][at] = flux(this.bins.low)
    this.raw[1][at] = flux(this.bins.sharp)
    this.raw[2][at] = flux(this.bins.all)
    // The drum score's rises (`OnsetFeatures`), from the same spectrum, linear.
    const drumBands = [this.bins.low, this.bins.sharp, this.bins.tick]
    for (let b = 0; b < 3; b++) {
      let power = 0
      for (let k = drumBands[b][0]; k < drumBands[b][1]; k++) power += this.re[k] * this.re[k] + this.im[k] * this.im[k]
      const amplitude = Math.sqrt(power)
      this.rises[b][at] = f > 0 ? Math.max(0, amplitude - this.amplitude[b]) : 0
      this.amplitude[b] = amplitude
    }
    const [h0, h1] = this.bins.harmony
    for (let k = h0; k < h1; k++) this.spectrum[at * (h1 - h0) + k - h0] = this.current[k]
    const swap = this.previous
    this.previous = this.current
    this.current = swap
    this.spectra++
    this.advance()
  }

  /** Brings harmony, normalisation and the forward pass as far as the spectra allow. */
  private advance(): void {
    const H = this.harmonyFrames
    const [h0, h1] = this.bins.harmony
    const width = h1 - h0
    // Harmony of frame g needs spectra g-H .. g+H-1.
    for (; this.harmonised + H <= this.spectra; this.harmonised++) {
      const g = this.harmonised
      let d = 0
      if (g >= H) {
        for (let k = 0; k < width; k++) {
          let after = 0
          let before = 0
          for (let j = 0; j < H; j++) {
            after += this.spectrum[((g + j) % this.capacity) * width + k]
            before += this.spectrum[((g - H + j) % this.capacity) * width + k]
          }
          d += Math.abs(after - before) / H
        }
      }
      this.raw[3][g % this.capacity] = d
    }
    // A frame is normalised against the NORM_SEC before it: what came before only, so the map is never NORM_SEC short of
    // the decoded frontier (a track's last seconds would otherwise have no beat).
    const W = this.normFrames
    for (; this.normalised < this.harmonised; this.normalised++) {
      const f = this.normalised
      const lo = Math.max(0, f - W, this.harmonised - this.capacity)
      const hi = f
      for (let b = 0; b < this.raw.length; b++) {
        const x = this.raw[b]
        let s1 = 0
        let s2 = 0
        for (let j = lo; j <= hi; j++) {
          const v = x[j % this.capacity]
          s1 += v
          s2 += v * v
        }
        const n = hi - lo + 1
        const mean = s1 / n
        const spread = Math.sqrt(Math.max(0, s2 / n - mean * mean))
        this.z[b][f % this.capacity] = spread < MIN_SPREAD ? 0 : (x[f % this.capacity] - mean) / spread
      }
    }
    // The pass reads each feature's largest value within a frame either side: a beat and its onset's peak may straddle two frames.
    for (; this.passed + 1 < this.normalised; this.passed++) this.step(this.passed)
  }

  /** The feature `b` at frame `f`, the largest within a frame either side. */
  private feature(b: number, f: number): number {
    const z = this.z[b]
    let most = z[f % this.capacity]
    if (f > 0) most = Math.max(most, z[(f - 1) % this.capacity])
    return Math.max(most, z[(f + 1) % this.capacity])
  }

  /** The bar's score for a beat at `position` (0 is the one) at frame `f`. */
  private beatScore(f: number, position: number): number {
    const low = this.feature(0, f)
    const sharp = this.feature(1, f)
    const drum = position % 2 === 0 ? low - CONTRAST * sharp : sharp - CONTRAST * low
    return drum + TICK_WEIGHT * this.feature(2, f) + (position === 0 ? HARMONY_WEIGHT * this.feature(3, f) : 0)
  }

  /** One frame of the forward pass. */
  private step(f: number): void {
    const { score, nextScore, offsets, minPeriod, periods } = this
    const tick = TICK_WEIGHT * this.feature(2, f)
    // Inside a beat every state moves one position on; the half beat collects the tick.
    for (let i = 0; i < periods; i++) {
      const T = minPeriod + i
      const half = T >> 1
      const base = offsets[i]
      for (let m = 4 * T - 1; m >= 1; m--) {
        const r = m % T
        if (r !== 0) nextScore[base + m] = score[base + m - 1] + (r === half ? tick : 0)
      }
    }
    // A beat is entered from the end of the beat before, at a period up to TEMPO_STEP_FRAMES away.
    const backAt = (f % this.capacity) * periods * 4
    for (let k = 0; k < 4; k++) {
      const observed = this.beatScore(f, k)
      for (let j = 0; j < periods; j++) {
        const T2 = minPeriod + j
        let best = -Infinity
        let from = j
        for (let i = Math.max(0, j - TEMPO_STEP_FRAMES); i <= Math.min(periods - 1, j + TEMPO_STEP_FRAMES); i++) {
          const T = minPeriod + i
          const end = offsets[i] + (k === 0 ? 4 * T : k * T) - 1
          const s = score[end] - TEMPO_CHANGE_COST * Math.abs(Math.log2(T2 / T))
          if (s > best) {
            best = s
            from = i
          }
        }
        nextScore[offsets[j] + k * T2] = best + observed - this.prior[j]
        this.back[backAt + j * 4 + k] = from
      }
    }
    this.score = nextScore
    this.nextScore = score
    // Only differences matter; keep the numbers small.
    if (f % 512 === 0) {
      let most = -Infinity
      for (let s = 0; s < this.score.length; s++) if (this.score[s] > most) most = this.score[s]
      for (let s = 0; s < this.score.length; s++) this.score[s] -= most
    }
  }

  /**
   * Brings the plan up to date for a listener at `listenerTime`: the path
   * read back again once REPLAN_SEC more is decoded, and every beat within
   * COMMIT_SEC of the listener committed.
   */
  update(listenerTime: number): void {
    if (Number.isNaN(this.origin)) return
    this.trim(listenerTime)
    // Re-planned once REPLAN_SEC more has passed, or on any new frame once the listener is near the frontier (the end of
    // a track, where the last fraction of a REPLAN_SEC would otherwise never be planned).
    const at = (this.passed - 1) * this.frameSec
    const nearFrontier = this.timeOf(this.passed - 1) < listenerTime + COMMIT_SEC + REPLAN_SEC
    if (this.passed > 0 && (at >= this.plannedAt + REPLAN_SEC || (nearFrontier && at > this.plannedAt))) {
      this.plannedAt = at
      this.plan()
    }
    this.commit(listenerTime)
  }

  /** Forgets what lies further behind the listener than MAP_BEHIND_SEC, keeping a bar to count the ones from. */
  private trim(listenerTime: number): void {
    const keepFrom = listenerTime - MAP_BEHIND_SEC
    while (this.committed.length > 4 && this.committed[0].time < keepFrom) this.committed.shift()
  }

  /** Reads the best path back from the last frame passed to the last committed beat, and judges where it is shown. */
  private plan(): void {
    const last = this.passed - 1
    let bestPeriod = 0
    let bestPosition = 0
    let best = -Infinity
    for (let i = 0; i < this.periods; i++) {
      for (let m = 0; m < 4 * (this.minPeriod + i); m++) {
        const s = this.score[this.offsets[i] + m]
        if (s > best) {
          best = s
          bestPeriod = i
          bestPosition = m
        }
      }
    }
    const anchor = this.committed.length > 0 ? this.committed[this.committed.length - 1].frame : -1
    const oldest = Math.max(0, this.passed - this.capacity + 1)
    const path: PathBeat[] = []
    let f = last
    let i = bestPeriod
    let m = bestPosition
    for (;;) {
      const T = this.minPeriod + i
      const k = Math.floor(m / T)
      f -= m - k * T
      // A path read from a later frontier may place the committed beat a frame or two away: that is the same beat.
      if (f <= anchor + (this.minPeriod >> 1) || f < oldest) break
      path.push({
        frame: f,
        time: NaN,
        position: k,
        score: this.beatScore(f, k),
        shown: false,
      })
      const from = this.back[(f % this.capacity) * this.periods * 4 + i * 4 + k]
      const T0 = this.minPeriod + from
      i = from
      m = (k === 0 ? 4 * T0 : k * T0) - 1
      f -= 1
    }
    path.reverse()
    this.smooth(path)
    this.judge(path)
    this.planned = path
    this.revision++
  }

  /**
   * Gives each beat of `path` its time: the least-squares quadratic (so a ritardando is not cut short) through the frame times of the SMOOTH_BEATS beats
   * either side, read at the beat. A frame is 1/FRAME_RATE s and a period a whole number of frames, so a path at a
   * tempo between two periods alternates them, a frame early then a frame late; the fit puts each beat where the
   * tempo around it does. The committed beats before the path take part as neighbours and keep their times.
   */
  private smooth(path: PathBeat[]): void {
    const all = [...this.committed, ...path]
    const from = this.committed.length
    for (let at = from; at < all.length; at++) {
      const lo = Math.max(0, at - SMOOTH_BEATS)
      const hi = Math.min(all.length - 1, at + SMOOTH_BEATS)
      // Centred on the beat for conditioning: y = a + b x + c x^2 with x = j - at, and a is the answer.
      const y0 = this.timeOf(all[at].frame)
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0,
        s4 = 0,
        t0 = 0,
        t1 = 0,
        t2 = 0
      for (let j = lo; j <= hi; j++) {
        const x = j - at
        const y = this.timeOf(all[j].frame) - y0
        const x2 = x * x
        s0 += 1
        s1 += x
        s2 += x2
        s3 += x2 * x
        s4 += x2 * x2
        t0 += y
        t1 += x * y
        t2 += x2 * y
      }
      const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2)
      const a = t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2)
      all[at].time = y0 + (Math.abs(det) < 1e-9 ? 0 : a / det)
    }
  }

  /** Marks each beat of `path` shown or not, reading the committed beats before it as context. */
  private judge(path: PathBeat[]): void {
    const all = [...this.committed, ...path]
    const from = this.committed.length
    const confident = all.map((_, at) => {
      const lo = Math.max(0, at - CONFIDENCE_BEATS)
      const hi = Math.min(all.length - 1, at + CONFIDENCE_BEATS)
      const scores: number[] = []
      for (let j = lo; j <= hi; j++) scores.push(all[j].score)
      scores.sort((a, b) => a - b)
      return scores[scores.length >> 1] >= MIN_CONFIDENCE
    })
    const glide = GLIDE_MAX_SEC / this.frameSec
    let before = -Infinity
    for (let at = 0; at < all.length; at++) if (confident[at] && at < from) before = all[at].frame
    for (let at = from; at < all.length; at++) {
      if (confident[at]) {
        path[at - from].shown = true
        before = all[at].frame
        continue
      }
      let after = Infinity
      for (let j = at + 1; j < all.length && all[j].frame - all[at].frame <= glide; j++) {
        if (confident[j]) {
          after = all[j].frame
          break
        }
      }
      path[at - from].shown = after - before <= glide
    }
  }

  private commit(listenerTime: number): void {
    const limit = listenerTime + COMMIT_SEC
    let taken = 0
    while (taken < this.planned.length && this.planned[taken].time <= limit) taken++
    if (taken === 0) return
    for (let j = 0; j < taken; j++) this.committed.push(this.planned[j])
    this.committedCount += taken
    this.planned = this.planned.slice(taken)
  }

  /**
   * The shown beats either side of media time `time` (the last at or before
   * it and the first after it, committed or planned) or NaN where there is
   * none, the NUMBER of the one before (beats counted since the map began),
   * and its place in its bar (0 is the one).
   */
  beatsAround(time: number): {
    previous: number
    next: number
    index: number
    position: number
  } {
    const none = { previous: NaN, next: NaN, index: NaN, position: NaN }
    const all = this.committed.length + this.planned.length
    const at = (j: number) => (j < this.committed.length ? this.committed[j] : this.planned[j - this.committed.length])
    let before = -1
    for (let j = 0; j < all; j++) {
      if (at(j).time <= time) before = j
      else break
    }
    if (before < 0 || before + 1 >= all) return none
    const a = at(before)
    const b = at(before + 1)
    if (!a.shown || !b.shown) return none
    return {
      previous: a.time,
      next: b.time,
      index: this.committedCount - this.committed.length + before,
      position: a.position,
    }
  }

  /**
   * The caret's beat at media time `time` (`CaretBeat`): the map's beat
   * there, folded to a power of two of itself inside CARET_MIN_BPM up to
   * twice it, counted from the bar's one, so a halved caret falls on one and
   * three and a doubled one on every half beat.
   */
  caretAt(time: number): CaretBeat {
    const { previous, next, position } = this.beatsAround(time)
    if (Number.isNaN(previous)) return { phase: NaN, period: NaN }
    const period = next - previous
    const scale = 2 ** -Math.floor(Math.log2(60 / period / CARET_MIN_BPM))
    const caret = (position + (time - previous) / period) * scale
    return { phase: caret - Math.floor(caret), period: period / scale }
  }

  /** The onset features, read in place (`OnsetFeatures`); valid until the next `feed`. */
  readonly onsets: OnsetFeatures = {
    frames: () => [Math.max(0, this.spectra - this.capacity + 1), this.normalised],
    timeOf: (frame) => this.timeOf(frame),
    frameOf: (time) => Math.round(((time - ONSET_DELAY_SEC - this.origin) * this.sampleRate - this.size / 2) / this.hop),
    rise: (band, frame) => this.rises[band][frame % this.capacity],
  }

  /** Every shown beat between `from` and `to`. */
  beatsBetween(from: number, to: number): MapBeat[] {
    const out: MapBeat[] = []
    const visit = (b: PathBeat, committed: boolean) => {
      const t = b.time
      if (b.shown && t >= from && t <= to) out.push({ time: t, committed, one: b.position === 0, position: b.position })
    }
    for (const b of this.committed) visit(b, true)
    for (const b of this.planned) visit(b, false)
    return out
  }
}

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
 * - A SIGNAL is one recurring sound. Its ARCHETYPE is the average of its
 *   instances' fingerprints, over the bands it occupies (its MASK). Its two
 *   flags, KICK and HIT, belong to the signal and not to an instance; a
 *   signal may carry one, both or neither (a kick and a snare that always
 *   land together are one signal carrying both).
 * - An INSTANCE is one occurrence: its time, its MATCH to the archetype
 *   (0..1, how closely its shape agrees) and its INTENSITY (0..1, linear in
 *   dB: 1 is 0 dBFS in the signal's bands, 0 is -60 dB or below).
 *
 * How the inventory is built:
 *
 * 1. PARSE. Nine octave bands (`BANDS`), each a two-stage band-pass, give a
 *    level in dB per hop (`HOP` samples, ~5.3ms). A band's RISE is how far
 *    its level climbs above its lowest over the last `RISE_HOPS`; an ONSET
 *    in a band is a rise of at least `RISE_DB` peaking there. Onsets in
 *    several bands within `JOIN_HOPS` of each other are one EVENT, whose
 *    FINGERPRINT is, per band, its peak level, its rise and its SHAPE: the
 *    level over the next `SHAPE_HOPS` relative to that peak.
 * 2. MATCH, PER BAND. An event is compared with each signal over that
 *    signal's mask only (`matchOf`), so energy in other bands, belonging to
 *    other sounds, does not count against it. The best signal at or above
 *    `NEW_SIGNAL_MATCH` takes the event and CLAIMS its mask's bands; the
 *    bands left unclaimed may be taken by another signal, so a kick layered
 *    with a snare counts for both. Onset bands nothing could take FOUND a new
 *    signal whose mask they are.
 * 3. ARCHETYPE. A signal's archetype is the mean of its instances'
 *    fingerprints, each weighted by its match, over every instance in the
 *    map, before and after: the first kick of a section is judged against
 *    the archetype its successors build.
 * 4. FLAG. Each signal is judged on its archetype's sound and on how its
 *    instances lie against the beat grid (`BeatPort`): a low body landing on
 *    beats is a kick, a bright body landing on beats or between them at no
 *    more than one a beat is a hit.
 *
 * The PATTERN is a second opinion inside the analysis, never a setting:
 * where a flagged signal has an instance a bar before and a bar after and
 * none between, the bar between is searched again without the onset floor
 * (`searchPredicted`), and an instance is added only where the sound itself
 * matches there. Whether a hit exists is the analysis's decision.
 *
 * Everything not yet heard is re-decided on every pass (`analyse`): events
 * are re-assigned against the archetypes as they now stand. Instances the
 * listener has passed are FINAL.
 */

/** The rate every figure here is tuned at; audio at another rate is resampled to it on the way in. */
export const SIGNAL_RATE = 48000
export const HOP = 256
export const HOP_SEC = HOP / SIGNAL_RATE

/** Octave band centres, in Hz. */
export const BANDS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800] as const
const BAND_COUNT = BANDS.length
const BAND_Q = Math.SQRT2
/** Hops a band's energy is averaged over: about two cycles of its centre, at least two hops. */
const ENVELOPE_HOPS = BANDS.map((hz) => Math.max(2, Math.ceil((2 * SIGNAL_RATE) / hz / HOP)))
/** Hops a rise is measured over (behind the envelope). */
const RISE_HOPS = 6
/** The least rise, in dB, that is an onset in a band. */
export const RISE_DB = 6
/** Bands below this level, in dB, are silence: no onset is read there. */
const SILENCE_DB = -70
/**
 * Bands beginning within this many hops of the event's first are the same
 * event (~32ms): a kick's falling pitch reaches its lower bands that much
 * after its click, and a sixteenth at 180 BPM is still 83ms.
 */
const JOIN_HOPS = 6
/**
 * The bands at and below 200Hz join for longer (~64ms): a kick's pitch falls
 * from a couple of hundred Hz into the sub, reaching the 50Hz band up to
 * some 60ms after its click. A bass note on the next eighth is further away
 * than this at any tempo up to 230 BPM.
 */
const LOW_JOIN_HOPS = 12
const LOW_JOIN_HZ = 200
const joinHopsOf = (b: number) => (BANDS[b] <= LOW_JOIN_HZ ? LOW_JOIN_HOPS : JOIN_HOPS)
/** Hops a fingerprint's shape spans, from the event's start: ~128ms. */
export const SHAPE_HOPS = 24
/** How far below its peak a shape is followed, in dB. */
const SHAPE_FLOOR_DB = -40
/** Intensity 0 is this level, in dB; 1 is 0 dBFS. */
export const INTENSITY_FLOOR_DB = -60

/**
 * The least match at which an event is an instance of an existing signal;
 * below it, it founds a new one. THE internal tuning factor of the inventory:
 * too strict and one sound splits into many signals that never gather enough
 * instances to be flagged, too loose and unlike sounds merge.
 */
export const NEW_SIGNAL_MATCH = 0.5
/** Assign-rebuild-merge rounds per analysis pass. */
const ROUNDS = 3
/** Two signals are one sound when their masks share this share of their bands and each archetype matches the other this well. */
const MERGE_OVERLAP = 0.5
const MERGE_MATCH = 0.7
/** The dB a band's shape may differ by, on average, for its shape score to fall to 1/e. */
const SHAPE_SCALE_DB = 6
/** The same for the balance between a signal's bands; a band's balance counts at most BALANCE_CAP_DB against it. */
const BALANCE_SCALE_DB = 6
const BALANCE_CAP_DB = 24
/** What a mask band that did not climb at all still counts for, before its weight. */
const ABSENT_FLOOR = 0.05
/** A band more than this many dB under an event's loudest onset band is not part of a new signal's mask: it is leakage or another sound's tail. */
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
 * dB of its loudest band from 800Hz up (a hat's power lies above the body;
 * the 400Hz band is left out because a kick's body leaks into it),
 * and still within BODY_SUSTAIN_DB of its peak BODY_SUSTAIN_HOPS later (~64ms:
 * a kick's beater click and a closed hat have died away by then, a snare's or
 * a clap's noise has not).
 */
const BODY_DB = -12
/** And within this many dB of the whole sound's loudest band: a faint upper edge of a low sound is not a body. */
const BODY_TOP_DB = -24
const BODY_SUSTAIN_HOPS = 12
const BODY_SUSTAIN_DB = -10
/** At most this many instances a beat for a hit; a hat plays on every eighth or sixteenth. */
const HIT_PER_BEAT = 1.1
/** How far either side of a predicted instance the pattern's second look searches, in hops (~32ms). */
const PREDICT_SEARCH_HOPS = 6
/** The least rise, in dB, the second look accepts: the sound must still arrive, but under a masking sound. */
const PREDICT_RISE_DB = 2

/** Where the beats fall: the beat times between two moments. A port, so the map does not own the beat grid. */
export interface BeatPort {
  beatsBetween(from: number, to: number): number[]
}

/** One band's part of a fingerprint. */
interface BandPrint {
  peakDb: number
  rise: number
  shape: Float32Array
}

/** One parsed onset event. */
interface MapEvent {
  hop: number
  time: number
  bands: BandPrint[]
  /** Bands whose rise made it an onset (or, for an event the pattern's second look found, the mask it was searched for). */
  onsetMask: number
  /** Signal ids this event is an instance of, with the match and intensity each. */
  assigned: Array<{ signal: number; match: number; intensity: number }>
  /** Heard: its assignment is final. */
  final: boolean
  /** Found by the pattern's second look, not by the onset floor. */
  predicted: boolean
}

/** A recurring sound. */
interface Signal {
  id: number
  mask: number
  /** Archetype per band (only mask bands meaningful): mean shape, mean balance (peak dB under the loudest mask band). */
  shape: Float32Array[]
  balance: Float64Array
  weight: number
  kick: boolean
  hit: boolean
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

/**
 * How much a band counts in a match, by its level under the archetype's
 * loudest: linear in dB, 1 at the top and nothing at WEIGHT_RANGE_DB below.
 * Not by power: white noise has most of its power in the top octaves, and a
 * snare would then be judged on its hiss alone, which a hat shares.
 */
function bandWeight(balanceDb: number): number {
  return Math.max(0, 1 + balanceDb / WEIGHT_RANGE_DB)
}
const WEIGHT_RANGE_DB = 40

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
  /** Per band, per hop since `firstHop`: the raw hop energy and the enveloped level in dB. */
  private raw: Float32Array[] = BANDS.map(() => new Float32Array(1 << 14))
  private level: Float32Array[] = BANDS.map(() => new Float32Array(1 << 14))
  /** Hop number of index 0 in the arrays, and the number of hops held. */
  private firstHop = 0
  private hops = 0
  private filled = 0
  /** Media time of hop 0. */
  private origin = NaN
  /** Hops up to which events have been parsed. */
  private parsedTo = 0
  /** Per band, the last local hop an event's join holds it for. */
  private busyUntil = new Array<number>(BAND_COUNT).fill(-Infinity)
  private events: MapEvent[] = []
  private signals: Signal[] = []
  private nextSignal = 0
  private heardTime = -Infinity

  constructor(private readonly beats: BeatPort) {}

  /** Media time of hop `hop`'s start. */
  private timeOf(hop: number): number {
    return this.origin + hop * HOP_SEC
  }

  /** The media time analysed up to: the look-ahead's front. */
  get frontier(): number {
    return Number.isNaN(this.origin) ? NaN : this.timeOf(this.firstHop + this.hops)
  }

  /** Forgets everything: a new track, or a seek outside what is held. */
  reset(): void {
    for (const f of this.filters) f.reset()
    this.firstHop = 0
    this.hops = 0
    this.filled = 0
    this.origin = NaN
    this.parsedTo = 0
    this.busyUntil.fill(-Infinity)
    this.events = []
    this.heardTime = -Infinity
    // Signals are kept across a seek in the same track (what was learned stays true); `forgetSignals` clears them for a new one.
  }

  /** Clears the learned signals, for a new track. */
  forgetSignals(): void {
    this.signals = []
    this.nextSignal = 0
  }

  /** Takes mono samples at SIGNAL_RATE, the first at media time `startTime`, contiguous with what came before (or the first after `reset`). */
  feed(samples: Float32Array, startTime: number): void {
    if (Number.isNaN(this.origin)) this.origin = startTime
    const filters = this.filters
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]
      for (let b = 0; b < BAND_COUNT; b++) filters[b].add(x)
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
      // Before the first hop is silence, so the first hops average as every other does.
      const span = ENVELOPE_HOPS[b]
      let sum = 0
      for (let k = 0; k < Math.min(span, index + 1); k++) sum += raw[index - k]
      // A full-scale sine in the band reads 0 dB (mean square 1/2).
      this.level[b][index] = 10 * Math.log10(1e-12 + (2 * sum) / span)
    }
    this.hops++
  }

  private grow(): void {
    const size = this.raw[0].length * 2
    this.raw = this.raw.map((a) => { const n = new Float32Array(size); n.set(a); return n })
    this.level = this.level.map((a) => { const n = new Float32Array(size); n.set(a); return n })
  }

  /** The band's rise at local hop `i`: its level over its lowest in the RISE_HOPS before its envelope. */
  private riseAt(b: number, i: number): number {
    if (i < 0) return 0
    const lv = this.level[b]
    const back = ENVELOPE_HOPS[b]
    if (lv[i] < SILENCE_DB) return 0
    // Before the first hop is silence, so a sound at the very start still climbs.
    let trough = Infinity
    for (let k = i - back - RISE_HOPS; k < i - back + 1; k++) trough = Math.min(trough, k < 0 ? SILENCE_DB : lv[k])
    return Math.max(0, lv[i] - trough)
  }

  /** The fingerprint of an event starting at local hop `start`, for every band. */
  private printAt(start: number): BandPrint[] {
    const out: BandPrint[] = []
    for (let b = 0; b < BAND_COUNT; b++) {
      const lv = this.level[b]
      // The band's own clock: its level lags the sound by its envelope.
      const from = start + ENVELOPE_HOPS[b] - 1
      let peakDb = -Infinity
      for (let k = from; k <= from + joinHopsOf(b); k++) peakDb = Math.max(peakDb, lv[k])
      let rise = 0
      for (let k = from - 1; k <= from + joinHopsOf(b); k++) rise = Math.max(rise, this.riseAt(b, k))
      const shape = new Float32Array(SHAPE_HOPS)
      for (let k = 0; k < SHAPE_HOPS; k++) shape[k] = Math.max(SHAPE_FLOOR_DB, lv[from + k] - peakDb)
      out.push({ peakDb, rise, shape })
    }
    return out
  }

  /**
   * Whether band `b` has an onset whose rise peaks at local hop `i`. A band's
   * level is averaged over ENVELOPE_HOPS[b], so its rise peaks that many hops
   * after the sound began: a 50Hz band's some 40ms after a click's.
   */
  private onsetAt(b: number, i: number): boolean {
    const r = this.riseAt(b, i)
    return r >= RISE_DB && r >= this.riseAt(b, i - 1) && r > this.riseAt(b, i + 1)
  }

  /** Parses every event whose fingerprint lies wholly inside what has been fed. */
  private parse(): void {
    const lag = Math.max(...ENVELOPE_HOPS)
    const last = this.hops - SHAPE_HOPS - LOW_JOIN_HOPS - 2 * lag
    let i = this.parsedTo
    // `i` is the hop a sound BEGINS at: band b shows its onset ENVELOPE_HOPS[b] - 1 hops later.
    while (i < last) {
      // A band an earlier event gathered is that event's until its join closes.
      const free = (b: number, j: number) => j > this.busyUntil[b]
      let mask = 0
      for (let b = 0; b < BAND_COUNT; b++) if (free(b, i) && this.onsetAt(b, i + ENVELOPE_HOPS[b] - 1)) mask |= 1 << b
      // The event starts at the first hop any band begins at, and gathers what begins in each band within its join of it.
      if (mask !== 0) {
        for (let b = 0; b < BAND_COUNT; b++) {
          for (let j = i + 1; j <= i + joinHopsOf(b) && !(mask & (1 << b)); j++) if (free(b, j) && this.onsetAt(b, j + ENVELOPE_HOPS[b] - 1)) mask |= 1 << b
        }
      }
      if (mask === 0) { i++; continue }
      const hop = this.firstHop + i
      this.events.push({ hop, time: this.timeOf(hop), bands: this.printAt(i), onsetMask: mask, assigned: [], final: false, predicted: false })
      // The next event may begin once the earliest join has closed; a band already gathered cannot start it again within its own join.
      for (let b = 0; b < BAND_COUNT; b++) if (mask & (1 << b)) this.busyUntil[b] = i + joinHopsOf(b)
      i += JOIN_HOPS + 1
    }
    this.parsedTo = Math.max(this.parsedTo, i)
  }

  /**
   * How closely `print` matches `signal`'s archetype over its mask, 0..1.
   * Each band counts by its level in the archetype (`bandWeight`), so a band
   * that carries little of the sound (a kick's faint top) cannot sink a match
   * on its own: per band, how far its shape differs, whether it climbed at all,
   * and how far its level stands from where the archetype puts it against the
   * loudest band.
   */
  private matchOf(print: BandPrint[], signal: Signal, onsetMask: number): number {
    const bands = bandsOf(signal.mask)
    let top = -Infinity
    for (const b of bands) top = Math.max(top, print[b].peakDb)
    let logSum = 0
    let weightSum = 0
    for (const b of bands) {
      const p = print[b]
      const present = onsetMask & (1 << b) ? 1 : Math.max(ABSENT_FLOOR, Math.min(1, p.rise / RISE_DB))
      let d = 0
      const a = signal.shape[b]
      for (let k = 0; k < SHAPE_HOPS; k++) d += Math.abs(p.shape[k] - a[k])
      d /= SHAPE_HOPS
      const balance = Math.min(BALANCE_CAP_DB, Math.abs(p.peakDb - top - signal.balance[b]))
      const w = bandWeight(signal.balance[b])
      logSum += w * (Math.log(present) - d / SHAPE_SCALE_DB - balance / BALANCE_SCALE_DB)
      weightSum += w
    }
    return weightSum > 0 ? Math.exp(logSum / weightSum) : 0
  }

  /** The intensity of `print` in `mask`'s bands: their summed peak power, 0 dBFS = 1, INTENSITY_FLOOR_DB = 0. */
  private intensityOf(print: BandPrint[], mask: number): number {
    let power = 0
    for (const b of bandsOf(mask)) power += dbToPower(print[b].peakDb)
    const db = 10 * Math.log10(power + 1e-12)
    return Math.min(1, Math.max(0, (db - INTENSITY_FLOOR_DB) / -INTENSITY_FLOOR_DB))
  }

  private found(print: BandPrint[], mask: number): Signal {
    const bands = bandsOf(mask)
    let top = -Infinity
    for (const b of bands) top = Math.max(top, print[b].peakDb)
    const signal: Signal = {
      id: this.nextSignal++,
      mask,
      shape: BANDS.map((_, b) => Float32Array.from(print[b].shape)),
      balance: Float64Array.from(BANDS.map((_, b) => print[b].peakDb - top)),
      weight: 0,
      kick: false,
      hit: false,
    }
    this.signals.push(signal)
    return signal
  }

  /** Assigns one event: the best signals over disjoint masks, then a new signal for the onset bands left. */
  private assign(event: MapEvent, soleOf: Map<number, MapEvent>): void {
    event.assigned = []
    let claimed = 0
    // Of the signals matching at or above NEW_SIGNAL_MATCH, the one explaining the most of the event's
    // power over its mask is taken first: by match alone, a one-band signal (a bass note's sub, a
    // fragment of a kick) matches as readily as a whole kick and would claim a band of it first.
    // Over the whole mask, not only the bands that climbed: an 808's sub may already be sounding.
    for (;;) {
      let best: Signal | null = null
      let bestMatch = 0
      let bestScore = 0
      for (const s of this.signals) {
        if (s.mask & claimed) continue
        // A signal needs at least one of its bands to have an onset in this event.
        if ((s.mask & event.onsetMask) === 0) continue
        // A signal this event alone defines matches it trivially: it must earn its place against the others again.
        if (soleOf.get(s.id) === event) continue
        const m = this.matchOf(event.bands, s, event.onsetMask)
        if (m < NEW_SIGNAL_MATCH) continue
        let covered = 0
        for (const b of bandsOf(s.mask)) covered += dbToPower(event.bands[b].peakDb)
        const score = m * covered
        if (score > bestScore) { best = s; bestMatch = m; bestScore = score }
      }
      if (!best) break
      claimed |= best.mask
      event.assigned.push({ signal: best.id, match: bestMatch, intensity: this.intensityOf(event.bands, best.mask) })
    }
    let left = event.onsetMask & ~claimed
    let loudest = -Infinity
    for (const b of bandsOf(left)) loudest = Math.max(loudest, event.bands[b].peakDb)
    for (const b of bandsOf(left)) if (event.bands[b].peakDb < loudest - MASK_RANGE_DB) left &= ~(1 << b)
    if (left !== 0 && !event.predicted) {
      const s = this.found(event.bands, left)
      event.assigned.push({ signal: s.id, match: 1, intensity: this.intensityOf(event.bands, left) })
    }
  }

  /**
   * Folds each signal into an older one it is the same sound as: masks
   * sharing at least MERGE_OVERLAP of their bands, and each archetype
   * matching the other at MERGE_MATCH or better. True when anything merged.
   */
  private mergeAlike(): boolean {
    const into = new Map<number, number>()
    for (let i = 0; i < this.signals.length; i++) {
      const a = this.signals[i]
      if (into.has(a.id)) continue
      for (let j = i + 1; j < this.signals.length; j++) {
        const b = this.signals[j]
        if (into.has(b.id)) continue
        const shared = bandsOf(a.mask & b.mask).length
        const union = bandsOf(a.mask | b.mask).length
        if (shared / union < MERGE_OVERLAP) continue
        if (this.matchOf(this.printOf(b), a, b.mask) < MERGE_MATCH || this.matchOf(this.printOf(a), b, a.mask) < MERGE_MATCH) continue
        into.set(b.id, a.id)
        a.mask |= b.mask
      }
    }
    if (into.size === 0) return false
    for (const e of this.events) {
      const seen = new Set<number>()
      e.assigned = e.assigned
        .map((x) => ({ ...x, signal: into.get(x.signal) ?? x.signal }))
        .filter((x) => !seen.has(x.signal) && (seen.add(x.signal), true))
    }
    this.signals = this.signals.filter((s) => !into.has(s.id))
    return true
  }

  /** A signal's archetype as a fingerprint, to match it against another signal. */
  private printOf(signal: Signal): BandPrint[] {
    return BANDS.map((_, b) => ({ peakDb: signal.balance[b], rise: RISE_DB, shape: signal.shape[b] }))
  }

  /** The signals with exactly one instance, each with that instance. */
  private soleInstances(): Map<number, MapEvent> {
    const count = new Map<number, number>()
    const only = new Map<number, MapEvent>()
    for (const e of this.events) for (const a of e.assigned) {
      count.set(a.signal, (count.get(a.signal) ?? 0) + 1)
      only.set(a.signal, e)
    }
    for (const [id, n] of count) if (n !== 1) only.delete(id)
    return only
  }

  /** Rebuilds every archetype from its instances, weighted by match. */
  private rebuildArchetypes(): void {
    const byId = new Map(this.signals.map((s) => [s.id, s]))
    const acc = new Map<number, { shape: Float64Array[]; balance: Float64Array; weight: number }>()
    for (const e of this.events) {
      for (const a of e.assigned) {
        const s = byId.get(a.signal)
        if (!s) continue
        let entry = acc.get(s.id)
        if (!entry) {
          entry = { shape: BANDS.map(() => new Float64Array(SHAPE_HOPS)), balance: new Float64Array(BAND_COUNT), weight: 0 }
          acc.set(s.id, entry)
        }
        const bands = bandsOf(s.mask)
        let top = -Infinity
        for (const b of bands) top = Math.max(top, e.bands[b].peakDb)
        const w = a.match
        for (const b of bands) {
          const shape = e.bands[b].shape
          for (let k = 0; k < SHAPE_HOPS; k++) entry.shape[b][k] += w * shape[k]
          entry.balance[b] += w * (e.bands[b].peakDb - top)
        }
        entry.weight += w
      }
    }
    for (const s of this.signals) {
      const entry = acc.get(s.id)
      s.weight = entry?.weight ?? 0
      if (!entry || entry.weight <= 0) continue
      for (const b of bandsOf(s.mask)) {
        for (let k = 0; k < SHAPE_HOPS; k++) s.shape[b][k] = entry.shape[b][k] / entry.weight
        s.balance[b] = entry.balance[b] / entry.weight
      }
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
   *   bands dying SWEEP_DB faster than its lowest) or a percussive DECAY. Any
   *   one will do, because a snare landing on the kick every time hides the
   *   click under its noise and the sweep under its body. And no more than
   *   KICK_PER_BEAT.
   * - HIT: a BODY (see BODY_DB) carried on noise (at least NOISE_BANDS bands
   *   from 800Hz up, one of them at or above 3.2kHz), and no more than
   *   HIT_PER_BEAT.
   */
  private flag(): void {
    const times = new Map<number, number[]>()
    for (const e of this.events) for (const a of e.assigned) {
      const list = times.get(a.signal) ?? []
      list.push(e.time)
      times.set(a.signal, list)
    }
    for (const s of this.signals) {
      const list = times.get(s.id) ?? []
      s.kick = false
      s.hit = false
      if (list.length < MIN_FLAG_INSTANCES) continue
      const beats = this.beats.beatsBetween(list[0] - 2, list[list.length - 1] + 2)
      if (beats.length < 2) continue
      const grid: number[] = []
      for (let i = 0; i + 1 < beats.length; i++) {
        for (let k = 0; k < GRID_DIVISIONS; k++) grid.push(beats[i] + ((beats[i + 1] - beats[i]) * k) / GRID_DIVISIONS)
      }
      grid.push(beats[beats.length - 1])
      const onGrid = list.filter((t) => nearest(grid, t) <= ON_GRID_SEC).length / list.length >= ON_GRID_SHARE
      if (!onGrid) continue
      const spanBeats = Math.max(1, beats.filter((t) => t >= list[0] && t <= list[list.length - 1]).length)
      const perBeat = list.length / spanBeats
      const bands = bandsOf(s.mask)
      // Mostly low: in a kick's fundamental, or as high as 200Hz where that is a pitch passing through on its way down.
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
      const body = bodyBand >= 0 && s.balance[bodyBand] - bright >= BODY_DB && s.balance[bodyBand] >= BODY_TOP_DB && s.shape[bodyBand][BODY_SUSTAIN_HOPS] >= BODY_SUSTAIN_DB
      const noise = bands.filter((b) => BANDS[b] >= 800).length >= NOISE_BANDS && bands.some((b) => BANDS[b] >= 3200)
      s.hit = body && noise && perBeat <= HIT_PER_BEAT
    }
  }

  /**
   * The pattern's second look: for each flagged signal, a bar with an
   * instance a bar before and a bar after and none of its own is searched
   * without the onset floor, and an instance is added where the sound
   * matches. Only the event added is new; the onset events are untouched.
   */
  private searchPredicted(): void {
    for (const s of this.signals) {
      if (!s.kick && !s.hit) continue
      const own = this.events.filter((e) => e.assigned.some((a) => a.signal === s.id)).map((e) => e.time)
      if (own.length < MIN_FLAG_INSTANCES) continue
      for (const t of own) {
        const beats = this.beats.beatsBetween(t - 0.01, t + 8)
        if (beats.length < 9) continue
        const bar = beats[4] - beats[0]
        const predicted = t + bar
        if (nearest(own, predicted) <= ON_GRID_SEC) continue
        if (nearest(own, predicted + bar) > ON_GRID_SEC) continue
        if (predicted - this.timeOf(this.firstHop) < 1 || predicted > this.frontier - 1) continue
        if (predicted <= this.heardTime) continue
        const centre = Math.round((predicted - this.origin) / HOP_SEC) - this.firstHop - 2
        let bestMatch = NEW_SIGNAL_MATCH
        let bestAt = -1
        let bestPrint: BandPrint[] | null = null
        for (let i = centre - PREDICT_SEARCH_HOPS; i <= centre + PREDICT_SEARCH_HOPS; i++) {
          if (i < 1 || i + SHAPE_HOPS + 16 >= this.hops) continue
          const print = this.printAt(i)
          let rose = true
          for (const b of bandsOf(s.mask)) if (print[b].rise < PREDICT_RISE_DB) { rose = false; break }
          if (!rose) continue
          const m = this.matchOf(print, s, s.mask)
          if (m > bestMatch) { bestMatch = m; bestAt = i; bestPrint = print }
        }
        if (!bestPrint) continue
        const hop = this.firstHop + bestAt
        const time = this.timeOf(hop)
        if (this.events.some((e) => Math.abs(e.time - time) <= ON_GRID_SEC && e.assigned.some((a) => a.signal === s.id))) continue
        const event: MapEvent = { hop, time, bands: bestPrint, onsetMask: s.mask, assigned: [], final: false, predicted: true }
        event.assigned.push({ signal: s.id, match: bestMatch, intensity: this.intensityOf(bestPrint, s.mask) })
        this.events.push(event)
        own.push(time)
        own.sort((a, b) => a - b)
      }
    }
    this.events.sort((a, b) => a.time - b.time)
  }

  /**
   * Brings the map up to date for a listener at `heardTime`: parses what
   * was fed, makes everything heard final, and re-decides the rest against
   * the archetypes as they now stand.
   */
  analyse(heardTime: number): void {
    if (Number.isNaN(this.origin)) return
    this.heardTime = Math.max(this.heardTime, heardTime)
    for (const e of this.events) if (e.time <= this.heardTime) e.final = true
    this.parse()
    // Predicted events are re-derived from the pattern each pass, unless heard.
    this.events = this.events.filter((e) => e.final || !e.predicted)
    // Two rounds: assign against the archetypes, rebuild them from the assignment, assign again.
    // Assign against the archetypes, rebuild them, fold together signals that turned out to be one
    // sound, and assign again: one sound first met layered with another, or founded twice before
    // either had an archetype worth matching, converges onto one signal.
    for (let round = 0; round < ROUNDS; round++) {
      const soleOf = this.soleInstances()
      for (const e of this.events) if (!e.final) this.assign(e, soleOf)
      this.rebuildArchetypes()
      this.signals = this.signals.filter((s) => s.weight > 0)
      if (this.mergeAlike()) this.rebuildArchetypes()
    }
    this.flag()
    this.searchPredicted()
  }

  /** The inventory's signals. */
  signalList(): SignalSummary[] {
    const counts = new Map<number, number>()
    for (const e of this.events) for (const a of e.assigned) counts.set(a.signal, (counts.get(a.signal) ?? 0) + 1)
    return this.signals.map((s) => ({ id: s.id, bands: bandsOf(s.mask).map((b) => BANDS[b]), kick: s.kick, hit: s.hit, instances: counts.get(s.id) ?? 0 }))
  }

  /** Every instance with a time in [from, to), oldest first. */
  instancesBetween(from: number, to: number): SignalInstance[] {
    const byId = new Map(this.signals.map((s) => [s.id, s]))
    const out: SignalInstance[] = []
    for (const e of this.events) {
      if (e.time < from || e.time >= to) continue
      for (const a of e.assigned) {
        const s = byId.get(a.signal)
        if (!s) continue
        out.push({ time: e.time, signal: s.id, kick: s.kick, hit: s.hit, match: a.match, intensity: a.intensity })
      }
    }
    return out
  }
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

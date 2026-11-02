/**
 * The DRUM SCORE: every onset of the music around the listener, each with how
 * much of it is a THUMP, a PIERCE and a TICK, written from the beat map's own
 * onset features (`beatMap.ts`'s `OnsetFeatures`) up to `MAP_AHEAD_SEC` ahead
 * and read by the visualizer's three trackers (`musicAnalysis.ts`).
 *
 * The three CHANNELS are what a listener feels rather than which instrument
 * played: a THUMP is the low end jumping (a kick, a bass stab), a PIERCE is a
 * sharp sound cutting through the mix (a snare, a clap, a rim shot), a TICK is
 * the busy, rhythmic top (hats, shakers). Nothing is classified: one onset
 * carries a strength in every channel it is present in, so a snare with low
 * punch is a pierce with a slight thump and a ringing kick a thump with a weak
 * pierce. How much of that bleed shows is the reader's CONTRAST.
 *
 * 1. ONSETS: a peak of one band's RISE (`OnsetFeatures`: its total linear
 *    amplitude growing), the largest within `PEAK_FRAMES` either side, whose
 *    PROMINENCE (the rise over the median rise of the `LOCAL_FRAMES` around
 *    it) reaches `PEAK_PROMINENCE`: judged against the hit's own
 *    surroundings, so one kick is the same onset after a quiet passage and a
 *    busy one. Peaks of different bands within `MERGE_FRAMES` of each other
 *    are one onset, at the frame of the most prominent, timed where its rise
 *    began (`attackOf`). A channel is PRESENT in an onset when its prominence
 *    reaches `PRESENT_PROMINENCE`, and its strength is the log of its rise
 *    times its SHARE, its prominence against its `CONTRAST` with the other
 *    bands' (so a strength difference is a loudness ratio, and a sound that
 *    is mostly another channel is faint in this one, never absent).
 * 2. THE CLOCK: where the beat map has a bar, each onset is placed on the
 *    sixteenth it lands on, and every channel's strength at every sixteenth of
 *    every bar is read off the flux whether an onset was found there or not.
 *    The EXPECTATION of a sixteenth is the median of that strength at the
 *    same place in the `PATTERN_BARS` bars either side. A channel that sounds
 *    at a sixteenth it is expected at is lifted its PATTERN's share of the way to the
 *    expectation: one kick of a four-on-the-floor that came out weak still
 *    lands. A channel that is expected but was not found, where its flux
 *    still shows `PRESENCE_SHARE` of the expectation, is an onset all the
 *    same: a kick buried under a crash is not lost. A sixteenth is EXPECTED
 *    when its expectation reaches the median strength of that channel's
 *    onsets around it, so a pattern's weak sixteenths lift nothing.
 * 3. THE ONE of each bar is emphasised: every strength there gains
 *    `ONE_EMPHASIS` of a doubling.
 */

import type { MapBeat, OnsetBand, OnsetFeatures } from './beatMap'

/** The three channels, in the order of their `OnsetBand`. */
export const CHANNELS = ['thump', 'pierce', 'tick'] as const
export type DrumChannel = (typeof CHANNELS)[number]

/** One onset: its media time, whether it is on the one of a bar, and its strength in each channel (NaN where absent). */
export interface DrumInstance {
  time: number
  one: boolean
  thump: number
  pierce: number
  tick: number
}

/** How far either side a peak must be the largest, in frames (10 ms each). */
const PEAK_FRAMES = 3
/**
 * How far either side a rise is judged against, in frames: the hit's own surroundings and nothing older, so a kick
 * is the same onset after a quiet passage and a busy one.
 */
const LOCAL_FRAMES = 10
/** How many times its surroundings' median rise a band's peak must reach to be an onset (its PROMINENCE). */
const PEAK_PROMINENCE = 3
/** The prominence a channel must have to be present in an onset at all. */
const PRESENT_PROMINENCE = 2
/** The least median a prominence is taken against, in the rise's units (about -60 dB of full scale): silence is not a surrounding. */
const MIN_RISE = 0.5
/**
 * CONTRAST[c][d]: how much of band d's prominence counts against channel c's SHARE of an onset. A snare's noise
 * reaches the tick band and a hat's the sharp one, so the two weigh each other heavily; a kick under a snare, or a
 * clap on a kick, is both, so the low band and the sharp one weigh each other lightly. It only ever WEAKENS a
 * channel: a kick under a snare is a fainter thump, never none.
 */
const CONTRAST: readonly (readonly number[])[] = [
  [0, 0.5, 0],
  [0, 0, 0.8],
  [0, 0.8, 0],
]
/** The share of its peak rise a frame must still show to be part of the rise's attack (`attackOf`). */
const ATTACK_SHARE = 0.25
/** Peaks closer than this, in frames, are one onset. */
const MERGE_FRAMES = 3
/** How far from a sixteenth an onset may lie and be on it, in frames. */
const SNAP_FRAMES = 3
/** How many bars either side a sixteenth's expectation is read over. */
const PATTERN_BARS = 4
/**
 * How far a present channel is lifted toward its expectation, per unit of the channel's PATTERN (0..1, the
 * tracker's setting): at 0 the score is the signal alone, at the default 0.5 an onset is lifted half way.
 */
const LIFT_PER_PATTERN = 1
/**
 * The share of its expectation a channel's flux must show at a sixteenth to be found there all the same, at the
 * default pattern of 0.5. The share is this raised to `2 * pattern`: 1 at no pattern (nothing is added that is not
 * as strong as expected), this at the default, its square at a full pattern.
 */
const PRESENCE_SHARE = 0.3
/** Each channel's pattern when nobody says otherwise: what the score was tuned at. */
export const DEFAULT_PATTERN = 0.5
/** How much a strength on the one gains, as a share of a doubling (strengths are natural logs). */
const ONE_EMPHASIS = 0.25
/** The longest gap between two beats a bar is read across, in seconds (the beat map's slowest tempo, and a margin). */
const MAX_BEAT_SEC = 1

const BANDS: readonly OnsetBand[] = [0, 1, 2]

function median(values: number[]): number {
  if (values.length === 0) return NaN
  values.sort((a, b) => a - b)
  return values[values.length >> 1]
}

interface Onset {
  frame: number
  strength: number[]
  one: boolean
}

/** A sixteenth of a bar: its frame, its bar (counted along the beats) and its place in the bar, 0 to 15. */
interface Sixteenth {
  frame: number
  bar: number
  place: number
}

/** The sixteenths of the bars the beats make, every consecutive pair of beats close enough to be one beat. */
function sixteenthsOf(features: OnsetFeatures, beats: readonly MapBeat[]): Sixteenth[] {
  const out: Sixteenth[] = []
  let bar = 0
  for (let j = 0; j + 1 < beats.length; j++) {
    const a = beats[j]
    const b = beats[j + 1]
    if (a.position === 0) bar++
    const span = b.time - a.time
    if (span <= 0 || span > MAX_BEAT_SEC) continue
    for (let q = 0; q < 4; q++) out.push({ frame: features.frameOf(a.time + (q * span) / 4), bar, place: a.position * 4 + q })
  }
  return out
}

/**
 * The drum score from `from` on, up to what the features hold, in time order: every onset (step 1), placed and
 * lifted by the clock where `beats` (the beat map's shown beats) make bars (steps 2 and 3).
 */
export function writeDrumScore(
  features: OnsetFeatures,
  beats: readonly MapBeat[],
  from: number,
  pattern: Readonly<Record<DrumChannel, number>> = { thump: DEFAULT_PATTERN, pierce: DEFAULT_PATTERN, tick: DEFAULT_PATTERN },
): DrumInstance[] {
  const [first, end] = features.frames()
  forgetBefore(features, first)
  const start = Math.max(first + PEAK_FRAMES, features.frameOf(from))
  const stop = end - PEAK_FRAMES
  // 1. Peaks of every band, merged into onsets.
  const peaks: { frame: number; z: number }[] = []
  for (const band of BANDS) {
    for (let f = start; f < stop; f++) {
      const x = features.rise(band, f)
      if (!(x >= PEAK_PROMINENCE * MIN_RISE)) continue
      let largest = true
      for (let g = f - PEAK_FRAMES; g <= f + PEAK_FRAMES && largest; g++) {
        const y = features.rise(band, g)
        largest = g < f ? y < x : g === f || y <= x
      }
      if (!largest) continue
      const z = prominence(features, band, f, first, end)
      if (z >= PEAK_PROMINENCE) peaks.push({ frame: f, z })
    }
  }
  peaks.sort((a, b) => a.frame - b.frame)
  const onsets: Onset[] = []
  for (let j = 0; j < peaks.length; ) {
    let k = j
    let at = peaks[j]
    while (k + 1 < peaks.length && peaks[k + 1].frame - peaks[j].frame <= MERGE_FRAMES) {
      k++
      if (peaks[k].z > at.z) at = peaks[k]
    }
    onsets.push({ frame: at.frame, strength: BANDS.map((band) => strengthAt(features, band, at.frame, first, end)), one: false })
    j = k + 1
  }
  // 2. The clock.
  const sixteenths = sixteenthsOf(features, beats)
  if (sixteenths.length > 0) lift(features, onsets, sixteenths, start, first, end, [pattern.thump, pattern.pierce, pattern.tick])
  // 3. The one.
  for (const onset of onsets) {
    if (!onset.one) continue
    for (let b = 0; b < BANDS.length; b++) if (!Number.isNaN(onset.strength[b])) onset.strength[b] += ONE_EMPHASIS * Math.LN2
  }
  onsets.sort((a, b) => a.frame - b.frame)
  return onsets.map((onset) => ({ time: features.timeOf(attackOf(features, onset.frame, first)), one: onset.one, thump: onset.strength[0], pierce: onset.strength[1], tick: onset.strength[2] }))
}

/**
 * Where the rise that peaks at `frame` began: the earliest frame of the run before it, no further back than
 * PEAK_FRAMES, that still rises ATTACK_SHARE of the peak in the band that peaks most there. A drum whose body builds
 * over several frames (a real kick does, a click does not) peaks its rise late; the hit is where it started.
 */
function attackOf(features: OnsetFeatures, frame: number, first: number): number {
  let band: OnsetBand = 0
  for (const b of BANDS) if (features.rise(b, frame) > features.rise(band, frame)) band = b
  const floor = ATTACK_SHARE * features.rise(band, frame)
  let at = frame
  while (at - 1 >= Math.max(first, frame - PEAK_FRAMES) && features.rise(band, at - 1) >= floor) at--
  return at
}

/** A band's rise at `frame` over the median rise of the LOCAL_FRAMES either side (at least MIN_RISE). */
function prominence(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number): number {
  // Asked for the same frames many times over in one writing (every peak, every sixteenth's neighbourhood, each with
  // the other bands) and again at every writing after: a frame whose neighbourhood is all decoded never changes, so
  // it is computed once and kept until the features drop it.
  const final = frame + LOCAL_FRAMES < end
  const kept = final ? prominenceKept(features)[band] : null
  const known = kept?.get(frame)
  if (known !== undefined) return known
  const around: number[] = []
  for (let f = Math.max(first, frame - LOCAL_FRAMES); f <= Math.min(end - 1, frame + LOCAL_FRAMES); f++) around.push(features.rise(band, f))
  const value = features.rise(band, frame) / Math.max(MIN_RISE, median(around))
  kept?.set(frame, value)
  return value
}

/** The prominences of each band's frames whose neighbourhood is all decoded, per features (one per beat map). */
const keptProminence = new WeakMap<OnsetFeatures, Map<number, number>[]>()

function prominenceKept(features: OnsetFeatures): Map<number, number>[] {
  let kept = keptProminence.get(features)
  if (!kept) keptProminence.set(features, (kept = BANDS.map(() => new Map<number, number>())))
  return kept
}

/** Forgets the kept prominences of frames the features no longer hold. */
function forgetBefore(features: OnsetFeatures, first: number): void {
  for (const kept of keptProminence.get(features) ?? []) for (const frame of kept.keys()) if (frame < first) kept.delete(frame)
}

/** The frame within one either side of `frame` where `band` rises most. */
function peakNear(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number): number {
  let at = frame
  for (let f = Math.max(first, frame - 1); f <= Math.min(end - 1, frame + 1); f++) if (features.rise(band, f) > features.rise(band, at)) at = f
  return at
}

/**
 * A channel's strength in an onset at `frame`: the log of its rise there times its SHARE, its prominence over its own
 * and its CONTRAST's of the others', so a sound that is mostly another channel is faint in this one; NaN where its
 * prominence is short of `presence`.
 */
function strengthAt(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number, presence = PRESENT_PROMINENCE): number {
  const at = peakNear(features, band, frame, first, end)
  const own = prominence(features, band, at, first, end)
  if (!(own >= presence) || !(own > 0)) return NaN
  let against = 0
  for (const other of BANDS) if (CONTRAST[band][other] > 0) against += CONTRAST[band][other] * prominence(features, other, peakNear(features, other, frame, first, end), first, end)
  return Math.log(features.rise(band, at) * (own / (own + against)))
}

/** A channel's strength at a sixteenth whether an onset was found there or not: its strongest within SNAP_FRAMES, at any salience above none. */
function levelAt(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number): number {
  let most = -Infinity
  for (let f = Math.max(first + 1, frame - SNAP_FRAMES); f <= Math.min(end - 2, frame + SNAP_FRAMES); f++) {
    const x = strengthAt(features, band, f, first, end, 0)
    if (x > most) most = x
  }
  return most
}

/** Step 2: places `onsets` on the sixteenths, lifts each expected channel, and adds the expected onsets not found. */
function lift(features: OnsetFeatures, onsets: Onset[], sixteenths: readonly Sixteenth[], start: number, first: number, end: number, pattern: readonly number[]): void {
  // Every channel's strength at every sixteenth, found or not (-Infinity where it is not there at all).
  const level = BANDS.map((band) => sixteenths.map((s) => levelAt(features, band, s.frame, first, end)))
  // The sixteenths by bar and place, to read a place's expectation across bars.
  const byPlace = new Map<number, number[]>()
  sixteenths.forEach((s, i) => {
    const key = s.place
    const list = byPlace.get(key) ?? []
    list.push(i)
    byPlace.set(key, list)
  })
  // Each onset's sixteenth, and each sixteenth's onset.
  const onsetAt = new Map<number, Onset>()
  let k = 0
  for (const onset of onsets) {
    while (k + 1 < sixteenths.length && Math.abs(sixteenths[k + 1].frame - onset.frame) <= Math.abs(sixteenths[k].frame - onset.frame)) k++
    if (Math.abs(sixteenths[k].frame - onset.frame) > SNAP_FRAMES || onsetAt.has(k)) continue
    onsetAt.set(k, onset)
    onset.one = sixteenths[k].place === 0
  }
  for (let b = 0; b < BANDS.length; b++) {
    if (!(pattern[b] > 0)) continue
    const liftBy = Math.min(1, LIFT_PER_PATTERN * pattern[b])
    const presence = 2 * pattern[b] * Math.log(PRESENCE_SHARE)
    // The median strength of the channel's onsets: what an expectation must reach to lift anything.
    const typical = median(onsets.map((o) => o.strength[b]).filter((x) => !Number.isNaN(x)))
    if (Number.isNaN(typical)) continue
    for (let i = 0; i < sixteenths.length; i++) {
      const s = sixteenths[i]
      if (s.frame < start) continue
      const around: number[] = []
      for (const j of byPlace.get(s.place) ?? []) if (j !== i && Math.abs(sixteenths[j].bar - s.bar) <= PATTERN_BARS) around.push(level[b][j])
      const expected = median(around)
      if (!(expected >= typical)) continue
      const onset = onsetAt.get(i)
      const own = onset ? onset.strength[b] : NaN
      if (!Number.isNaN(own)) {
        if (own < expected) onset!.strength[b] = own + liftBy * (expected - own)
        continue
      }
      // Expected and not found: found all the same where the flux still shows a share of the expectation.
      if (level[b][i] < expected + presence) continue
      const found = level[b][i] + liftBy * (expected - level[b][i])
      if (onset) onset.strength[b] = found
      else {
        const added: Onset = { frame: s.frame, strength: BANDS.map(() => NaN), one: s.place === 0 }
        added.strength[b] = found
        onsets.push(added)
        onsetAt.set(i, added)
      }
    }
  }
}

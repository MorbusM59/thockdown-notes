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
 * 1. ONSETS: a peak of one band's flux, the largest within `PEAK_FRAMES`
 *    either side, whose normalised value reaches `PEAK_Z`. Peaks of different
 *    bands within `MERGE_FRAMES` of each other are one onset, at the frame of
 *    the most pronounced. A channel's SALIENCE in an onset is its normalised
 *    flux less its `CONTRAST` with the other bands; it is PRESENT when that
 *    reaches `PRESENT_Z`, and its strength is the log of its raw flux times
 *    the share of it the salience keeps (so a strength difference is a
 *    loudness ratio, the reader's stretch means one thing in a quiet intro
 *    and a loud drop, and a sound that is mostly another channel is faint in
 *    this one).
 * 2. THE CLOCK: where the beat map has a bar, each onset is placed on the
 *    sixteenth it lands on, and every channel's strength at every sixteenth of
 *    every bar is read off the flux whether an onset was found there or not.
 *    The EXPECTATION of a sixteenth is the median of that strength at the
 *    same place in the `PATTERN_BARS` bars either side. A channel that sounds
 *    at a sixteenth it is expected at is lifted `LIFT` of the way to the
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
/** The normalised flux a peak must reach to be an onset. */
const PEAK_Z = 1.5
/** The normalised flux a channel must reach to be present in an onset, after its CONTRAST. */
const PRESENT_Z = 0.5
/**
 * CONTRAST[c][d]: how much of band d's normalised flux counts against channel c's presence. A snare's noise reaches
 * the tick band and a hat's the sharp one, so the two weigh each other heavily and an onset is assigned to whichever
 * it is MORE of; a kick under a snare, or a clap on a kick, is both, so the low band and the sharp one weigh each other
 * lightly.
 */
const CONTRAST: readonly (readonly number[])[] = [
  [0, 0.5, 0],
  [0, 0, 0.8],
  [0, 0.8, 0],
]
/** Peaks closer than this, in frames, are one onset. */
const MERGE_FRAMES = 3
/** How far from a sixteenth an onset may lie and be on it, in frames. */
const SNAP_FRAMES = 3
/** How many bars either side a sixteenth's expectation is read over. */
const PATTERN_BARS = 4
/** How far a present channel is lifted toward its expectation. */
const LIFT = 0.5
/** The share of its expectation a channel's flux must show at a sixteenth to be found there all the same. */
const PRESENCE_SHARE = 0.3
/** How much a strength on the one gains, as a share of a doubling (strengths are natural logs). */
const ONE_EMPHASIS = 0.25
/** The longest gap between two beats a bar is read across, in seconds (the beat map's slowest tempo, and a margin). */
const MAX_BEAT_SEC = 1

const BANDS: readonly OnsetBand[] = [0, 1, 2]

/** The strongest raw flux of `band` within `radius` frames of `frame`, inside what is held. */
function fluxNear(features: OnsetFeatures, band: OnsetBand, frame: number, radius: number, first: number, end: number): number {
  let most = 0
  for (let f = Math.max(first, frame - radius); f <= Math.min(end - 1, frame + radius); f++) most = Math.max(most, features.flux(band, f))
  return most
}

function normalisedNear(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number): number {
  let most = -Infinity
  for (let f = Math.max(first, frame - 1); f <= Math.min(end - 1, frame + 1); f++) most = Math.max(most, features.normalised(band, f))
  return most
}

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
export function writeDrumScore(features: OnsetFeatures, beats: readonly MapBeat[], from: number): DrumInstance[] {
  const [first, end] = features.frames()
  const start = Math.max(first + PEAK_FRAMES, features.frameOf(from))
  const stop = end - PEAK_FRAMES
  // 1. Peaks of every band, merged into onsets.
  const peaks: { frame: number; z: number }[] = []
  for (const band of BANDS) {
    for (let f = start; f < stop; f++) {
      const z = features.normalised(band, f)
      if (z < PEAK_Z) continue
      const x = features.flux(band, f)
      let largest = true
      for (let g = f - PEAK_FRAMES; g <= f + PEAK_FRAMES && largest; g++) {
        const y = features.flux(band, g)
        largest = g < f ? y < x : g === f || y <= x
      }
      if (largest) peaks.push({ frame: f, z })
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
  if (sixteenths.length > 0) lift(features, onsets, sixteenths, start, first, end)
  // 3. The one.
  for (const onset of onsets) {
    if (!onset.one) continue
    for (let b = 0; b < BANDS.length; b++) if (!Number.isNaN(onset.strength[b])) onset.strength[b] += ONE_EMPHASIS * Math.LN2
  }
  onsets.sort((a, b) => a.frame - b.frame)
  return onsets.map((onset) => ({ time: features.timeOf(onset.frame), one: onset.one, thump: onset.strength[0], pierce: onset.strength[1], tick: onset.strength[2] }))
}

/**
 * A channel's strength in an onset at `frame`: the log of its raw flux there, scaled by the share of its normalised flux
 * its CONTRAST leaves (its SALIENCE), or NaN where that salience is short of PRESENT_Z.
 */
function strengthAt(features: OnsetFeatures, band: OnsetBand, frame: number, first: number, end: number, presence = PRESENT_Z): number {
  const own = normalisedNear(features, band, frame, first, end)
  let salience = own
  for (const other of BANDS) if (CONTRAST[band][other] > 0) salience -= CONTRAST[band][other] * Math.max(0, normalisedNear(features, other, frame, first, end))
  if (!(salience >= presence) || !(salience > 0)) return NaN
  // Only the share of the flux the contrast leaves is this channel's: a snare whose rattle reaches the hats' band is
  // a faint tick, however loud it is there.
  return Math.log(fluxNear(features, band, frame, 1, first, end) * (salience / own))
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
function lift(features: OnsetFeatures, onsets: Onset[], sixteenths: readonly Sixteenth[], start: number, first: number, end: number): void {
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
        if (own < expected) onset!.strength[b] = own + LIFT * (expected - own)
        continue
      }
      // Expected and not found: found all the same where the flux still shows a share of the expectation.
      if (level[b][i] < expected + Math.log(PRESENCE_SHARE)) continue
      const found = level[b][i] + LIFT * (expected - level[b][i])
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

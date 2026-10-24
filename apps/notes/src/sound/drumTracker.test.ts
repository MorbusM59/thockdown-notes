import { describe, expect, it } from 'vitest'
import { DrumCursor, DrumTracker, type Drum } from './drumTracker'

const RATE = 48000

/** A deterministic noise source, so a failing run reproduces. */
function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

interface Track {
  samples: Float32Array
  kicks: number[]
}

/**
 * Four-on-the-floor house: a pitched-down kick on every beat, an off-beat
 * bass line in the kick's own band (ducked by the kick and swelling back, as
 * sidechained bass does), off-beat open hats, a clap on two and four, and a
 * kick-free breakdown between `breakFrom` and `breakTo`. `kickGain` scales
 * the kick that starts at a given time.
 */
function house(seconds: number, bpm: number, breakFrom = Infinity, breakTo = Infinity, kickGain: (t0: number) => number = () => 1): Track {
  const n = Math.round(seconds * RATE)
  const out = new Float32Array(n)
  const beat = 60 / bpm
  const rand = noise(7)
  const kicks: number[] = []
  for (let b = 0; b * beat < seconds; b++) {
    const t0 = b * beat
    const inBreak = t0 >= breakFrom && t0 < breakTo
    if (!inBreak) kicks.push(t0)
    // Kick: a sine falling from 150Hz to 50Hz, decaying over a quarter second.
    if (!inBreak) {
      let phase = 0
      const gain = kickGain(t0)
      for (let i = 0; i < 0.3 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at >= n) break
        const t = i / RATE
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
        out[at] += gain * 0.9 * Math.sin(phase) * Math.exp(-t / 0.12)
        // The beater's click: a few milliseconds of noise.
        out[at] += gain * 0.25 * rand() * Math.exp(-t / 0.003)
      }
    }
    // Bass: a 55/73Hz note on the off-beat, rising over 60ms, held, ducked into the next kick.
    const note = b % 4 === 3 ? 73 : 55
    for (let i = 0; i < beat * 0.5 * RATE; i++) {
      const at = Math.round((t0 + beat / 2) * RATE) + i
      if (at >= n) break
      const t = i / RATE
      const env = Math.min(1, t / 0.06)
      const wave = Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t)
      out[at] += 0.45 * env * wave
    }
    // Open hat on the off-beat, clap on two and four.
    for (let i = 0; i < 0.08 * RATE; i++) {
      const at = Math.round((t0 + beat / 2) * RATE) + i
      if (at < n) out[at] += 0.15 * rand() * Math.exp(-i / RATE / 0.03)
    }
    if (b % 2 === 1) {
      for (let i = 0; i < 0.12 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at < n) out[at] += 0.3 * rand() * Math.exp(-i / RATE / 0.04)
      }
    }
  }
  return { samples: out, kicks }
}


/** One kick: a sine falling from 150Hz to 50Hz over a quarter second, and the beater's click. */
function addKick(out: Float32Array, t0: number, gain: number, rand: () => number): void {
  let phase = 0
  for (let i = 0; i < 0.3 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
    out[at] += gain * 0.9 * Math.sin(phase) * Math.exp(-t / 0.12)
    out[at] += gain * 0.25 * rand() * Math.exp(-t / 0.003)
  }
}

/** A burst of noise: a snare or clap (`decay` 0.04s) or a hat (0.02s). */
function addNoise(out: Float32Array, t0: number, gain: number, decay: number, rand: () => number): void {
  for (let i = 0; i < 4 * decay * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at < out.length) out[at] += gain * rand() * Math.exp(-i / RATE / decay)
  }
}

interface Groove {
  /** Kicks in one bar, as [sixteenth 0-15, gain]; a gain of 0 is a kick dropped. */
  kicks: (bar: number) => Array<[number, number]>
  /** Sixteenths carrying a snare. */
  snares: number[]
  /** How late the off-beat sixteenths fall, as a share of a sixteenth (1/3 is triplet swing). */
  swing?: number
}

/**
 * A drum pattern over a bass line: kicks and snares where `groove` puts them,
 * closed hats on every eighth, and a bass note on every beat's second
 * eighth, so the low band is never only kick. Returns the kick times played.
 */
function drums(seconds: number, bpm: number, groove: Groove): Track {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(5)
  const sixteenth = 60 / bpm / 4
  const at = (bar: number, s: number) => (bar * 16 + s + (s % 2 === 1 ? groove.swing ?? 0 : 0)) * sixteenth
  const kicks: number[] = []
  for (let bar = 0; at(bar, 0) < seconds; bar++) {
    for (const [s, gain] of groove.kicks(bar)) {
      if (gain <= 0) continue
      addKick(out, at(bar, s), gain, rand)
      if (gain >= 0.5) kicks.push(at(bar, s))
    }
    for (const s of groove.snares) addNoise(out, at(bar, s), 0.35, 0.04, rand)
    for (let s = 0; s < 16; s += 2) addNoise(out, at(bar, s), 0.08, 0.02, rand)
    for (let beat = 0; beat < 4; beat++) {
      const t0 = at(bar, beat * 4 + 2)
      for (let i = 0; i < 2 * sixteenth * RATE; i++) {
        const k = Math.round(t0 * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
      }
    }
  }
  return { samples: out, kicks: kicks.filter((k) => k < seconds) }
}

/** The share of `kicks` between `from` and `to` that drew a hit above `floor`, and the hits above `floor` that matched no kick. */
function score(track: Track, hits: Array<{ at: number; response: number }>, from: number, to: number, floor: number) {
  const kicks = track.kicks.filter((k) => k > from && k < to)
  const found = kicks.filter((k) => (hitFor(k, hits)?.response ?? 0) > floor).length / kicks.length
  const strays = hits.filter((h) => h.at > from && h.at < to && h.response > floor && !track.kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
  return { found, strays }
}

interface PlayOptions {
  /** How far the hit asked for trails the feed, in seconds. */
  lagSec?: number
  /** Error in the media time each feed is stamped with, uniform within ±this, in seconds. */
  stampJitterSec?: number
  /** Every this many frames, the frame's samples are lost and only their count is reported. */
  loseEvery?: number
}

/**
 * Plays a track through the tracker the way `musicBeat.ts` does: fed in
 * display-frame chunks of uneven size (a 60Hz display with jitter and the odd
 * long frame), and asked at each frame for the hit heard `lagSec` behind the
 * feed. Returns every hit reported, with its media time and response.
 */
function play(track: Track, contrast: number, options: PlayOptions = {}, drum: Drum = 'kick'): { hits: Array<{ at: number; response: number }>; tracker: DrumTracker } {
  const { lagSec = 5, stampJitterSec = 0, loseEvery = 0 } = options
  const tracker = new DrumTracker(RATE)
  const cursor = new DrumCursor()
  const rand = noise(3)
  const jitter = noise(11)
  let lost = 0
  const hits: Array<{ at: number; response: number }> = []
  let fed = 0
  let frame = 0
  while (fed < track.samples.length) {
    frame++
    const chunk = frame % 97 === 0 ? 2400 : Math.round(800 + 120 * rand())
    const end = Math.min(track.samples.length, fed + chunk)
    if (loseEvery > 0 && frame % loseEvery === 0) {
      lost += end - fed
    } else {
      tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE + stampJitterSec * jitter(), lost)
      lost = 0
    }
    fed = end
    const heard = end / RATE - lagSec
    if (heard <= 0) continue
    const response = tracker.hitBetween(drum, cursor, heard, contrast)
    if (response > 0) hits.push({ at: heard, response })
  }
  return { hits, tracker }
}

/**
 * The hit reported for a kick: the first frame at or after its onset peak,
 * which trails the kick's first sample by up to 20ms (more where a bass note
 * overlaps it), so up to that plus a long (50ms) frame late.
 */
const LATE_SEC = 0.075
/** How early a hit may be reported: the hop clock's resolution and the envelope's centre. */
const EARLY_SEC = 0.02

function hitFor(kick: number, hits: Array<{ at: number; response: number }>) {
  return hits.find((h) => h.at >= kick - EARLY_SEC && h.at <= kick + LATE_SEC)
}

describe('DrumTracker on kicks', () => {
  it('locks to the tempo of four-on-the-floor house', () => {
    const { tracker } = play(house(20, 126), 0.5)
    expect(tracker.tempoBpm).toBeGreaterThan(125)
    expect(tracker.tempoBpm).toBeLessThan(127)
  })

  it('fires once per kick, on time and at full strength, and never on the bass line, hats or clap', () => {
    const track = house(30, 128)
    const { hits } = play(track, 0.5)
    const kicks = track.kicks.filter((k) => k > 6 && k < 24)
    for (const kick of kicks) expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    const between = hits.filter((h) => h.at > 6 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
    expect(hits.filter((h) => h.at > 6 && h.at < 24 + LATE_SEC).length).toBe(kicks.length)
  })

  it('goes faint through a breakdown with no kick, and picks the kick up again after it', () => {
    const track = house(40, 124, 14, 22)
    const { hits } = play(track, 0.5)
    for (const hit of hits.filter((h) => h.at > 14.1 && h.at < 21.9)) expect(hit.response, `at ${hit.at.toFixed(3)}`).toBeLessThan(0.6)
    for (const kick of track.kicks.filter((k) => k > 24 && k < 34)) {
      expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    }
  })

  it('reports a hit within a frame of the kick', () => {
    const track = house(20, 128)
    const { hits } = play(track, 0.5)
    // Asked every frame (about 17ms apart), a hit lands within a frame of the
    // onset peak, which trails the kick's first sample by about 15ms. A
    // picture trailing its sound by under 45ms is not perceived as late
    // (ITU-R BT.1359), so 40ms is the bound, with no frame landing early.
    const offsets = track.kicks.filter((k) => k > 6 && k < 14).map((k) => hitFor(k, hits)!.at - k)
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(0.04)
    }
  })

  it('keeps firing on every kick after one far louder than the rest', () => {
    // A kick is judged against the band's recent kicks, so one outlier must
    // count as a full hit and leave the ones after it reading as before.
    const track = house(30, 128, Infinity, Infinity, (t0) => (Math.abs(t0 - 15) < 0.01 ? 3 : 1))
    const { hits } = play(track, 0.5)
    for (const kick of track.kicks.filter((k) => k > 12 && k < 24)) {
      expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    }
  })

  it('stays on the kicks when the media time it is fed jitters by 10ms a frame', () => {
    // The browser reports a media element's position with jitter of several
    // milliseconds, more than a hop. The hop clock must follow the samples,
    // with the media time only aligning it, or the jitter walks it off the music.
    const track = house(30, 128)
    const { hits } = play(track, 0.5, { stampJitterSec: 0.01 })
    const kicks = track.kicks.filter((k) => k > 6 && k < 24)
    for (const kick of kicks) expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    const between = hits.filter((h) => h.at > 6 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
  })

  it('keeps time across frames whose samples were lost', () => {
    const track = house(30, 128)
    const { hits } = play(track, 0.5, { loseEvery: 41 })
    const kicks = track.kicks.filter((k) => k > 10 && k < 24)
    const found = kicks.filter((k) => (hitFor(k, hits)?.response ?? 0) > 0.5)
    // A kick in a lost frame, or in the ~40ms the bands take to start over
    // after one, is not seen: about one kick in six at a loss every 41 frames.
    // What must hold is the clock: every kick that is seen lands on time and
    // nothing lands between them.
    expect(found.length).toBeGreaterThanOrEqual(Math.floor(kicks.length * 0.8))
    const between = hits.filter((h) => h.at > 10 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
  })
})

describe('DrumTracker on kicks in grooves other than four on the floor', () => {
  it.each([
    ['a jungle break at 172', 172, { kicks: () => [[0, 1], [2, 1], [10, 1], [11, 1]], snares: [4, 12] } as Groove],
    ['a hip-hop break at 92', 92, { kicks: () => [[0, 1], [7, 1], [10, 1]], snares: [4, 12] } as Groove],
    ['a swung groove at 118', 118, { kicks: () => [[0, 1], [4, 1], [8, 1], [11, 1], [12, 1]], snares: [4, 12], swing: 1 / 3 } as Groove],
    ['a 3-3-2 pattern at 125', 125, { kicks: () => [[0, 1], [6, 1], [12, 1]], snares: [4, 12] } as Groove],
    ['four on the floor with ghost kicks', 126, { kicks: () => [[0, 1], [4, 1], [7, 0.25], [8, 1], [12, 1], [15, 0.25]], snares: [4, 12] } as Groove],
  ])('fires on every kick of %s and nowhere else', (_name, bpm, groove) => {
    const track = drums(40, bpm, groove)
    const { hits } = play(track, 0.5)
    // 0.3, not the 0.75 of the house tests: these kicks overlap an unducked
    // bass at the kick's own pitch, and the energy they add over it is
    // honestly less than a kick alone (the jungle downbeat reads 0.46 every bar).
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('locks to the beat of a 3-3-2 pattern rather than to its kicks', () => {
    const { tracker } = play(drums(30, 125, { kicks: () => [[0, 1], [6, 1], [12, 1]], snares: [4, 12] }), 0.5)
    expect(tracker.tempoBpm).toBeGreaterThan(124)
    expect(tracker.tempoBpm).toBeLessThan(126)
  })

  it('fires on the kicks that are played when one in five is dropped at random', () => {
    const drop = noise(17)
    const track = drums(40, 126, { kicks: () => [0, 4, 8, 12].map((s) => [s, drop() > -0.6 ? 1 : 0] as [number, number]), snares: [4, 12] })
    const { hits } = play(track, 0.5)
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('shows nothing but kicks on a hip-hop break while frames are lost', () => {
    // The hardest case for the lock: a break's comb confidence is a quarter
    // of a four-on-the-floor track's, and before it locks every onset peak
    // (hats, snares, bass) used to flash at full strength.
    const track = drums(40, 92, { kicks: () => [[0, 1], [7, 1], [10, 1]], snares: [4, 12] })
    const { hits } = play(track, 0.5, { loseEvery: 41 })
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.8)
    expect(strays).toEqual([])
  })

  it('leaves the beat before a fill\'s downbeat dark, so the downbeat lands as a fresh hit', () => {
    // Every eighth bar ends in two beats of sixteenth toms and no kick, into
    // a kick and crash on the one. A tom pulsing a sixteenth before the one
    // left the pulse still falling when it landed, and it read as missed.
    const bpm = 126
    const beat = 60 / bpm
    const bar = 4 * beat
    const barOf = (t: number) => Math.floor(t / bar + 1e-6)
    const inFill = (t: number) => barOf(t) % 8 === 7 && t - barOf(t) * bar >= 2 * beat - 1e-6
    const isOne = (t: number) => barOf(t) % 8 === 0 && t > 1 && t - barOf(t) * bar < 1e-6
    const track = house(60, bpm, Infinity, Infinity, (t0) => (inFill(t0) ? 0 : isOne(t0) ? 1.4 : 1))
    track.kicks = track.kicks.filter((k) => !inFill(k))
    const rand = noise(21)
    for (let b = 7; b * bar < 60; b += 8) {
      for (let s = 0; s < 8; s++) {
        const t0 = b * bar + 2 * beat + (s * beat) / 4
        let phase = 0
        for (let i = 0; i < 0.1 * RATE; i++) {
          const at = Math.round(t0 * RATE) + i
          if (at >= track.samples.length) break
          const t = i / RATE
          phase += (2 * Math.PI * 140 * (1 + 0.5 * Math.exp(-t / 0.02))) / RATE
          track.samples[at] += 0.6 * Math.sin(phase) * Math.exp(-t / 0.08) + 0.3 * rand() * Math.exp(-t / 0.03)
        }
      }
      for (let i = 0; i < 2 * RATE; i++) {
        const at = Math.round((b + 1) * bar * RATE) + i
        if (at < track.samples.length) track.samples[at] += 0.4 * rand() * Math.exp(-i / RATE / 0.6)
      }
    }
    const { hits } = play(track, 0.5)
    for (const one of track.kicks.filter((k) => isOne(k) && k > 8 && k < 55)) {
      expect(hitFor(one, hits)?.response ?? 0, `downbeat at ${one.toFixed(3)}`).toBeGreaterThan(0.75)
      const before = hits.filter((h) => h.at > one - beat && h.at < one - EARLY_SEC && h.response > 0.3)
      expect(before, `before the downbeat at ${one.toFixed(3)}`).toEqual([])
    }
  })
})

/** White noise through `order` one-pole high-passes at `hz`: a bright burst with little below it. */
function brightNoise(hz: number, order: number, rand: () => number): () => number {
  const a = 1 / (1 + (2 * Math.PI * hz) / RATE)
  const x = new Float64Array(order + 1)
  const y = new Float64Array(order + 1)
  return () => {
    let input = rand()
    for (let k = 0; k < order; k++) {
      y[k] = a * (y[k] + input - x[k])
      x[k] = input
      input = y[k]
    }
    return input
  }
}

/** A snare: a 190Hz body decaying over 80ms under a burst of noise above 1kHz decaying over 120ms. */
function addSnare(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.5 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    out[at] += gain * (0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.08) + 0.6 * bright() * Math.exp(-t / 0.12))
  }
}

/** A closed hat: noise above 7kHz, decaying over 25ms. */
function addHat(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.15 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at < out.length) out[at] += gain * bright() * Math.exp(-i / RATE / 0.025)
  }
}

/** White noise through two one-pole low-passes at `hz`. */
function darkNoise(hz: number, rand: () => number): () => number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE)
  let y1 = 0
  let y2 = 0
  return () => {
    y1 += a * (rand() - y1)
    y2 += a * (y1 - y2)
    return y2
  }
}

/**
 * A mixed kick: `addKick`'s body with its beater click below 3kHz, where a
 * mastered kick's click sits, some 10dB under its body. `addKick`'s click is white to the top of the
 * spectrum, brighter than a hat, and a hat landing on it cannot be told from it.
 */
function addMixedKick(out: Float32Array, t0: number, click: () => number): void {
  let phase = 0
  for (let i = 0; i < 0.3 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
    out[at] += 0.9 * Math.sin(phase) * Math.exp(-t / 0.12) + 0.3 * click() * Math.exp(-t / 0.004)
  }
}

interface Kit {
  /** Sixteenths in a bar carrying each drum. */
  kicks: number[]
  snares: number[]
  hats: number[]
  /** Clap-like snares: noise only, no body (a clap or a rim shot's crack). */
  clap?: boolean
}

/**
 * A full kit over a bass line on every beat's second eighth, with the times
 * each drum was played. A snare is the same sound throughout; hats vary in
 * gain the way a played hat does.
 */
function kit(seconds: number, bpm: number, groove: Kit): { samples: Float32Array; kicks: number[]; snares: number[]; hats: number[] } {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(9)
  const click = darkNoise(3000, noise(17))
  const snareNoise = brightNoise(1000, 2, noise(13))
  const hatNoise = brightNoise(7000, 3, noise(15))
  const sixteenth = 60 / bpm / 4
  const played = { kicks: [] as number[], snares: [] as number[], hats: [] as number[] }
  for (let bar = 0; bar * 16 * sixteenth < seconds; bar++) {
    const at = (s: number) => (bar * 16 + s) * sixteenth
    for (const s of groove.kicks) { addMixedKick(out, at(s), click); played.kicks.push(at(s)) }
    for (const s of groove.snares) {
      if (groove.clap) addHat(out, at(s), 0, hatNoise)
      addSnare(out, at(s), 1, snareNoise)
      played.snares.push(at(s))
    }
    for (const s of groove.hats) { addHat(out, at(s), 0.35 + 0.1 * rand(), hatNoise); played.hats.push(at(s)) }
    for (let beat = 0; beat < 4; beat++) {
      const t0 = at(beat * 4 + 2)
      for (let i = 0; i < 2 * sixteenth * RATE; i++) {
        const k = Math.round(t0 * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
      }
    }
  }
  const within = (times: number[]) => times.filter((t) => t < seconds)
  return { samples: out, kicks: within(played.kicks), snares: within(played.snares), hats: within(played.hats) }
}

/**
 * What a song puts in the mids over a kit: a strummed chord on every eighth
 * (sawtooth strings to 4kHz with a pick's click, each strum landing a little
 * after the grid as a player's does) and a voice (noise between 300Hz and
 * 3.5kHz in syllables of uneven length and loudness), neither reaching the
 * hat's band. Added to `out` in place.
 */
function addBusyMids(out: Float32Array, bpm: number): void {
  const rand = noise(21)
  const pick = darkNoise(4000, brightNoise(800, 1, noise(23)))
  const voice = darkNoise(3500, brightNoise(300, 1, noise(25)))
  const eighth = 60 / bpm / 2
  const chords = [[82, 123, 165, 207], [110, 165, 220, 277], [98, 147, 196, 247], [73, 110, 147, 185]]
  for (let e = 0; e * eighth < out.length / RATE; e++) {
    const t0 = e * eighth + 0.004 + 0.012 * Math.abs(rand())
    const chord = chords[Math.floor(e / 8) % chords.length]
    const gain = 0.12 + 0.05 * rand()
    for (let i = 0; i < 0.6 * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= out.length) break
      const t = i / RATE
      let s = 0
      for (let n = 0; n < chord.length; n++) {
        // Strummed: each string a few ms after the last.
        const ts = t - 0.006 * n
        if (ts < 0) continue
        for (let h = 1; chord[n] * h < 4000; h++) s += Math.sin(2 * Math.PI * chord[n] * h * ts) / h
      }
      out[at] += gain * (0.25 * s * Math.min(1, t / 0.003) * Math.exp(-t / 0.25) + 0.6 * pick() * Math.exp(-t / 0.01))
    }
  }
  // The voice: syllables 80-400ms long, each its own loudness, with breaths between phrases.
  let t = 0
  while (t < out.length / RATE) {
    const length = 0.08 + 0.32 * Math.abs(rand())
    const gain = (Math.floor(t / 4) % 2 === 0 ? 0.5 : 0) * (0.6 + 0.4 * Math.abs(rand()))
    for (let i = 0; i < length * RATE; i++) {
      const at = Math.round(t * RATE) + i
      if (at >= out.length) break
      const u = i / RATE
      out[at] += gain * voice() * Math.min(1, u / 0.02) * Math.min(1, (length - u) / 0.03)
    }
    t += length + 0.03 * Math.abs(rand())
  }
}

/** `play` and `score` for one drum of a kit: the share of its hits found, and the hits that matched none of them. */
function scoreDrum(track: ReturnType<typeof kit>, drum: Drum, times: number[], options: PlayOptions = {}) {
  const { hits } = play({ samples: track.samples, kicks: times }, 0.5, options, drum)
  return score({ samples: track.samples, kicks: times }, hits, 10, 34, 0.3)
}

/** How long the kit's snare rings over a hat after it: its noise falls 6dB in about 70ms, measured from the end of its climb. */
const SNARE_RING_SEC = 0.15

describe('DrumTracker on snares and hats', () => {
  const rock: Kit = { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }

  it.each([
    ['a rock beat at 110', 110, rock],
    ['a hip-hop break at 92', 92, { kicks: [0, 7, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
    ['a jungle break at 172', 172, { kicks: [0, 2, 10, 11], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
    ['house with the clap on the kick at 126', 126, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14] }],
  ])('fires on every snare of %s and nowhere else', (_name, bpm, groove) => {
    const track = kit(40, bpm, groove)
    const { found, strays } = scoreDrum(track, 'snare', track.snares)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it.each([
    ['a rock beat at 110', 110, rock],
    ['sixteenth hats at 124', 124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }],
    ['off-beat hats in house at 126', 126, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14] }],
  ])('fires on every hat of %s off the snares, and nowhere else', (_name, bpm, groove) => {
    const track = kit(40, bpm, groove)
    // A hat on a snare, or in the ring of its noise after it, is the snare's: the snare wins (VOICES).
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, {}, 'hat')
    const { found } = score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3)
    // 0.9, not the kick's 0.95: a quiet stroke over the last of a snare's
    // noise, a quarter beat after it, is now and then lost under it.
    expect(found).toBeGreaterThan(0.9)
    const strays = hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
    expect(strays).toEqual([])
  })

  it.each([
    ['a rock beat at 110', 110, rock],
    ['sixteenth hats at 124', 124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }],
  ])('fires on every hat of %s under strummed guitars and a voice', (_name, bpm, groove) => {
    const track = kit(40, bpm, groove)
    addBusyMids(track.samples, bpm)
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, {}, 'hat')
    const { found } = score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3)
    const strays = hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
    expect(found).toBeGreaterThan(0.9)
    expect(strays).toEqual([])
  }, 30_000)

  it('leaves the kicks alone: neither the snare nor the hat fires on a kick by itself', () => {
    const track = kit(40, 110, rock)
    const lone = track.kicks.filter((k) => !track.snares.concat(track.hats).some((t) => Math.abs(t - k) < 0.001))
    for (const drum of ['snare', 'hat'] as const) {
      const { hits } = play({ samples: track.samples, kicks: lone }, 0.5, {}, drum)
      expect(lone.filter((k) => k > 10 && k < 34 && (hitFor(k, hits)?.response ?? 0) > 0.3), drum).toEqual([])
    }
  })

  it('keeps the kick as it was when the kit has every drum', () => {
    const track = kit(40, 110, rock)
    const { found, strays } = scoreDrum(track, 'kick', track.kicks)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('keeps the snare and the hat on time while the media time jitters and frames are lost', () => {
    const track = kit(40, 110, rock)
    const options = { stampJitterSec: 0.01, loseEvery: 41 }
    const snare = scoreDrum(track, 'snare', track.snares, options)
    expect(snare.found).toBeGreaterThan(0.8)
    expect(snare.strays).toEqual([])
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, options, 'hat')
    // A lost frame every 41 (one every 0.7s) blinds the hat for the frame
    // and the 85ms after it, where what a climb started from is the silence
    // the gap was filled with (`DrumTracker.settle`): about a fifth of these
    // dense hats.
    expect(score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3).found).toBeGreaterThan(0.7)
    expect(hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))).toEqual([])
  })
})

describe('DrumTracker on identical hits', () => {
  it('pulses identical kicks of a syncopated groove identically, wherever in the bar they land', () => {
    // A slow groove whose period is no whole number of hops, so each slot's
    // memory smears across neighbouring bins by a different amount.
    const track = drums(60, 79.2, { kicks: () => [[0, 1], [3, 1], [6, 1], [10, 1], [11, 1]], snares: [4, 12] })
    const responses = play(track, 0.5).hits.filter((h) => h.at > 20).map((h) => h.response).sort((a, b) => a - b)
    expect(responses.length).toBeGreaterThan(50)
    // Including the kick that lands as a bass note stops, whose climb over
    // the note reads a few dB short of an identical kick's over silence.
    expect(responses.filter((r) => r > 0.99).length / responses.length).toBeGreaterThan(0.95)
  })
})

describe('DrumCursor', () => {
  it('finds the hits of a new tracker at once after reading an older one, as a reader kept across a restart does', () => {
    const track = house(60, 124)
    const cursor = new DrumCursor()
    // Each tracker is fed from LEAD before its first question, as the
    // analysis decodes the window either side of the listener on a restart.
    const LEAD = 6
    const read = (from: number, to: number) => {
      const tracker = new DrumTracker(RATE)
      const at = Math.max(0, Math.round((from - 5) * RATE))
      let fed = at
      const hits: number[] = []
      for (let heard = from; heard < to; heard += 1 / 60) {
        const end = Math.min(track.samples.length, Math.round((heard + LEAD) * RATE))
        if (end > fed) tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
        fed = Math.max(fed, end)
        if (tracker.hitBetween('kick', cursor, heard, 0.5) > 0) hits.push(heard)
      }
      return hits
    }
    expect(read(0, 30).length).toBeGreaterThan(40)
    // A seek back: the second tracker's hops count from zero again.
    const after = read(10, 20)
    expect(after[0]).toBeLessThan(11.5)
  })
})

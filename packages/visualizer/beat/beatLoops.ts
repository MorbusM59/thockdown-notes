/**
 * The delay calibration's LOOPS (`BeatLoopCalibration.tsx`): drum tracks
 * built for it (each app ships the files of the loops it offers), whose hits are written down here (each loop's
 * `score`) rather than detected, so what the reader judges is the timing
 * alone. How a loop is PLAYED is each app's (`BeatLoopPlayer`): it must take
 * the music's own path to the speaker, or the delay set against it would not
 * be the music's -- the desktop's Web Audio output, the phone's native one.
 */
export type LoopChannel = 'thump' | 'pierce' | 'tick'

/** A hit: when in the bar, and how strong (0..1). */
export interface LoopHit {
  sec: number
  strength: number
}

/** What a loop's score holds: every channel's hits in one bar. */
export type LoopScore = Readonly<Record<LoopChannel, readonly LoopHit[]>>

/** A calibration loop's timing: what is heard when, whatever file carries it. */
export interface LoopTiming {
  /** The track's length, exactly: its frame count over its rate. */
  trackSec: number
  /** Seconds after which the rhythm repeats; the track is a whole number of them. */
  barSec: number
  /** The hits of one bar, as the loop was programmed (its author's piano roll or MIDI). */
  score: LoopScore
}

/**
 * Hits at sixteenths of a bar, each with its strength. `swing` delays the
 * off sixteenths (the 2nd and 4th of each beat) by that share of a sixteenth.
 */
function atSixteenths(barSec: number, hits: Readonly<Record<number, number>>, swing = 0): LoopHit[] {
  const sixteenthSec = barSec / 16
  return Object.entries(hits).map(([at, strength]) => {
    const sixteenth = Number(at)
    return { sec: (sixteenth + (sixteenth % 2) * swing) * sixteenthSec, strength }
  })
}

/** 01: four bars at 87 BPM (529656 frames at 48 kHz). */
const LOOP_01_BAR_SEC = 529656 / 48000 / 4
/**
 * 01 is played with Ableton's "Swing 16-85" groove: its hits on the off
 * sixteenths measure 0.40 to 0.46 of a sixteenth (32 to 37 ms) late.
 */
const LOOP_01_SWING = 0.42

/** 02: 16 s (768000 frames), its rhythm repeating every four seconds; the ticks are sextuplets, 24 to the bar. */
const LOOP_02_BAR_SEC = 4
/** 02's ticks with a rim shot on them (the 3rd, 6th, 15th and 18th of 24): louder, so drawn stronger. */
const LOOP_02_RIM_SHOTS = new Set([2, 5, 14, 17])

/** 03: eight bars at 120 BPM, no swing (768000 frames). */
const LOOP_03_BAR_SEC = 2

/**
 * 04: 120 BPM, no swing (384000 frames, 8 s). Its kicks run over the whole
 * track, four bars (in beats, from its author's roll), so the track is one
 * pattern; its snare part, two stick sounds in sixteenths (from its MIDI,
 * velocities 111 and 90 drawn as 1 and 0.8), repeats in each of the four bars.
 */
const LOOP_04_SEC = 8
const LOOP_04_BEAT_SEC = 0.5
const LOOP_04_KICK_BEATS = [0, 0.5, 4, 4.5, 6.5, 8, 8.5, 12, 12.5, 15.5]
const LOOP_04_SNARES: Readonly<Record<number, number>> = {
  0: 1, 1: 0.8, 2: 0.8, 3: 0.8, 3.5: 0.8, 4: 0.8, 5: 0.8, 6: 1, 7: 0.8, 7.5: 0.8, 8: 0.8, 9: 0.8, 10: 0.8, 11: 0.8, 11.5: 0.8, 12: 1, 13: 0.8, 14: 0.8, 15: 0.8, 15.5: 0.8,
}

/**
 * 05: 100 BPM (460800 frames, 9.6 s), a two-bar pattern played twice, read
 * off its author's roll in sixteenths of the two bars; strengths follow the
 * roll's velocities (full, mid 0.7, soft 0.4). Played with Ableton's
 * "Swing 16-45": its off sixteenths measure about 0.2 of a sixteenth (30 ms) late.
 */
const LOOP_05_BAR_SEC = 4.8
const LOOP_05_SWING = 0.2

/**
 * 06: 120 BPM, no swing (384000 frames, 8 s): four bars, the whole track one
 * pattern. From its MIDI, in sixteenths with their velocities (the loudest of
 * several notes at once): the kick (MIDI 40) is the thump, the rim and the
 * clap (38, 37) the pierce, and the four hats (39, 41, 42, 43) the tick.
 */
const LOOP_06_SEC = 8
const LOOP_06_THUMP = { 0: 94, 10: 94, 13: 94, 16: 94, 26: 63, 32: 94, 42: 94, 45: 94, 48: 94, 56: 115, 58: 94 }
const LOOP_06_PIERCE = { 4: 60, 12: 84, 20: 63, 28: 63, 36: 60, 44: 84, 52: 63, 60: 105 }
const LOOP_06_TICK = { 0: 87, 1: 41, 2: 100, 3: 60, 4: 116, 5: 87, 6: 97, 8: 87, 9: 55, 10: 82, 11: 87, 12: 116, 13: 87, 14: 97, 16: 87, 17: 41, 18: 100, 19: 60, 20: 116, 21: 87, 22: 97, 24: 87, 25: 55, 26: 82, 27: 87, 28: 116, 29: 87, 30: 97, 32: 87, 33: 41, 34: 100, 35: 60, 36: 116, 37: 87, 38: 97, 40: 87, 41: 55, 42: 82, 43: 87, 44: 116, 45: 87, 46: 97, 48: 87, 49: 41, 50: 100, 51: 60, 52: 116, 53: 87, 54: 97, 56: 87, 57: 55, 58: 82, 59: 87, 60: 116, 61: 87, 62: 97 }
/** MIDI velocities as strengths. */
const byVelocity = (notes: Readonly<Record<number, number>>): Record<number, number> =>
  Object.fromEntries(Object.entries(notes).map(([at, velocity]) => [at, velocity / 127]))

/**
 * 07: 165 BPM, no swing: two bars, the whole track one pattern (139637
 * frames: two bars are 139636.4, so the track's own length is what the loop
 * keeps time by). From its MIDI, all at velocity 100: the kick (MIDI 36) is
 * the thump, the snare (40) the pierce, the two closed hats (42, 44) the tick.
 */
const LOOP_07_SEC = 139637 / 48000
const LOOP_07_THUMP = { 0: 100, 10: 100, 16: 100, 26: 100 }
const LOOP_07_PIERCE = { 4: 100, 12: 100, 20: 100, 28: 100 }
const LOOP_07_TICK = { 2: 100, 6: 100, 7: 100, 10: 100, 14: 100, 18: 100, 22: 100, 25: 100, 26: 100, 30: 100 }

/**
 * The loops' timing, each by its number: the audio is the app's to ship
 * (`BeatLoop.url`), so an app carries only the loops it offers.
 */
export const LOOP_01: LoopTiming = {
  trackSec: 529656 / 48000,
  barSec: LOOP_01_BAR_SEC,
  score: {
    thump: atSixteenths(LOOP_01_BAR_SEC, { 0: 1, 2: 1, 9: 0.3, 10: 1, 13: 1 }, LOOP_01_SWING),
    pierce: atSixteenths(LOOP_01_BAR_SEC, { 4: 1, 7: 0.5, 12: 1 }, LOOP_01_SWING),
    tick: atSixteenths(LOOP_01_BAR_SEC, { 0: 1, 2: 1, 4: 1, 6: 0.5, 8: 0.5, 10: 1, 12: 1, 14: 0.5 }, LOOP_01_SWING),
  },
}

export const LOOP_02: LoopTiming = {
  trackSec: 16,
  barSec: LOOP_02_BAR_SEC,
  score: {
    thump: [0, 0.8335, 2.3315, 2.8335].map((sec) => ({ sec, strength: 1 })),
    pierce: [1, 3].map((sec) => ({ sec, strength: 1 })),
    tick: Array.from({ length: 24 }, (_, i) => ({ sec: (i * LOOP_02_BAR_SEC) / 24, strength: LOOP_02_RIM_SHOTS.has(i) ? 1 : 0.5 })),
  },
}

export const LOOP_03: LoopTiming = {
  trackSec: 16,
  barSec: LOOP_03_BAR_SEC,
  score: {
    thump: atSixteenths(LOOP_03_BAR_SEC, { 0: 1, 10: 1, 13: 1 }),
    pierce: atSixteenths(LOOP_03_BAR_SEC, { 6: 1 }),
    tick: atSixteenths(LOOP_03_BAR_SEC, { 4: 1, 12: 1 }),
  },
}

export const LOOP_04: LoopTiming = {
  trackSec: LOOP_04_SEC,
  barSec: LOOP_04_SEC,
  score: {
    thump: LOOP_04_KICK_BEATS.map((beat) => ({ sec: beat * LOOP_04_BEAT_SEC, strength: 1 })),
    pierce: [0, 1, 2, 3].flatMap((bar) => atSixteenths(2, LOOP_04_SNARES).map((hit) => ({ ...hit, sec: hit.sec + bar * 2 }))),
    tick: [],
  },
}

export const LOOP_05: LoopTiming = {
  trackSec: 9.6,
  barSec: LOOP_05_BAR_SEC,
  // Sixteenths counted on through both bars: given one bar (2.4 s), sixteenths 16 to 31 fall in the second.
  score: {
    thump: atSixteenths(LOOP_05_BAR_SEC / 2, { 0: 1, 9: 0.7, 11: 0.4, 16: 0.7, 25: 0.7, 27: 0.4, 29: 0.7, 30: 0.4, 31: 0.4 }, LOOP_05_SWING),
    pierce: atSixteenths(LOOP_05_BAR_SEC / 2, { 4: 0.7, 12: 1, 20: 0.7, 28: 1 }, LOOP_05_SWING),
    tick: atSixteenths(LOOP_05_BAR_SEC / 2, { 2: 1, 6: 0.7, 10: 0.7, 14: 1, 18: 0.7, 22: 0.7, 26: 1, 30: 0.7 }, LOOP_05_SWING),
  },
}

export const LOOP_06: LoopTiming = {
  trackSec: LOOP_06_SEC,
  barSec: LOOP_06_SEC,
  // Sixteenths counted on through all four bars: given one bar (2 s), sixteenths 16 to 63 fall in the later ones.
  score: {
    thump: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_THUMP)),
    pierce: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_PIERCE)),
    tick: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_TICK)),
  },
}

export const LOOP_07: LoopTiming = {
  trackSec: LOOP_07_SEC,
  barSec: LOOP_07_SEC,
  // Sixteenths counted on through both bars: given one bar, sixteenths 16 to 31 fall in the second.
  score: {
    thump: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_THUMP)),
    pierce: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_PIERCE)),
    tick: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_TICK)),
  },
}

/** The latest hit of `channel` at bar time `barSec` (0..the loop's bar), and how long ago it was; a hit late in the bar is still falling at the start of the next. */
export function lastHit(loop: LoopTiming, channel: LoopChannel, barSec: number): { strength: number; agoSec: number } {
  let latest = { strength: 0, agoSec: Infinity }
  for (const hit of loop.score[channel]) {
    const ago = barSec - hit.sec
    const agoSec = ago >= 0 ? ago : ago + loop.barSec
    if (agoSec < latest.agoSec) latest = { strength: hit.strength, agoSec }
  }
  return latest
}

/** A calibration loop as an app offers it: its timing and the file it ships it in. */
export interface BeatLoop extends LoopTiming {
  url: string
}

export interface LoopRun {
  /** Where in its bar (0..its bar) the loop the reader is hearing now is; NaN before the first report. */
  heardBarSec(frameTimeMs: number, delaySec: number): number
  stop(): void
}

/** Plays `loop` on the music's path; `onFailed` is told if it cannot play. */
export type BeatLoopPlayer = (loop: BeatLoop, onFailed: () => void) => LoopRun

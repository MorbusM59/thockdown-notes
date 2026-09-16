// Deterministic randomness: statistically fine, entirely reproducible.
//
// A run is replayable from its seed plus the ordered list of choices made,
// which is what makes a defect REPORTABLE rather than merely describable
// ("the bear killed me in one hit" is a bug report only if the same bear
// can be summoned again). That requires two disciplines, and the second is
// the one that gets broken quietly:
//
//   1. No Math.random, no Date.now, anywhere below the director. The state
//      is threaded through every call: a function that draws takes the
//      state in and hands the next one back.
//   2. DRAWS HAPPEN IN `resolve`, NEVER IN `present`. A stage that rolls
//      while building its cells makes the draw order depend on how many
//      times React re-rendered, and determinism is gone with no symptom
//      until someone tries to reproduce a run. Anything a screen needs to
//      SHOW is rolled when the previous choice resolved, and stored in
//      stage state until it is shown.
//
// mulberry32: one 32-bit word of state, a period of 2^32, and a uniform
// output. Chosen because the state is a single number -- it serializes into
// the save as a field rather than as a structure, which matters when the
// save is the thing the promise above rests on.

export type RngState = number

export interface Draw<T> {
  value: T
  rng: RngState
}

/** Normalizes anything into a usable 32-bit state. */
export function toRngState(value: number): RngState {
  return Math.floor(Math.abs(value)) >>> 0
}

/** A fresh seed. The ONLY place the game is allowed to consult the clock. */
export function createSeed(nowMs: number): RngState {
  return toRngState(nowMs ^ 0x9e3779b9)
}

/** A uniform draw in [0, 1). */
export function nextFloat(rng: RngState): Draw<number> {
  let t = (rng + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, rng: t >>> 0 }
}

/** A whole number in [min, max], both ends included. A D6 is (1, 6). */
export function nextInt(rng: RngState, min: number, max: number): Draw<number> {
  const draw = nextFloat(rng)
  const span = Math.max(0, Math.floor(max) - Math.floor(min))
  return { value: Math.floor(min) + Math.floor(draw.value * (span + 1)), rng: draw.rng }
}

/**
 * ONE CHANCE, ROLLED, with its working shown: what came up, what it had to
 * come in under, and whether it did.
 *
 * The game tells the player what happened in glyphs, and every pill's tooltip
 * documents the arithmetic behind it -- which is only possible if a roll is a
 * VALUE rather than a boolean somebody threw the number away to make. This is
 * that value; `nextChance` is it with the working discarded, defined in terms
 * of it so the two cannot come to disagree about what "passed" means.
 *
 * Both numbers are 0..1. Read as "rolled 42, needed under 65".
 */
export interface Roll {
  rolled: number
  needed: number
  passed: boolean
}

export function nextRoll(rng: RngState, probability: number): Draw<Roll> {
  const draw = nextFloat(rng)
  return {
    value: { rolled: draw.value, needed: probability, passed: draw.value < probability },
    rng: draw.rng,
  }
}

/** True with the given probability. Out-of-range probabilities are honest: 0 never, 1 always. */
export function nextChance(rng: RngState, probability: number): Draw<boolean> {
  const draw = nextRoll(rng, probability)
  return { value: draw.value.passed, rng: draw.rng }
}

/** One element, uniformly. Null for an empty pool rather than undefined behaviour. */
export function nextPick<T>(rng: RngState, pool: readonly T[]): Draw<T | null> {
  if (pool.length === 0) return { value: null, rng }
  const draw = nextInt(rng, 0, pool.length - 1)
  return { value: pool[draw.value], rng: draw.rng }
}

/**
 * `count` distinct elements, in draw order. Fewer than asked for when the
 * pool is smaller -- a screen offering three of two things is a content
 * problem to be seen, not an exception to be caught.
 */
export function nextSample<T>(rng: RngState, pool: readonly T[], count: number): Draw<T[]> {
  const remaining = [...pool]
  const picked: T[] = []
  let state = rng
  while (picked.length < count && remaining.length > 0) {
    const draw = nextInt(state, 0, remaining.length - 1)
    state = draw.rng
    picked.push(remaining.splice(draw.value, 1)[0])
  }
  return { value: picked, rng: state }
}

/**
 * A weighted pick. Weights at or below zero are unreachable rather than
 * negative-probability, which is the only reading that lets content switch
 * an entry off by setting its weight to 0.
 */
export function nextWeighted<T>(rng: RngState, pool: readonly T[], weightOf: (item: T) => number): Draw<T | null> {
  const candidates = pool.filter((item) => weightOf(item) > 0)
  if (candidates.length === 0) return { value: null, rng }
  const total = candidates.reduce((sum, item) => sum + weightOf(item), 0)
  const draw = nextFloat(rng)
  let remaining = draw.value * total
  for (const item of candidates) {
    remaining -= weightOf(item)
    if (remaining < 0) return { value: item, rng: draw.rng }
  }
  return { value: candidates[candidates.length - 1], rng: draw.rng }
}

// How much stronger a monster gets as the run goes on.
//
// ONE curve, `factor^level`, with the factor chosen once per run. It applies
// to MONSTERS ONLY and to exactly two of their derived values -- hit points
// and the damage multiplier. Not to the chances: `1.05^level` on a 0..1
// chance saturates rather than scales, and a monster whose dodge is pinned
// at 100% by level 15 has stopped being stronger and started being
// unhittable. Not to the action count either, for now: an extra action is a
// whole extra decision in the round, which is a bigger step than a curve
// should take on its own.
//
// The player does NOT scale this way, deliberately. Their growth is stat
// points plus items and traits, and leveraging those well is meant to be
// where the advantage comes from.
//
// "Difficulty" here is the RUN's preset. It is a different thing from the
// design plan's "Difficulty Rating", which is the number added to a D6 in a
// stat check (model/checks.ts) -- the two share a word and nothing else.

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]

/** The per-level factor. Named rather than inlined: these are tuning, and tuning gets tuned. */
export const DIFFICULTY_POWER_FACTOR: Readonly<Record<Difficulty, number>> = {
  easy: 1.02,
  normal: 1.05,
  hard: 1.1,
  insane: 1.2,
}

/**
 * Nothing presents a difficulty choice yet, and the save does not carry one.
 * Named here so the day it is chosen there is one place that stops being the
 * default, rather than a literal spread through the monster builder.
 */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal'

/**
 * `factor^level`, the multiplier on a monster's hit points and damage.
 *
 * The exponent is the LEVEL as numbered, so a level-1 monster is already one
 * factor up from base. Whether it should be `level - 1` is an open question
 * (adventure-platform.md), and it is one line here when it is answered --
 * which is the reason this is a function and not an expression at the call
 * site.
 */
export function powerMultiplier(level: number, difficulty: Difficulty = DEFAULT_DIFFICULTY): number {
  const safeLevel = Math.max(0, Math.floor(level))
  return DIFFICULTY_POWER_FACTOR[difficulty] ** safeLevel
}

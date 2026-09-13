// How much stronger a monster is than its stats say, and how fast that grows.
//
// TWO NUMBERS PER PRESET, not one. A single growth factor could only make
// the late game harder or easier; it could do nothing about the FIRST fight,
// which is where a run is actually lost. So a preset sets a BASE -- what a
// monster's hit points and damage are worth at level zero, as a fraction of
// what its stats derive -- and a GROWTH the level exponentiates on top.
//
//     power = base x growth^level
//
// It applies to MONSTERS ONLY and to exactly two of their derived values --
// hit points and the damage multiplier. Not to the chances: `1.05^level` on
// a 0..1 chance saturates rather than scales, and a monster whose dodge is
// pinned at 100% by level 15 has stopped being stronger and started being
// unhittable. Not to the action count either: an extra action is a whole
// extra decision in the round, which is a bigger step than a curve should
// take on its own.
//
// The player does NOT scale this way, deliberately. Their growth is stat
// points plus items and traits, and leveraging those well is meant to be
// where the advantage comes from.
//
// "Difficulty" here is the RUN's preset. It is a different thing from the
// design plan's "Difficulty Rating", which is the number added to a D6 in a
// stat check (model/checks.ts) -- the two share a word and nothing else.

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const

export type Difficulty = (typeof DIFFICULTIES)[number]

export interface DifficultyPreset {
  /** What a monster's hit points and damage are worth before the curve. */
  base: number
  /** Compounded per level, on top of the base. */
  growth: number
}

/** Named rather than inlined: these are tuning, and tuning gets tuned. */
export const DIFFICULTY_PRESETS: Readonly<Record<Difficulty, DifficultyPreset>> = {
  easy: { base: 0.5, growth: 1.01 },
  medium: { base: 0.8, growth: 1.02 },
  hard: { base: 1.0, growth: 1.05 },
  extreme: { base: 1.2, growth: 1.1 },
}

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  extreme: 'Extreme',
}

/**
 * MEDIUM, and that is a decision rather than the middle of the list. `hard`
 * is the old single-curve behaviour exactly (base 1, growth 1.05) and it is
 * the tuning under which a level-one warrior loses their first fight without
 * a hope -- so it is a preset somebody may choose and not the one they get
 * for never having been asked.
 */
export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value)
}

/**
 * `base x growth^level`, the multiplier on a monster's hit points and damage.
 *
 * The exponent is the LEVEL as numbered, so a level-1 monster is already one
 * growth step above the base -- which is what the presets were written
 * against. Whether it should be `level - 1` is an open question
 * (adventure-platform.md); it is one line here when it is answered, which is
 * the reason this is a function and not an expression at the call site.
 */
export function powerMultiplier(level: number, difficulty: Difficulty = DEFAULT_DIFFICULTY): number {
  const safeLevel = Math.max(0, Math.floor(level))
  const preset = DIFFICULTY_PRESETS[difficulty]
  return preset.base * preset.growth ** safeLevel
}

/** How a preset reads where it is chosen: what it does, in the two numbers it is. */
export function describeDifficulty(difficulty: Difficulty): string[] {
  const preset = DIFFICULTY_PRESETS[difficulty]
  return [
    `Monster hit points and damage at ${Math.round(preset.base * 100)}%`,
    `+${Math.round((preset.growth - 1) * 100)}% compounding each level`,
  ]
}

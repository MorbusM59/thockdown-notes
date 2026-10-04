// PROGRESSION: how fast a monster outgrows what its stats say.
//
//     power = progression ^ level
//
// ONE NUMBER, chosen on a slider (the options panel's Adventure section),
// from 1.01 to 1.25. It is the BASE OF THE EXPONENTIAL in the mathematical
// sense -- what the level exponentiates -- which is why its range starts
// just above one: at 1.01 a monster is one percent stronger per level, and
// at 1.25 it is a quarter stronger per level and the curve runs away from
// the player inside a run.
//
// It applies to MONSTERS ONLY and to exactly two of their derived values --
// hit points and the damage multiplier. Not to the chances: `1.05^level` on
// a 0..1 chance saturates rather than scales, and a monster whose dodge is
// pinned at 100% by level 15 has stopped being stronger and started being
// unhittable. Not to the action count either: an extra action is a whole
// extra decision in the round, which is a bigger step than a curve should
// take on its own.
//
// The player does NOT scale this way, deliberately. Their growth is tier,
// stat points, items and traits, and leveraging those well is meant to be
// where the advantage comes from.
//
// THE LEVEL-ZERO MULTIPLIER IS GONE, and that is the one thing here that was
// decided rather than specified. What preceded this was four PRESETS, each a
// (base, growth) pair, and the argument for the pair was that a single
// growth factor can only move the LATE game -- it does nothing about the
// first fight, which is where a run is actually lost. That argument was
// right and is now answered by the OTHER slider: the thumb (`successAdjust`,
// model/chance.ts) is flat, immediate and reaches the very first roll, so
// the two sliders between them cover both axes -- one bends the curve, one
// lifts the whole line. A hidden third number doing half of each would be
// the overlap the vectors were separated to end. So the base is 1: a monster
// at level zero is worth exactly what its stats derive.
//
// "Progression" here is the RUN's curve. It is a different thing from the
// design plan's "Difficulty Rating", which is the number added to a D6 in a
// stat check (model/checks.ts) -- unrelated, and no longer sharing a word.

/** The gentlest curve the slider offers, and the default a run starts under. */
export const PROGRESSION_MIN = 1.01

/** The steepest. A quarter again per level compounds to ~9x over a dozen. */
export const PROGRESSION_MAX = 1.25

/** One step of the slider. Twenty-five positions, which a dial can hold. */
export const PROGRESSION_STEP = 0.01

/**
 * THE MINIMUM, deliberately, and not the middle of the range.
 *
 * The preset this replaced defaulted to the middle on the argument that the
 * gentlest setting was not what somebody should get for never having been
 * asked. That is inverted now, because the slider is IN FRONT OF THEM: it
 * sits in the options panel with its value on its tooltip, so the gentlest
 * default is a starting point they can see and raise rather than a decision
 * taken for them somewhere they never looked.
 */
export const DEFAULT_PROGRESSION = PROGRESSION_MIN

export function clampProgression(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PROGRESSION
  return Math.min(PROGRESSION_MAX, Math.max(PROGRESSION_MIN, value))
}

/**
 * `progression ^ level`, the multiplier on a monster's hit points and damage.
 *
 * The exponent is the LEVEL as numbered, so a level-1 monster is already one
 * step above par. Whether it should be `level - 1` is an open question
 * (adventure-platform.md); it is one line here when it is answered, which is
 * the reason this is a function and not an expression at the call site.
 */
export function powerMultiplier(level: number, progression: number = DEFAULT_PROGRESSION): number {
  return clampProgression(progression) ** Math.max(0, Math.floor(level))
}

/** How the slider reads where it is shown: the curve, in the words it means. */
export function describeProgression(progression: number): string {
  return `+${Math.round((clampProgression(progression) - 1) * 100)}% monster hit points and damage, compounding each level`
}

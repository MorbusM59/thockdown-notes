// The stat check, in one place, so the game has exactly one of them.
//
// The rule: roll a D6, add the encounter's Difficulty Rating, and the check
// passes if the stat MATCHES OR EXCEEDS that total. The die is the
// OPPOSITION, not the player's contribution -- a stat of 6 always beats DR
// 0, and DR 6 cannot be beaten at all. Worth stating plainly because the
// inverse convention (stat + d6 against a target) is the more common one in
// tabletop games and reads identically in prose.
//
// A check also reports HOW WELL it went, because some of them are not
// pass/fail at all: reading tracks yields "some sort of creature" at a bare
// pass and "a hulking orc warrior" at a wide one, from the same roll. The
// margin is the whole difference, so it is returned rather than recomputed
// by every caller that cares.

import { nextInt, type RngState } from '../core/rng'

export const CHECK_DIE_SIDES = 6

/**
 * How well a check went, for content that reads in degrees rather than in
 * outcomes. Kept to four bands because a ladder of prose per enemy is
 * content somebody has to write, and four is already a lot of writing.
 */
export type CheckTier = 'failed' | 'marginal' | 'solid' | 'complete'

export interface CheckResult {
  passed: boolean
  tier: CheckTier
  /** The die alone. */
  roll: number
  /** roll + difficultyRating: what the stat had to match or beat. */
  target: number
  /** statValue - target. Negative on a failure. */
  margin: number
  statValue: number
  rng: RngState
}

export function tierForMargin(margin: number): CheckTier {
  if (margin < 0) return 'failed'
  if (margin >= 4) return 'complete'
  if (margin >= 2) return 'solid'
  return 'marginal'
}

export function resolveCheck(
  statValue: number,
  difficultyRating: number,
  rng: RngState,
  dieSides: number = CHECK_DIE_SIDES,
): CheckResult {
  const draw = nextInt(rng, 1, dieSides)
  const target = draw.value + difficultyRating
  const margin = statValue - target
  return {
    passed: margin >= 0,
    tier: tierForMargin(margin),
    roll: draw.value,
    target,
    margin,
    statValue,
    rng: draw.rng,
  }
}

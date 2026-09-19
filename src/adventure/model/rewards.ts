// What a won encounter pays, and the one escalating check that decides how
// much of it there is.
//
// Two rewards, ONE procedure. After a fight the player rolls for an extra
// loot screen; on a success they roll again at fifty points worse, and again,
// until one fails. Motes work identically, against Intellect instead of Luck.
// Writing that twice would be two places to fix the day the penalty changes,
// so it is one function taking a declared chance (model/chance.ts).
//
// The monster's TYPE raises the starting chance, and raises it PAST CERTAINTY
// on purpose. At a stat of zero, the run of chances per type is:
//
//   regular   50%
//   elite    100%,  50%
//   mini     150%, 100%,  50%
//   boss     200%, 150%, 100%, 50%
//
// -- so an elite guarantees a second screen, a mini boss guarantees the first
// extra and offers a third extra at a coin flip, and a boss's second extra is
// guaranteed too. That is exactly why the repeat penalty comes off the RAW
// chance and not a clamped one: clamp first and a boss's 200% becomes 100%,
// then 50%, and three certainties collapse into one and a coin flip.

import { clampChance, rawChance, type StatChance } from './chance'
import { nextChance, type RngState } from '../core/rng'
import type { MonsterType } from './monsters'
import type { StatBlock } from './stats'

/** Every repeat is this much less likely than the one before. */
export const REWARD_REPEAT_PENALTY = 0.5

/** Added to the starting chance by what was killed. */
export const MONSTER_TYPE_REWARD_BONUS: Readonly<Record<MonsterType, number>> = {
  runt: 0,
  regular: 0,
  elite: 0.5,
  miniBoss: 1,
  boss: 1.5,
}

/** An extra loot screen, checked against Luck. */
export const EXTRA_LOOT_CHANCE: StatChance = { base: 0.5, perPoint: 0.05, stat: 'luck' }

/** An extra mote of experience, checked against Intellect. */
export const EXTRA_MOTE_CHANCE: StatChance = { base: 0.5, perPoint: 0.05, stat: 'intellect' }

/** A loot screen's gold branch. Always exactly one piece; an item is the alternative. */
export const GOLD_PER_LOOT_SCREEN = 1

/** Every won encounter pays this much experience before the check runs at all. */
export const BASE_MOTES_PER_ENCOUNTER = 1

/**
 * How many times the escalating check succeeds before it fails: the number of
 * EXTRA awards, on top of the one that is automatic.
 *
 * There is no opponent -- the fight is over -- so the stat is read
 * uncontested, which is what makes `50% + 5% x Luck` mean what it says.
 */
export function countRepeatedAwards(
  chance: StatChance,
  stats: StatBlock,
  typeBonus: number,
  rng: RngState,
): { count: number; rng: RngState } {
  const start = rawChance(chance, stats) + typeBonus
  let count = 0
  let state = rng
  for (;;) {
    const value = start - REWARD_REPEAT_PENALTY * count
    // Nothing left to roll: every repeat only subtracts, so a chance at or
    // below zero can never come back. Stopping rather than rolling a certain
    // failure also keeps the seed's consumption proportional to what happened.
    if (value <= 0) return { count, rng: state }
    const draw = nextChance(state, clampChance(value))
    state = draw.rng
    if (!draw.value) return { count, rng: state }
    count += 1
  }
}

export interface EncounterReward {
  /** Loot screens shown, each a choice between one gold and an item. Always at least one. */
  lootScreens: number
  /**
   * Motes of experience. One is automatic; the rest come from the same
   * escalating check against Intellect.
   *
   * Awarded AFTER every loot screen has been through, as the player returns
   * to the encounter selection -- so the sequence reads as "what you found,
   * then what you learned" rather than interleaving the two.
   */
  motes: number
}

export function rewardFor(
  stats: StatBlock,
  type: MonsterType,
  rng: RngState,
): { reward: EncounterReward; rng: RngState } {
  const bonus = MONSTER_TYPE_REWARD_BONUS[type]
  const loot = countRepeatedAwards(EXTRA_LOOT_CHANCE, stats, bonus, rng)
  const motes = countRepeatedAwards(EXTRA_MOTE_CHANCE, stats, bonus, loot.rng)
  return {
    reward: {
      lootScreens: 1 + loot.count,
      motes: BASE_MOTES_PER_ENCOUNTER + motes.count,
    },
    rng: motes.rng,
  }
}

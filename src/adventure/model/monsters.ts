// A monster's numbers, built the same way a player's are and then scaled.
//
// The pipeline, in order, and the order is the whole of it:
//
//   class base stats -> + type shift -> derive (against the player)
//                    -> x power multiplier, on health and damage only
//
// A monster is a CLASS (which supplies base stats, on the same scale the
// player's origins use) and a TYPE (which shifts every one of those stats by
// a flat amount). The two are orthogonal: a mini boss is a random class
// carrying the mini-boss type, not a creature of its own.
//
// Base stats are NOT clamped to the player's cap of 6. That cap is a rule
// about a player's own progression -- what they can reach before gear -- and
// a boss at +3 on a class base of 2 is meant to be past it.

import { powerMultiplier, type Difficulty } from './difficulty'
import { addStats, deriveStats, type DerivedStats, type StatBlock } from './stats'

export const MONSTER_TYPES = ['group', 'regular', 'elite', 'miniBoss', 'boss'] as const

export type MonsterType = (typeof MONSTER_TYPES)[number]

/** What the type adds to EVERY base stat. */
export const MONSTER_TYPE_STAT_SHIFT: Readonly<Record<MonsterType, number>> = {
  group: -1,
  regular: 0,
  elite: 1,
  miniBoss: 2,
  boss: 3,
}

/**
 * The base chance a charisma action fails against a monster of this type,
 * before the tier-and-usage term is added.
 *
 * This is where a monster's resistance to being talked at lives -- which is
 * why the tier term's divisor is the player's own Charisma and not a
 * contested one. Contesting it too would divide by `charisma - intellect`,
 * which is zero or negative whenever the monster is the smarter one.
 *
 * A GROUP never resists: crowd control works on crowds, by construction.
 */
export const MONSTER_TYPE_CHARISMA_RESISTANCE: Readonly<Record<MonsterType, number>> = {
  group: 0,
  regular: 0.2,
  elite: 0.4,
  miniBoss: 0.6,
  boss: 0.8,
}

export interface Monster {
  classId: string
  type: MonsterType
  /** Class base plus the type's flat shift. Uncapped -- see the module comment. */
  stats: StatBlock
  /**
   * Derived AGAINST THE PLAYER, so the contested chances in here are this
   * monster's real ones in this fight and not a context-free approximation.
   */
  derived: DerivedStats
  /** Already scaled by the power multiplier. */
  maxHitPoints: number
  /** Base damage times the scaled multiplier -- what one landed blow is worth. */
  damage: number
}

/** Both sides multiply this by their damage multiplier. One parameter, expected to be tuned. */
export const BASE_DAMAGE = 10

export function damageFrom(damageMultiplier: number): number {
  return BASE_DAMAGE * damageMultiplier
}

export function buildMonster(options: {
  classId: string
  classBaseStats: StatBlock
  type: MonsterType
  level: number
  difficulty?: Difficulty
  /** The player, so the contested chances resolve. */
  against: StatBlock
}): Monster {
  const shift = MONSTER_TYPE_STAT_SHIFT[options.type]
  const stats = addStats(options.classBaseStats, {
    might: shift,
    agility: shift,
    perception: shift,
    intellect: shift,
    charisma: shift,
    luck: shift,
  })
  const derived = deriveStats(stats, options.against)
  const power = powerMultiplier(options.level, options.difficulty)
  return {
    classId: options.classId,
    type: options.type,
    stats,
    derived,
    // Whole hit points: a monster with 63.4 of them is a rounding artefact
    // on screen, and the floor is the same rule every other count follows.
    maxHitPoints: Math.floor(derived.maxHitPoints * power),
    damage: damageFrom(derived.damageMultiplier) * power,
  }
}

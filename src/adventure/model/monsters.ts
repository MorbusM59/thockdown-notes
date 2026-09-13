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

/** Members in a group whose encounter does not name a count. */
export const DEFAULT_GROUP_SIZE = 3

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

/**
 * A GROUP is fought as ONE monster with a shared pool -- "a hydra fight".
 *
 * Its hit points and its actions are a single member's times the head count.
 * The pool is then divided into that many equal bands, and each band the
 * cumulative damage crosses costs the group ONE MEMBER'S WORTH OF ACTIONS,
 * taken off whatever is currently left and floored at zero.
 *
 * That last part is deliberately biased toward the player: the member that
 * just died is assumed to have been the one who would have acted LAST, so
 * killing it takes actions the group still had rather than actions it had
 * already spent. The alternative -- charging the loss against actions
 * already used -- would make killing a member during a round do nothing at
 * all until the next one.
 *
 * The head count is CONTENT, per encounter. `DEFAULT_GROUP_SIZE` is what an
 * encounter that does not say gets.
 */
export interface Monster {
  classId: string
  type: MonsterType
  /** Members fought as one. 1 for everything that is not a group. */
  count: number
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
  /** The whole group's opening action pool: one member's, times the count. */
  maxActions: number
}

/**
 * How many members' worth of actions a group has lost, given the damage it
 * has taken. Each 1/count band of the pool crossed is one member.
 *
 * Uses the total pool and the count rather than a stored band width, so it
 * cannot disagree with `maxHitPoints`; and it is a pure function of damage
 * taken, so it needs nothing remembered between blows.
 */
export function membersDown(monster: Monster, damageTaken: number): number {
  if (monster.count <= 1) return damageTaken >= monster.maxHitPoints ? 1 : 0
  const band = monster.maxHitPoints / monster.count
  return Math.min(monster.count, Math.floor(Math.max(0, damageTaken) / band))
}

/**
 * The actions a group still has: its pool, less one member's worth for every
 * band of damage it has crossed, floored at zero.
 *
 * `actionsSpent` is what has already been used this round. Both subtractions
 * apply -- the group loses actions to the clock and to its casualties, and a
 * member dying does not refund what the group already did.
 */
export function actionsRemaining(monster: Monster, damageTaken: number, actionsSpent: number): number {
  const perMember = monster.maxActions / monster.count
  const lost = membersDown(monster, damageTaken) * perMember
  return Math.max(0, Math.floor(monster.maxActions - lost - Math.max(0, actionsSpent)))
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
  /** Members in a group. Content's to choose; anything but a group is one. */
  count?: number
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
  const count = options.type === 'group' ? Math.max(1, Math.floor(options.count ?? DEFAULT_GROUP_SIZE)) : 1
  return {
    classId: options.classId,
    type: options.type,
    count,
    stats,
    derived,
    // Whole hit points: a monster with 63.4 of them is a rounding artefact
    // on screen, and the floor is the same rule every other count follows.
    maxHitPoints: Math.floor(derived.maxHitPoints * power) * count,
    // Per member. A group of four does not hit four times harder for one
    // blow -- it hits four times as OFTEN, which is what the action pool is.
    damage: damageFrom(derived.damageMultiplier) * power,
    maxActions: derived.actionsPerRound * count,
  }
}

/**
 * What a monster does when the player attacks it -- the hidden mirror of the
 * player's own defensive choice.
 *
 * Dodge if it is offered, otherwise defend. There is no judgement in it and
 * none is wanted: dodge takes no damage at all and defend takes some, so the
 * ordering is total.
 *
 * FLEE is deliberately absent. It is not something a monster weighs; it is a
 * state the player PUTS it in -- by a successful Terrify, or out of a talk
 * event that checks Charisma. A monster that could decide to run on its own
 * would make Terrify meaningless, since it would already be doing the thing
 * Terrify is for.
 */
export type MonsterDefence = 'dodge' | 'defend'

export function monsterDefence(dodgeAvailable: boolean): MonsterDefence {
  return dodgeAvailable ? 'dodge' : 'defend'
}

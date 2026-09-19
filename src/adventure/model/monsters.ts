// A monster's numbers, built from THE SAME FOUR VECTORS a player is.
//
// The pipeline, in order, and the order is the whole of it:
//
//   tier x build weights -> base stats
//                        -> + species effects, through resolveProfile
//                        -> derive (against the player)
//                        -> x power multiplier, on health and damage only
//
// There is no monster-only arithmetic left in it. The stat shift per rank,
// the armour per rank and the stat deltas on classes and species are all
// GONE: rank is a tier (model/vectors.ts), armour is something a species
// has, and stats are the build's. A mini boss is not a creature of its own
// -- it is the same four vectors with fifteen more points to spend.
//
// Base stats are NOT clamped to the player's cap of 6. That cap is a rule
// about what a player's own SPENDING can reach; a tier-20 boss is meant to
// be past it, and so is a player who has bought their tier up.

import { NO_ARMOR, type Armor } from './armor'
import { powerMultiplier } from './difficulty'
import { resolveProfile, type ActionPosition, type Modifier, type Situation } from './modifiers'

import { buildModifier, type Build, type CombatClass, type MonsterType, type Species } from './vectors'
import { resolveChanceWith, type ChanceAdjustment } from './chance'
import { CHANCE_DERIVED_KEYS, CHANCE_SPECS, createStatBlock, type ChanceKey, type DerivedStats, type StatBlock } from './stats'

export { MONSTER_TYPES, MONSTER_TYPE_CHARISMA_RESISTANCE, type MonsterType } from './vectors'

/**
 * A MONSTER IS FOUGHT AS ONE, however many bodies it has -- "a hydra fight".
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
 * The head count is ROLLED PER OFFER now, from the rank's own buddy chances
 * (model/vectors.ts's `MONSTER_BUDDY_CHANCES`), rather than being a property
 * of a "group" rank that no longer exists. A runt always has a friend; an
 * ordinary monster has one half the time; nothing elite or above travels.
 */
export interface Monster {
  buildId: string
  speciesId: string
  classId: string
  type: MonsterType
  /** What the four vectors add up to, before anything is derived. */
  tier: number
  /** Members fought as one. 1 for anything that came alone. */
  count: number
  /** Tier split by the build's weights. Uncapped -- see the module comment. */
  stats: StatBlock
  /**
   * Derived AGAINST THE PLAYER, so the contested chances in here are this
   * monster's real ones in this fight and not a context-free approximation.
   * The species' effects are already in it.
   */
  derived: DerivedStats
  /** Already scaled by the power multiplier. */
  maxHitPoints: number
  /** Base damage times the scaled multiplier -- what one landed blow is worth. */
  damage: number
  /** The whole group's opening action pool: one member's, times the count. */
  maxActions: number
  /**
   * Flat reduction on a blow it DEFENDS against. Natural, always: a species
   * is not carried and cannot be dropped, so it has nothing that decays.
   */
  armor: Armor
  /** Its class, carried whole, because the fight asks it for moves. */
  combatClass: CombatClass | null
  /** What its species does to each contested chance, for the roll to apply. */
  chances: Readonly<Record<ChanceKey, ChanceAdjustment>>
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

/**
 * A SPECIES AS A MODIFIER, so it resolves in the pass every other effect
 * resolves in.
 *
 * The same trick `buildModifier` plays for the player (model/gameState.ts):
 * a species carries the modifier vocabulary, so wrapping it in a Modifier
 * means `resolveProfile` applies it with no knowledge that species exist,
 * and `describeModifier` writes its tooltip for free.
 */
export function speciesModifier(species: Species | null): Modifier | null {
  if (!species) return null
  return { id: `species:${species.id}`, kind: 'trait', name: species.name, icon: species.icon, effects: species.effects }
}

/**
 * WHAT IS TRUE OF THE INSTANT a monster is being asked about.
 *
 * `Situation`'s own fields, except that the fight tracks a monster's wear as
 * DAMAGE TAKEN rather than as hit points left -- the monster is the only one
 * who knows its own maximum, and it does not exist until it is built.
 */
export interface MonsterMoment {
  /** What this fight has already done to it. */
  damageTaken?: number
  /** Where in the round the action being resolved falls. */
  actionPosition?: ActionPosition
  /** How hurt the PLAYER is, 0..1, for a `subject: 'target'` effect to read. */
  opponentHealthFraction?: number
}

/**
 * The moment, as a `Situation` -- which means turning damage taken into hit
 * points left, and that needs the maximum the STATS derive.
 *
 * TWO PASSES, and the first one is not waste: the fraction has to be measured
 * against the maximum BEFORE any conditional has moved it, or an effect that
 * raises hit points while maimed would lift the character out of the band
 * that switched it on and oscillate. `resolveProfile` keeps exactly the same
 * discipline for the player, for exactly the same reason -- this is that rule
 * applied to the side that could not state it, because the caller has no
 * maximum to divide by until the monster exists.
 */
function situationFor(moment: MonsterMoment | undefined, layers: readonly Modifier[]): Situation {
  if (!moment) return {}
  const base: Situation = {
    actionPosition: moment.actionPosition,
    opponentHealthFraction: moment.opponentHealthFraction,
  }
  if (moment.damageTaken === undefined) return base
  const unconditioned = resolveProfile(createStatBlock(0), layers, { items: 0, traits: 0 })
  return { ...base, hitPoints: unconditioned.derived.maxHitPoints - Math.max(0, moment.damageTaken) }
}

export function buildMonster(options: {
  build: Build | null
  species: Species | null
  combatClass: CombatClass | null
  type: MonsterType
  tier: number
  /** The run's curve (model/difficulty.ts), already resolved by `runTuning`. */
  progression?: number
  level: number
  /** The player, so the contested chances resolve. */
  against: StatBlock
  count?: number
  /**
   * WHICH MOMENT THIS MONSTER IS BEING ASKED ABOUT (model/modifiers.ts's
   * `Situation`), plus the damage this fight has already done to it.
   *
   * A monster is not a stored thing: `monsterFor` rebuilds it from the
   * encounter's offer on every call, so this is a VIEW of the creature at one
   * instant rather than an update to a record. Absent -- on the offer screens
   * and in the hunt, where there is no fight yet -- every conditional effect
   * is simply out of force, exactly as it is for the player's status bar.
   *
   * It used to take no moment at all, which meant a species' conditional
   * effects were resolved once against nothing and then thrown away: the
   * Ghoul's "+80% Damage injured" and the Lich's "+100% Actions maimed" could
   * never fire, and a `healthy` one would have fired always. Measured, not
   * suspected -- a Ghoul with those effects and one without them came out
   * with identical damage and hit points.
   */
  moment?: MonsterMoment
}): Monster {
  // BOTH VECTORS AS MODIFIERS, resolved in the one pass: the build's tier
  // points (which must sit above the base-stat clamp -- see `buildModifier`)
  // and the species' effects. A monster has no base stats of its own at all;
  // everything it is arrives through this list.
  const layers = [buildModifier(options.build, options.tier), speciesModifier(options.species)]
    .filter((layer): layer is Modifier => layer !== null)
  const profile = resolveProfile(createStatBlock(0), layers, { items: 0, traits: 0 }, situationFor(options.moment, layers))
  // The three CONTESTED chances, resolved against the player with this
  // monster's own adjustments -- `resolveProfile` cannot do it, because a
  // chance is settled at the moment it is rolled and it has no opponent. A
  // Spider's "+30% accuracy" reaches its attacks through `chances` below;
  // this is what the DETAIL PILL reads. WITHOUT the run's thumb, deliberately
  // -- `successAdjust` is applied at the roll and never folded into what a
  // character is worth (model/chance.ts), so a difficulty setting must not
  // show up in a creature's description.
  const derived: DerivedStats = {
    ...profile.derived,
    ...Object.fromEntries(CHANCE_DERIVED_KEYS.map((key) => [
      key,
      resolveChanceWith(CHANCE_SPECS[key], profile.stats, options.against, {
        adjustment: profile.chances[key],
      }),
    ])),
  }
  const power = powerMultiplier(options.level, options.progression)
  const count = Math.max(1, Math.floor(options.count ?? 1))
  return {
    buildId: options.build?.id ?? '',
    speciesId: options.species?.id ?? '',
    classId: options.combatClass?.id ?? '',
    type: options.type,
    tier: Math.max(0, Math.floor(options.tier)),
    count,
    stats: profile.stats,
    // The PROFILE's derived values, not the bare ones: the species has had
    // its say on hit points, actions, accuracy and crit, and taking
    // `deriveStats` alone here would have silently dropped every one of them.
    derived,
    // Whole hit points: a monster with 63.4 of them is a rounding artefact
    // on screen, and the floor is the same rule every other count follows.
    maxHitPoints: Math.floor(profile.derived.maxHitPoints * power) * count,
    // Per member. A pack of four does not hit four times harder for one
    // blow -- it hits four times as OFTEN, which is what the action pool is.
    damage: damageFrom(profile.derived.damageMultiplier) * power,
    maxActions: profile.derived.actionsPerRound * count,
    // Per MEMBER, not per pack: four wolves do not stack four hides on one
    // body.
    armor: profile.naturalArmor > 0 ? { ...NO_ARMOR, natural: profile.naturalArmor } : NO_ARMOR,
    combatClass: options.combatClass,
    // CARRIED, not folded in: a chance is resolved against an opponent at the
    // moment it is rolled (model/chance.ts), so the species' say on accuracy
    // and crit has to travel to the roll rather than be averaged into a
    // number here. Exactly what an EffectiveProfile does for the player.
    chances: profile.chances,
  }
}

/**
 * What a monster does when the player attacks it -- the hidden mirror of the
 * player's own defensive choice.
 *
 * Dodge if it is offered, otherwise defend. There is no judgement in it and
 * none is wanted: dodge takes no damage at all and defend takes some, so the
 * ordering is total. A monster's CLASS may swap what defending means, which
 * is the class vector doing its job and not a second decision -- the choice
 * is still the same two.
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

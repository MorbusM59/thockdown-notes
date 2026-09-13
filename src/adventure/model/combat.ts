// The combat round: whose action it is, what that action does, and when the
// round is over. Pure, seeded, and interactive by construction.
//
// EVERY ACTION IN THE ROUND IS ONE CHOICE THE PLAYER MAKES, whichever side
// owns it. On the player's action the ring offers offensive choices; on a
// monster's it offers the player's reactive ones. That is why this is a step
// machine and not a loop that runs a fight to completion: nothing here may
// advance past a point where the ring has to ask something.
//
// The round is the unit that makes Agility mean anything. Actions are
// restored to maximum at its start, spent one at a time, and the round ends
// when there are none left anywhere -- so a faster character does not hit
// harder, they simply come up more often.
//
// Nothing in here decides what an encounter PAYS. That is content, and the
// rates are unwritten (open question 45).

import { absorb, NO_ARMOR, type Armor } from './armor'
import { nextChance, type RngState } from '../core/rng'
import { resolveChance } from './chance'
import { actionsRemaining, damageFrom, monsterDefence, type Monster } from './monsters'
import { CRIT_CHANCE, DODGE_CHANCE, HIT_CHANCE, type DerivedStats, type StatBlock } from './stats'

/** What the player may answer a monster's attack with. All four are always offered except Dodge. */
export const DEFENCES = ['dodge', 'defend', 'flee', 'takeTheHit'] as const

export type Defence = (typeof DEFENCES)[number]

/**
 * A round in progress.
 *
 * The monster's remaining actions are DERIVED (see `monsterActionsLeft`)
 * rather than stored: a group loses actions to its casualties as well as to
 * the clock, and a stored counter would have to be corrected by whoever
 * happened to deal the fatal blow.
 */
export interface RoundState {
  playerActionsSpent: number
  monsterActionsSpent: number
  playerHitPoints: number
  playerArmor: Armor
  /** Cumulative, because a group's casualties are a function of it. */
  monsterDamageTaken: number
  /** Set when a monster has been made to run -- by Terrify, or by a talk event. */
  monsterFleeing: boolean
  /** Set when the player got away. The encounter is over and pays nothing. */
  playerFled: boolean
}

export function beginRound(previous: Omit<RoundState, 'playerActionsSpent' | 'monsterActionsSpent'>): RoundState {
  // The ONLY thing a new round resets. Hit points, damage dealt and armor all
  // carry: a round is a clock, not a checkpoint.
  return { ...previous, playerActionsSpent: 0, monsterActionsSpent: 0 }
}

export function playerActionsLeft(state: RoundState, playerDerived: DerivedStats): number {
  return Math.max(0, playerDerived.actionsPerRound - state.playerActionsSpent)
}

export function monsterActionsLeft(state: RoundState, monster: Monster): number {
  return actionsRemaining(monster, state.monsterDamageTaken, state.monsterActionsSpent)
}

export type CombatStatus = 'playerDefeated' | 'monstersDefeated' | 'monsterFled' | 'playerFled' | 'roundOver' | 'acting'

/**
 * Where the fight is, checked before anything asks whose action it is.
 *
 * The order is not arbitrary: an ENDING beats a round boundary, because a
 * fight that finished on the last action of a round has finished, and asking
 * the player for tactical choices over a corpse would be the alternative.
 */
export function combatStatus(state: RoundState, monster: Monster, playerDerived: DerivedStats): CombatStatus {
  if (state.playerHitPoints <= 0) return 'playerDefeated'
  if (state.monsterDamageTaken >= monster.maxHitPoints) return 'monstersDefeated'
  if (state.playerFled) return 'playerFled'
  if (state.monsterFleeing) return 'monsterFled'
  const left = playerActionsLeft(state, playerDerived) + monsterActionsLeft(state, monster)
  return left > 0 ? 'acting' : 'roundOver'
}

/**
 * Whose action this is: `player_actions / (player_actions + monster_actions)`,
 * rolled fresh for every single action rather than shuffled once.
 *
 * A side with nothing left cannot be picked -- the ratio takes care of that
 * without a special case -- and with nothing left anywhere the caller should
 * have seen `roundOver` from `combatStatus` first, so this returns null
 * rather than dividing by zero.
 */
export function rollActor(
  state: RoundState,
  monster: Monster,
  playerDerived: DerivedStats,
  rng: RngState,
): { actor: 'player' | 'monster' | null; rng: RngState } {
  const mine = playerActionsLeft(state, playerDerived)
  const theirs = monsterActionsLeft(state, monster)
  if (mine + theirs <= 0) return { actor: null, rng }
  const draw = nextChance(rng, mine / (mine + theirs))
  return { actor: draw.value ? 'player' : 'monster', rng: draw.rng }
}

/** One blow's worth of what happened, for the narration to read from. */
export interface Blow {
  hit: boolean
  crit: boolean
  dodged: boolean
  /** After armor, if any was involved. */
  damage: number
  /** Whether this blow cost the defender a point of item armor. */
  armorDecayed: boolean
}

interface ExchangeInput {
  attackerStats: StatBlock
  attackerDamage: number
  defenderStats: StatBlock
  /**
   * The defender's armor, ALWAYS -- it is a property of the defender, not of
   * the defence. Which defence was chosen decides whether it is CONSULTED.
   * Passing null for "not consulted" is what wiped a player's armor to zero
   * every time they fled or took a hit: the exchange handed back an empty
   * pool and the caller stored it.
   */
  armor: Armor
  armorDecayFloor: number
  /** Dodge negates entirely; Take the hit makes the attack land by definition. */
  defence: Defence | 'none'
  dodgeOffered: boolean
  rng: RngState
}

/**
 * One attack resolved, in the order the plan states it: the defender's choice
 * first, then the roll to hit, then the crit, then armor.
 *
 * Dodge short-circuits before the hit roll because the plan says the attack
 * does not land at all -- not that it is likelier to miss. Take the hit is
 * the mirror: the attacker's chance to miss drops to zero, and armor is not
 * consulted, which is what makes it a real choice rather than a worse Defend.
 */
export function resolveExchange(input: ExchangeInput): { blow: Blow; armor: Armor; rng: RngState } {
  const armor = input.armor
  if (input.defence === 'dodge') {
    return { blow: { hit: false, crit: false, dodged: true, damage: 0, armorDecayed: false }, armor, rng: input.rng }
  }

  let rng = input.rng
  let landed = true
  if (input.defence !== 'takeTheHit') {
    const roll = nextChance(rng, resolveChance(HIT_CHANCE, input.attackerStats, input.defenderStats))
    landed = roll.value
    rng = roll.rng
  }
  if (!landed) {
    return { blow: { hit: false, crit: false, dodged: false, damage: 0, armorDecayed: false }, armor, rng }
  }

  const critRoll = nextChance(rng, resolveChance(CRIT_CHANCE, input.attackerStats, input.defenderStats))
  rng = critRoll.rng
  // WHOLE, once, here. The power multiplier makes a monster's damage
  // fractional (8.4 at level one, 16.8 on a crit), and leaving it that way
  // meant the record lost 16.8 hit points while the narration said 17. Hit
  // points are a count; rounding at the blow is the only place the two can
  // be made to agree.
  const raw = Math.round(input.attackerDamage * (critRoll.value ? 2 : 1))

  // Armor is Defend's alone. Flee and Take the hit both say so explicitly,
  // and Dodge never reaches here. The pool comes back UNTOUCHED rather than
  // emptied -- it is still on the defender, it simply did not help.
  if (input.defence !== 'defend') {
    return { blow: { hit: true, crit: critRoll.value, dodged: false, damage: raw, armorDecayed: false }, armor, rng }
  }

  const absorbed = absorb(armor, raw, input.defenderStats.luck, input.armorDecayFloor, rng)
  return {
    blow: { hit: true, crit: critRoll.value, dodged: false, damage: absorbed.damage, armorDecayed: absorbed.decayed },
    armor: absorbed.armor,
    rng: absorbed.rng,
  }
}

/** Whether Dodge is on the table at all this time, which is what its chance buys. */
export function rollDodgeOffered(
  defenderStats: StatBlock,
  attackerStats: StatBlock,
  rng: RngState,
): { offered: boolean; rng: RngState } {
  const draw = nextChance(rng, resolveChance(DODGE_CHANCE, defenderStats, attackerStats))
  return { offered: draw.value, rng: draw.rng }
}

/** What the player may pick, this time. Dodge is the only one that has to be earned. */
export function defencesOffered(dodgeOffered: boolean): Defence[] {
  return DEFENCES.filter((defence) => defence !== 'dodge' || dodgeOffered)
}

/**
 * The player attacks. The enemy's defence is HIDDEN and automatic -- it takes
 * the best outcome, which is a total ordering rather than a judgement (see
 * `monsterDefence`).
 */
export function resolvePlayerAttack(options: {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  playerDerived: DerivedStats
  rng: RngState
}): { state: RoundState; blow: Blow; rng: RngState } {
  const offered = rollDodgeOffered(options.monster.stats, options.playerStats, options.rng)
  const exchange = resolveExchange({
    attackerStats: options.playerStats,
    attackerDamage: damageFrom(options.playerDerived.damageMultiplier),
    defenderStats: options.monster.stats,
    // Monsters carry no items or traits, so nothing gives them armor yet.
    armor: NO_ARMOR,
    armorDecayFloor: 0,
    defence: monsterDefence(offered.offered),
    dodgeOffered: offered.offered,
    rng: offered.rng,
  })
  return {
    state: {
      ...options.state,
      playerActionsSpent: options.state.playerActionsSpent + 1,
      monsterDamageTaken: options.state.monsterDamageTaken + exchange.blow.damage,
    },
    blow: exchange.blow,
    rng: exchange.rng,
  }
}

/**
 * A monster attacks, and the player answers with the defence they picked.
 *
 * FLEE resolves before the blow: the enemy rolls a contested Agility check to
 * pursue, and a failure ends the encounter outright. A success means the
 * player is still standing there, with no armor between them and the blow --
 * which is the cost of having tried.
 */
export function resolveMonsterAttack(options: {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  armorDecayFloor: number
  defence: Defence
  rng: RngState
}): { state: RoundState; blow: Blow | null; escaped: boolean; rng: RngState } {
  const spent = { ...options.state, monsterActionsSpent: options.state.monsterActionsSpent + 1 }

  let rng = options.rng
  if (options.defence === 'flee') {
    const pursuit = nextChance(rng, resolveChance(DODGE_CHANCE, options.monster.stats, options.playerStats))
    rng = pursuit.rng
    if (!pursuit.value) {
      return { state: { ...spent, playerFled: true }, blow: null, escaped: true, rng }
    }
  }

  const exchange = resolveExchange({
    attackerStats: options.monster.stats,
    attackerDamage: options.monster.damage,
    defenderStats: options.playerStats,
    armor: options.state.playerArmor,
    armorDecayFloor: options.armorDecayFloor,
    defence: options.defence,
    dodgeOffered: options.defence === 'dodge',
    rng,
  })

  return {
    state: {
      ...spent,
      playerHitPoints: Math.max(0, spent.playerHitPoints - exchange.blow.damage),
      playerArmor: exchange.armor,
    },
    blow: exchange.blow,
    escaped: false,
    rng: exchange.rng,
  }
}


/**
 * What an encounter pays, by how it ended.
 *
 * The AMOUNTS are content and mostly unwritten (open question 45) -- what a
 * regular monster, a mini boss and a boss are each worth. What is settled is
 * the SHAPE, and the two flights are the interesting cases:
 *
 *   - the MONSTER got away (Terrify, or a talk event): one gold, no loot, and
 *     the encounter's experience in full. You beat it; you just did not get
 *     to search it.
 *   - the PLAYER got away: nothing at all. It still counts against the
 *     level's encounter count, which is what makes running a decision rather
 *     than a free reroll.
 *
 * One gold is not a special case for fleeing, incidentally: the loot menu's
 * gold branch is one piece too, so a monster that ran pays exactly that
 * branch with no choice offered.
 */
export interface EncounterPayout {
  goldUnits: number
  /** The encounter's own award. Zero where the player did not earn it. */
  experienceUnits: number
  /** Whether the loot menu opens at all -- an item is the alternative to the gold. */
  offersLoot: boolean
  /** Whether this uses up one of the level's ten. */
  countsAsEncounter: boolean
}

export const NO_PAYOUT: EncounterPayout = {
  goldUnits: 0,
  experienceUnits: 0,
  offersLoot: false,
  countsAsEncounter: true,
}

export function payoutFor(status: CombatStatus, encounterExperience: number): EncounterPayout {
  switch (status) {
    case 'monstersDefeated':
      return { goldUnits: 1, experienceUnits: encounterExperience, offersLoot: true, countsAsEncounter: true }
    case 'monsterFled':
      return { goldUnits: 1, experienceUnits: encounterExperience, offersLoot: false, countsAsEncounter: true }
    case 'playerFled':
    case 'playerDefeated':
      return NO_PAYOUT
    default:
      return NO_PAYOUT
  }
}

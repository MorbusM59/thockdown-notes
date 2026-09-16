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

import { absorb, type Armor } from './armor'
import type { JsonObject, JsonValue } from '../core/json'
import { NO_SPELLS } from './spellReach'
import { nextChance, nextRoll, type RngState, type Roll } from '../core/rng'
import { NO_CHANCE_ADJUSTMENT, resolveChanceWith, type ChanceAdjustment, type ChanceSide } from './chance'
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

  // --- What this ROUND happens to be ------------------------------------
  // Rolled once when the round opens and true until it closes. They are on
  // the round rather than beside it because that is exactly their lifetime,
  // and because a fight resolved a step at a time has nowhere else to put a
  // fact that outlives a step.

  /**
   * The highest spell level in reach this round; -1 for none. ONE NUMBER,
   * because reaching a level brings every lower one with it (model/spells.ts).
   */
  spellReach: number
  /** The charm effects that came up this round, strongest first (model/charm.ts). */
  charms: number[]

  // --- What the fight has had done to it --------------------------------
  // These OUTLIVE the round: a plague does not lift because a clock ticked.
  // `beginRound` carries them for exactly that reason.

  // ALL FOUR ARE COUNTS, and that is the rule: an active effect STACKS. A
  // second Plague takes twice the share, a second Storm throws twice the
  // bolt, a second Ignite burns twice as hot, and a second Prepare doubles
  // what the next attack gains. Three of them were flags first, on the
  // reading that a condition is either on or off -- which made a second cast
  // a wasted action and so made those spells something the ring had to
  // withhold. Counting instead removes the special case rather than managing
  // it.

  /** Stacks of Plague: a fifth of what it has left EACH, at the end of every round. */
  plagued: number
  /** Storms overhead: a bolt EACH, at the end of every round. */
  storming: number
  /** Stacks of Ignite. It burns per stack, per monster action. */
  igniteStacks: number
  /** Preparations banked. The next ATTACK spends them all, at once. */
  prepared: number
}

/**
 * A round, as JSON and back -- next to the type, because a serializer is a
 * property of what it serializes and not of whoever happens to store it.
 *
 * Out is STRUCTURAL (a `RoundState` is already JSON-shaped, nested armor
 * included) so a new field cannot be forgotten on the way out. In is
 * hand-written, because reading has to survive a save that predates the
 * field -- and `roundJson.test.ts` round-trips a fully-populated round so
 * that a field missing HERE fails rather than silently reading as zero.
 */
export function roundToJson(round: RoundState): JsonObject {
  return { ...round, playerArmor: { ...round.playerArmor }, charms: [...round.charms] }
}

/** A stack count as written, tolerating the BOOLEAN these three used to be. */
function stacksOf(value: unknown): number {
  if (value === true) return 1
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function roundFromJson(value: JsonValue | undefined): RoundState {
  const row = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const num = (key: string, fallback = 0) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : fallback)
  const armor = (typeof row.playerArmor === 'object' && row.playerArmor !== null && !Array.isArray(row.playerArmor)
    ? row.playerArmor
    : {}) as Record<string, unknown>
  const armorPool = (key: string) => (typeof armor[key] === 'number' && Number.isFinite(armor[key]) ? (armor[key] as number) : 0)
  return {
    playerActionsSpent: num('playerActionsSpent'),
    monsterActionsSpent: num('monsterActionsSpent'),
    playerHitPoints: num('playerHitPoints'),
    playerArmor: { fromItems: armorPool('fromItems'), natural: armorPool('natural') },
    monsterDamageTaken: num('monsterDamageTaken'),
    monsterFleeing: row.monsterFleeing === true,
    playerFled: row.playerFled === true,
    // NO_SPELLS, not zero: zero is "Singe is in reach", which is a hand the
    // player was never dealt.
    spellReach: num('spellReach', NO_SPELLS),
    charms: Array.isArray(row.charms)
      ? row.charms.filter((entry): entry is number => typeof entry === 'number')
      : [],
    // A save that predates the counts wrote booleans here; `true` is one
    // stack, which is exactly what it meant.
    plagued: stacksOf(row.plagued),
    storming: stacksOf(row.storming),
    igniteStacks: stacksOf(row.igniteStacks),
    prepared: stacksOf(row.prepared),
  }
}

/**
 * A FIGHT NOTHING HAS HAPPENED IN YET: no spell in reach, no charm up, no
 * condition laid on, nothing banked.
 *
 * Written once so a fight's opening conditions are one thing rather than six
 * repeated at every place a fight begins -- and so adding a seventh is a line
 * here and a compiler error at any caller that builds a round some other way.
 */
export const UNTOUCHED_FIGHT = {
  spellReach: NO_SPELLS,
  charms: [] as number[],
  plagued: 0,
  storming: 0,
  igniteStacks: 0,
  prepared: 0,
}

export function beginRound(previous: Omit<RoundState, 'playerActionsSpent' | 'monsterActionsSpent'>): RoundState {
  // The ONLY thing a new round resets. Hit points, damage dealt, armor, the
  // lingering spells and a banked Prepare all carry: a round is a clock, not
  // a checkpoint. What a round GRANTS -- its spell reach and its charms -- is
  // rolled by the caller and handed in here, because rolling is not this
  // function's business and it takes no rng.
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

/**
 * THE WORKING BEHIND A BLOW, so the pill that reports it can document its own
 * arithmetic (escapeMenu/narrationMarkup.ts on an entry's two halves).
 *
 * Every field is what the roll or the sum ACTUALLY was, not a restatement --
 * a tooltip computed from the stats a second time is a tooltip that can
 * disagree with the fight, which is the one thing it must not do. Absent
 * where nothing was rolled: magic takes no hit roll, Take the hit takes no
 * hit roll, a blow that missed takes no crit roll.
 */
export interface BlowMath {
  /** The defender's chance not to be there at all, where the attacker rolled it. */
  dodge: Roll | null
  hit: Roll | null
  crit: Roll | null
  /** What one blow of this attacker's is worth, before the crit and before armour. */
  base: number
  /** 1, or 2 on a crit. */
  critMultiplier: number
  /** What armour stopped, where it was consulted. */
  absorbed: number
}

export const NO_BLOW_MATH: BlowMath = {
  dodge: null, hit: null, crit: null, base: 0, critMultiplier: 1, absorbed: 0,
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
  math: BlowMath
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
  /**
   * What the ATTACKER's modifiers do to their own accuracy and crit. The
   * defender's dodge is not here: dodge is settled before the exchange, by
   * `rollDodgeOffered`, which takes its own.
   */
  attackerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  /** Whose blow this is. Both rolls below are the attacker's, so one answer covers them. */
  attacker: ChanceSide
  /** The run's thumb on the scale (model/chance.ts). 0 leaves every roll exactly as the stats made it. */
  successAdjust?: number
  /**
   * Dodge negates entirely; Take the hit makes the attack land by definition;
   * MAGIC is neither a choice nor a defence but the absence of one -- it
   * cannot be missed with and armour does not see it (model/spells.ts).
   */
  defence: Defence | 'none' | 'magic'
  dodgeOffered: boolean
  /** The defender's dodge offer, where the caller rolled one, for the working. */
  dodgeRoll?: Roll | null
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
  // What the attacker's own side of this already rolled, where the caller
  // took it before getting here (the defender's dodge offer).
  const math: BlowMath = { ...NO_BLOW_MATH, dodge: input.dodgeRoll ?? null, base: input.attackerDamage }

  if (input.defence === 'dodge') {
    return {
      blow: { hit: false, crit: false, dodged: true, damage: 0, armorDecayed: false, math },
      armor,
      rng: input.rng,
    }
  }

  let rng = input.rng
  let landed = true
  // Magic joins Take the hit here: both mean the blow arrives, so there is
  // nothing to roll. The dodge branch above is never reached for magic --
  // the caster does not offer the dodge in the first place.
  if (input.defence !== 'takeTheHit' && input.defence !== 'magic') {
    const roll = nextRoll(rng, resolveChanceWith(HIT_CHANCE, input.attackerStats, input.defenderStats, {
      adjustment: input.attackerChances?.hitChance,
      side: input.attacker,
      successAdjust: input.successAdjust,
    }))
    math.hit = roll.value
    landed = roll.value.passed
    rng = roll.rng
  }
  if (!landed) {
    return {
      blow: { hit: false, crit: false, dodged: false, damage: 0, armorDecayed: false, math },
      armor,
      rng,
    }
  }

  const critRoll = nextRoll(rng, resolveChanceWith(CRIT_CHANCE, input.attackerStats, input.defenderStats, {
    adjustment: input.attackerChances?.critChance,
    side: input.attacker,
    successAdjust: input.successAdjust,
  }))
  rng = critRoll.rng
  math.crit = critRoll.value
  math.critMultiplier = critRoll.value.passed ? 2 : 1
  // WHOLE, once, here. The power multiplier makes a monster's damage
  // fractional (8.4 at level one, 16.8 on a crit), and leaving it that way
  // meant the record lost 16.8 hit points while the narration said 17. Hit
  // points are a count; rounding at the blow is the only place the two can
  // be made to agree.
  const raw = Math.round(input.attackerDamage * math.critMultiplier)

  // Armor is Defend's alone. Flee, Take the hit and magic all say so
  // explicitly, and Dodge never reaches here. The pool comes back UNTOUCHED
  // rather than emptied -- it is still on the defender, it simply did not
  // help. For magic that is the rule rather than a consequence: a plated
  // monster is the problem Intellect answers.
  if (input.defence !== 'defend') {
    return {
      blow: { hit: true, crit: critRoll.value.passed, dodged: false, damage: raw, armorDecayed: false, math },
      armor,
      rng,
    }
  }

  const absorbed = absorb(armor, raw, input.defenderStats.luck, input.armorDecayFloor, rng)
  return {
    blow: {
      hit: true,
      crit: critRoll.value.passed,
      dodged: false,
      damage: absorbed.damage,
      armorDecayed: absorbed.decayed,
      math: { ...math, absorbed: absorbed.absorbed },
    },
    armor: absorbed.armor,
    rng: absorbed.rng,
  }
}

/** Whether Dodge is on the table at all this time, which is what its chance buys. */
export function rollDodgeOffered(options: {
  defenderStats: StatBlock
  attackerStats: StatBlock
  /** The DEFENDER's own adjustment -- this is their chance, not the attacker's. */
  adjustment?: ChanceAdjustment
  /** Who is dodging. A monster's dodge is a monster SUCCESS and is weighted as one. */
  defender: ChanceSide
  successAdjust?: number
  rng: RngState
}): { offered: boolean; roll: Roll; rng: RngState } {
  const draw = nextRoll(options.rng, resolveChanceWith(DODGE_CHANCE, options.defenderStats, options.attackerStats, {
    adjustment: options.adjustment ?? NO_CHANCE_ADJUSTMENT,
    side: options.defender,
    successAdjust: options.successAdjust,
  }))
  return { offered: draw.value.passed, roll: draw.value, rng: draw.rng }
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
  /** The player's own accuracy and crit adjustments. Monsters carry none. */
  playerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  successAdjust?: number
  rng: RngState
}): { state: RoundState; blow: Blow; rng: RngState } {
  // The MONSTER's dodge, which the thumb presses down rather than up.
  const offered = rollDodgeOffered({
    defenderStats: options.monster.stats,
    attackerStats: options.playerStats,
    defender: 'monster',
    successAdjust: options.successAdjust,
    rng: options.rng,
  })
  const exchange = resolveExchange({
    attackerStats: options.playerStats,
    attackerDamage: damageFrom(options.playerDerived.damageMultiplier),
    defenderStats: options.monster.stats,
    // The monster's own plate, in the natural pool -- so `absorb` reduces the
    // blow and has nothing it is allowed to wear away (model/armor.ts). There
    // is therefore no armor to carry back out of the exchange, which is why
    // nothing here stores one.
    armor: options.monster.armor,
    armorDecayFloor: 0,
    attackerChances: options.playerChances,
    attacker: 'player',
    successAdjust: options.successAdjust,
    defence: monsterDefence(offered.offered),
    dodgeOffered: offered.offered,
    dodgeRoll: offered.roll,
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
  /**
   * The roll that PUT Dodge on the table, taken when the action was armed
   * rather than here. Carried through so the blow can explain itself: picking
   * Dodge cannot fail, because Dodge being there IS the success, and the
   * number behind that is the only one a dodged blow has to show.
   */
  dodgeRoll?: Roll | null
  successAdjust?: number
  rng: RngState
}): { state: RoundState; blow: Blow | null; escaped: boolean; pursuit: Roll | null; rng: RngState } {
  const spent = { ...options.state, monsterActionsSpent: options.state.monsterActionsSpent + 1 }

  let rng = options.rng
  let pursuit: Roll | null = null
  if (options.defence === 'flee') {
    // The MONSTER's roll, so no player adjustment applies to it -- an item
    // that sharpens your own dodge does not make the thing chasing you
    // slower -- and the thumb presses it DOWN, since catching you is a
    // monster success.
    const chase = nextRoll(rng, resolveChanceWith(DODGE_CHANCE, options.monster.stats, options.playerStats, {
      side: 'monster',
      successAdjust: options.successAdjust,
    }))
    rng = chase.rng
    pursuit = chase.value
    if (!chase.value.passed) {
      return { state: { ...spent, playerFled: true }, blow: null, escaped: true, pursuit, rng }
    }
  }

  const exchange = resolveExchange({
    attackerStats: options.monster.stats,
    attackerDamage: options.monster.damage,
    defenderStats: options.playerStats,
    armor: options.state.playerArmor,
    armorDecayFloor: options.armorDecayFloor,
    attacker: 'monster',
    successAdjust: options.successAdjust,
    defence: options.defence,
    dodgeOffered: options.defence === 'dodge',
    dodgeRoll: options.dodgeRoll,
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
    pursuit,
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

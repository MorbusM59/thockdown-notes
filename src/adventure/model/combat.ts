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

import { absorb, type Armor, type ArmorPiece } from './armor'
import { rollAttackDamage } from './damageRoll'
import type { JsonObject, JsonValue } from '../core/json'
import { NO_SPELLS } from './spellReach'
import { nextChance, nextRoll, type RngState, type Roll } from '../core/rng'
import { NO_CHANCE_ADJUSTMENT, resolveChanceWith, type ChanceAdjustment, type ChanceSide } from './chance'
import { actionsRemaining, damageFrom, monsterDefence, type Monster } from './monsters'
import type { ActionPosition } from './modifiers'
import { damageShareOf, strikesOf } from './moves'
import type { CombatMove } from './vectors'
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
  /**
   * WHICH ROUND THIS IS, from 1. The one fact a class move's
   * `firstActionOfEncounter` trigger needs that the round did not already
   * have: "first of the fight" is round 1 with nothing spent, and without a
   * round number there is no way to tell that from the first action of the
   * fourth round. One counter rather than a second pair of per-fight action
   * totals, because the pair would have to be kept in step with the per-round
   * pair beside it and this cannot.
   */
  roundNumber: number
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
  return {
    ...round,
    playerArmor: {
      natural: round.playerArmor.natural,
      pieces: round.playerArmor.pieces.map((piece) => ({ ...piece })),
    },
    charms: [...round.charms],
  }
}

/** One armor piece as it was written. A row that cannot be read is dropped. */
function pieceFromJson(value: unknown): ArmorPiece | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.itemId !== 'string' || row.itemId.length === 0) return null
  const num = (key: string) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : 0)
  const max = Math.max(0, Math.floor(num('max')))
  return {
    itemId: row.itemId,
    max,
    points: Math.max(0, Math.min(max, Math.floor(num('points')))),
  }
}

/** A stack count as written, tolerating the BOOLEAN these three used to be. */
function stacksOf(value: unknown): number {
  if (value === true) return 1
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function roundFromJson(value: JsonValue | undefined): RoundState {
  const row = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const num = (key: string, fallback = 0) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : fallback)
  const armorRow = (typeof row.playerArmor === 'object' && row.playerArmor !== null && !Array.isArray(row.playerArmor)
    ? row.playerArmor
    : {}) as Record<string, unknown>
  // A save written before armor was per-item has a `fromItems` number and no
  // pieces. There is no honest way to say which item those points were on, so
  // the natural pool is read and the rest is rebuilt from the holdings when
  // the round next writes -- a fight resumed across that boundary loses the
  // wear, which is the generous direction and the only one available.
  const armor: Armor = {
    natural: typeof armorRow.natural === 'number' && Number.isFinite(armorRow.natural) ? armorRow.natural : 0,
    pieces: Array.isArray(armorRow.pieces) ? armorRow.pieces.flatMap((entry) => pieceFromJson(entry) ?? []) : [],
  }
  return {
    // A save from before rounds were numbered reads as round 1, which makes a
    // resumed fight offer one more opening move than it should. That is the
    // generous direction and the only one available -- the number it should
    // have is not recoverable from anything else in the round.
    roundNumber: Math.max(1, num('roundNumber', 1)),
    playerActionsSpent: num('playerActionsSpent'),
    monsterActionsSpent: num('monsterActionsSpent'),
    playerHitPoints: num('playerHitPoints'),
    playerArmor: armor,
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
  // ZERO, not one: every round including the first is opened by `beginRound`,
  // which increments. A one here would have the opening round read as the
  // second and quietly withhold every `firstActionOfEncounter` move in the
  // game.
  roundNumber: 0,
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
  return { ...previous, roundNumber: previous.roundNumber + 1, playerActionsSpent: 0, monsterActionsSpent: 0 }
}

export function playerActionsLeft(state: RoundState, playerDerived: DerivedStats): number {
  return Math.max(0, playerDerived.actionsPerRound - state.playerActionsSpent)
}

export function monsterActionsLeft(state: RoundState, monster: Monster): number {
  return actionsRemaining(monster, state.monsterDamageTaken, state.monsterActionsSpent)
}

/**
 * WHETHER THE ACTION ABOUT TO BE RESOLVED IS THE ROUND'S FIRST OR ITS LAST,
 * whoever is taking it (model/modifiers.ts's `ActionPosition`).
 *
 * Over the ROUND rather than over one side's pool, deliberately: "the first
 * action each round" is the first thing that happens in the round, and reading
 * it per side would leave an opener on Dodge -- which only ever fires on a
 * MONSTER's action -- permanently switched off.
 *
 * The last one is "nothing else is left afterwards", counting both pools, so a
 * round where the monster is out of actions and the player has one left is on
 * its last. A round of a single action is both, which is why this returns two
 * flags rather than a position.
 */
export function roundActionPosition(
  state: RoundState,
  playerDerived: DerivedStats,
  monster: Monster,
): ActionPosition {
  const spent = state.playerActionsSpent + state.monsterActionsSpent
  const left = playerActionsLeft(state, playerDerived) + monsterActionsLeft(state, monster)
  return { first: spent === 0, last: left <= 1 }
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
  /** What one blow of this attacker's is worth at its CEILING -- the nominal. */
  base: number
  /** What the damage roll came to, before the crit and before armour. */
  rolled: number
  /** The band it was drawn from, low first (model/damageRoll.ts). */
  low: number
  high: number
  /** Draws taken: one, plus one per point of the attacker's Luck. */
  rolls: number
  /** 1, or 2 on a crit. */
  critMultiplier: number
  /** What armour stopped, where it was consulted. */
  absorbed: number
}

export const NO_BLOW_MATH: BlowMath = {
  dodge: null, hit: null, crit: null, base: 0, rolled: 0, low: 0, high: 0, rolls: 1,
  critMultiplier: 1, absorbed: 0,
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
  /**
   * A CLASS MOVE's say on this one blow (model/vectors.ts, vector four).
   * Damage scaling is applied by the CALLER, which strikes the right number
   * of times; what arrives here is the part that belongs inside one exchange.
   */
  ignoreArmor?: boolean
  /** Extra flat armour for this blow only, from a defensive move. Natural, so nothing decays it. */
  guard?: number
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

  // HOW MUCH OF THE NOMINAL ACTUALLY ARRIVES, drawn from the attacker's own
  // Perception band, best of their Luck's worth of draws (model/damageRoll.ts).
  // Rolled after the crit rather than before it only because there is no
  // point rolling damage for a blow that did not land.
  const drawn = rollAttackDamage({
    nominal: input.attackerDamage,
    attackerStats: input.attackerStats,
    rng,
  })
  rng = drawn.rng
  math.rolled = drawn.damage
  math.low = drawn.low
  math.high = drawn.high
  math.rolls = drawn.rolls

  // WHOLE, once, here. The power multiplier makes a monster's damage
  // fractional (8.4 at level one, 16.8 on a crit), and leaving it that way
  // meant the record lost 16.8 hit points while the narration said 17. Hit
  // points are a count; rounding at the blow is the only place the two can
  // be made to agree.
  const raw = Math.round(drawn.damage * math.critMultiplier)

  // Armor is Defend's alone. Flee, Take the hit and magic all say so
  // explicitly, and Dodge never reaches here. The pool comes back UNTOUCHED
  // rather than emptied -- it is still on the defender, it simply did not
  // help. For magic that is the rule rather than a consequence: a plated
  // monster is the problem Intellect answers.
  // A move that IGNORES ARMOUR leaves here with the whole blow, by the same
  // route magic does: the pool comes back untouched rather than emptied,
  // because it is still on the defender and simply did not help.
  if (input.defence !== 'defend' || input.ignoreArmor) {
    return {
      blow: { hit: true, crit: critRoll.value.passed, dodged: false, damage: raw, armorDecayed: false, math },
      armor,
      rng,
    }
  }

  // A defensive move's GUARD is flat armour for this blow only. It goes in
  // the natural pool -- the half decay cannot touch -- because it is not a
  // thing the defender owns and wears down; it is what they did this turn.
  const guarded = input.guard && input.guard > 0
    ? { ...armor, natural: armor.natural + input.guard }
    : armor
  const absorbed = absorb(guarded, raw, input.defenderStats.luck, rng)
  return {
    blow: {
      hit: true,
      crit: critRoll.value.passed,
      dodged: false,
      damage: absorbed.damage,
      armorDecayed: absorbed.decayed,
      math: { ...math, absorbed: absorbed.absorbed },
    },
    // The guard is TAKEN BACK OUT of what is stored. It was this turn's
    // choice, not a pool the defender owns, and leaving it in would have a
    // Sentinel's Bulwark quietly accumulate four permanent armour a round.
    armor: input.guard && input.guard > 0
      ? { ...absorbed.armor, natural: Math.max(0, absorbed.armor.natural - input.guard) }
      : absorbed.armor,
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
 *
 * ONE ACTION, ONE OR MORE BLOWS. A class move may strike several times
 * (model/vectors.ts), and each strike is a whole exchange of its own: its own
 * dodge offer, its own hit roll, its own crit and its own damage draw. That
 * is what makes a Juggler's two blows at 60% a different thing from one blow
 * at 120% -- the same expected damage, spread over twice as many chances to
 * miss and twice as many chances to crit. Collapsing them into one scaled
 * blow would have made the class a rounding difference.
 */
export function resolvePlayerAttack(options: {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  playerDerived: DerivedStats
  /** The player's own accuracy and crit adjustments. Monsters carry none. */
  playerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  successAdjust?: number
  /** The armed class move, or null for an ordinary attack. */
  move?: CombatMove | null
  rng: RngState
}): { state: RoundState; blow: Blow; blows: Blow[]; rng: RngState } {
  const move = options.move ?? null
  const chances = withMoveShares(options.playerChances, move)
  const nominal = damageFrom(options.playerDerived.damageMultiplier) * damageShareOf(move)
  let rng = options.rng
  let taken = 0
  const blows: Blow[] = []

  for (let strike = 0; strike < strikesOf(move); strike += 1) {
    // The MONSTER's dodge, which the thumb presses down rather than up. Rolled
    // per strike: a second blow is a second chance to be somewhere else.
    const offered = rollDodgeOffered({
      defenderStats: options.monster.stats,
      attackerStats: options.playerStats,
      defender: 'monster',
      successAdjust: options.successAdjust,
      rng,
    })
    const exchange = resolveExchange({
      attackerStats: options.playerStats,
      attackerDamage: nominal,
      defenderStats: options.monster.stats,
      // The monster's own plate, in the natural pool -- so `absorb` reduces the
      // blow and has nothing it is allowed to wear away (model/armor.ts). There
      // is therefore no armor to carry back out of the exchange, which is why
      // nothing here stores one.
      armor: options.monster.armor,
      attackerChances: chances,
      attacker: 'player',
      successAdjust: options.successAdjust,
      defence: monsterDefence(offered.offered),
      ignoreArmor: move?.ignoresArmor,
      dodgeOffered: offered.offered,
      dodgeRoll: offered.roll,
      rng: offered.rng,
    })
    rng = exchange.rng
    taken += exchange.blow.damage
    blows.push(exchange.blow)
  }

  return {
    state: {
      ...options.state,
      playerActionsSpent: options.state.playerActionsSpent + 1,
      // A STUN IS A SPENT ACTION on the other side's clock, which is the unit
      // a round already counts in -- so nothing had to learn a new kind of
      // state for it, and a stun cannot outlive the round it was landed in.
      monsterActionsSpent: options.state.monsterActionsSpent + (move?.stealsActions ?? 0),
      monsterDamageTaken: options.state.monsterDamageTaken + taken,
    },
    // The FIRST blow, for callers that describe one. `blows` is the whole of
    // what happened and is what the narration walks.
    blow: blows[0],
    blows,
    rng,
  }
}

/**
 * A move's accuracy and crit shares, folded into whatever the character's own
 * modifiers already said.
 *
 * MULTIPLIED ON THE REMAINDER, not added: a chance adjustment is carried as
 * "what share of the failures survives" (model/chance.ts), so two sources
 * compose by multiplying those survivals. That is why a move can promise
 * "half the misses gone" on top of an item that already removed a fifth and
 * neither overshoots nor needs a clamp.
 */
function withMoveShares(
  own: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>> | undefined,
  move: CombatMove | null,
): Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>> | undefined {
  if (!move || (!move.hitShare && !move.critShare)) return own
  const base = own ?? { hitChance: NO_CHANCE_ADJUSTMENT, critChance: NO_CHANCE_ADJUSTMENT }
  return {
    hitChance: composeShare(base.hitChance, move.hitShare ?? 0),
    critChance: composeShare(base.critChance, move.critShare ?? 0),
  }
}

/** One share of the remainder, in the sign convention the adjustment uses. */
function composeShare(adjustment: ChanceAdjustment, share: number): ChanceAdjustment {
  if (share === 0) return adjustment
  return share > 0
    ? { ...adjustment, failureKeep: adjustment.failureKeep * (1 - Math.min(1, share)) }
    : { ...adjustment, successKeep: adjustment.successKeep * (1 - Math.min(1, -share)) }
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
  defence: Defence
  /**
   * The roll that PUT Dodge on the table, taken when the action was armed
   * rather than here. Carried through so the blow can explain itself: picking
   * Dodge cannot fail, because Dodge being there IS the success, and the
   * number behind that is the only one a dodged blow has to show.
   */
  dodgeRoll?: Roll | null
  successAdjust?: number
  /** The PLAYER's armed move for the defence they picked. Guards and ripostes. */
  defenceMove?: CombatMove | null
  /** The MONSTER's armed move for its own attack. Strikes, shares, armour. */
  monsterMove?: CombatMove | null
  /** The player's stats as their modifiers leave them, for a riposte's damage. */
  playerDamage?: number
  rng: RngState
}): {
  state: RoundState
  blow: Blow | null
  /** Every blow the monster threw this action -- more than one where its class strikes twice. */
  blows: Blow[]
  /** What the player's defensive move struck back for, if it did. */
  riposte: Blow | null
  escaped: boolean
  pursuit: Roll | null
  rng: RngState
} {
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
      return { state: { ...spent, playerFled: true }, blow: null, blows: [], riposte: null, escaped: true, pursuit, rng }
    }
  }

  const monsterMove = options.monsterMove ?? null
  const defenceMove = options.defenceMove ?? null
  const nominal = options.monster.damage * damageShareOf(monsterMove)
  const monsterChances = withMoveShares(
    { hitChance: options.monster.chances.hitChance, critChance: options.monster.chances.critChance },
    monsterMove,
  )

  let armor = options.state.playerArmor
  let hurt = 0
  const blows: Blow[] = []
  for (let strike = 0; strike < strikesOf(monsterMove); strike += 1) {
    const exchange = resolveExchange({
      attackerStats: options.monster.stats,
      attackerDamage: nominal,
      defenderStats: options.playerStats,
      armor,
      attackerChances: monsterChances,
      attacker: 'monster',
      successAdjust: options.successAdjust,
      defence: options.defence,
      ignoreArmor: monsterMove?.ignoresArmor,
      // The player's own defensive move guards EVERY strike of the action it
      // answered: it is the choice they made against this attack, not against
      // one blow of it.
      guard: defenceMove?.guard,
      dodgeOffered: options.defence === 'dodge',
      dodgeRoll: options.dodgeRoll,
      rng,
    })
    rng = exchange.rng
    armor = exchange.armor
    hurt += exchange.blow.damage
    blows.push(exchange.blow)
  }

  let state: RoundState = {
    ...spent,
    // A monster's stun costs the PLAYER actions, the mirror of the player's own.
    playerActionsSpent: spent.playerActionsSpent + (monsterMove?.stealsActions ?? 0),
    playerHitPoints: Math.max(0, spent.playerHitPoints - hurt),
    playerArmor: armor,
  }

  // THE RIPOSTE IS PART OF THE DEFENCE, not a free action: it costs the
  // player nothing because they already spent the choice, and it is resolved
  // only if they are still standing. Striking back from the floor would make
  // a Duelist's Riposte a way to win a fight you had already lost.
  let riposte: Blow | null = null
  if (defenceMove?.riposteShare && state.playerHitPoints > 0 && !state.playerFled) {
    const back = resolveExchange({
      attackerStats: options.playerStats,
      attackerDamage: (options.playerDamage ?? 0) * defenceMove.riposteShare,
      defenderStats: options.monster.stats,
      armor: options.monster.armor,
      attacker: 'player',
      successAdjust: options.successAdjust,
      // The monster is busy having attacked. A riposte is not answered.
      defence: 'none',
      dodgeOffered: false,
      rng,
    })
    rng = back.rng
    riposte = back.blow
    state = { ...state, monsterDamageTaken: state.monsterDamageTaken + back.blow.damage }
  }

  return {
    state,
    blow: blows[0] ?? null,
    blows,
    riposte,
    escaped: false,
    pursuit,
    rng,
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

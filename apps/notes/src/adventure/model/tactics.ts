// SIX RULES ABOUT A FIGHT'S SHAPE, and the one place all of them live.
//
// A stat, a derived value and a chance all answer "how good is this character
// at the thing they are doing". These six answer a different question: what
// does the ORDER of what happens make true. Combo pays for a long round, Mark
// pays for opening well, Setup pays for opening well against something that
// will later be nearly dead, Poison pays for landing often, Counter pays for
// being attacked, and Thorns pays for being hit while armoured.
//
// They are one kind and not six because everything about them is the same:
// each is ONE PERCENTAGE, each is banked additively across whatever the
// character holds (Combo 5% and Combo 3% is Combo 8% -- the standing rule
// that an active effect stacks), and each is read at exactly one named moment
// of the exchange. The moments are the functions below, so `combat.ts` calls
// six named questions rather than growing six special cases inside two
// resolvers that are already the longest thing in the model.
//
// SYMMETRIC, like everything else about a fight: a tactic belongs to whoever
// holds it, and a monster's species can carry one. That is why the tally
// below is per SIDE rather than per player -- a rule written for one side and
// not its sibling is this codebase's characteristic failure, and the cost of
// avoiding it here is one extra field per number.
//
// PERCENTAGES ARE FRACTIONS, as everywhere in the vocabulary: `0.05` is the
// "Combo (5)" the design calls for.

import type { Armor } from './armor'
import { totalArmor } from './armor'

export const TACTIC_KEYS = ['combo', 'poison', 'mark', 'setup', 'counter', 'thorns'] as const

export type TacticKey = typeof TACTIC_KEYS[number]

/** What each is worth, as a fraction. Zero is "not held", which is the default. */
export type Tactics = Readonly<Record<TacticKey, number>>

export const NO_TACTICS: Tactics = {
  combo: 0, poison: 0, mark: 0, setup: 0, counter: 0, thorns: 0,
}

export const TACTIC_LABELS: Readonly<Record<TacticKey, string>> = {
  combo: 'Combo',
  poison: 'Poison',
  mark: 'Mark',
  setup: 'Setup',
  counter: 'Counter',
  thorns: 'Thorns',
}

/**
 * What each one MEANS, for the verbose style. The concise style prints the
 * name and the figure and nothing else, which is what the six names are for.
 */
export const TACTIC_EXPLANATIONS: Readonly<Record<TacticKey, string>> = {
  combo: 'each attack this round, landed or not, makes the next ones hit harder',
  poison: 'each landed blow leaves a share of itself, paid at the end of every round',
  mark: 'a share of the round\'s first blow is added to its last',
  setup: 'a share of the fight\'s first blow is added to every blow against a maimed foe',
  counter: 'a free attack every time you answer a blow, worth a share of an ordinary one',
  thorns: 'armour that stops a blow throws a share of itself back',
}

/**
 * WHAT ONE SIDE HAS DONE, which is the whole of what the six need to know.
 *
 * On the ROUND, because that is where a fight keeps anything that outlives a
 * single step. Two of the four reset when the round turns over and two do
 * not, and which is which is the rule rather than an accident:
 *
 *   strikes      resets -- Combo is explicitly a thing that builds within a
 *                round and is gone at the next one
 *   firstBlow    resets -- Mark pairs the round's first with the round's last
 *   poison       carries -- a poisoned thing stays poisoned; stacks accrue
 *                across rounds and are PAID at the end of each
 *   openingBlow  carries -- Setup names the first blow of the FIGHT
 */
export interface SideTally {
  /** Attacks this side has taken this round, landed or not. Combo counts these. */
  strikes: number
  /** Damage of this side's FIRST attack this round. Mark pays a share of it. */
  firstBlow: number
  /** Damage of this side's first attack of the whole fight. Setup pays a share of it. */
  openingBlow: number
  /** Poison owed by the OPPONENT, accrued by this side's landed blows. Paid per round. */
  poison: number
}

export const NO_TALLY: SideTally = { strikes: 0, firstBlow: 0, openingBlow: 0, poison: 0 }

/** Both sides' tallies. Keyed the way `ChanceSide` already keys a fight. */
export interface Tallies {
  player: SideTally
  monster: SideTally
}

export const NO_TALLIES: Tallies = { player: NO_TALLY, monster: NO_TALLY }

/** What a new round leaves standing: the two that carry, and not the two that do not. */
export function tallyIntoRound(tally: SideTally): SideTally {
  return { ...tally, strikes: 0, firstBlow: 0 }
}

export function talliesIntoRound(tallies: Tallies): Tallies {
  return { player: tallyIntoRound(tallies.player), monster: tallyIntoRound(tallies.monster) }
}

/**
 * WHAT THE BLOW ABOUT TO BE THROWN IS WORTH, before it is rolled.
 *
 * Three of the six land here, and they compose the way the vocabulary's
 * quantities always do -- ADDITIVELY, as shares of the nominal, because these
 * are quantities and not chances. Combo is a share per strike already taken,
 * Mark and Setup are shares of a blow that has already landed.
 *
 * Conditional on the moment, not on the character: `isLastOfRound` and
 * `targetIsMaimed` are facts the caller has and this cannot work out, and an
 * absent one simply means the rule is not in force -- the same convention as
 * `Situation`.
 */
export function blowDamageWith(options: {
  nominal: number
  tactics: Tactics
  tally: SideTally
  isLastOfRound: boolean
  targetIsMaimed: boolean
}): number {
  const { nominal, tactics, tally } = options
  // A share per strike ALREADY TAKEN, so the first attack of a round is
  // exactly the nominal and the second is the first one's worth better.
  let damage = nominal * (1 + tactics.combo * tally.strikes)
  if (options.isLastOfRound) damage += tactics.mark * tally.firstBlow
  if (options.targetIsMaimed) damage += tactics.setup * tally.openingBlow
  return damage
}

/**
 * The tally after a blow. Every attack counts towards Combo whatever became
 * of it -- the design says so explicitly, and it is what makes Combo scale
 * with how many actions a round has rather than with how well they went --
 * while Poison, Mark and Setup all read DAMAGE and so read nothing from a
 * blow that did not land.
 */
export function tallyAfterBlow(tally: SideTally, tactics: Tactics, damage: number): SideTally {
  const landed = damage > 0
  return {
    strikes: tally.strikes + 1,
    firstBlow: tally.strikes === 0 ? damage : tally.firstBlow,
    openingBlow: tally.openingBlow === 0 ? damage : tally.openingBlow,
    poison: landed ? tally.poison + tactics.poison * damage : tally.poison,
  }
}

/**
 * What a side's poison does to the other when the round turns over.
 *
 * Whole, because hit points are a count and the blow rounds for the same
 * reason. It is NOT reduced by armour and cannot miss -- poison is the one
 * damage in the game that is simply owed.
 */
export function poisonDamage(tally: SideTally): number {
  return Math.round(tally.poison)
}

/**
 * What the armour that just stopped a blow throws back, given the pool it was
 * stopped with. Reads the WHOLE pool, natural and decaying together, so a
 * thorned character is worth more the better armoured they are -- and reads
 * it AFTER the absorb, because what is left is what is still standing there.
 */
export function thornsRecoil(tactics: Tactics, armor: Armor): number {
  if (tactics.thorns <= 0) return 0
  return Math.round(tactics.thorns * totalArmor(armor))
}

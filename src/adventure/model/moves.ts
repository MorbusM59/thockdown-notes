// WHICH MOVE IS ARMED, and what a blow struck with it is worth.
//
// A class (model/vectors.ts, vector four) is a list of moves, each of which
// stands in for one ordinary choice under one condition. This module answers
// the two questions that turns into:
//
//   armMove(...)    -- given what the fight looks like right now, which of
//                      this actor's moves replaces this choice? Rolled ONCE,
//                      when the action comes up.
//   blowsFor(...)   -- what does striking with it actually consist of?
//
// ARMED, NOT ASKED. The move is decided at the moment the action is armed
// and stored on the fight's state, exactly as the dodge offer and the
// round's charms are, and for the same reason: `present` may not roll, and a
// move re-rolled on every React render would change while the player looked
// at it. The stored id is what the cell is named after and what the resolve
// applies, so what the ring promised and what the blow did cannot disagree.
//
// FIRST DECLARED WINS. Where two moves could replace the same choice, the
// one earlier in the class's list is taken -- declaration order is the
// author's priority, and it is the only ordering that does not need a second
// field nobody would keep in step.

import { nextChance, type RngState } from '../core/rng'
import type { CombatClass, CombatMove } from './vectors'
import type { Defence } from './defences'
import { HEALTH_BAND_BOUNDS, bandWithArticle, inHealthBand } from './health'
import type { DescriptionStyle } from './modifiers'

/** What the triggers read. Everything in it is a fact the fight already has. */
export interface MoveSituation {
  /** This actor's actions in the whole encounter so far, this one not counted. */
  actionsTakenThisEncounter: number
  /** This actor's actions in this round so far, this one not counted. */
  actionsSpentThisRound: number
  /** Including this one. 1 means this is the last. */
  actionsLeftThisRound: number
  /** Current over maximum, 0..1. */
  healthFraction: number
  /** The OTHER side's, 0..1. Absent where there is nobody across from you. */
  opponentHealthFraction?: number
}

export const FRESH_SITUATION: MoveSituation = {
  actionsTakenThisEncounter: 0,
  actionsSpentThisRound: 0,
  actionsLeftThisRound: 1,
  healthFraction: 1,
}

/**
 * Whether a trigger's condition holds, for everything but `chance`.
 *
 * `chance` is absent from this on purpose: it is the one trigger that costs a
 * draw, and a predicate that sometimes moves the seeded stream is a predicate
 * nobody can call twice. `armMove` rolls it, once, and only for a move whose
 * turn it actually is.
 */
function conditionHolds(move: CombatMove, situation: MoveSituation): boolean {
  switch (move.when.kind) {
    case 'always': return true
    case 'firstActionOfEncounter': return situation.actionsTakenThisEncounter === 0
    case 'firstActionOfRound': return situation.actionsSpentThisRound === 0
    case 'lastActionOfRound': return situation.actionsLeftThisRound <= 1
    case 'health': return inHealthBand(situation.healthFraction, move.when.band)
    case 'targetHealth': return situation.opponentHealthFraction !== undefined
      && inHealthBand(situation.opponentHealthFraction, move.when.band)
    case 'chance': return true
  }
}

/**
 * The move that replaces `choice` this time, or null for the ordinary one.
 *
 * Deterministic for every trigger but `chance`, and the rng comes back
 * advanced only where a chance was actually rolled -- a draw taken for a move
 * that could not have fired anyway would move the stream and make two runs
 * with the same seed diverge on a class nobody picked.
 */
export function armMove(
  combatClass: CombatClass | null,
  choice: 'attack' | Defence,
  situation: MoveSituation,
  rng: RngState,
): { move: CombatMove | null; rng: RngState } {
  if (!combatClass) return { move: null, rng }
  let current = rng
  for (const move of combatClass.moves) {
    if (move.replaces !== choice) continue
    if (!conditionHolds(move, situation)) continue
    if (move.when.kind === 'chance') {
      const draw = nextChance(current, move.when.chance)
      current = draw.rng
      if (!draw.value) continue
      return { move, rng: current }
    }
    return { move, rng: current }
  }
  return { move: null, rng: current }
}

/** A move by id, out of a class. What the fight stored is an id, like everything else. */
export function moveById(combatClass: CombatClass | null, id: string | null): CombatMove | null {
  if (!combatClass || !id) return null
  return combatClass.moves.find((move) => move.id === id) ?? null
}

/** How many blows one action with this move is. One, without a move. */
export function strikesOf(move: CombatMove | null): number {
  return Math.max(1, Math.floor(move?.strikes ?? 1))
}

/** What each of those blows is worth, as a share of a nominal one. */
export function damageShareOf(move: CombatMove | null): number {
  return Math.max(0, move?.damageShare ?? 1)
}

/**
 * WHAT A MOVE IS WORTH, in the lines its cell shows.
 *
 * Written from the fields rather than from a hand-written sentence per move,
 * for the reason every other describer in this game is: a move whose numbers
 * were tuned and whose description was not is a move that lies, and there is
 * no test that can catch a stale sentence.
 */
/**
 * THE CONCISE FORM'S NAMED MECHANICS.
 *
 * Each is a quantity the game has, given one word so a cell's detail can be
 * read at a glance instead of parsed. Exported because the format contract
 * (`descriptionFormat.contract.test.ts`) has to know which capitalised words
 * are proper names rather than sentences that lost their full stop -- and a
 * second hand-written list of them is exactly the drift that rule exists to
 * prevent.
 */
export const MOVE_TERMS = ['Split', 'Magical', 'Stun', 'Vengeance', 'Block'] as const

export function describeMove(move: CombatMove, style: DescriptionStyle): string[] {
  const concise = style === 'concise'
  const pct = (fraction: number) => Math.round(fraction * 100)
  const lines: string[] = []
  const strikes = strikesOf(move)
  const share = damageShareOf(move)

  // SPLIT is the term for one action spent as several blows, and it is named
  // rather than spelled out because two blows at 60% is a different thing
  // from one at 120% and a player needs to recognise which they are holding.
  // Not "Flurry": that is the name of a Juggler move, and a term that also
  // names one specific move reads as a cross-reference to it.
  if (strikes > 1) {
    lines.push(concise
      ? `Split (${strikes}x${pct(share)}%)`
      : `${strikes} strikes, ${pct(share)}% Damage each`)
  } else if (share !== 1) {
    lines.push(`${pct(share)}% of a blow`)
  }
  // The two share rules read as conversions, because that is what they are:
  // a share of the misses BECOMES hits, a share of the hits BECOMES crits.
  if (move.hitShare) {
    lines.push(concise ? `${pct(move.hitShare)}% miss to hit` : `${pct(move.hitShare)}% of the misses gone`)
  }
  if (move.critShare) {
    lines.push(concise ? `${pct(move.critShare)}% hit to crit` : `${pct(move.critShare)}% of the hits turned critical`)
  }
  // MAGICAL, because that is already the game's word for a blow armor does
  // not reduce -- the same rule spells say aloud.
  if (move.ignoresArmor) lines.push(concise ? 'Magical' : 'Armor does not see it')
  if (move.stealsActions) {
    lines.push(concise
      ? `Stun (${move.stealsActions})`
      : `costs them ${move.stealsActions} Action${move.stealsActions === 1 ? '' : 's'}`)
  }
  if (move.riposteShare) {
    lines.push(concise
      ? `Vengeance (${pct(move.riposteShare)}%)`
      : `strikes back for ${pct(move.riposteShare)}% of a blow`)
  }
  if (move.guard) lines.push(concise ? `${move.guard} Block` : `${move.guard} Armor, this blow only`)

  // THE TRIGGER, and in concise an unconditional one says NOTHING: "every
  // time" is the absence of a condition, and printing it makes the reader
  // check a line that can never differ.
  const when = whenWords(move, style)
  if (when) lines.push(when)

  // FLAVOUR IS NOT A DESCRIPTION. It is a sentence -- capitalised, with a
  // full stop -- and it says nothing about what the move does, which is
  // exactly what concise asks to be rid of. It is the one line here the
  // description format rules do not govern, because it is not one of them.
  if (move.flavour && style === 'verbose') lines.push(move.flavour)
  return lines
}

/**
 * WHEN THE MOVE COMES UP, or an empty string where concise has nothing to say.
 *
 * The two round positions take the SAME adjectives an item's conditional
 * percentage takes (`Initial`, `Final`, model/modifiers.ts): the fact is the
 * same one, and reading it two ways because it arrived from two functions is
 * the drift this codebase is characteristically made of.
 */
function whenWords(move: CombatMove, style: DescriptionStyle): string {
  const concise = style === 'concise'
  switch (move.when.kind) {
    case 'always': return concise ? '' : 'every time'
    case 'firstActionOfEncounter': return concise ? 'on Engage' : 'on the first action of a fight'
    case 'firstActionOfRound': return concise ? 'Initial' : 'on the first action of a round'
    case 'lastActionOfRound': return concise ? 'Final' : 'on the last action of a round'
    case 'chance': return `${Math.round(move.when.chance * 100)}% of the time`
    case 'health': return concise
      ? move.when.band
      : `while ${move.when.band} (${HEALTH_BAND_BOUNDS[move.when.band]})`
    case 'targetHealth': return concise
      ? `vs ${move.when.band}`
      : `against ${bandWithArticle(move.when.band)} foe (${HEALTH_BAND_BOUNDS[move.when.band]})`
  }
}

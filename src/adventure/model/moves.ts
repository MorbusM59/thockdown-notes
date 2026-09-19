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
    case 'whileHurt': return situation.healthFraction < move.when.belowFraction
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
export function describeMove(move: CombatMove): string[] {
  const lines: string[] = []
  const strikes = strikesOf(move)
  const share = damageShareOf(move)
  if (strikes > 1) lines.push(`${strikes} strikes, ${Math.round(share * 100)}% damage each`)
  else if (share !== 1) lines.push(`${Math.round(share * 100)}% of a blow`)
  if (move.hitShare) lines.push(`${Math.round(move.hitShare * 100)}% of the misses gone`)
  if (move.critShare) lines.push(`${Math.round(move.critShare * 100)}% of the hits turned critical`)
  if (move.ignoresArmor) lines.push('Armour does not see it')
  if (move.stealsActions) lines.push(`Costs them ${move.stealsActions} action${move.stealsActions === 1 ? '' : 's'}`)
  if (move.riposteShare) lines.push(`Strikes back for ${Math.round(move.riposteShare * 100)}% of a blow`)
  if (move.guard) lines.push(`${move.guard} armour, this blow only`)
  lines.push(WHEN_WORDS(move))
  if (move.flavour) lines.push(move.flavour)
  return lines
}

function WHEN_WORDS(move: CombatMove): string {
  switch (move.when.kind) {
    case 'always': return 'Every time'
    case 'firstActionOfEncounter': return 'On the first action of a fight'
    case 'firstActionOfRound': return 'On the first action of a round'
    case 'lastActionOfRound': return 'On the last action of a round'
    case 'chance': return `${Math.round(move.when.chance * 100)}% of the time`
    case 'whileHurt': return `Below ${Math.round(move.when.belowFraction * 100)}% health`
  }
}

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
import { describePercent, type DescriptionStyle } from './modifiers'
import { TACTIC_LABELS } from './tactics'

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
export const MOVE_TERMS = ['Split', 'Magical', 'Stun', 'Block'] as const

export function describeMove(move: CombatMove, style: DescriptionStyle): string[] {
  const concise = style === 'concise'
  const pct = (fraction: number) => Math.round(fraction * 100)
  const lines: string[] = []
  const strikes = strikesOf(move)
  const share = damageShareOf(move)

  // WHAT THE WHOLE ACTION IS WORTH, as a plain percentage of an ordinary
  // attack: `300% Damage`. Not `+200%`, and not `300% of a blow` -- an
  // absolute figure asks the reader for no arithmetic at all, and the SIGN is
  // what separates the two kinds: an item's `+50% Damage` is a modifier on
  // top of an attack, a move's `300% Damage` is the attack.
  //
  // FOR A SPLIT IT IS THE TOTAL, which is the number the reader actually
  // wants -- `180% Damage | Split (4)` rather than a per-strike share they
  // have to multiply. The count stays its own term because it is a different
  // fact and the one that matters: four blows at 45% is not one at 180%, it
  // is four chances to miss and four chances to crit.
  //
  // SPLIT, and not "Flurry": that is the name of a Juggler move, and a term
  // that also names one specific move reads as a cross-reference to it.
  const total = strikes * share
  if (total !== 1 || strikes > 1) lines.push(`${pct(total)}% Damage`)
  if (strikes > 1) {
    lines.push(concise
      ? `Split (${strikes})`
      : `Split (${strikes}): spent as ${strikes} separate blows, each rolled on its own`)
  }

  // THE SAME DESCRIBER AN ITEM'S CHANCE EFFECT USES, because it is the same
  // arithmetic to the line: both multiply the one `ChanceAdjustment` and both
  // compose by multiplying keep factors (model/chance.ts). Two vocabularies
  // for it -- an item naming the destination, a move naming the transition --
  // meant a player holding both was reading one mechanism described two ways,
  // with no way to tell they would stack. It also fixes a real defect on the
  // way: this printed "-35% miss to hit" for a NEGATIVE share, which is not
  // what a minus means here and not what the code does. It is "-35% to Hit",
  // and a minus is the ladder downwards -- 35% of the hits become misses.
  if (move.hitShare) lines.push(describePercent('hitChance', move.hitShare, style))
  if (move.critShare) lines.push(describePercent('critChance', move.critShare, style))
  // MAGICAL, because that is already the game's word for a blow armor does
  // not reduce -- the same rule spells say aloud.
  if (move.ignoresArmor) lines.push(concise ? 'Magical' : 'Armor does not see it')
  if (move.stealsActions) {
    lines.push(concise
      ? `Stun (${move.stealsActions})`
      : `costs them ${move.stealsActions} Action${move.stealsActions === 1 ? '' : 's'}`)
  }
  // COUNTER, in the tactic's own notation (model/tactics.ts), because it IS
  // that tactic: a move's share adds to whatever the character carries.
  // "Vengeance" was this same rule under a private name, and a second name
  // for one mechanism is the thing a player cannot tell will compose.
  if (move.counter) {
    lines.push(concise
      ? `${TACTIC_LABELS.counter} (${pct(move.counter)})`
      // NOT the tactic's own explanation, which says "every time you answer a
      // blow" -- true of a trait that is always on and false of a move, which
      // is the one action just chosen. The verbose form spells the share out
      // instead, and the reader learns the word itself from the tactic.
      // "worth N% of an ordinary one", NOT "N% Damage": Counter's number is
      // the whole size of the free attack, where a Damage percentage is a
      // modifier on top of one. Same reason the share above became `+100%
      // Damage` -- each quantity says what kind it is.
      : `${TACTIC_LABELS.counter} (${pct(move.counter)}): a free attack at ${pct(move.counter)}% Damage`)
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
    case 'chance': return `${Math.round(move.when.chance * 100)}% chance`
    case 'health': return concise
      ? move.when.band
      : `while ${move.when.band} (${HEALTH_BAND_BOUNDS[move.when.band]})`
    case 'targetHealth': return concise
      ? `vs ${move.when.band}`
      : `against ${bandWithArticle(move.when.band)} foe (${HEALTH_BAND_BOUNDS[move.when.band]})`
  }
}

// How a stat becomes a probability, in one place.
//
// EVERY chance in this game has the same shape: a base, a per-point step, and
// the stat it reads -- contested against that stat's counter. Dodge is
// `50% + 5%` per point of Agility, a crit is `20% + 10%` per point of Luck, a
// monster's pursuit of a fleeing player is `50% + 5%` per point of Agility
// again. Writing each of those out by hand is three chances to get the
// contest wrong and three places to fix when the rule changes, so an action
// DECLARES its two numbers and hands them here instead.
//
// CONTESTED means the opponent's counter stat is subtracted from mine before
// the step is applied. The pairing is symmetric where a stat answers itself
// and reciprocal where it does not, which is what makes "countered by" a
// relation rather than a table of special cases.
//
// An ABSENT opponent contributes ZERO, not the actor's own value. That is
// what makes the design plan's stat table -- `50% + 5% x Agility` -- the same
// formula as the contested one rather than a second rule: the table is the
// contest against an opponent of nothing. Defaulting to the actor's own value
// looks like it gives "a delta of zero" and does, but it also cancels the
// stat term itself, so an uncontested dodge came out at a flat 50% however
// nimble the character was.

import type { StatBlock, StatKey } from './stats'

export const COUNTER_STATS: Readonly<Record<StatKey, StatKey>> = {
  might: 'might',
  agility: 'agility',
  perception: 'luck',
  intellect: 'charisma',
  charisma: 'intellect',
  luck: 'perception',
}

/**
 * What goes into a contested formula in place of a bare stat: my value minus
 * my opponent's counter, or just my value when there is no opponent.
 *
 * Might answers Might. Nothing derived from a stat block uses it -- the
 * damage multiplier is a coefficient, not a check -- but special attacks and
 * later content are Might-versus-Might, which is why the entry exists.
 */
export function contestedStat(stat: StatKey, own: StatBlock, opponent?: StatBlock | null): number {
  return own[stat] - (opponent ? opponent[COUNTER_STATS[stat]] : 0)
}

/**
 * One chance, declared rather than written out: what it is at zero, what a
 * point of its stat is worth, and which stat that is.
 */
export interface StatChance {
  /** At a contested stat of zero. */
  base: number
  /** Added per point of the contested stat. Negative is legal -- a penalty per point is still a curve. */
  perPoint: number
  stat: StatKey
}

/**
 * A declared chance BEFORE clamping.
 *
 * Kept apart from `resolveChance` because some rules subtract from a chance
 * that is already over 1 and the order matters: a boss's loot check starts at
 * 200% and loses 50 points per repeat, so it is certain three times over.
 * Clamping first would make it 100% and then 50%, turning three guaranteed
 * loot screens into one and a coin flip.
 */
export function rawChance(chance: StatChance, own: StatBlock, opponent?: StatBlock | null): number {
  return chance.base + chance.perPoint * contestedStat(chance.stat, own, opponent)
}

export function clampChance(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** A declared chance, resolved against an actor and optionally an opponent. Always inside 0..1. */
export function resolveChance(chance: StatChance, own: StatBlock, opponent?: StatBlock | null): number {
  return clampChance(rawChance(chance, own, opponent))
}

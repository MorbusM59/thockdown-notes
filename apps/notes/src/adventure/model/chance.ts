// How a stat becomes a probability, in one place.
//
// EVERY chance in this game has the same shape: a HALVING CURVE over the
// contested stat delta. Writing each of them out by hand is a chance to get
// the contest wrong and a place to fix when the rule changes, so an action
// DECLARES its two numbers and hands them here instead.
//
// THE CURVE REPLACED A LINE, and the line is why. `base + perPoint x delta`
// walks off both ends: dodge reached a flat 100% at ten points of Agility and
// crit was CERTAIN at eight points of Luck, with the clamp turning both into
// immunities rather than into steep odds. That is not an edge case here -- a
// mono-stat build at the base cap of six plus six of tier is already at
// twelve, against another build's zero, so deltas past ten are ordinary play
// rather than a corner. The curve cannot reach either bound at any finite
// delta, so an immunity is not expressible.
//
// CONTESTED means the opponent's counter stat is subtracted from mine before
// the step is applied. The pairing is symmetric where a stat answers itself
// and reciprocal where it does not, which is what makes "countered by" a
// relation rather than a table of special cases.
//
// An ABSENT opponent contributes ZERO, not the actor's own value. That is
// what makes the stat table on a character sheet the same formula as the
// contested one rather than a second rule: the table is the contest against
// an opponent of nothing. Defaulting to the actor's own value looks like it
// gives "a delta of zero" and does, but it also cancels the stat term itself,
// so an uncontested dodge came out at a flat 50% however nimble the character
// was.

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
 * HOW FAST THE CURVE CLIMBS: at `deltaForce` 1, every point of delta halves
 * the chance of failure -- 50%, 75%, 87.5%. The shared default is a quarter
 * of that, so it takes FOUR points to halve, which keeps a one-point edge a
 * nudge and still leaves room above the deltas real builds reach.
 */
export const DEFAULT_DELTA_FORCE = 0.25

/**
 * One chance, declared rather than written out: how steeply it answers the
 * contested delta, where along that delta the coin flip sits, and which stat
 * it reads.
 *
 * THERE IS NO `base` FIELD, and that is the one thing this declaration no
 * longer says out loud. A chance at parity is `chanceAtDelta(chance, 0)` --
 * derived from the shift rather than authored beside it, because a base and a
 * shift are two ways to say the same thing and two ways to say one thing is
 * one way to say two different ones. `statChance.contract.test.ts` states
 * every declaration's parity value instead, so the number a designer actually
 * cares about is checked rather than implied.
 */
export interface StatChance {
  /** How steeply the curve answers the delta. See `DEFAULT_DELTA_FORCE`. */
  deltaForce: number
  /**
   * Where the coin flip sits: `p(-deltaShift) = 0.5`, always. Zero puts it at
   * parity; crit's -4 says a character needs four points of Luck over their
   * opponent just to crit half the time, which is what makes crit a rarity
   * rather than a contest.
   */
  deltaShift: number
  stat: StatKey
}

/**
 * THE CURVE. A chance at a given contested delta, and the only shape a
 * stat-delta check has.
 *
 *   u <= 0:  p = 0.5 x 2^(-deltaForce x |u|)
 *   u >  0:  p = 1 - 0.5 x 2^(-deltaForce x u)        where u = delta + deltaShift
 *
 * Read from whichever side you are on, that is one rule: EVERY
 * `1 / deltaForce` points of delta halves whichever of the two is left. It is
 * the same arithmetic as `ChanceAdjustment`'s keep factors and as
 * `pressThumb` below -- a percentage of a probability is a percentage of what
 * is LEFT -- so the base curve is no longer the one place in the game that
 * works differently from everything applied on top of it.
 *
 * Strictly inside 0..1 at every finite delta, and monotone in it. Nothing
 * clamps it, because there is nothing to clamp.
 */
export function chanceAtDelta(chance: StatChance, delta: number): number {
  const shifted = delta + chance.deltaShift
  const half = 0.5 * 2 ** (-chance.deltaForce * Math.abs(shifted))
  return shifted <= 0 ? half : 1 - half
}

export function clampChance(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** A declared chance, resolved against an actor and optionally an opponent. Always inside 0..1. */
export function resolveChance(chance: StatChance, own: StatBlock, opponent?: StatBlock | null): number {
  return chanceAtDelta(chance, contestedStat(chance.stat, own, opponent))
}

/**
 * What a modifier does to a chance, on top of whatever the stats made it.
 *
 * TWO KEEP FACTORS, not a scale and an offset, and the difference is the whole
 * rule: **a percentage of a probability is a percentage of what is LEFT.** A
 * +20% boost to a 60% chance to hit does not make it 72% and does not make it
 * 80% -- it takes a fifth of the MISSES away, leaving 68%. A second +10% takes
 * a tenth of what is still missing, leaving 71.2%. That is the same arithmetic
 * `pressThumb` does below, arrived at from the other end: the thumb is the
 * run's tuning expressed as a chance boost, and an item's boost is the same
 * shape so that neither can overshoot 0..1 and neither needs a clamp hiding a
 * mistake.
 *
 *   failureKeep -- the share of FAILURES a boost leaves standing, multiplied
 *                  together across every boost held. `1` is no boost at all.
 *   successKeep -- the mirror, for a PENALTY: the share of successes it
 *                  leaves standing. A buckler that costs 10% of your dodges
 *                  takes a tenth of the dodges, not ten points off the chance.
 *
 * Both are multiplicative on their own half, so holding two of anything is the
 * same arithmetic as holding one twice and the order they are collected in
 * cannot matter. Applied wherever the chance is used, exactly once -- which is
 * the whole reason this is a value carried alongside the profile rather than a
 * number folded into it: a chance is CONTESTED at the moment it is rolled, so
 * it cannot be finished in advance.
 *
 * A SCALE AND A DELTA came before this, and they were replaced rather than
 * added to. They could express "+5 points of crit", which reads fine on a
 * single item and is unbounded the moment two of them are held: three lucky
 * coins and a crit is certain. Every chance effect in the game is now a
 * percentage of the remainder, which is the same rule at every site
 * (model/modifiers.ts).
 */
export interface ChanceAdjustment {
  failureKeep: number
  successKeep: number
}

export const NO_CHANCE_ADJUSTMENT: ChanceAdjustment = { failureKeep: 1, successKeep: 1 }

/**
 * WHOSE roll this is. The one thing a chance needs to know about the world
 * outside the two stat blocks, and only because of the thumb below.
 */
export type ChanceSide = 'player' | 'monster'

/**
 * THE THUMB ON THE SCALE: one number, from 0 to 1, that scales a player's
 * chance to FAIL and a monster's chance to SUCCEED.
 *
 *   player:  1 - (1 - p) x (1 - t)      a 20% failure at t=0.5 becomes 10%
 *   monster: p x (1 - t)                a 60% hit    at t=0.5 becomes 30%
 *
 * At 0 it does nothing at all and every chance is exactly what the stats
 * made it. At 1 the player cannot fail and the monster cannot succeed.
 *
 * WHY THIS SHAPE rather than a flat bonus: both sides keep reading the same
 * stat table, the same contest and the same formulas, so a point of Agility
 * is worth what it was worth and nothing about the design has to be restated
 * at a second difficulty. It also cannot overshoot -- neither expression can
 * leave 0..1 for a chance already inside it -- so no clamp is hiding a
 * mistake, and it has diminishing absolute effect exactly where it should:
 * on a roll that was already nearly certain, there is little failure left to
 * halve.
 *
 * It is applied at the ROLL and nowhere else. A character's own numbers --
 * what the tab bar shows, what a stat point promises -- are what the
 * character is worth, and the thumb is a property of the run's tuning rather
 * than of them. See `resolveChanceWith`.
 */
export function pressThumb(chance: number, side: ChanceSide, successAdjust: number): number {
  const thumb = Math.max(0, Math.min(1, successAdjust))
  if (thumb === 0) return chance
  return side === 'player' ? 1 - (1 - chance) * (1 - thumb) : chance * (1 - thumb)
}

/** Everything about a roll that is not the two stat blocks. */
export interface ChanceContext {
  /** What the roller's items and traits do to this chance. */
  adjustment?: ChanceAdjustment
  /** Whose roll it is. Required for the thumb to mean anything. */
  side?: ChanceSide
  /** The run's thumb, 0..1. See `pressThumb`. */
  successAdjust?: number
}

/**
 * A declared chance, resolved, adjusted by what the roller carries, and then
 * weighted by the run's thumb -- the ONE way a chance is arrived at anywhere
 * in the game.
 *
 * Both the tab bar's figure and the roll in a fight come through here; they
 * differ in whether an opponent is passed and whether a side is. When they
 * did not share this function at all, an item saying "+10% crit" moved the
 * number on the bar and nothing in the fight, because combat resolved chances
 * from the stat block alone and never saw the modifier.
 */
export function resolveChanceWith(
  chance: StatChance,
  own: StatBlock,
  opponent: StatBlock | null | undefined,
  context: ChanceContext = {},
): number {
  const adjustment = context.adjustment ?? NO_CHANCE_ADJUSTMENT
  const stated = resolveChance(chance, own, opponent)
  // Gains first, then penalties. Each acts on its own half of the remainder,
  // so neither can leave 0..1 and the result needs no second clamp.
  const gained = 1 - (1 - stated) * Math.max(0, adjustment.failureKeep)
  const adjusted = clampChance(gained * Math.max(0, adjustment.successKeep))
  return context.side === undefined ? adjusted : pressThumb(adjusted, context.side, context.successAdjust ?? 0)
}

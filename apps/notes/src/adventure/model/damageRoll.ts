// WHAT ONE BLOW ACTUALLY COMES TO, which is not a fixed number.
//
// A blow's nominal damage (`damageFrom`, the Might curve times BASE_DAMAGE) is
// its CEILING, not its value. The blow rolls somewhere in a band below that
// ceiling, and how wide the band is reads Perception:
//
//   spread = BASE_DAMAGE_SPREAD x (6 - perception) / 6
//   the band runs from (1 - spread) to 1, as a share of nominal
//
// So an unobservant character swings wildly and a sharp one lands what they
// meant to. Six is the base stat cap, which is why it is the divisor and the
// zero: a character who has maxed Perception without gear does full damage
// every time, and that is the reward for it.
//
// THE SPREAD GOES NEGATIVE PAST SIX, and the band reverses rather than
// inverting: `1 - spread` is then above 1, so the band runs from 1 UP to it.
// Gear that carries Perception past what a run can reach on its own stops
// buying consistency and starts buying damage, which is the right shape for a
// stat to have past its own cap -- and it falls out of the formula rather
// than being a second rule bolted on for the case.
//
// LUCK BUYS REROLLS: one extra per point, best of them taken. Not a bonus to
// the number but another draw at it, which is what makes Luck read as luck --
// it cannot push a blow past the band's ceiling, only stop it landing at the
// floor. At Perception 6 the band is a point and Luck buys nothing here at
// all, which is the honest consequence of a band with no width.
//
// IT IS THE ATTACKER'S STATS, whoever the attacker is. A lucky monster rolls
// its damage as many times as a lucky player does. That is the same rule
// every other chance in this game follows -- both sides read one stat table,
// and the thumb (model/chance.ts) exists precisely so the difficulty dial
// never has to become a second one. The spec said "the user gets one extra
// roll per point of luck"; applying it to the attacker rather than to the
// player is the reading that keeps that invariant, and it is the one thing
// here to overrule if it was meant narrowly.

import { nextFloat, type RngState } from '../core/rng'
import type { StatBlock } from './stats'

/** The band's width at Perception 0, as a share of nominal damage. Tunable. */
export const BASE_DAMAGE_SPREAD = 0.5

/** Where the curve flattens: the base stat cap, so a maxed run does full damage. */
export const SPREAD_PIVOT = 6

/** `BASE_DAMAGE_SPREAD x (6 - perception) / 6`. Negative past the pivot, deliberately. */
export function damageSpread(perception: number): number {
  return BASE_DAMAGE_SPREAD * ((SPREAD_PIVOT - perception) / SPREAD_PIVOT)
}

/**
 * The band, as shares of nominal, LOW FIRST however the spread came out.
 *
 * Ordering here rather than at each caller is the whole reason this is a
 * function: a negative spread reverses the two, and a caller that assumed
 * `1 - spread` was the floor would sample a band running the wrong way.
 */
export function damageBand(perception: number): { low: number; high: number } {
  const edge = 1 - damageSpread(perception)
  return { low: Math.min(1, edge), high: Math.max(1, edge) }
}

/** One draw, plus one per point of Luck. Whole, and never fewer than one. */
export function damageRollCount(luck: number): number {
  return Math.max(1, 1 + Math.floor(luck))
}

export interface DamageRoll {
  /** What the blow came to, before the crit multiplier and before armour. */
  damage: number
  /** The band it was drawn from, in damage rather than in shares. */
  low: number
  high: number
  /** How many draws were taken. The best of them is `damage`. */
  rolls: number
  rng: RngState
}

/**
 * A blow's damage, rolled: the best of `1 + luck` draws from the band.
 *
 * Takes the NOMINAL damage rather than computing it, because what one blow is
 * worth is already settled by the time anything asks this -- the Might curve,
 * the power multiplier, a prepared attack's sharpening and a Meteor's
 * doubling have all had their say, and this is only the last word on how much
 * of it arrives.
 */
export function rollAttackDamage(options: {
  nominal: number
  attackerStats: StatBlock
  rng: RngState
}): DamageRoll {
  const band = damageBand(options.attackerStats.perception)
  const low = options.nominal * band.low
  const high = options.nominal * band.high
  const rolls = damageRollCount(options.attackerStats.luck)

  // A band of no width is not worth drawing from, and drawing anyway would
  // spend the rng stream on an answer that cannot vary -- which is a real
  // cost, since every roll after it in a seeded run shifts.
  if (high <= low) return { damage: low, low, high, rolls: 1, rng: options.rng }

  let best = low
  let rng = options.rng
  for (let draw = 0; draw < rolls; draw += 1) {
    const roll = nextFloat(rng)
    rng = roll.rng
    best = Math.max(best, low + roll.value * (high - low))
  }
  return { damage: best, low, high, rolls, rng }
}

// THE OMEN: what the road gives you before it gives you a boss.
//
// A special event stands before every mini boss and every boss -- three a
// level, at the only three encounters a player cannot choose their way
// around. It is the one moment in the game that hands something over for
// nothing, and it is placed exactly where the run is about to be tested.
//
// WHAT IT OFFERS is one of two kinds, and the asymmetry is the decision:
//
//   ONE heal, always, worth `10 + 2 x Might` -- the tougher you are, the more
//   a rest is worth to you, which is the same shape as everything else Might
//   buys.
//
//   SEVERAL traits, `2 + Intellect / 2` of them, drawn from THIS REGION's ten.
//   Intellect widens the choice rather than improving it: a clever character
//   is not offered better, they are offered more to choose between.
//
// So the question is always "take the sure thing, or take the thing you will
// still have at the next one" -- and the answer moves with how hurt you are,
// which is why the heal scales with Might rather than with what is missing.
//
// THE REGION IS THE POINT. Regions did nothing at all before this; now they
// decide what can be found. They are laid in a ring with the traits authored
// on the borders between them (content/thockquest.ts), so neighbours share
// half their pool and the world has a grain a player can steer along.

import { nextSample, type RngState } from '../core/rng'
import type { Modifier } from './modifiers'
import type { Region } from '../content'

/**
 * WHAT A REST IS WORTH: ten, and two more for every point of Might.
 *
 * Might is the toughness stat, so the character who can take the most is also
 * the one who gets the most back -- a heal that ignored it would be worth
 * least to exactly the character built around surviving.
 */
export function omenHealAmount(might: number): number {
  return 10 + 2 * Math.max(0, Math.floor(might))
}

/**
 * HOW MANY TRAITS ARE LAID OUT: two, and one more for every two points of
 * Intellect. Floored, so odd points are not lost -- they are the half that
 * pays for the next one.
 */
export function omenTraitCount(intellect: number): number {
  return 2 + Math.floor(Math.max(0, intellect) / 2)
}

/**
 * The traits this region can offer, as modifiers, minus what is already held.
 *
 * Held ones are excluded for the same reason loot excludes them: a run holds
 * one of each thing ever, so offering a held trait is offering nothing. By id
 * against the region's list, so a region naming a trait that content no
 * longer has simply has one fewer -- the same tolerance the save has for a
 * dropped id.
 */
export function omenPool(
  region: Region | undefined,
  traits: readonly Modifier[],
  held: readonly Modifier[],
): Modifier[] {
  if (!region) return []
  const heldIds = new Set(held.map((modifier) => modifier.id))
  const inRegion = new Set(region.traits)
  return traits.filter((trait) => inRegion.has(trait.id) && !heldIds.has(trait.id))
}

/**
 * The draw itself: which traits are on the table this time.
 *
 * Fewer than asked for is a real outcome, not a failure -- a run deep enough
 * to hold most of a region's ten is offered what is left, and a region picked
 * clean offers none at all. The heal is always there, so the screen is never
 * empty.
 */
export function drawOmenTraits(
  pool: readonly Modifier[],
  count: number,
  rng: RngState,
): { traits: Modifier[]; rng: RngState } {
  if (pool.length === 0 || count <= 0) return { traits: [], rng }
  const sample = nextSample(rng, pool, count)
  return { traits: sample.value, rng: sample.rng }
}

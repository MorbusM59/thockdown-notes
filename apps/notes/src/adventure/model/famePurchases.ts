// WHAT A FAME POINT BUYS.
//
// The design left this blank for a long time on purpose, and the two rules it
// buys were written as seams years before there was anything to put in them:
// `carryLimit` and `keepAllowance` (model/gameState.ts) have always been
// functions of the RUN rather than constants at their call sites, precisely
// because "a fame unlock is expected to raise it". This is the thing that
// raises them.
//
// THE WORD "UNLOCK" IS NOT USED HERE, and that is the point of the name. Two
// different things were both called unlocks: these, which a run BUYS with
// fame and which die with it, and the permanent unlocks
// (model/permanentUnlocks.ts), which a run EARNS and which cross into the
// next one. `game.famePurchases` and `profile.unlocked` are now unconfusable.
// The design document still says "a fame unlock is expected to raise it" --
// it means this, and the quotations below are left as its author wrote them.
//
// FAME IS SPENT WITHIN A RUN, like stat points, and buys nothing that outlives
// it. That is a change from the original plan, where fame persisted between
// runs; what persists instead is a separate list of permanent unlocks, earned
// by what a run SPENT rather than carried over as currency. Those are not
// written yet and nothing here anticipates them beyond leaving the ceilings
// where a permanent unlock could later move them.
//
// FOUR PURCHASES, TWO RULES, TWO KINDS -- a grid, not a list, which is why
// this is a table with `rule` and `kind` columns rather than four bespoke
// entries. A fifth purchase that raised something else would add a rule; a
// third kind of modifier would add a kind; neither needs a new mechanism.
//
// THE CEILING IS ON THE RULE, NOT ON THE PURCHASE COUNT, and that is
// deliberate: what the design fixes is where a run can GET to (six held, three
// kept), and expressing it as "buy this three times" would silently move that
// ceiling the day a base value changes. Stated as a total, the base and the
// ceiling can each move without the other lying.

import type { ModifierKind } from './modifiers'
import { MAX_FAME_TIER, TIER_PER_FAME_POINT } from './vectors'

export type FamePurchaseId = 'strongBack' | 'largeCoffers' | 'experienced' | 'stubborn' | 'ascendant'

/** Which of the run-shape rules a purchase raises. */
export type FamePurchaseRule = 'carry' | 'keep' | 'tier'

export interface FamePurchase {
  id: FamePurchaseId
  /** What the player reads. */
  name: string
  icon: string
  /** Fame points, paid on the same ladder gold feeds (model/gold.ts). */
  cost: number
  rule: FamePurchaseRule
  /**
   * WHICH KIND the rule is about, or null where the rule has no kinds.
   *
   * Carrying and keeping are per kind -- you carry items and you carry traits,
   * and they are two separate allowances. TIER is not: a run has one, and a
   * nullable field says so better than a third `kind` value nothing else
   * would ever match on.
   */
  kind: ModifierKind | null
  /**
   * What ONE purchase adds to the rule. One for a slot; five for tier,
   * because a tier point is not a unit anybody spends singly -- the design
   * puts a fame point at five tier and the ceiling at five points.
   */
  step: number
}

/**
 * Carrying more costs one; keeping more costs two, because keeping is worth
 * more: a carried modifier is lost at the level's end and a kept one is the
 * only thing that compounds across a run.
 */
export const FAME_PURCHASES: readonly FamePurchase[] = [
  { id: 'strongBack', name: 'Strong Back', icon: 'fa-solid fa-hand-back-fist', cost: 1, rule: 'carry', kind: 'item', step: 1 },
  { id: 'largeCoffers', name: 'Large Coffers', icon: 'fa-solid fa-vault', cost: 2, rule: 'keep', kind: 'item', step: 1 },
  { id: 'experienced', name: 'Experienced', icon: 'fa-solid fa-hat-wizard', cost: 1, rule: 'carry', kind: 'trait', step: 1 },
  { id: 'stubborn', name: 'Stubborn', icon: 'fa-solid fa-anchor', cost: 2, rule: 'keep', kind: 'trait', step: 1 },
  // THE THIRD RULE, and the only one that buys what a character IS rather
  // than what they may hold: five tier points, which the build's weights then
  // split (model/vectors.ts). One point each and five of them, so a fully
  // ascended run is a tier-30 character -- six times the stat budget it set
  // out with, which is the whole of what makes a late run feel different.
  { id: 'ascendant', name: 'Ascendant', icon: 'fa-solid fa-arrow-up-right-dots', cost: 1, rule: 'tier', kind: null, step: TIER_PER_FAME_POINT },
]

export function famePurchaseById(id: string): FamePurchase | undefined {
  return FAME_PURCHASES.find((purchase) => purchase.id === id)
}

/**
 * HOW FAR EACH RULE MAY BE RAISED, as a total rather than as a number of
 * purchases -- see the module comment. Six carried at once and three surviving
 * a level is where the design puts the top of a run.
 */
export const FAME_PURCHASE_CEILING: Record<FamePurchaseRule, number> = {
  carry: 6,
  keep: 3,
  tier: MAX_FAME_TIER,
}

/** How many times this run has bought a given purchase. */
export function timesBought(held: readonly string[], id: FamePurchaseId): number {
  return held.reduce((count, entry) => (entry === id ? count + 1 : count), 0)
}

/**
 * What this run's purchases add to one rule for one kind.
 *
 * Clamped against the ceiling HERE rather than trusted from the list, because
 * the list is persisted: a save from a build with a higher ceiling, or one
 * edited by hand, must not be able to raise a rule past where the rules say a
 * run can go. The purchase screen asks the same ceiling before offering, so
 * this clamp is a floor under a rule rather than a correction to a bug.
 */
export function famePurchaseBonus(
  held: readonly string[],
  rule: FamePurchaseRule,
  kind: ModifierKind | null,
  base: number,
): number {
  const match = FAME_PURCHASES.find((purchase) => purchase.rule === rule && purchase.kind === kind)
  if (!match) return 0
  const bought = timesBought(held, match.id)
  return Math.max(0, Math.min(bought * match.step, FAME_PURCHASE_CEILING[rule] - base))
}

/** Whether this run may still buy one -- the ceiling's own question, asked once. */
export function canBuyMore(held: readonly string[], purchase: FamePurchase, base: number): boolean {
  return base + timesBought(held, purchase.id) * purchase.step < FAME_PURCHASE_CEILING[purchase.rule]
}

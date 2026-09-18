// WHAT A FAME POINT BUYS.
//
// The design left this blank for a long time on purpose, and the two rules it
// buys were written as seams years before there was anything to put in them:
// `carryLimit` and `keepAllowance` (model/gameState.ts) have always been
// functions of the RUN rather than constants at their call sites, precisely
// because "a fame unlock is expected to raise it". This is the thing that
// raises them.
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

export type FameUnlockId = 'strongBack' | 'largeCoffers' | 'experienced' | 'stubborn'

/** Which of the two run-shape rules an unlock raises. */
export type FameUnlockRule = 'carry' | 'keep'

export interface FameUnlock {
  id: FameUnlockId
  /** What the player reads. */
  name: string
  icon: string
  /** Fame points, paid on the same ladder gold feeds (model/gold.ts). */
  cost: number
  rule: FameUnlockRule
  kind: ModifierKind
}

/**
 * Carrying more costs one; keeping more costs two, because keeping is worth
 * more: a carried modifier is lost at the level's end and a kept one is the
 * only thing that compounds across a run.
 */
export const FAME_UNLOCKS: readonly FameUnlock[] = [
  { id: 'strongBack', name: 'Strong Back', icon: 'fa-solid fa-hand-back-fist', cost: 1, rule: 'carry', kind: 'item' },
  { id: 'largeCoffers', name: 'Large Coffers', icon: 'fa-solid fa-vault', cost: 2, rule: 'keep', kind: 'item' },
  { id: 'experienced', name: 'Experienced', icon: 'fa-solid fa-hat-wizard', cost: 1, rule: 'carry', kind: 'trait' },
  { id: 'stubborn', name: 'Stubborn', icon: 'fa-solid fa-anchor', cost: 2, rule: 'keep', kind: 'trait' },
]

export function fameUnlockById(id: string): FameUnlock | undefined {
  return FAME_UNLOCKS.find((unlock) => unlock.id === id)
}

/**
 * HOW FAR EACH RULE MAY BE RAISED, as a total rather than as a number of
 * purchases -- see the module comment. Six carried at once and three surviving
 * a level is where the design puts the top of a run.
 */
export const FAME_UNLOCK_CEILING: Record<FameUnlockRule, number> = {
  carry: 6,
  keep: 3,
}

/** How many times this run has bought a given unlock. */
export function timesBought(held: readonly string[], id: FameUnlockId): number {
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
export function fameUnlockBonus(
  held: readonly string[],
  rule: FameUnlockRule,
  kind: ModifierKind,
  base: number,
): number {
  const match = FAME_UNLOCKS.find((unlock) => unlock.rule === rule && unlock.kind === kind)
  if (!match) return 0
  const bought = timesBought(held, match.id)
  return Math.max(0, Math.min(bought, FAME_UNLOCK_CEILING[rule] - base))
}

/** Whether this run may still buy one -- the ceiling's own question, asked once. */
export function canBuyMore(held: readonly string[], unlock: FameUnlock, base: number): boolean {
  return base + timesBought(held, unlock.id) < FAME_UNLOCK_CEILING[unlock.rule]
}

// THE FOUR VECTORS: what a player or a monster IS.
//
// An actor in this game is exactly four things, and each one affects the
// actor in exactly ONE way. That is the whole rule, and it is what the
// previous arrangement did not have -- an "origin" carried stat gifts AND
// damage percentages AND an armour rule, a monster "class" carried stat
// deltas, a species carried stat deltas too, and a "type" carried a stat
// shift plus armour plus charisma resistance. Four names, three of them
// doing overlapping arithmetic, and no way to answer "where does this number
// come from" without reading all of them.
//
//   vector   | what it is          | the ONE thing it does
//   ---------|---------------------|--------------------------------------
//   build    | an adjective        | WEIGHTS over the six stats
//   tier     | a number            | how many stat points those weights split
//   species  | a noun (what it is) | non-stat modifier effects
//   class    | a noun (what it does)| swaps a combat choice for another
//
// So a monster is read off the four in order -- "a Dashing Orc Bruiser at
// tier 12" -- and so is a player. THE SAME FOUR, deliberately: a rule that
// applies to one side and not the other is a rule that has to be written
// twice and will be got wrong once.
//
// WHAT EACH VECTOR MAY NOT DO is as load-bearing as what it may, and
// `validateContent` enforces both directions: a species may not carry a
// `statDelta` (that is the build's), a build may not carry anything but
// weights, and a class may not touch the profile at all. Without that, the
// first interesting monster puts a stat bonus on a species and the vectors
// are back to overlapping within a release.

import type { Modifier, ModifierEffect } from './modifiers'
import type { Defence } from './defences'
import { STAT_KEYS, type StatBlock, type StatKey } from './stats'

// --- VECTOR 1: BUILD -------------------------------------------------------

/**
 * WEIGHTS OVER THE SIX STATS, and nothing else.
 *
 * The numbers are RATIOS, not points: `{ might: 2, agility: 1 }` means two
 * parts Might to one part Agility whatever the tier, so one build reads the
 * same at tier 5 and at tier 30. That is why a build is an adjective -- it
 * says what shape a creature is, not how much of it there is.
 *
 * Weights are non-negative. A negative weight would shrink the denominator
 * (see `statsFromTier`) and make a second stat's share depend on how bad you
 * are at a third, which is not a thing anybody could reason about; a stat a
 * build does not want simply gets no weight.
 */
export interface Build {
  id: string
  /** An adjective. It is the first word of a monster's name. */
  name: string
  icon: string
  /** At least one must be positive. Stats left out weigh nothing. */
  weights: Partial<Record<StatKey, number>>
  /** Offered at character creation only once this permanent unlock is won. */
  requiresUnlock?: string
  /** False keeps it out of character creation; monsters may still roll it. */
  playable?: boolean
}

/**
 * THE TIER, SPLIT BY THE WEIGHTS -- the one formula that turns two vectors
 * into a stat block.
 *
 * `tier` points are distributed in proportion to the weights. The design
 * states it as "5 means that 5 points are distributed according to weights",
 * and DISTRIBUTED is taken literally: the block sums to exactly the tier.
 *
 * That is largest-remainder apportionment, not rounding each share on its
 * own. It agrees with the design's own worked example -- tier 5 over
 * `{ agility: 1, might: 2 }` gives 2 and 3 either way -- and it does not
 * leak, which per-share rounding does: six equal weights at tier 5 round to
 * 1 each and hand out SIX points, so the flattest build would quietly be the
 * strongest at every tier. A rule that says "five points" and hands out six
 * is a rule nobody can balance against.
 *
 * Ties in the remainder go to the earlier stat in `STAT_KEYS`, which makes
 * this a pure function of its arguments -- no rng, no order of iteration.
 */
export function statsFromTier(build: Pick<Build, 'weights'>, tier: number): StatBlock {
  const points = Math.max(0, Math.floor(tier))
  const weights = STAT_KEYS.map((key) => Math.max(0, build.weights[key] ?? 0))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0 || points === 0) {
    return Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as StatBlock
  }

  const exact = weights.map((weight) => (points * weight) / total)
  const floors = exact.map((value) => Math.floor(value))
  let left = points - floors.reduce((sum, value) => sum + value, 0)

  // The seats the floors did not spend, to the largest remainders first.
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index))
  const result = [...floors]
  for (const seat of order) {
    if (left <= 0) break
    result[seat.index] += 1
    left -= 1
  }

  return Object.fromEntries(STAT_KEYS.map((key, index) => [key, result[index]])) as StatBlock
}

/**
 * THE TIER AS A MODIFIER, which is the only way it can reach a stat block.
 *
 * `resolveProfile` CLAMPS base stats to the cap of six, deliberately: base
 * stats are what a run has SPENT and a run may not spend past six. Tier is
 * not spending -- it is what a creature IS -- so it arrives the way gear
 * does, as `statDelta` effects on top of the clamp. A tier-20 boss therefore
 * reaches Might 13 without the cap having to learn an exception, and the
 * player's own bought tier does the same.
 *
 * Wrapping it as a Modifier rather than adding it by hand also means
 * `describeModifier` writes its tooltip, and the one resolver stays the one
 * resolver.
 */
export function buildModifier(build: Build | null, tier: number): Modifier | null {
  if (!build) return null
  const stats = statsFromTier(build, tier)
  return {
    id: `build:${build.id}`,
    kind: 'trait',
    name: `${build.name} ${tier}`,
    icon: build.icon,
    effects: STAT_KEYS
      .filter((key) => stats[key] !== 0)
      .map((key) => ({ kind: 'statDelta', stat: key, amount: stats[key] } as const)),
  }
}

/** The weights as a player reads them: "2 parts Might, 1 part Agility". */
export function describeBuild(build: Build): string[] {
  const parts = STAT_KEYS
    .filter((key) => (build.weights[key] ?? 0) > 0)
    .map((key) => ({ key, weight: build.weights[key] as number }))
  const total = parts.reduce((sum, part) => sum + part.weight, 0)
  return parts.map((part) => {
    const share = Math.round((part.weight / total) * 100)
    return `${STAT_LABELS_LOCAL[part.key]}: ${part.weight} part${part.weight === 1 ? '' : 's'} (${share}%)`
  })
}

// Imported lazily as a local map rather than from stats.ts's STAT_LABELS to
// keep this module's import list to the three it genuinely needs. (It is the
// same six words; `vectors.contract.test.ts` asserts they agree.)
const STAT_LABELS_LOCAL: Readonly<Record<StatKey, string>> = {
  might: 'Might',
  agility: 'Agility',
  perception: 'Perception',
  intellect: 'Intellect',
  charisma: 'Charisma',
  luck: 'Luck',
}

// --- VECTOR 2: TIER --------------------------------------------------------

export const MONSTER_TYPES = ['runt', 'regular', 'elite', 'miniBoss', 'boss'] as const

export type MonsterType = (typeof MONSTER_TYPES)[number]

/** What a monster of this rank starts at, before the level adds to it. */
export const MONSTER_TYPE_TIER: Readonly<Record<MonsterType, number>> = {
  runt: 0,
  regular: 5,
  elite: 10,
  miniBoss: 15,
  boss: 20,
}

/**
 * A monster's tier: its rank's, plus one for every level past the first.
 *
 * ONE per level rather than five, deliberately: the rank gap (five) is meant
 * to stay legible for the whole run, so a level-12 regular is still plainly
 * weaker than a level-12 elite. A per-level step as big as the rank step
 * would make the ladder's rungs meaningless by the third level.
 */
export function monsterTier(type: MonsterType, level: number): number {
  return MONSTER_TYPE_TIER[type] + Math.max(0, Math.floor(level) - 1)
}

/** Where a run starts. Fame buys it upward -- see model/famePurchases.ts. */
export const BASE_PLAYER_TIER = 5

/** What one fame point spent on tier is worth, and how many may be spent. */
export const TIER_PER_FAME_POINT = 5
export const MAX_TIER_PURCHASES = 5

/** The top of the ladder: 5 + 5 x 5. Stated as a total, like every other ceiling. */
export const MAX_PLAYER_TIER = BASE_PLAYER_TIER + TIER_PER_FAME_POINT * MAX_TIER_PURCHASES

/** What the RANK is called, where a name has to say it. Regular says nothing. */
export const MONSTER_TYPE_WORD: Readonly<Record<MonsterType, string>> = {
  runt: 'Runt',
  regular: '',
  elite: 'Elite',
  miniBoss: 'Champion',
  boss: 'Overlord',
}

/**
 * HOW MANY OF THEM THERE ARE, as chances rather than a fixed head count.
 *
 * The weak ranks travel together and the strong ones do not, which is the
 * whole of it: a runt always has a friend and usually two, an ordinary
 * monster has one half the time, and anything elite or above is alone
 * because being alone is part of what the rank means.
 *
 * A LIST OF CHANCES, one per additional body, rather than a min and a max:
 * it says exactly what is rolled, in the order it is rolled, and adding a
 * third possible friend is an entry rather than a new distribution.
 */
export const MONSTER_BUDDY_CHANCES: Readonly<Record<MonsterType, readonly number[]>> = {
  runt: [1, 0.5],
  regular: [0.5],
  elite: [],
  miniBoss: [],
  boss: [],
}

/**
 * The base chance a charisma action fails against a monster of this rank,
 * before the tier-and-usage term is added.
 *
 * This is where a monster's resistance to being talked at lives -- which is
 * why the tier term's divisor is the player's own Charisma and not a
 * contested one. Contesting it too would divide by `charisma - intellect`,
 * which is zero or negative whenever the monster is the smarter one.
 *
 * A RUNT never resists: crowd control works on the small and the many, by
 * construction.
 */
export const MONSTER_TYPE_CHARISMA_RESISTANCE: Readonly<Record<MonsterType, number>> = {
  runt: 0,
  regular: 0.2,
  elite: 0.4,
  miniBoss: 0.6,
  boss: 0.8,
}

// --- VECTOR 3: SPECIES -----------------------------------------------------

/**
 * WHAT A THING IS: everything about it that is not a stat and not a choice.
 *
 * Carried in the MODIFIER vocabulary (model/modifiers.ts), which is what
 * lets a species say "+100% damage", "worn armour counts for nothing" or
 * "triple damage on the first action of a round" with no code anywhere
 * knowing that species exist -- the resolver already reads that vocabulary
 * for every item and trait in the game, and `describeModifier` already
 * writes its tooltip.
 *
 * A species may NOT carry `statDelta`. Stats are the build's and the tier's,
 * and a species that could add two Might would be a second, hidden build.
 * `validateContent` fails on it.
 */
export interface Species {
  id: string
  /** A noun. It is the middle word of a monster's name. */
  name: string
  icon: string
  effects: readonly ModifierEffect[]
  /** True offers it at character creation. Monsters roll from the rest. */
  playable?: boolean
  requiresUnlock?: string
}

// --- VECTOR 4: CLASS -------------------------------------------------------

/**
 * WHEN a move stands in for the ordinary choice.
 *
 * Every trigger is answerable from the round and the fight alone, which is
 * what lets the armed move be decided at the moment the action comes up --
 * once, seeded -- rather than re-asked while a screen is on display. See
 * `model/moves.ts`.
 */
export type MoveTrigger =
  /** Every time. The class simply fights differently. */
  | { kind: 'always' }
  /** The first action this actor takes in the whole encounter. */
  | { kind: 'firstActionOfEncounter' }
  /** The first action of each round. */
  | { kind: 'firstActionOfRound' }
  /** The last action of each round -- rarer at low Agility, not commoner. */
  | { kind: 'lastActionOfRound' }
  /** A roll, every time the action comes up. */
  | { kind: 'chance'; chance: number }
  /** Only with their back to the wall. */
  | { kind: 'whileHurt'; belowFraction: number }

/**
 * ONE COMBAT CHOICE SWAPPED FOR ANOTHER -- the whole of what a class does.
 *
 * A move REPLACES a choice the actor would otherwise have had: the ordinary
 * attack, or one of the four defences. It never ADDS a cell, and that is the
 * pace constraint doing its job -- the ring already holds spells, an attack
 * and Prepare, and a class that added two more cells per screen would make
 * every action a reading exercise. A swap costs no press and no thought: the
 * cell is simply a better (or stranger) one when the class's condition is
 * met, and it says so on its face.
 *
 * Everything below is a SHARE, in the same two arithmetics the modifier
 * vocabulary uses: a quantity share multiplies, a chance share takes that
 * fraction of what is left (model/chance.ts). So `damageShare: 0.6` is 60%
 * of a nominal blow, and `hitShare: 0.5` removes half the misses.
 */
export interface CombatMove {
  id: string
  name: string
  icon: string
  /** The choice it stands in for. */
  replaces: 'attack' | Defence
  when: MoveTrigger
  /** Blows in one action. Two strikes at 0.6 is 120% of a blow, spread over two rolls. */
  strikes?: number
  /** Share of a nominal blow, PER strike. Default 1. */
  damageShare?: number
  /** Share of this actor's misses removed for this action. */
  hitShare?: number
  /** Share of this actor's ordinary hits turned into crits for this action. */
  critShare?: number
  /** Armour does not see this blow at all. */
  ignoresArmor?: boolean
  /** Actions taken off the OTHER side's pool -- a stun, in the unit the round counts in. */
  stealsActions?: number
  /** On a DEFENCE: strike back for this share of a nominal blow after surviving. */
  riposteShare?: number
  /** On a DEFENCE: extra flat armour, for this blow only. */
  guard?: number
  /** One line, in the class's own words, for the cell's detail. */
  flavour?: string
}

/**
 * WHAT A THING DOES: a named bundle of swaps, and nothing else.
 *
 * A class touches no stat, no derived value and no armour pool -- if it did,
 * it would be a species with a different name. It changes which cell is on
 * the ring and what pressing it is worth, which is the one thing none of the
 * other three vectors can express.
 */
export interface CombatClass {
  id: string
  /** A noun. It is the last word of a monster's name. */
  name: string
  icon: string
  moves: readonly CombatMove[]
  playable?: boolean
  requiresUnlock?: string
}

/** A player's four, or a monster's four. The same record either way. */
export interface VectorSet {
  build: Build | null
  tier: number
  species: Species | null
  combatClass: CombatClass | null
}

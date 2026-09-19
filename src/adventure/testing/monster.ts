// Test-only: a monster with exactly the numbers a test wants.
//
// NOT SHIPPED CODE -- see testing/run.ts. Eight suites built one of these by
// hand, and when a monster stopped being a class-and-type with stat deltas
// and became four vectors, all eight broke in the same way. One builder is
// one place to fix next time.
//
// It takes a STAT BLOCK rather than a build and a tier, because that is what
// a combat test is actually about: "a monster with Might 2" is the premise,
// and "a Hulking one at tier 6" is a sentence about the character system that
// the fight does not care about. The block is handed in as a one-off build
// whose weights ARE the block, at a tier equal to its total -- which
// `statsFromTier` then reproduces exactly (it is an apportionment, so weights
// summing to the tier apportion to themselves).

import { buildMonster, type Monster } from '../model/monsters'
import type { Build, CombatClass, MonsterType, Species } from '../model/vectors'
import { createStatBlock, STAT_KEYS, type StatBlock } from '../model/stats'

export function blockOf(over: Partial<StatBlock> = {}): StatBlock {
  return { ...createStatBlock(0), ...over }
}

/** A build whose weights are exactly this block, so the tier reproduces it. */
export function buildOf(stats: StatBlock): { build: Build; tier: number } {
  return {
    build: { id: 'test', name: 'Test', icon: 'fa-solid fa-flask', weights: { ...stats } },
    tier: STAT_KEYS.reduce((sum, key) => sum + stats[key], 0),
  }
}

export function testMonster(options: {
  stats: StatBlock
  against: StatBlock
  type?: MonsterType
  count?: number
  level?: number
  species?: Species | null
  combatClass?: CombatClass | null
}): Monster {
  const { build, tier } = buildOf(options.stats)
  return buildMonster({
    build,
    species: options.species ?? null,
    combatClass: options.combatClass ?? null,
    type: options.type ?? 'regular',
    tier,
    level: options.level ?? 1,
    against: options.against,
    count: options.count,
  })
}

import { describe, expect, it } from 'vitest'

import {
  BASE_MOTES_PER_ENCOUNTER, countRepeatedAwards, EXTRA_LOOT_CHANCE,
  MONSTER_TYPE_REWARD_BONUS, rewardFor,
} from './rewards'
import { createStatBlock, type StatBlock } from './stats'
import { MONSTER_TYPES, type MonsterType } from './monsters'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

/** The fewest screens a type can ever produce -- what the escalating chance GUARANTEES. */
function guaranteedScreens(type: MonsterType, stats: StatBlock): number {
  let fewest = Number.POSITIVE_INFINITY
  for (let seed = 1; seed <= 400; seed += 1) {
    fewest = Math.min(fewest, rewardFor(stats, type, seed).reward.lootScreens)
  }
  return fewest
}

describe('the escalating reward check', () => {
  it('guarantees the run of screens the type bonus buys', () => {
    // The table the whole reward economy is read off, asserted rather than
    // described. At a stat of zero the chances run 50 / 100 / 150 / 200 and
    // lose fifty points per repeat, so:
    const stats = block()
    expect(guaranteedScreens('regular', stats)).toBe(1)
    expect(guaranteedScreens('runt', stats)).toBe(1)
    expect(guaranteedScreens('elite', stats)).toBe(2)
    expect(guaranteedScreens('miniBoss', stats)).toBe(3)
    expect(guaranteedScreens('boss', stats)).toBe(4)
  })

  it('subtracts the repeat penalty from the RAW chance, not a clamped one', () => {
    // Clamp first and a boss's 200% becomes 100%, then 50%: three certainties
    // collapse into one and a coin flip. This is the difference.
    const stats = block()
    const bonus = MONSTER_TYPE_REWARD_BONUS.boss
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(countRepeatedAwards(EXTRA_LOOT_CHANCE, stats, bonus, seed).count).toBeGreaterThanOrEqual(3)
    }
  })

  it('lets the stat buy screens a bare type never would', () => {
    // 50% + 5% x 6 = 80% on the first repeat, and 30% on the second.
    const lucky = block({ luck: 6 })
    let best = 0
    for (let seed = 1; seed <= 400; seed += 1) {
      best = Math.max(best, rewardFor(lucky, 'regular', seed).reward.lootScreens)
    }
    expect(best).toBeGreaterThanOrEqual(3)
  })

  it('always pays at least one screen and one mote', () => {
    for (const type of MONSTER_TYPES) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const { reward } = rewardFor(block(), type, seed)
        expect(reward.lootScreens).toBeGreaterThanOrEqual(1)
        expect(reward.motes).toBeGreaterThanOrEqual(BASE_MOTES_PER_ENCOUNTER)
      }
    }
  })

  it('reads motes against Intellect and loot against Luck, independently', () => {
    // A character with all the Luck and no Intellect gets screens, not motes.
    let screens = 0
    let motes = 0
    for (let seed = 1; seed <= 300; seed += 1) {
      const { reward } = rewardFor(block({ luck: 6 }), 'regular', seed)
      screens += reward.lootScreens
      motes += reward.motes
    }
    expect(screens / 300).toBeGreaterThan(motes / 300)
  })
})

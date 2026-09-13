import { describe, expect, it } from 'vitest'

import { buildMonster, MONSTER_TYPES, MONSTER_TYPE_STAT_SHIFT, damageFrom, BASE_DAMAGE } from './monsters'
import { DIFFICULTIES, powerMultiplier } from './difficulty'
import { COUNTER_STATS, contestedStat, createStatBlock, deriveStats, STAT_KEYS } from './stats'

const block = (over: Partial<Record<string, number>> = {}) => ({ ...createStatBlock(0), ...over }) as ReturnType<typeof createStatBlock>

describe('contested stats', () => {
  it('pairs every stat with a counter that counters it back', () => {
    // The property, not the table: "countered by" is a relation, so it has
    // to be an involution. A one-way entry would mean a stat that answers
    // something which does not answer it -- and the delta would then depend
    // on which side of the fight asked.
    for (const stat of STAT_KEYS) {
      expect(COUNTER_STATS[COUNTER_STATS[stat]]).toBe(stat)
    }
  })

  it('subtracts the opponent COUNTER, not the same stat', () => {
    // Perception is answered by Luck. Reading the opponent's Perception here
    // would look right in every same-stat case and be wrong for two thirds
    // of the table.
    const mine = block({ perception: 4 })
    const theirs = block({ perception: 9, luck: 1 })
    expect(contestedStat('perception', mine, theirs)).toBe(3)
  })

  it('is exactly zero with no opponent, for cross-counter stats too', () => {
    // The trap this guards: defaulting the opponent to the OWN BLOCK gives a
    // delta of zero only where a stat counters itself. For Perception (vs
    // Luck) it would silently yield `perception - luck`.
    const mine = block({ might: 3, agility: 2, perception: 5, intellect: 1, charisma: 4, luck: 0 })
    for (const stat of STAT_KEYS) {
      expect(contestedStat(stat, mine)).toBe(0)
    }
  })

  it('resolves the design plan\'s worked example', () => {
    // Agility 3 against Agility 5 dodges at 50% + 5% x (3 - 5).
    const dodge = deriveStats(block({ agility: 3 }), block({ agility: 5 })).dodgeChance
    expect(dodge).toBeCloseTo(0.4, 10)
  })

  it('leaves the uncontested values alone whoever is on the other side', () => {
    const mine = block({ might: 4, agility: 3, perception: 2, luck: 5 })
    const alone = deriveStats(mine)
    const opposed = deriveStats(mine, block({ might: 6, agility: 6, perception: 6, luck: 6 }))
    for (const key of ['maxHitPoints', 'damageMultiplier', 'actionsPerRound', 'encounterChoices', 'offerChoices'] as const) {
      expect(opposed[key]).toBe(alone[key])
    }
    // ...and does move the ones that are contested.
    expect(opposed.dodgeChance).not.toBe(alone.dodgeChance)
  })
})

describe('the power multiplier', () => {
  it('scales hit points and damage and NOTHING else', () => {
    // The rule this holds: `factor^level` on a 0..1 chance saturates rather
    // than scales, and a monster pinned at 100% dodge by level 15 has
    // stopped being stronger and started being unhittable.
    const against = block({ agility: 2, perception: 2, luck: 2 })
    const at = (level: number) => buildMonster({
      classId: 'fighter', classBaseStats: block({ might: 2, agility: 1 }), type: 'regular', level, against,
    })
    const first = at(1)
    const twentieth = at(20)
    expect(twentieth.maxHitPoints).toBeGreaterThan(first.maxHitPoints * 2)
    expect(twentieth.damage).toBeGreaterThan(first.damage * 2)
    for (const key of ['dodgeChance', 'hitChance', 'critChance', 'actionsPerRound'] as const) {
      expect(twentieth.derived[key]).toBe(first.derived[key])
    }
  })

  it('is one factor per level, for every difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      const one = powerMultiplier(1, difficulty)
      expect(powerMultiplier(3, difficulty)).toBeCloseTo(one ** 3, 10)
    }
  })
})

describe('monster types', () => {
  it('shifts every base stat by the ladder, class untouched', () => {
    const base = block({ might: 2, agility: 1 })
    for (const type of MONSTER_TYPES) {
      const monster = buildMonster({ classId: 'fighter', classBaseStats: base, type, level: 1, against: base })
      for (const stat of STAT_KEYS) {
        expect(monster.stats[stat]).toBe(base[stat] + MONSTER_TYPE_STAT_SHIFT[type])
      }
    }
  })

  it('orders the ladder so a boss is the strongest and a group the weakest', () => {
    const base = block({ might: 2, agility: 1 })
    const hp = (type: (typeof MONSTER_TYPES)[number]) =>
      buildMonster({ classId: 'fighter', classBaseStats: base, type, level: 1, against: base }).maxHitPoints
    expect(hp('group')).toBeLessThan(hp('regular'))
    expect(hp('regular')).toBeLessThan(hp('elite'))
    expect(hp('elite')).toBeLessThan(hp('miniBoss'))
    expect(hp('miniBoss')).toBeLessThan(hp('boss'))
  })

  it('multiplies one universal base damage, both sides', () => {
    expect(damageFrom(1)).toBe(BASE_DAMAGE)
    // Might 0 is the 50% floor of the multiplier, so half of base.
    expect(damageFrom(deriveStats(block()).damageMultiplier)).toBeCloseTo(BASE_DAMAGE * 0.5, 10)
  })
})

import { describe, expect, it } from 'vitest'

import {
  actionsRemaining, BASE_DAMAGE, buildMonster, damageFrom, membersDown,
  monsterDefence, MONSTER_TYPES, MONSTER_TYPE_STAT_SHIFT,
} from './monsters'
import { DIFFICULTIES, powerMultiplier } from './difficulty'
import { COUNTER_STATS, contestedStat, resolveChance } from './chance'
import { createStatBlock, deriveStats, DODGE_CHANCE, STAT_KEYS } from './stats'

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

  it('reads the OWN stat with no opponent, not a cancelled-out zero', () => {
    // Two traps, and the code fell into both in turn.
    //
    // Defaulting the opponent to the actor's OWN BLOCK gives a zero delta
    // only where a stat counters itself -- for Perception (answered by Luck)
    // it silently computes `perception - luck`. Defaulting the opposing
    // VALUE to the actor's own gives a zero delta everywhere and cancels the
    // stat term with it, so an uncontested dodge came out flat at 50%
    // however nimble the character was.
    //
    // An absent opponent contributes NOTHING. That is what makes the design
    // plan's `50% + 5% x Agility` the same formula as the contested one.
    const mine = block({ might: 3, agility: 2, perception: 5, intellect: 1, charisma: 4, luck: 0 })
    for (const stat of STAT_KEYS) {
      expect(contestedStat(stat, mine)).toBe(mine[stat])
    }
  })

  it('makes the plan\'s stat table the contest against nobody', () => {
    for (let agility = 0; agility <= 6; agility += 1) {
      const mine = block({ agility })
      expect(deriveStats(mine).dodgeChance).toBeCloseTo(0.5 + 0.05 * agility, 10)
      // ...and against an opponent of zero, which is the same thing.
      expect(deriveStats(mine, block()).dodgeChance).toBeCloseTo(0.5 + 0.05 * agility, 10)
    }
  })

  it('resolves a declared chance the same way the derived one does', () => {
    // One resolver, so an action declaring `{base, perPoint, stat}` and the
    // derived stat block cannot drift apart.
    const mine = block({ agility: 4 })
    const theirs = block({ agility: 1 })
    expect(resolveChance(DODGE_CHANCE, mine, theirs))
      .toBeCloseTo(deriveStats(mine, theirs).dodgeChance, 10)
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

  it('orders the ladder by a MEMBER\'s strength, which is not the pool', () => {
    // A group of three pools more hit points than one regular monster, so the
    // ladder cannot be read off `maxHitPoints` -- that is the whole point of
    // a group. What the ladder orders is how strong each member is.
    const base = block({ might: 2, agility: 1 })
    const perMember = (type: (typeof MONSTER_TYPES)[number]) => {
      const monster = buildMonster({ classId: 'fighter', classBaseStats: base, type, level: 1, against: base })
      return monster.maxHitPoints / monster.count
    }
    expect(perMember('group')).toBeLessThan(perMember('regular'))
    expect(perMember('regular')).toBeLessThan(perMember('elite'))
    expect(perMember('elite')).toBeLessThan(perMember('miniBoss'))
    expect(perMember('miniBoss')).toBeLessThan(perMember('boss'))
    // ...and the pool really does go the other way for a default group.
    const group = buildMonster({ classId: 'fighter', classBaseStats: base, type: 'group', level: 1, against: base })
    const regular = buildMonster({ classId: 'fighter', classBaseStats: base, type: 'regular', level: 1, against: base })
    expect(group.maxHitPoints).toBeGreaterThan(regular.maxHitPoints)
  })

  it('multiplies one universal base damage, both sides', () => {
    expect(damageFrom(1)).toBe(BASE_DAMAGE)
    // Might 0 is the 50% floor of the multiplier, so half of base.
    expect(damageFrom(deriveStats(block()).damageMultiplier)).toBeCloseTo(BASE_DAMAGE * 0.5, 10)
  })
})

describe('a group is one hydra', () => {
  const base = block({ might: 2, agility: 2 })
  const groupOf = (count: number) =>
    buildMonster({ classId: 'fighter', classBaseStats: base, type: 'group', level: 1, against: base, count })

  it('pools hit points and actions across its members', () => {
    const one = groupOf(1)
    const four = groupOf(4)
    expect(four.maxHitPoints).toBe(one.maxHitPoints * 4)
    expect(four.maxActions).toBe(one.maxActions * 4)
    // One blow is still one member's blow -- a group hits more OFTEN, not harder.
    expect(four.damage).toBeCloseTo(one.damage, 10)
  })

  it('loses a member each time damage crosses a band of the pool', () => {
    const group = groupOf(4)
    const band = group.maxHitPoints / 4
    expect(membersDown(group, 0)).toBe(0)
    expect(membersDown(group, band - 1)).toBe(0)
    expect(membersDown(group, band)).toBe(1)
    expect(membersDown(group, band * 3 + 1)).toBe(3)
    // Never more members than it has, however far past the pool the damage goes.
    expect(membersDown(group, group.maxHitPoints * 10)).toBe(4)
  })

  it('takes a dead member\'s actions off what is LEFT, biased to the player', () => {
    const group = groupOf(4)
    const band = group.maxHitPoints / 4
    const perMember = group.maxActions / 4
    // Untouched: the whole pool.
    expect(actionsRemaining(group, 0, 0)).toBe(group.maxActions)
    // One member down costs a member's worth even though the group had spent
    // none -- the casualty is assumed to be the one that would have gone last.
    expect(actionsRemaining(group, band, 0)).toBe(group.maxActions - perMember)
    // Spending and dying both apply; a death does not refund what was spent.
    expect(actionsRemaining(group, band, 2)).toBe(group.maxActions - perMember - 2)
  })

  it('floors at zero rather than going negative', () => {
    const group = groupOf(2)
    expect(actionsRemaining(group, group.maxHitPoints, group.maxActions)).toBe(0)
    expect(actionsRemaining(group, group.maxHitPoints * 5, 999)).toBe(0)
  })

  it('is one member for every type that is not a group', () => {
    for (const type of MONSTER_TYPES.filter((candidate) => candidate !== 'group')) {
      const monster = buildMonster({ classId: 'fighter', classBaseStats: base, type, level: 1, against: base, count: 5 })
      expect(monster.count).toBe(1)
    }
  })
})

describe('what a monster does when attacked', () => {
  it('dodges when it can and defends when it cannot', () => {
    expect(monsterDefence(true)).toBe('dodge')
    expect(monsterDefence(false)).toBe('defend')
  })
})

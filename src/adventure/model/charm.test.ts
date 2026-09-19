import { describe, expect, it } from 'vitest'

import { beginRound, UNTOUCHED_FIGHT, type RoundState } from './combat'
import {
  charmChance, CHARM_EFFECTS, charmsOf, interceptMonsterAction, rollCharms,
} from './charm'
import { type Monster } from './monsters'
import { createStatBlock, type StatBlock } from './stats'
import { NO_ARMOR } from './armor'
import { testMonster } from '../testing/monster'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

const PLAYER = block({ might: 2, agility: 2, charisma: 6 })

function monsterOf(over: Partial<StatBlock> = {}): Monster {
  return testMonster({ stats: block({ might: 2, agility: 1, ...over }),
    type: 'regular',
    level: 1,
    against: PLAYER,
  })
}

function roundUnder(charms: number[], over: Partial<RoundState> = {}): RoundState {
  return beginRound({
    ...UNTOUCHED_FIGHT,
    charms,
    playerHitPoints: 80,
    playerArmor: NO_ARMOR,
    monsterDamageTaken: 0,
    monsterFleeing: false,
    playerFled: false,
    ...over,
  })
}

/**
 * Two rolls, two questions. This one is "is it up at all", and it is
 * UNCONTESTED on purpose -- what the monster's wits are worth is settled by
 * the check that fires, and contesting both would charge the player for its
 * Intellect twice.
 */
describe('which charms a round is under', () => {
  it('is nothing at all without Charisma', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(rollCharms(0, seed).charms).toEqual([])
    }
    expect(charmChance(0, 0)).toBe(0)
  })

  it('climbs a ladder rather than arriving all at once', () => {
    // The levels are 0, 2 and 4 and the gap is the point: a charisma of two
    // has the first half the time and the third never.
    expect(charmChance(2, 0)).toBeGreaterThan(0)
    expect(charmChance(2, 4)).toBe(0)
    expect(charmChance(6, 0)).toBeGreaterThan(charmChance(6, 4))
  })

  it('hands them back strongest first, which is the order everything reads them in', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { charms } = rollCharms(12, seed)
      expect([...charms]).toEqual([...charms].sort((left, right) => right - left))
    }
    // A charisma past the top of the table has all three, every round.
    expect(rollCharms(20, 3).charms).toEqual(CHARM_EFFECTS.map((effect) => effect.level).reverse())
    expect(charmsOf(roundUnder([4, 2, 0])).map((effect) => effect.name)).toEqual(['Doom', 'Confusion', 'Distraction'])
  })
})

describe('a charm firing', () => {
  const intercept = (charms: number[], rng: number, stats = PLAYER) => interceptMonsterAction({
    state: roundUnder(charms),
    monster: monsterOf(),
    playerStats: stats,
    rng,
  })

  it('never fires for a character with nothing to say', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(intercept([4, 2, 0], seed, block()).interception).toBeNull()
    }
  })

  it('takes the action either way, whichever of the three it was', () => {
    // That is what all three do FIRST, and the difference is only what it
    // costs the monster on top.
    for (const level of [0, 2, 4]) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const fired = intercept([level], seed).interception
        if (!fired) continue
        expect(fired.state.monsterActionsSpent).toBe(1)
        expect(fired.effect.level).toBe(level)
        break
      }
    }
  })

  it('tries the strongest first, so a doomed monster is not merely distracted', () => {
    // All three up, and the first check that passes wins. With a charisma
    // this far past the table every check passes, so it must always be Doom.
    const fired = interceptMonsterAction({
      state: roundUnder([4, 2, 0]),
      monster: monsterOf(),
      playerStats: block({ charisma: 40 }),
      rng: 7,
    }).interception
    expect(fired?.effect.outcome).toBe('died')
  })

  it('turns a monster on itself for its own damage, and never misses doing it', () => {
    const monster = monsterOf()
    const fired = interceptMonsterAction({
      state: roundUnder([2]),
      monster,
      playerStats: block({ charisma: 40 }),
      rng: 7,
    }).interception
    expect(fired?.effect.outcome).toBe('turnedOnItself')
    expect(fired?.damage).toBe(Math.round(monster.damage))
    expect(fired?.state.monsterDamageTaken).toBe(Math.round(monster.damage))
  })

  it('kills outright, for exactly what it had left', () => {
    const monster = monsterOf()
    const wounded = roundUnder([4], { monsterDamageTaken: 10 })
    const fired = interceptMonsterAction({
      state: wounded,
      monster,
      playerStats: block({ charisma: 40 }),
      rng: 7,
    }).interception
    expect(fired?.effect.outcome).toBe('died')
    expect(fired?.damage).toBe(monster.maxHitPoints - 10)
    expect(fired?.state.monsterDamageTaken).toBe(monster.maxHitPoints)
  })

  it('is harder against a clever monster than a stupid one', () => {
    // The check is contested against Intellect, like every other chance --
    // which is the relation COUNTER_STATS already declares.
    const count = (intellect: number) => {
      let fired = 0
      for (let seed = 1; seed <= 400; seed += 1) {
        const result = interceptMonsterAction({
          state: roundUnder([0]),
          monster: monsterOf({ intellect }),
          playerStats: block({ charisma: 5 }),
          rng: seed,
        })
        if (result.interception) fired += 1
      }
      return fired
    }
    expect(count(0)).toBeGreaterThan(count(4))
  })
})

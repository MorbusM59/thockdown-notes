import { describe, expect, it } from 'vitest'

import {
  beginRound, combatStatus, defencesOffered, monsterActionsLeft, payoutFor, UNTOUCHED_FIGHT,
  playerActionsLeft, resolveExchange, resolveMonsterAttack, resolvePlayerAttack, rollActor,
  type RoundState,
} from './combat'
import { MONSTER_TYPES, type Monster, type MonsterType } from './monsters'
import { createStatBlock, deriveStats, type StatBlock } from './stats'
import { NO_ARMOR, totalArmor, type Armor } from './armor'
import { testMonster } from '../testing/monster'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

const PLAYER = block({ might: 2, agility: 2, perception: 2, luck: 1 })
const PLAYER_DERIVED = deriveStats(PLAYER)

function monster(over: { type?: 'regular' | 'runt'; count?: number } = {}): Monster {
  return testMonster({ stats: block({ might: 2, agility: 1 }),
    type: over.type ?? 'regular',
    level: 1,
    against: PLAYER,
    count: over.count,
  })
}

function freshRound(over: Partial<RoundState> = {}): RoundState {
  return beginRound({
    ...UNTOUCHED_FIGHT,
    playerHitPoints: 80,
    playerArmor: NO_ARMOR,
    monsterDamageTaken: 0,
    monsterFleeing: false,
    playerFled: false,
    ...over,
  })
}

describe('the round', () => {
  it('resets actions and nothing else', () => {
    const mid = { ...freshRound(), playerActionsSpent: 2, monsterActionsSpent: 1, playerHitPoints: 31, monsterDamageTaken: 12 }
    const next = beginRound(mid)
    expect(next.playerActionsSpent).toBe(0)
    expect(next.monsterActionsSpent).toBe(0)
    // A round is a clock, not a checkpoint.
    expect(next.playerHitPoints).toBe(31)
    expect(next.monsterDamageTaken).toBe(12)
  })

  it('is over exactly when no action is left anywhere', () => {
    const foe = monster()
    const spendAll = {
      ...freshRound(),
      playerActionsSpent: PLAYER_DERIVED.actionsPerRound,
      monsterActionsSpent: foe.maxActions,
    }
    expect(combatStatus(freshRound(), foe, PLAYER_DERIVED)).toBe('acting')
    expect(combatStatus(spendAll, foe, PLAYER_DERIVED)).toBe('roundOver')
  })

  it('lets an ending beat a round boundary', () => {
    // A fight that finished on the round's last action has finished. The
    // alternative is offering tactical choices over a corpse.
    const foe = monster()
    const exhausted = {
      ...freshRound(),
      playerActionsSpent: PLAYER_DERIVED.actionsPerRound,
      monsterActionsSpent: foe.maxActions,
    }
    expect(combatStatus({ ...exhausted, playerHitPoints: 0 }, foe, PLAYER_DERIVED)).toBe('playerDefeated')
    expect(combatStatus({ ...exhausted, monsterDamageTaken: foe.maxHitPoints }, foe, PLAYER_DERIVED)).toBe('monstersDefeated')
  })
})

describe('whose action it is', () => {
  it('never picks a side with nothing left', () => {
    const foe = monster()
    const noneLeftForMe = { ...freshRound(), playerActionsSpent: PLAYER_DERIVED.actionsPerRound }
    const noneLeftForThem = { ...freshRound(), monsterActionsSpent: foe.maxActions }
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(rollActor(noneLeftForMe, foe, PLAYER_DERIVED, seed).actor).toBe('monster')
      expect(rollActor(noneLeftForThem, foe, PLAYER_DERIVED, seed).actor).toBe('player')
    }
  })

  it('returns nobody rather than dividing by zero', () => {
    const foe = monster()
    const empty = {
      ...freshRound(),
      playerActionsSpent: PLAYER_DERIVED.actionsPerRound,
      monsterActionsSpent: foe.maxActions,
    }
    expect(rollActor(empty, foe, PLAYER_DERIVED, 1).actor).toBeNull()
  })

  it('splits the round in proportion to the two action pools', () => {
    // The property the whole action economy rests on: more actions is more
    // turns at the dial, in the ratio the pools are in.
    const foe = monster()
    const mine = playerActionsLeft(freshRound(), PLAYER_DERIVED)
    const theirs = monsterActionsLeft(freshRound(), foe)
    let player = 0
    const runs = 4000
    for (let seed = 1; seed <= runs; seed += 1) {
      if (rollActor(freshRound(), foe, PLAYER_DERIVED, seed).actor === 'player') player += 1
    }
    expect(player / runs).toBeCloseTo(mine / (mine + theirs), 1)
  })
})

describe('one exchange', () => {
  const attacker = block({ perception: 6, luck: 0 })
  const defender = block()

  it('dodging negates the blow without rolling anything', () => {
    const result = resolveExchange({
      attacker: 'player', attackerStats: attacker, attackerDamage: 10, defenderStats: defender,
      armor: NO_ARMOR, defence: 'dodge', dodgeOffered: true, rng: 7,
    })
    expect(result.blow).toMatchObject({ dodged: true, hit: false, damage: 0 })
    // The attack does not land at all -- it is not merely likelier to miss --
    // so no randomness is spent on it.
    expect(result.rng).toBe(7)
  })

  it('taking the hit always lands', () => {
    // Even against an attacker who could not otherwise hit anything.
    const hopeless = block({ perception: -20 })
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = resolveExchange({
        attacker: 'player', attackerStats: hopeless, attackerDamage: 10, defenderStats: defender,
        armor: NO_ARMOR, defence: 'takeTheHit', dodgeOffered: false, rng: seed,
      })
      expect(result.blow.hit).toBe(true)
    }
  })

  it('puts armor between the blow and its target on Defend, and only there', () => {
    const armor: Armor = { natural: 2, pieces: [{ itemId: 'plate', points: 4, max: 4, floor: 0 }] }
    const shared = {
      attacker: 'player' as const, attackerStats: attacker, attackerDamage: 10, defenderStats: defender, dodgeOffered: false, rng: 3,
    }
    const defended = resolveExchange({ ...shared, armor, defence: 'defend' })
    const bare = resolveExchange({ ...shared, armor, defence: 'takeTheHit' })
    expect(defended.blow.damage).toBeLessThan(bare.blow.damage)
    // ...and a defence that does not consult armor hands it back untouched,
    // rather than handing back an empty pool for the caller to store.
    expect(bare.armor).toEqual(armor)
    // Flee explicitly forgoes it too.
    const fleeing = resolveExchange({ ...shared, armor, defence: 'flee' })
    expect(fleeing.blow.damage).toBeGreaterThan(defended.blow.damage)
  })
})

describe('the defences on offer', () => {
  it('earns Dodge and gives the rest', () => {
    expect(defencesOffered(false)).toEqual(['defend', 'flee', 'takeTheHit'])
    expect(defencesOffered(true)).toEqual(['dodge', 'defend', 'flee', 'takeTheHit'])
  })
})

describe('fleeing', () => {
  it('ends the encounter when the pursuit check fails', () => {
    // A monster that cannot pursue anything.
    const slow = testMonster({ stats: block({ agility: -40 }), type: 'regular', level: 1, against: PLAYER,
    })
    const result = resolveMonsterAttack({
      state: freshRound(), monster: slow, playerStats: PLAYER, defence: 'flee', rng: 5,
    })
    expect(result.escaped).toBe(true)
    expect(result.state.playerFled).toBe(true)
    expect(result.blow).toBeNull()
  })

  it('costs the attempt when the pursuit succeeds', () => {
    const fast = testMonster({ stats: block({ agility: 40, perception: 40 }), type: 'regular', level: 1, against: PLAYER,
    })
    const result = resolveMonsterAttack({
      state: freshRound({ playerArmor: { natural: 0, pieces: [{ itemId: 'plate', points: 6, max: 6, floor: 0 }] } }),
      monster: fast, playerStats: PLAYER, defence: 'flee', rng: 5,
    })
    expect(result.escaped).toBe(false)
    // No armor between them and the blow -- the cost of having tried.
    expect(result.state.playerArmor).toEqual({ natural: 0, pieces: [{ itemId: 'plate', points: 6, max: 6, floor: 0 }] })
    expect(result.blow?.hit).toBe(true)
  })
})

describe('a group losing members mid-round', () => {
  it('takes actions off the pool as the damage crosses each band', () => {
    // Three of them, said outright: the head count is rolled per offer now
    // (model/vectors.ts's buddy chances) rather than read off a constant, so
    // a test about what a pack DOES names its own pack size.
    const swarm = monster({ type: 'runt', count: 3 })
    expect(swarm.count).toBe(3)
    const whole = monsterActionsLeft(freshRound(), swarm)
    const oneDown = monsterActionsLeft(freshRound({ monsterDamageTaken: swarm.maxHitPoints / 3 }), swarm)
    expect(oneDown).toBeLessThan(whole)
    // Killed outright: nothing left to act with.
    expect(monsterActionsLeft(freshRound({ monsterDamageTaken: swarm.maxHitPoints }), swarm)).toBe(0)
  })
})

describe('what an encounter pays', () => {
  it('pays a fleeing monster out as the loot menu\'s gold branch, with no choice', () => {
    expect(payoutFor('monsterFled', 4)).toEqual({
      goldUnits: 1, experienceUnits: 4, offersLoot: false, countsAsEncounter: true,
    })
  })

  it('pays a fleeing player nothing, and still spends the encounter', () => {
    // Running is a decision, not a free reroll.
    expect(payoutFor('playerFled', 4)).toEqual({
      goldUnits: 0, experienceUnits: 0, offersLoot: false, countsAsEncounter: true,
    })
  })

  it('opens the loot menu only on a real win', () => {
    expect(payoutFor('monstersDefeated', 4).offersLoot).toBe(true)
    expect(payoutFor('playerDefeated', 4)).toEqual({
      goldUnits: 0, experienceUnits: 0, offersLoot: false, countsAsEncounter: true,
    })
  })
})

describe('an attack spends exactly one action', () => {
  it('from the side that made it', () => {
    const foe = monster()
    const mine = resolvePlayerAttack({
      state: freshRound(), monster: foe, playerStats: PLAYER, playerDerived: PLAYER_DERIVED, rng: 11,
    })
    expect(mine.state.playerActionsSpent).toBe(1)
    expect(mine.state.monsterActionsSpent).toBe(0)
    const theirs = resolveMonsterAttack({
      state: freshRound(), monster: foe, playerStats: PLAYER, defence: 'defend', rng: 11,
    })
    expect(theirs.state.monsterActionsSpent).toBe(1)
    expect(theirs.state.playerActionsSpent).toBe(0)
  })
})

/**
 * A monster's plate is the PLAYER'S armor mechanism pointed the other way --
 * the same `absorb`, the same natural pool, the same "only when defending"
 * rule. Nothing about a fight learned a second kind of armor, and these
 * assert that rather than assert the numbers in the table.
 */
describe('monster armor', () => {
  const monsterOf = (type: MonsterType): Monster => testMonster({ stats: block({ might: 2, agility: 1 }),
    type,
    level: 1,
    against: PLAYER,
  })
  const armoured = (natural: number): Monster => ({ ...monsterOf('regular'), armor: { natural, pieces: [] } })

  /** An attack the monster cannot dodge, so the exchange reaches armor. */
  function strike(monster: Monster, seed: number) {
    return resolvePlayerAttack({
      state: freshRound(),
      monster,
      playerStats: PLAYER,
      playerDerived: PLAYER_DERIVED,
      // Certain to hit, never a crit: the blow's size is then the armor's
      // doing alone.
      successAdjust: 1,
      rng: seed,
    })
  }

  it('takes its points off a blow it defends against', () => {
    // Same seed, same blow, one difference. Some seeds let the monster dodge
    // outright, which is a different branch -- take the ones that landed.
    for (let seed = 1; seed <= 40; seed += 1) {
      const bare = strike(armoured(0), seed)
      const plated = strike(armoured(4), seed)
      if (!bare.blow.hit || bare.blow.dodged) continue
      if (bare.blow.damage <= 0) continue
      expect(plated.blow.damage).toBeLessThan(bare.blow.damage)
      expect(bare.blow.damage - plated.blow.damage).toBeLessThanOrEqual(4)
      return
    }
    throw new Error('no seed produced a landed blow')
  })

  it('never wears away, however many blows it takes', () => {
    // It lives in the NATURAL pool, which `absorb` is not allowed to touch --
    // so there is nothing for a fight to carry between actions, which is why
    // the round state stores no monster armor at all.
    const monster = armoured(3)
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(strike(monster, seed)).toBeDefined()
      expect(monster.armor).toEqual({ natural: 3, pieces: [] })
    }
  })

  it('is given by SPECIES rather than by rank, which is the other way round', () => {
    // It WAS a per-rank table, and that was exactly the muddle the four
    // vectors were separated to end: a rank is a TIER and nothing else, and
    // what a creature is made of belongs to its species. So every rank is
    // unarmoured on its own, and any rank is armoured when it is the kind of
    // thing that has a hide -- which `contested.test.ts` asserts from the
    // other side, with a species that has one.
    for (const type of MONSTER_TYPES) {
      expect(totalArmor(monsterOf(type).armor)).toBe(0)
    }
  })
})

/**
 * A blow's damage is DRAWN, not fixed (model/damageRoll.ts). These are the
 * two ends of that reaching the fight: the same blow varies, and the working
 * it hands back is the one it actually used.
 */
describe('a blow rolls its damage', () => {
  function swing(stats: StatBlock, seed: number) {
    return resolvePlayerAttack({
      state: freshRound(),
      monster: monster(),
      playerStats: stats,
      playerDerived: deriveStats(stats),
      // Certain to land, so every difference below is the damage roll's.
      successAdjust: 1,
      rng: seed,
    })
  }

  it('varies across seeds for a character with a band to draw from', () => {
    const loose = block({ might: 2, perception: 0 })
    const seen = new Set<number>()
    for (let seed = 1; seed <= 60; seed += 1) {
      const blow = swing(loose, seed).blow
      // The ROLL, not the damage: a crit doubles what was rolled and would
      // make this pass on variance the band had nothing to do with.
      if (blow.hit) seen.add(Math.round(blow.math.rolled * 100))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('stops varying once Perception closes the band', () => {
    const sharp = block({ might: 2, perception: 6 })
    const seen = new Set<number>()
    for (let seed = 1; seed <= 60; seed += 1) {
      const blow = swing(sharp, seed).blow
      if (blow.hit) seen.add(Math.round(blow.math.rolled * 100))
    }
    expect(seen.size).toBe(1)
  })

  it('reports the band and the draws it actually took', () => {
    const stats = block({ might: 2, perception: 1, luck: 3 })
    for (let seed = 1; seed <= 40; seed += 1) {
      const blow = swing(stats, seed).blow
      if (!blow.hit) continue
      expect(blow.math.rolls).toBe(4)
      expect(blow.math.low).toBeLessThan(blow.math.high)
      expect(blow.math.rolled).toBeGreaterThanOrEqual(blow.math.low - 1e-9)
      expect(blow.math.rolled).toBeLessThanOrEqual(blow.math.high + 1e-9)
      // The nominal is the band's ceiling, which is what "nominal" means.
      expect(blow.math.high).toBeCloseTo(blow.math.base, 10)
      return
    }
    throw new Error('no blow landed')
  })
})

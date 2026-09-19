// A MONSTER'S CONDITIONAL EFFECTS REACH IT, in both directions.
//
// They did not, and the failure was silent: `buildMonster` resolved against no
// situation at all, so a species' conditionals were evaluated once against
// nothing and thrown away. The Ghoul's "+80% Damage injured" and the Lich's
// "+100% Actions maimed" could never fire, and a `healthy` one would have
// fired always. Nothing complained, because a number that is merely WRONG
// looks exactly like a number that is right.
//
// So this asserts the PROPERTY rather than a reading of it: an effect
// conditioned on a band changes the monster inside that band and nowhere else.

import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { buildMonster } from './monsters'
import { createStatBlock } from './stats'
import { MAIMED_BELOW, INJURED_BELOW } from './health'
import type { Species } from './vectors'

const BUILD = THOCKQUEST.builds[0]
const AGAINST = createStatBlock(3)

function monster(species: Species | null, moment?: Parameters<typeof buildMonster>[0]['moment']) {
  return buildMonster({
    build: BUILD, species, combatClass: null, type: 'regular',
    tier: 10, level: 1, progression: 1.01, against: AGAINST, moment,
  })
}

/** The same species with its conditionals stripped: the control. */
function plain(species: Species): Species {
  return { ...species, effects: species.effects.filter((e) => e.kind !== 'derivedPercentWhileHealth') }
}

describe('a monster reads its own health', () => {
  const ghoul = THOCKQUEST.species.find((s) => s.id === 'ghoul')
  if (!ghoul) throw new Error('the Ghoul is the fixture: it carries two `injured` self-conditionals')

  it('is unchanged by its conditionals while whole, and changed by them once hurt', () => {
    const control = monster(plain(ghoul), { damageTaken: 0 })
    const whole = monster(ghoul, { damageTaken: 0 })
    expect(whole.damage).toBeCloseTo(control.damage, 10)

    // Just inside `injured`, measured against the maximum the STATS derive --
    // which is what the two-pass in `situationFor` exists to get right.
    const max = whole.maxHitPoints
    const hurt = monster(ghoul, { damageTaken: Math.ceil(max * (1 - INJURED_BELOW)) + 1 })
    expect(hurt.damage).toBeGreaterThan(control.damage)
    expect(hurt.maxActions).toBeGreaterThan(control.maxActions)
  })

  it('keeps firing all the way down, because injured contains maimed', () => {
    const max = monster(ghoul, { damageTaken: 0 }).maxHitPoints
    const injured = monster(ghoul, { damageTaken: Math.ceil(max * (1 - INJURED_BELOW)) + 1 })
    const maimed = monster(ghoul, { damageTaken: Math.ceil(max * (1 - MAIMED_BELOW)) + 1 })
    expect(maimed.damage).toBeCloseTo(injured.damage, 10)
  })

  it('is out of force with NO moment, which is what an offer screen asks', () => {
    // A creature nobody has swung at yet is described by what it is, not by a
    // condition that has not come up. The same answer the player's bar gets.
    const control = monster(plain(ghoul))
    expect(monster(ghoul).damage).toBeCloseTo(control.damage, 10)
  })
})

describe('a monster reads the PLAYER\'s health', () => {
  const wolf = THOCKQUEST.species.find((s) => s.id === 'wolf')
  if (!wolf) throw new Error('the Wolf is the fixture: it carries a `maimed` target-conditional')

  it('hits harder once the player is in the band, and not before', () => {
    const control = monster(plain(wolf), { damageTaken: 0, opponentHealthFraction: 0.1 })
    const whole = monster(wolf, { damageTaken: 0, opponentHealthFraction: 0.9 })
    const bleeding = monster(wolf, { damageTaken: 0, opponentHealthFraction: 0.1 })
    expect(whole.damage).toBeCloseTo(control.damage, 10)
    expect(bleeding.damage).toBeGreaterThan(whole.damage)
  })

  it('is out of force when there is nobody across from it', () => {
    const control = monster(plain(wolf), { damageTaken: 0 })
    expect(monster(wolf, { damageTaken: 0 }).damage).toBeCloseTo(control.damage, 10)
  })
})

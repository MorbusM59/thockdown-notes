import { describe, expect, it } from 'vitest'

import {
  BOSS_ENCOUNTER,
  buildEncounterOffers,
  fixedTypeAt,
  MINI_BOSS_ENCOUNTERS,
  monsterPools,
  mostSelectedEncounterPool,
  OFFERABLE_TYPES,
  rollCount,
} from './encounterOffers'
import { MONSTER_BUDDY_CHANCES } from './vectors'
import { THOCKQUEST } from '../content/thockquest'

const POOLS = monsterPools(THOCKQUEST)

const offersAt = (encounter: number, choiceCount: number, rng: number) =>
  buildEncounterOffers({ encounter, choiceCount, ...POOLS, rng }).offers

describe('where the bosses are', () => {
  it('fixes the fifth, ninth and tenth and leaves the rest open', () => {
    for (let encounter = 1; encounter <= 10; encounter += 1) {
      const fixed = fixedTypeAt(encounter)
      if (encounter === BOSS_ENCOUNTER) expect(fixed).toBe('boss')
      else if (MINI_BOSS_ENCOUNTERS.includes(encounter)) expect(fixed).toBe('miniBoss')
      else expect(fixed).toBeNull()
    }
  })

  it('offers no CHOICE at a boss -- the encounter is the encounter', () => {
    for (const encounter of [...MINI_BOSS_ENCOUNTERS, BOSS_ENCOUNTER]) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const offers = offersAt(encounter, 5, seed)
        expect(offers).toHaveLength(1)
        expect(offers[0].type).toBe(encounter === BOSS_ENCOUNTER ? 'boss' : 'miniBoss')
      }
    }
  })
})

describe('what an ordinary encounter offers', () => {
  it('opens on a regular, whatever the dice say', () => {
    // So a level's first decision can never be a choice between three packs.
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(offersAt(1, 4, seed)[0].type).toBe('regular')
    }
  })

  it('never repeats a species-class-and-rank, whatever build wears it', () => {
    // The rule is about a VARIED list, and what varies is what the fight IS.
    // The BUILD is deliberately out of the key: a Hulking Orc Bruiser beside
    // a Wiry Orc Bruiser is the same fight with a different adjective. The
    // species is deliberately IN it, which it was not while a species was
    // only a name -- it carries the whole non-stat vector now, so a Golem and
    // an Imp are not interchangeable.
    for (let seed = 1; seed <= 120; seed += 1) {
      const offers = offersAt(3, 5, seed)
      const identities = offers.map((offer) => `${offer.speciesId}:${offer.classId}:${offer.type}`)
      expect(new Set(identities).size).toBe(identities.length)
    }
  })

  it('only ever draws the three offerable ranks', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const offer of offersAt(3, 5, seed)) {
        expect(OFFERABLE_TYPES).toContain(offer.type)
      }
    }
  })

  it('never offers one of the PEOPLES as a monster', () => {
    // The one asymmetry between the two sides of the game, and it lives in
    // `monsterPools` rather than at the call sites -- so this is the test
    // that would catch a third caller filtering for itself and getting it
    // wrong.
    const peoples = new Set(THOCKQUEST.species.filter((species) => species.playable).map((species) => species.id))
    expect(peoples.size).toBeGreaterThan(0)
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const encounter of [1, 3, 5, 10]) {
        for (const offer of offersAt(encounter, 5, seed)) {
          expect(peoples.has(offer.speciesId)).toBe(false)
        }
      }
    }
  })

  it('assigns every monster species to a valid encounter pool', () => {
    const monsterSpecies = THOCKQUEST.species.filter((species) => !species.playable)
    expect(monsterSpecies.length).toBeGreaterThan(0)
    for (const species of monsterSpecies) {
      expect(species.encounterPool).toBeTruthy()
      expect(POOLS.species.some((candidate) => candidate.id === species.id)).toBe(true)
    }
  })

  it('names only vectors the content actually has', () => {
    const builds = new Set(THOCKQUEST.builds.map((build) => build.id))
    const species = new Set(THOCKQUEST.species.map((entry) => entry.id))
    const classes = new Set(THOCKQUEST.combatClasses.map((entry) => entry.id))
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const offer of offersAt(3, 5, seed)) {
        expect(builds.has(offer.buildId)).toBe(true)
        expect(species.has(offer.speciesId)).toBe(true)
        expect(classes.has(offer.classId)).toBe(true)
      }
    }
  })

  it('gives every offer a head count its RANK allows', () => {
    // The buddy rule is the rank's, and an offer carries the roll rather than
    // re-rolling it wherever the monster is rebuilt -- which is what keeps a
    // reloaded fight the same fight.
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const encounter of [1, 3, 5, 10]) {
        for (const offer of offersAt(encounter, 5, seed)) {
          const most = 1 + MONSTER_BUDDY_CHANCES[offer.type].length
          expect(offer.count).toBeGreaterThanOrEqual(1)
          expect(offer.count).toBeLessThanOrEqual(most)
        }
      }
    }
  })

  it('stops asking for friends at the first refusal', () => {
    // A second buddy is a friend of the FIRST, so a creature that came alone
    // cannot have a second companion. With a runt's chances (1, then a half)
    // that means two or three and never anything else -- which is only true
    // if the loop breaks rather than rolling every entry independently.
    const seen = new Set<number>()
    for (let seed = 1; seed <= 400; seed += 1) seen.add(rollCount('runt', seed).count)
    expect([...seen].sort()).toEqual([2, 3])
  })

  it('gives as many as asked for while the content can tell them apart', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(offersAt(2, 4, seed)).toHaveLength(4)
    }
  })

  it('chooses the most frequently tracked pool for a fixed encounter, with a random tie break', () => {
    const tied = mostSelectedEncounterPool(['beasts', 'beasts', 'undead', 'undead', 'spirits'], 7)
    expect(['beasts', 'undead']).toContain(tied)

    const dominant = mostSelectedEncounterPool(['humanoids', 'humanoids', 'beasts', 'beasts', 'beasts'], 11)
    expect(dominant).toBe('beasts')
  })

  it('returns a SHORTER list rather than looping when the combinations run out', () => {
    // Asking for more than exists cannot be honoured: there are only so many
    // species-class-and-rank triples the content can field. The bound is
    // COMPUTED from the content rather than written down, so adding a species
    // moves it without touching this test -- and the ask is computed from the
    // bound for the same reason. (It used to be a flat twenty, which the four
    // vectors made reachable: fourteen species by fourteen classes by three
    // ranks is nearly six hundred distinguishable fights where the old
    // class-and-rank key could tell apart nine.)
    const reachable = POOLS.species.length * POOLS.classes.length * OFFERABLE_TYPES.length
    const asked = reachable + 50
    const offers = buildEncounterOffers({ encounter: 2, choiceCount: asked, ...POOLS, rng: 7 }).offers
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.length).toBeLessThanOrEqual(reachable)
    expect(offers.length).toBeLessThan(asked)
  })
})

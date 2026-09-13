import { describe, expect, it } from 'vitest'

import { BOSS_ENCOUNTER, buildEncounterOffers, fixedTypeAt, MINI_BOSS_ENCOUNTERS, OFFERABLE_TYPES } from './encounterOffers'
import { MONSTER_CLASS_IDS } from '../content'
import { THOCKQUEST } from '../content/thockquest'

const offersAt = (encounter: number, choiceCount: number, rng: number) =>
  buildEncounterOffers({
    encounter,
    choiceCount,
    species: THOCKQUEST.species,
    classes: MONSTER_CLASS_IDS,
    rng,
  }).offers

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

  it('never repeats a class-and-rank, whatever species wears it', () => {
    // The rule is about a VARIED list. Three regular warriors from three
    // species is the same fight three times in different names, so the
    // species deliberately does not widen the key.
    for (let seed = 1; seed <= 120; seed += 1) {
      const offers = offersAt(3, 5, seed)
      const identities = offers.map((offer) => `${offer.classId}:${offer.type}`)
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

  it('respects each form\'s class restriction', () => {
    const formsByName = new Map(
      THOCKQUEST.species.flatMap((species) =>
        Object.values(species.forms).flat().map((form) => [`${species.id}:${form.name}`, form] as const),
      ),
    )
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const encounter of [1, 3, 5, 10]) {
        for (const offer of offersAt(encounter, 5, seed)) {
          const form = formsByName.get(`${offer.speciesId}:${offer.name}`)
          expect(form).toBeDefined()
          if (form && form.classes.length > 0) expect(form.classes).toContain(offer.classId)
        }
      }
    }
  })

  it('gives as many as asked for while the content can tell them apart', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(offersAt(2, 4, seed)).toHaveLength(4)
    }
  })

  it('returns a SHORTER list rather than looping when the combinations run out', () => {
    // Asking for twenty cannot be honoured: there are only so many
    // class-and-rank pairs the content can actually field. The bound is
    // COMPUTED from the content rather than written down, so adding a species
    // moves it without touching this test.
    const reachable = new Set<string>()
    for (const species of THOCKQUEST.species) {
      for (const type of OFFERABLE_TYPES) {
        for (const form of species.forms[type as 'group' | 'regular' | 'elite']) {
          const classes = form.classes.length > 0 ? form.classes : MONSTER_CLASS_IDS
          for (const classId of classes) reachable.add(`${classId}:${type}`)
        }
      }
    }
    const offers = buildEncounterOffers({
      encounter: 2, choiceCount: 20, species: THOCKQUEST.species, classes: MONSTER_CLASS_IDS, rng: 7,
    }).offers
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.length).toBeLessThanOrEqual(reachable.size)
    expect(offers.length).toBeLessThan(20)
  })
})

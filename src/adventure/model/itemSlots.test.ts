// What a rolled item is, and what it is allowed to be.
//
// The class of defect these are for is not a wrong number -- the numbers are
// rolled and there is no right one -- it is a roll that is not stable, not
// thematic, or not reachable. All three are silent: a run whose Spyglass
// changes between screens looks like a rendering bug, a Whetstone that rolled
// +3 Charisma looks like content nobody read, and a verbose effect that never
// reaches the fight looks like nothing at all.

import { describe, expect, it } from 'vitest'

import { rollItem, validateItemTemplate, VERBOSE_IDS, type ItemTemplate } from './itemSlots'
import { armorSlotOf, type ModifierEffect } from './modifiers'
import { THOCKQUEST } from '../content'
import { catalogFor } from '../content'
import { DERIVED_KEYS, STAT_KEYS } from './stats'

const SEEDS = [1, 2, 3, 7, 11, 101, 9001, 123456, 2 ** 31, 0]

function effectsAcross(template: ItemTemplate): ModifierEffect[] {
  return SEEDS.flatMap((seed) => [...rollItem(template, seed).effects])
}

describe('a rolled item', () => {
  it('is the SAME item every time it is asked for in one run', () => {
    // The whole reason the roll is per run rather than per offer: the save
    // refers to items by id, so a second roll would mean the Spyglass in the
    // market and the Spyglass in hand were different objects.
    for (const template of THOCKQUEST.items) {
      const once = rollItem(template, 4242)
      const twice = rollItem(template, 4242)
      expect(twice).toEqual(once)
    }
  })

  it('is a DIFFERENT item in a different run, for most of them', () => {
    const changed = THOCKQUEST.items.filter(
      (template) => JSON.stringify(rollItem(template, 1).effects) !== JSON.stringify(rollItem(template, 2).effects),
    )
    // Not "all": a template with one stat and one derived value can roll the
    // same thing twice by chance, and demanding otherwise would be demanding
    // the dice behave.
    expect(changed.length).toBeGreaterThan(THOCKQUEST.items.length * 0.8)
  })

  /**
   * THE REASON EACH TEMPLATE DRAWS FROM ITS OWN STREAM. Adding a thirty-first
   * item must not re-roll the other thirty for every save in existence, which
   * is what one shared sequence walked in content order would have done.
   */
  it('does not move when another template is added, removed or reordered', () => {
    const spyglass = THOCKQUEST.items.find((item) => item.id === 'spyglass')
    if (!spyglass) throw new Error('no spyglass')
    const before = rollItem(spyglass, 777)

    const withExtra = catalogFor({
      ...THOCKQUEST,
      items: [
        { id: 'a-brand-new-thing', name: 'New', icon: '', stats: ['luck'], derived: [], verbose: [] },
        ...[...THOCKQUEST.items].reverse(),
      ],
    }, 777)
    expect(withExtra.get('spyglass')).toEqual(before)
  })

  it('fills two or three slots, armor counting as one of them', () => {
    for (const template of THOCKQUEST.items) {
      for (const seed of SEEDS) {
        // ONE EFFECT PER SLOT, exactly: a decay floor is what the VERBOSE
        // slot rolled about this item's armor, not a second thing the armor
        // slot brought with it.
        const slots = rollItem(template, seed).effects.length
        expect(slots).toBeGreaterThanOrEqual(2)
        expect(slots).toBeLessThanOrEqual(3)
      }
    }
  })

  it('always gives armour its armor, and never gives it to anything else', () => {
    for (const template of THOCKQUEST.items) {
      for (const seed of SEEDS) {
        const slot = armorSlotOf(rollItem(template, seed))
        if (!template.armor) {
          expect(slot).toBeNull()
          continue
        }
        if (!slot) throw new Error(`${template.id} rolled no armor`)
        expect(slot.amount).toBeGreaterThanOrEqual(template.armor[0])
        expect(slot.amount).toBeLessThanOrEqual(template.armor[1])
        // A floor at or above the pool is a piece that never wears at all,
        // which is a different item from the one the template describes.
        expect(slot.floor).toBeLessThan(slot.amount)
      }
    }
  })

  it('stays inside what its template says it is about', () => {
    for (const template of THOCKQUEST.items) {
      for (const effect of effectsAcross(template)) {
        if (effect.kind === 'statDelta') expect(template.stats).toContain(effect.stat)
        if ('derived' in effect) expect(template.derived).toContain(effect.derived)
      }
    }
  })

  it('keeps every slot inside its declared range', () => {
    for (const template of THOCKQUEST.items) {
      for (const effect of effectsAcross(template)) {
        if (effect.kind === 'statDelta') {
          expect(effect.amount).toBeGreaterThanOrEqual(1)
          expect(effect.amount).toBeLessThanOrEqual(3)
        }
        if (effect.kind === 'derivedPercent') {
          expect(effect.percent).toBeGreaterThanOrEqual(0.1)
          expect(effect.percent).toBeLessThanOrEqual(0.5)
          // In tens, so the player reads round numbers rather than 0.30000004.
          expect(Math.round(effect.percent * 100) % 10).toBe(0)
        }
      }
    }
  })

  it('never puts its two stat slots into the same stat', () => {
    for (const template of THOCKQUEST.items) {
      for (const seed of SEEDS) {
        const stats = rollItem(template, seed).effects
          .flatMap((effect) => (effect.kind === 'statDelta' ? [effect.stat] : []))
        expect(new Set(stats).size).toBe(stats.length)
      }
    }
  })
})

describe('the content itself', () => {
  it('names thirty items', () => {
    expect(THOCKQUEST.items).toHaveLength(30)
  })

  it('has a template for every verbose effect, so none of them is dead content', () => {
    const named = new Set(THOCKQUEST.items.flatMap((template) => template.verbose))
    for (const id of VERBOSE_IDS) expect(named.has(id)).toBe(true)
  })

  it('names only stats and derived values that exist', () => {
    for (const template of THOCKQUEST.items) {
      for (const stat of template.stats) expect(STAT_KEYS).toContain(stat)
      for (const key of template.derived) expect(DERIVED_KEYS).toContain(key)
    }
  })

  it('complains about a template that cannot fill what it names', () => {
    expect(validateItemTemplate({
      id: 'bad', name: 'Bad', icon: '', stats: [], derived: [], verbose: ['tempered'],
    })).toContain('item template "bad" names "tempered" but carries no armor to temper')
    expect(validateItemTemplate({
      id: 'worse', name: 'Worse', icon: '', stats: [], derived: [], verbose: ['desperate'],
    }).join(' ')).toContain('a below-hit-points effect but no derived value it could act on')
    // The narrower of the two: a round-position effect on a value a round
    // cannot move reads well and does nothing, which is the whole class of
    // defect model/modifierReach.test.ts exists for.
    expect(validateItemTemplate({
      id: 'quick', name: 'Quick', icon: '', stats: [], derived: ['actionsPerRound'], verbose: ['opener'],
    }).join(' ')).toContain('a first/last-action effect but no derived value it could act on')
  })

  it('is happy with every template it ships', () => {
    for (const template of THOCKQUEST.items) expect(validateItemTemplate(template)).toEqual([])
  })
})

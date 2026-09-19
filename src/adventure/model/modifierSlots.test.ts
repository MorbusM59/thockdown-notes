// What a rolled item is, and what it is allowed to be.
//
// The class of defect these are for is not a wrong number -- the numbers are
// rolled and there is no right one -- it is a roll that is not stable, not
// thematic, or not reachable. All three are silent: a run whose Spyglass
// changes between screens looks like a rendering bug, a Whetstone that rolled
// +3 Charisma looks like content nobody read, and a verbose effect that never
// reaches the fight looks like nothing at all.

import { describe, expect, it } from 'vitest'

import { DECAYING_ARMOR_RANGE, NATURAL_ARMOR_RANGE, rollModifier, SLOT_PLAN, validateTemplate, VERBOSE_IDS, type ModifierTemplate } from './modifierSlots'
import { armorSlotOf, type ModifierEffect } from './modifiers'
import { THOCKQUEST } from '../content'
import { catalogFor } from '../content'
import { DERIVED_KEYS, STAT_KEYS } from './stats'

const SEEDS = [1, 2, 3, 7, 11, 101, 9001, 123456, 2 ** 31, 0]

/** Both pools. Everything in the first block below holds for either kind. */
const TEMPLATES: readonly ModifierTemplate[] = [...THOCKQUEST.items, ...THOCKQUEST.traits]

function effectsAcross(template: ModifierTemplate): ModifierEffect[] {
  return SEEDS.flatMap((seed) => [...rollModifier(template, seed).effects])
}

describe('a rolled item', () => {
  it('is the SAME item every time it is asked for in one run', () => {
    // The whole reason the roll is per run rather than per offer: the save
    // refers to items by id, so a second roll would mean the Spyglass in the
    // market and the Spyglass in hand were different objects.
    for (const template of TEMPLATES) {
      const once = rollModifier(template, 4242)
      const twice = rollModifier(template, 4242)
      expect(twice).toEqual(once)
    }
  })

  it('is a DIFFERENT item in a different run, for most of them', () => {
    const changed = TEMPLATES.filter(
      (template) => JSON.stringify(rollModifier(template, 1).effects) !== JSON.stringify(rollModifier(template, 2).effects),
    )
    // Not "all": a template with one stat and one derived value can roll the
    // same thing twice by chance, and demanding otherwise would be demanding
    // the dice behave.
    expect(changed.length).toBeGreaterThan(TEMPLATES.length * 0.8)
  })

  /**
   * THE REASON EACH TEMPLATE DRAWS FROM ITS OWN STREAM. Adding a thirty-first
   * item must not re-roll the other thirty for every save in existence, which
   * is what one shared sequence walked in content order would have done.
   */
  it('does not move when another template is added, removed or reordered', () => {
    const spyglass = THOCKQUEST.items.find((item) => item.id === 'spyglass')
    if (!spyglass) throw new Error('no spyglass')
    const before = rollModifier(spyglass, 777)

    const withExtra = catalogFor({
      ...THOCKQUEST,
      items: [
        { id: 'a-brand-new-thing', kind: 'item' as const, name: 'New', icon: '', stats: ['luck' as const], derived: [], verbose: [] },
        ...[...THOCKQUEST.items].reverse(),
      ],
    }, 777)
    expect(withExtra.get('spyglass')).toEqual(before)
  })

  it('fills two or three slots, armor counting as one of them', () => {
    for (const template of TEMPLATES) {
      for (const seed of SEEDS) {
        // ONE EFFECT PER SLOT, exactly: a decay floor is what the VERBOSE
        // slot rolled about this item's armor, not a second thing the armor
        // slot brought with it.
        const slots = rollModifier(template, seed).effects.length
        expect(slots).toBeGreaterThanOrEqual(2)
        expect(slots).toBeLessThanOrEqual(3)
      }
    }
  })

  it('always gives armour its armor, and never gives it to anything else', () => {
    for (const template of TEMPLATES) {
      for (const seed of SEEDS) {
        const rolled = rollModifier(template, seed)
        const slot = armorSlotOf(rolled)
        const natural = rolled.effects.reduce(
          (sum, effect) => (effect.kind === 'naturalArmor' ? sum + effect.amount : sum),
          0,
        )
        if (!template.armor) {
          // A DECAYING pool never appears without the flag. Natural armor can,
          // because `ward` grants it from a verbose slot -- which is why the
          // two are asserted apart rather than as one "has armor".
          expect(slot).toBeNull()
          continue
        }
        if (template.kind === 'item') {
          if (!slot) throw new Error(`${template.id} rolled no armor`)
          expect(slot.amount).toBeGreaterThanOrEqual(DECAYING_ARMOR_RANGE[0])
          expect(slot.amount).toBeLessThanOrEqual(DECAYING_ARMOR_RANGE[1])
        } else {
          // A TRAIT's armor is natural and never wears, so it has no pool to
          // decay and a third of the size -- a point that survives a whole
          // level is worth several that do not.
          expect(slot).toBeNull()
          expect(natural).toBeGreaterThanOrEqual(NATURAL_ARMOR_RANGE[0])
          expect(DECAYING_ARMOR_RANGE[1] / NATURAL_ARMOR_RANGE[1]).toBe(3)
        }
      }
    }
  })

  it('stays inside what its template says it is about', () => {
    for (const template of TEMPLATES) {
      for (const effect of effectsAcross(template)) {
        if (effect.kind === 'statDelta') expect(template.stats ?? []).toContain(effect.stat)
        if ('derived' in effect) expect(template.derived).toContain(effect.derived)
      }
    }
  })

  it('keeps every slot inside its declared range', () => {
    for (const template of TEMPLATES) {
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
    for (const template of TEMPLATES) {
      for (const seed of SEEDS) {
        const stats = rollModifier(template, seed).effects
          .flatMap((effect) => (effect.kind === 'statDelta' ? [effect.stat] : []))
        expect(new Set(stats).size).toBe(stats.length)
      }
    }
  })
})

/**
 * THE ONLY DIFFERENCE BETWEEN THE TWO KINDS is two lines of `SLOT_PLAN`: gear
 * buys stat points because the base stat cap is what gear exists to carry a
 * character past, and a trait -- something you ARE, which cannot be picked up
 * -- spends those two slots on verbose effects instead.
 */
describe('the two kinds', () => {
  it('differ in which slots they have, and in nothing else', () => {
    expect(SLOT_PLAN.item.filter((slot) => slot === 'stat')).toHaveLength(2)
    expect(SLOT_PLAN.trait.filter((slot) => slot === 'stat')).toHaveLength(0)
    expect(SLOT_PLAN.item.filter((slot) => slot === 'verbose')).toHaveLength(1)
    expect(SLOT_PLAN.trait.filter((slot) => slot === 'verbose')).toHaveLength(2)
  })

  it('never gives a trait a stat point, however the dice fall', () => {
    for (const template of THOCKQUEST.traits) {
      for (const seed of SEEDS) {
        expect(rollModifier(template, seed).effects.some((effect) => effect.kind === 'statDelta')).toBe(false)
      }
    }
  })

  it('never spends two slots on the same thing', () => {
    // Two verbose slots draw from ONE sample, so a trait that rolled both
    // cannot spend them on the same effect -- which would read as one bigger
    // slot and quietly break its range.
    //
    // Compared WHOLE rather than by kind: an opener and a finisher are both a
    // `derivedPercentOnAction` and are not the same thing, so kinds would
    // report a false duplicate, and two effects that agree on every field
    // really are one slot spent twice.
    for (const template of THOCKQUEST.traits) {
      for (const seed of SEEDS) {
        const effects = rollModifier(template, seed).effects.map((effect) => JSON.stringify(effect))
        expect(new Set(effects).size).toBe(effects.length)
      }
    }
  })
})

describe('the content itself', () => {
  it('names thirty of each', () => {
    expect(THOCKQUEST.items).toHaveLength(30)
    expect(THOCKQUEST.traits).toHaveLength(30)
  })

  it('has a template for every verbose effect, so none of them is dead content', () => {
    const named = new Set(TEMPLATES.flatMap((template) => template.verbose))
    for (const id of VERBOSE_IDS) expect(named.has(id)).toBe(true)
  })

  it('names only stats and derived values that exist', () => {
    for (const template of TEMPLATES) {
      for (const stat of template.stats ?? []) expect(STAT_KEYS).toContain(stat)
      for (const key of template.derived) expect(DERIVED_KEYS).toContain(key)
    }
  })

  it('complains about a template that cannot fill what it names', () => {
    const bare = { icon: '', derived: [], verbose: [] }
    expect(validateTemplate({
      ...bare, id: 'worse', kind: 'item', name: 'Worse', verbose: ['desperate'],
    }).join(' ')).toContain('a below-hit-points effect but no derived value it could act on')
    // The narrower of the two: a round-position effect on a value a round
    // cannot move reads well and does nothing, which is the whole class of
    // defect model/modifierReach.test.ts exists for.
    expect(validateTemplate({
      ...bare, id: 'quick', kind: 'item', name: 'Quick', derived: ['actionsPerRound'], verbose: ['opener'],
    }).join(' ')).toContain('a first/last-action effect but no derived value it could act on')
    // A template that cannot reach two slots at all rolls something thinner
    // than the design says any modifier is, and nothing else would report it.
    // Naming FEWER options than its kind has slots for is fine and often
    // deliberate -- a Whetstone is Might and nothing else.
    expect(validateTemplate({
      ...bare, id: 'thin', kind: 'trait', name: 'Thin', verbose: ['repair'],
    }).join(' ')).toContain('can fill 1 slot(s), and every modifier fills at least 2')
    expect(validateTemplate({
      ...bare, id: 'narrow', kind: 'item', name: 'Narrow', stats: ['might'], derived: ['damageMultiplier'],
    })).toEqual([])
    // A trait's own armor slot grants natural armor, so naming `ward` beside
    // it is naming the same slot twice -- and rolling both spent one for
    // nothing.
    expect(validateTemplate({
      ...bare, id: 'warded', kind: 'trait', name: 'Warded', derived: ['damageMultiplier'],
      verbose: ['ward', 'desperate'], armor: true,
    }).join(' ')).toContain('what its own armor slot grants')
    // And a trait declaring stats declares something it has no slot to roll.
    expect(validateTemplate({
      ...bare, id: 'statty', kind: 'trait', name: 'Statty', stats: ['might', 'luck'],
      derived: ['damageMultiplier'], verbose: ['desperate', 'opener'],
    }).join(' ')).toContain('a trait has no stat slot to put them in')
  })

  it('is happy with every template it ships', () => {
    for (const template of TEMPLATES) expect(validateTemplate(template)).toEqual([])
  })
})

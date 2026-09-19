import { describe, expect, it } from 'vitest'

import { applyEffect, applyEffects, emptySave, type GameSave } from './model/gameState'
import { chromeGauges, chromeIdentity, chromeMeters, statusReadouts } from './chrome'
import { catalogFor, THOCKQUEST, type Content } from './content'
import { createSeed } from './core/rng'
import { createdRun, withVectors } from './testing/run'
import { BASE_PLAYER_TIER } from './model/vectors'
import { STAT_KEYS } from './model/stats'

/**
 * Armor cannot be fabricated any more, and that is the point of the change it
 * tests: it belongs to the modifiers carrying it (model/armor.ts), so the only
 * way to have any is to be carrying something that has some. An armour
 * template always fills its armor slot, so what it is worth is fixed for a
 * given run seed and read back from the catalog rather than written down here
 * (model/modifierSlots.ts).
 */
const PLATE = {
  id: 'test-plate', kind: 'item' as const, name: 'Test Plate', icon: 'fa-solid fa-shield',
  stats: [], derived: [], verbose: [], armor: true,
}
const HIDE = {
  id: 'test-hide', kind: 'trait' as const, name: 'Test Hide', icon: 'fa-solid fa-shield',
  derived: [], verbose: [], armor: true,
}

function contentWith(withArmor: boolean, withHide: boolean): Content {
  return {
    ...THOCKQUEST,
    items: withArmor ? [PLATE] : [],
    traits: withHide ? [HIDE] : [],
  }
}

const PLAIN = contentWith(false, false)

function runningGame(content: Content = PLAIN): GameSave {
  const started = applyEffect(emptySave(createSeed(1)), { kind: 'startGame' }, content, 1)
  return applyEffects(started, [
    ...(content.items.length > 0 ? [{ kind: 'acquireModifier' as const, modifierKind: 'item' as const, modifierId: content.items[0].id }] : []),
    ...(content.traits.length > 0 ? [{ kind: 'acquireModifier' as const, modifierKind: 'trait' as const, modifierId: content.traits[0].id }] : []),
  ], content, 1)
}

/** What this run's armour templates actually rolled, by pool. */
function armorOfRun(content: Content) {
  const catalog = catalogFor(content, createSeed(1))
  const sum = (kind: 'armorSlot' | 'naturalArmor') => [...catalog.values()]
    .flatMap((modifier) => modifier.effects)
    .reduce((total, effect) => (effect.kind === kind ? total + effect.amount : total), 0)
  return { item: sum('armorSlot'), natural: sum('naturalArmor') }
}

function readoutFor(save: GameSave, key: string, content: Content = PLAIN) {
  return statusReadouts(save, content).find((readout) => readout.key === key)
}

/**
 * Armor is TWO pools that behave differently -- item armor is spent as it
 * absorbs, natural armor cannot be worn away (model/armor.ts) -- so the
 * readout must never collapse them into their sum: a player reading one
 * number cannot tell what a fight is about to cost them.
 */
describe('the armor readout', () => {
  it('shows the item pool with the natural pool in parentheses, never the total', () => {
    // The two numbers are what the run rolled, read back rather than asserted:
    // the property is that they are kept APART, not what they came to.
    const content = contentWith(true, true)
    const armor = armorOfRun(content)
    expect(armor.item).toBeGreaterThan(0)
    expect(armor.natural).toBeGreaterThan(0)
    expect(readoutFor(runningGame(content), 'armor', content)?.value).toBe(`${armor.item}(${armor.natural})`)
  })

  it('is present at zero rather than appearing only once armor exists', () => {
    // It was conditional on a non-zero total once. A readout that appears
    // only when interesting teaches that armor is something that happens to
    // you rather than something you have -- and the row is a status line.
    expect(readoutFor(runningGame(), 'armor')?.value).toBe('0(0)')
  })

  it('keeps the two pools apart when only one of them is filled', () => {
    const natural = contentWith(false, true)
    const items = contentWith(true, false)
    expect(readoutFor(runningGame(natural), 'armor', natural)?.value).toBe(`0(${armorOfRun(natural).natural})`)
    expect(readoutFor(runningGame(items), 'armor', items)?.value).toBe(`${armorOfRun(items).item}(0)`)
  })
})


/**
 * Fame and stat points are one ladder (model/milestones.ts), so the rail's
 * two gauges must read the same way -- progress on the stream's TOTAL, a
 * tally of what has been spent. The fame gauge used to carry no ratio at all
 * because the curve was unwritten; a gauge that silently goes back to
 * drawing nothing is the regression this catches.
 */
describe('the rail gauges', () => {
  it('measures fame against gold EARNED, untouched by what was spent', () => {
    const earned = applyEffect(runningGame(), { kind: 'grantGold', units: 5 }, PLAIN, 1)
    const spent = applyEffect(earned, { kind: 'spendGold', units: 5 }, PLAIN, 1)
    const fameOf = (save: GameSave) => chromeGauges(save).find((gauge) => gauge.key === 'fame')
    // Half way to the first fame point, and buying something with the gold
    // does not undo that -- the whole reason gold is two stored numbers.
    expect(fameOf(earned)?.ratio).toBeCloseTo(0.5, 10)
    expect(fameOf(spent)?.ratio).toBeCloseTo(0.5, 10)
    // ...while the spendable balance really did go. (Asserted against the
    // METER, not a readout: gold left the tab bar for the stats row, and a
    // lookup by the old name would pass by finding nothing.)
    expect(chromeMeters(earned)?.leading?.value).toBe('5')
    expect(chromeMeters(spent)?.leading?.value).toBe('0')
  })

  it('gives both gauges a real ratio and a real tally', () => {
    const gauges = chromeGauges(runningGame())
    expect(gauges.map((gauge) => gauge.key)).toEqual(['fame', 'statPoint'])
    for (const gauge of gauges) {
      expect(gauge.ratio).toBe(0)
      expect(gauge.count).toBe(0)
    }
  })

  it('tallies what is WAITING to be spent, not what has been', () => {
    // The tally sits under a bar that fills toward the next point, and what
    // the reader wants from that column is whether there is anything to do.
    // Spending used to make the number go UP.
    const running = runningGame()
    const earned = applyEffect(running, { kind: 'grantExperience', units: 10 }, PLAIN, 1)
    const statOf = (save: GameSave) => chromeGauges(save).find((gauge) => gauge.key === 'statPoint')
    expect(statOf(earned)?.count).toBe(1)

    const spent = applyEffect(earned, { kind: 'allocateStatPoint' }, PLAIN, 1)
    expect(statOf(spent)?.count).toBe(0)

    // Fame is the same ladder and reads the same way, which it could not do
    // at all while "points in hand" was a counter nothing incremented.
    const famous = applyEffect(running, { kind: 'grantGold', units: 10 }, PLAIN, 1)
    expect(chromeGauges(famous).find((gauge) => gauge.key === 'fame')?.count).toBe(1)
  })

  it('carries a way in whether or not anything is waiting', () => {
    // A control that appears only when it is useful is one the player cannot
    // go looking for, and both screens are worth reading empty.
    const opened: string[] = []
    const gauges = chromeGauges(runningGame(), (key) => opened.push(key))
    for (const gauge of gauges) {
      expect(gauge.ratio).toBe(0)
      gauge.action?.onActivate()
    }
    expect(opened).toEqual(['fame', 'statPoint'])
    // The VERB, not the noun the bar measures: it is what a button is named.
    expect(gauges.map((gauge) => gauge.action?.label)).toEqual(['Open your renown', 'Spend a stat point'])
  })

  it('is a readout, not a button, when nobody is listening', () => {
    for (const gauge of chromeGauges(runningGame())) {
      expect(gauge.action).toBeUndefined()
    }
  })
})

/**
 * The identity box answers "which one is this" -- and for a run that is two
 * numbers, not one: a level is ten encounters and neither half locates you
 * without the other.
 */
describe('the identity line', () => {
  it('reads level-encounter, roman then arabic', () => {
    expect(chromeIdentity(runningGame(), 'Wilds')).toBe('I-1 [Wilds]')
  })

  it('moves to the encounter being PREPARED for, the moment the last is behind', () => {
    const running = runningGame()
    const next = applyEffect(running, { kind: 'advanceEncounter' }, PLAIN, 1)
    expect(chromeIdentity(next, 'Wilds')).toBe('I-2 [Wilds]')
  })

  it('never shows the eleventh, which is a sequencing fact rather than a place', () => {
    let save = runningGame()
    for (let step = 0; step < 10; step += 1) {
      save = applyEffect(save, { kind: 'advanceEncounter' }, PLAIN, 1)
    }
    expect(chromeIdentity(save, 'Wilds')).toBe('I-10 [Wilds]')
  })

  it('says nothing about where when there is no run', () => {
    expect(chromeIdentity(emptySave(createSeed(1)), 'ThockQuest')).toBe('[ThockQuest]')
  })
})

/**
 * A stat point waiting is reported by the rail's star gauge, under the bar
 * that fills toward the next one. It used to ALSO be a readout on the tab
 * bar, which is the same number in two places on one chrome.
 */
describe('the readouts', () => {
  it('does not repeat the star gauge on the tab bar', () => {
    const earned = applyEffect(runningGame(), { kind: 'grantExperience', units: 10 }, PLAIN, 1)
    expect(chromeGauges(earned).find((gauge) => gauge.key === 'statPoint')?.count).toBe(1)
    expect(readoutFor(earned, 'points')).toBeUndefined()
  })
})

describe('who the player is, on the bar', () => {
  it('reads the tier as the value and the three vectors as its tooltip', () => {
    // The gap this closes: a run picks a build, a species and a class at
    // creation and then had no way to see any of them again -- nor its tier,
    // which fame can buy up and nothing showed.
    const save = withVectors(createdRun({ seed: 77 }), {
      build: 'hulking',
      species: 'mertok',
      combatClass: 'duelist',
    })
    const tier = statusReadouts(save, THOCKQUEST).find((readout) => readout.key === 'tier')
    expect(tier).toBeDefined()
    expect(tier?.value).toBe(String(BASE_PLAYER_TIER))
    expect(tier?.label).toBe('Tier -- Hulking Mertok Duelist')
  })

  it('names only what has been chosen, because creation asks one at a time', () => {
    // A half-answered character is a real state, not a broken one, so a
    // vector not yet picked is LEFT OUT rather than replaced with a word.
    const save = withVectors(createdRun({ seed: 77 }), { build: 'hulking' })
    const bare = { ...save, games: save.games.map((game) => ({ ...game, speciesId: null, classId: null })) }
    const tier = statusReadouts(bare, THOCKQUEST).find((readout) => readout.key === 'tier')
    expect(tier?.label).toBe('Tier -- Hulking')
  })

  it('sits directly above the stats it was apportioned into', () => {
    // The pill and the row under it are one sentence: this budget produced
    // these numbers. A reader who has to hunt for the tier cannot read it
    // that way.
    const keys = statusReadouts(createdRun({ seed: 77 }), THOCKQUEST).map((readout) => readout.key)
    expect(keys.indexOf('tier')).toBe(keys.indexOf('might') - 1)
    for (const stat of STAT_KEYS) expect(keys).toContain(stat)
  })
})

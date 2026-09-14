import { describe, expect, it } from 'vitest'

import { applyEffect, emptySave, type GameSave } from './model/gameState'
import { chromeGauges, chromeIdentity, chromeMeters, statusReadouts } from './chrome'
import type { Modifier } from './model/modifiers'
import { createSeed } from './core/rng'

const NO_CATALOG: ReadonlyMap<string, Modifier> = new Map()

function runningGame(armor: { fromItems: number; natural: number }): GameSave {
  const started = applyEffect(emptySave(createSeed(1)), { kind: 'startGame' }, NO_CATALOG, 1)
  return applyEffect(started, { kind: 'setArmor', ...armor }, NO_CATALOG, 1)
}

function readoutFor(save: GameSave, key: string) {
  return statusReadouts(save, NO_CATALOG).find((readout) => readout.key === key)
}

/**
 * Armor is TWO pools that behave differently -- item armor is spent as it
 * absorbs, natural armor cannot be worn away (model/armor.ts) -- so the
 * readout must never collapse them into their sum: a player reading one
 * number cannot tell what a fight is about to cost them.
 */
describe('the armor readout', () => {
  it('shows the item pool with the natural pool in parentheses, never the total', () => {
    expect(readoutFor(runningGame({ fromItems: 9, natural: 2 }), 'armor')?.value).toBe('9(2)')
  })

  it('is present at zero rather than appearing only once armor exists', () => {
    // It was conditional on a non-zero total once. A readout that appears
    // only when interesting teaches that armor is something that happens to
    // you rather than something you have -- and the row is a status line.
    expect(readoutFor(runningGame({ fromItems: 0, natural: 0 }), 'armor')?.value).toBe('0(0)')
  })

  it('keeps the two pools apart when only one of them is filled', () => {
    expect(readoutFor(runningGame({ fromItems: 0, natural: 3 }), 'armor')?.value).toBe('0(3)')
    expect(readoutFor(runningGame({ fromItems: 4, natural: 0 }), 'armor')?.value).toBe('4(0)')
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
    const earned = applyEffect(runningGame({ fromItems: 0, natural: 0 }), { kind: 'grantGold', units: 5 }, NO_CATALOG, 1)
    const spent = applyEffect(earned, { kind: 'spendGold', units: 5 }, NO_CATALOG, 1)
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
    const gauges = chromeGauges(runningGame({ fromItems: 0, natural: 0 }))
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
    const running = runningGame({ fromItems: 0, natural: 0 })
    const earned = applyEffect(running, { kind: 'grantExperience', units: 10 }, NO_CATALOG, 1)
    const statOf = (save: GameSave) => chromeGauges(save).find((gauge) => gauge.key === 'statPoint')
    expect(statOf(earned)?.count).toBe(1)

    const spent = applyEffect(earned, { kind: 'allocateStatPoint' }, NO_CATALOG, 1)
    expect(statOf(spent)?.count).toBe(0)

    // Fame is the same ladder and reads the same way, which it could not do
    // at all while "points in hand" was a counter nothing incremented.
    const famous = applyEffect(running, { kind: 'grantGold', units: 10 }, NO_CATALOG, 1)
    expect(chromeGauges(famous).find((gauge) => gauge.key === 'fame')?.count).toBe(1)
  })

  it('carries a way in whether or not anything is waiting', () => {
    // A control that appears only when it is useful is one the player cannot
    // go looking for, and both screens are worth reading empty.
    const opened: string[] = []
    const gauges = chromeGauges(runningGame({ fromItems: 0, natural: 0 }), (key) => opened.push(key))
    for (const gauge of gauges) {
      expect(gauge.ratio).toBe(0)
      gauge.action?.onActivate()
    }
    expect(opened).toEqual(['fame', 'statPoint'])
    // The VERB, not the noun the bar measures: it is what a button is named.
    expect(gauges.map((gauge) => gauge.action?.label)).toEqual(['Open your renown', 'Spend a stat point'])
  })

  it('is a readout, not a button, when nobody is listening', () => {
    for (const gauge of chromeGauges(runningGame({ fromItems: 0, natural: 0 }))) {
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
    expect(chromeIdentity(runningGame({ fromItems: 0, natural: 0 }), 'Wilds')).toBe('I-1 [Wilds]')
  })

  it('moves to the encounter being PREPARED for, the moment the last is behind', () => {
    const running = runningGame({ fromItems: 0, natural: 0 })
    const next = applyEffect(running, { kind: 'advanceEncounter' }, NO_CATALOG, 1)
    expect(chromeIdentity(next, 'Wilds')).toBe('I-2 [Wilds]')
  })

  it('never shows the eleventh, which is a sequencing fact rather than a place', () => {
    let save = runningGame({ fromItems: 0, natural: 0 })
    for (let step = 0; step < 10; step += 1) {
      save = applyEffect(save, { kind: 'advanceEncounter' }, NO_CATALOG, 1)
    }
    expect(chromeIdentity(save, 'Wilds')).toBe('I-10 [Wilds]')
  })

  it('says nothing about where when there is no run', () => {
    expect(chromeIdentity(emptySave(createSeed(1)), 'Thockquest')).toBe('[Thockquest]')
  })
})

/**
 * A stat point waiting is reported by the rail's star gauge, under the bar
 * that fills toward the next one. It used to ALSO be a readout on the tab
 * bar, which is the same number in two places on one chrome.
 */
describe('the readouts', () => {
  it('does not repeat the star gauge on the tab bar', () => {
    const earned = applyEffect(runningGame({ fromItems: 0, natural: 0 }), { kind: 'grantExperience', units: 10 }, NO_CATALOG, 1)
    expect(chromeGauges(earned).find((gauge) => gauge.key === 'statPoint')?.count).toBe(1)
    expect(readoutFor(earned, 'points')).toBeUndefined()
  })
})

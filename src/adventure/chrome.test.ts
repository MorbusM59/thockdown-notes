import { describe, expect, it } from 'vitest'

import { applyEffect, emptySave, type GameSave } from './model/gameState'
import { chromeGauges, chromeMeters, statusReadouts } from './chrome'
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
})

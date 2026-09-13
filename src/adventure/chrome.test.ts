import { describe, expect, it } from 'vitest'

import { applyEffect, emptySave, type GameSave } from './model/gameState'
import { statusReadouts } from './chrome'
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

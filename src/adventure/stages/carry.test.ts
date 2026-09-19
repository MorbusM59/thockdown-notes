import { describe, expect, it } from 'vitest'

import { catalogFor, rolledPool, THOCKQUEST } from '../content'
import { emptySave } from '../model/gameState'
import { NO_ARMOR } from '../model/armor'
import { resolveProfile } from '../model/modifiers'
import { createStatBlock } from '../model/stats'
import type { StageContext } from '../core/stage'
import { DROP_CANCEL, dropChoices, dropEffects } from './carry'

const CATALOG = catalogFor(THOCKQUEST, 0)

function contextHolding(ids: readonly string[]): StageContext {
  const held = ids.flatMap((id) => {
    const modifier = CATALOG.get(id)
    return modifier ? [modifier] : []
  })
  return {
    save: emptySave(1),
    game: null,
    content: THOCKQUEST,
    catalog: CATALOG,
    items: rolledPool(THOCKQUEST, 0, 'item'),
    traits: rolledPool(THOCKQUEST, 0, 'trait'),
    armor: NO_ARMOR,
    describe: 'verbose',
    profile: resolveProfile(createStatBlock(0), held, { items: 0, traits: 0 }),
    held,
  }
}

describe('the question when your hands are full', () => {
  it('names the ACT, and the act differs by kind', () => {
    // The ring's centre shows this label and nothing else while the dial sits
    // on the cell, so a list of the things you are carrying -- on a screen
    // that follows a purchase -- would read as a second offer. The verb is
    // the only thing that says which way round the question is.
    const items = dropChoices(contextHolding(['whetstone']), 'item', 'iron-buckler')
    expect(items[0].label).toBe('Drop Whetstone')

    const traits = dropChoices(contextHolding(['second-skin']), 'trait', 'opportunist')
    expect(traits[0].label).toBe('Lose Second Skin')
  })

  it('offers a way back, naming what would be left behind', () => {
    const choices = dropChoices(contextHolding(['whetstone']), 'item', 'iron-buckler')
    expect(choices[choices.length - 1].id).toBe(DROP_CANCEL)
    expect(choices[choices.length - 1].label).toBe('Leave Iron Buckler')
  })

  it('gives up the one chosen BEFORE taking the new one', () => {
    // The other order would be the fourth of three, and the limit is a rule
    // about what a player may choose to hold rather than a guard buried in
    // the effect that applies it.
    expect(dropEffects('item', 'drop:whetstone', 'iron-buckler')).toEqual([
      { kind: 'releaseModifier', modifierKind: 'item', modifierId: 'whetstone' },
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'iron-buckler' },
    ])
  })

  it('reads a cancel as no effects at all, not as a drop of nothing', () => {
    expect(dropEffects('item', DROP_CANCEL, 'iron-buckler')).toBeNull()
  })
})

// Armor belongs to the ITEM, and the three moments that move it.
//
// The rule these are for is one sentence -- "armor points are tracked by the
// item, not the player; drop the item and its armor goes with it" -- and every
// way of getting it wrong is silent. A pool on the record would have had to
// guess how much of itself a dropped shield took; a maximum stored in the save
// would drift from what the item is in this run; a repair applied at the wrong
// moment would either never fire or fire twice.

import { describe, expect, it } from 'vitest'

import { itemArmor, maintainedFraction, totalArmor } from './armor'
import { activeGame, applyEffects, armorIn, emptySave, type GameSave } from './gameState'
import { THOCKQUEST, type Content } from '../content'
import type { Effect } from './effects'

const NOW = 1_700_000_000_000

/**
 * Content with ONE armour item and nothing else to confuse the arithmetic.
 * The armor range is a single value, so what it rolls is known in every run
 * without the test having to reach into the roller (model/itemSlots.ts).
 */
function contentWithPlate(max: number, extra: Content['items'] = []): Content {
  return {
    ...THOCKQUEST,
    items: [
      { id: 'plate', name: 'Plate', icon: 'fa-solid fa-shield', stats: [], derived: [], verbose: [], armor: [max, max] },
      ...extra,
    ],
    traits: [],
  }
}

function running(content: Content, effects: readonly Effect[] = []): GameSave {
  const started = applyEffects(emptySave(4242), [{ kind: 'startGame' }], content, NOW)
  return applyEffects(started, effects, content, NOW)
}

const armorOf = (save: GameSave, content: Content) => {
  const game = activeGame(save)
  if (!game) throw new Error('no game')
  return armorIn(save, game, content)
}

describe('an item that carries armor', () => {
  it('arrives whole, with nothing written to the save to say so', () => {
    const content = contentWithPlate(10)
    const save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    expect(itemArmor(armorOf(save, content))).toBe(10)
    // ABSENT MEANS FULL. A row written the moment something is acquired and a
    // row written before this field existed mean the same thing, so the
    // widening and the default are one value rather than two.
    expect(save.holdings[0].armorPoints).toBeUndefined()
  })

  it('takes its points with it when it is dropped, and comes back whole', () => {
    const content = contentWithPlate(10)
    let save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    save = applyEffects(save, [{ kind: 'setArmor', pieces: [{ itemId: 'plate', points: 2 }] }], content, NOW)
    expect(itemArmor(armorOf(save, content))).toBe(2)

    const dropped = applyEffects(save, [{ kind: 'releaseModifier', modifierKind: 'item', modifierId: 'plate' }], content, NOW)
    expect(totalArmor(armorOf(dropped, content))).toBe(0)

    // A plate found in the next chest is a WHOLE plate, not the battered one's
    // points in a new shape -- which is true here by construction rather than
    // by a correction, because the row that held them is gone.
    const again = applyEffects(dropped, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }], content, NOW)
    expect(itemArmor(armorOf(again, content))).toBe(10)
  })

  it('keeps its own pool when another armour item is carried beside it', () => {
    const content = contentWithPlate(10, [
      { id: 'bracer', name: 'Bracer', icon: 'fa-solid fa-shield', stats: [], derived: [], verbose: [], armor: [4, 4] },
    ])
    let save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'bracer' },
    ])
    save = applyEffects(save, [{ kind: 'setArmor', pieces: [{ itemId: 'plate', points: 1 }] }], content, NOW)
    const pieces = new Map(armorOf(save, content).pieces.map((piece) => [piece.itemId, piece.points]))
    expect(pieces.get('plate')).toBe(1)
    expect(pieces.get('bracer')).toBe(4)
  })
})

/**
 * THE REPAIR IS WHERE THE ENCOUNTER IS SPENT, not in an effect of its own:
 * `advanceEncounter` is exactly the moment "after the fight" names, and every
 * stage that ends an encounter already emits it. A second effect beside it
 * would be a second statement of the same moment, and the stage that forgot to
 * emit it would be the one nobody noticed.
 */
describe('between fights', () => {
  it('brings each piece up to what Might and Intellect maintain, and no further', () => {
    const content = contentWithPlate(10)
    let save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    save = applyEffects(save, [
      { kind: 'adjustBaseStat', stat: 'might', amount: 2 },
      { kind: 'adjustBaseStat', stat: 'intellect', amount: 2 },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 0 }] },
    ], content, NOW)
    expect(maintainedFraction(2, 2)).toBeCloseTo(0.2)

    const rested = applyEffects(save, [{ kind: 'advanceEncounter' }], content, NOW)
    expect(itemArmor(armorOf(rested, content))).toBe(2)

    // And a piece already above the line keeps what it has: this tops up, it
    // never trims.
    const healthy = applyEffects(save, [
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 9 }] },
      { kind: 'advanceEncounter' },
    ], content, NOW)
    expect(itemArmor(armorOf(healthy, content))).toBe(9)
  })

  it('repairs nothing at all for a character with neither stat', () => {
    const content = contentWithPlate(10)
    const save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 3 }] },
      { kind: 'advanceEncounter' },
    ])
    expect(itemArmor(armorOf(save, content))).toBe(3)
  })

  it('adds what the kit itself repairs on top of the maintained line', () => {
    const content = {
      ...contentWithPlate(10),
      traits: [{
        id: 'tinker',
        kind: 'trait' as const,
        name: 'Tinker',
        icon: '',
        effects: [{ kind: 'armorRepairAfterCombat' as const, amount: 3 }],
      }],
    }
    const save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'tinker' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 0 }] },
      { kind: 'advanceEncounter' },
    ])
    expect(itemArmor(armorOf(save, content))).toBe(3)
  })
})

describe('a new level', () => {
  it('makes everything carried over whole again', () => {
    const content = contentWithPlate(10)
    const save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 1 }] },
    ])
    const onward = applyEffects(save, [{ kind: 'advanceLevel' }], content, NOW)
    // It survived (nothing was marked, so the newest find is kept) and it is
    // full: a level is a journey with a rest at either end.
    expect(onward.holdings.map((row) => row.modifierId)).toEqual(['plate'])
    expect(itemArmor(armorOf(onward, content))).toBe(10)
  })
})

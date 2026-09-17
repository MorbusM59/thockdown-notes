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
import { armorSlotOf } from './modifiers'
import { catalogFor, THOCKQUEST, type Content } from '../content'
import { createSeed } from '../core/rng'
import type { Effect } from './effects'

const NOW = 1_700_000_000_000

/**
 * Content with ONE armour item and nothing else to confuse the arithmetic.
 *
 * HOW MUCH it rolls is not the test's to choose -- one range per slot, not one
 * per template (model/modifierSlots.ts) -- so every expectation below is
 * computed from what the run actually rolled (`maxOf`). Writing the number
 * down here would be re-asserting the roller's range in a file about the
 * armor lifecycle, and would go stale the first time that range moved.
 */
const PLATE = {
  id: 'plate', kind: 'item' as const, name: 'Plate', icon: 'fa-solid fa-shield',
  stats: [], derived: [], verbose: [], armor: true,
}

function contentWithPlate(extra: Content['items'] = []): Content {
  return { ...THOCKQUEST, items: [PLATE, ...extra], traits: [] }
}

/** What an armour template rolled in the run these tests play. */
function maxOf(content: Content, id = 'plate'): number {
  const rolled = catalogFor(content, createSeed(NOW))
  const slot = armorSlotOf(rolled.get(id) ?? { id, kind: 'item', name: '', icon: '', effects: [] })
  if (!slot) throw new Error(`${id} rolled no armor`)
  return slot.amount
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
    const content = contentWithPlate()
    const save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    expect(itemArmor(armorOf(save, content))).toBe(maxOf(content))
    // ABSENT MEANS FULL. A row written the moment something is acquired and a
    // row written before this field existed mean the same thing, so the
    // widening and the default are one value rather than two.
    expect(save.holdings[0].armorPoints).toBeUndefined()
  })

  it('takes its points with it when it is dropped, and comes back whole', () => {
    const content = contentWithPlate()
    let save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    save = applyEffects(save, [{ kind: 'setArmor', pieces: [{ itemId: 'plate', points: 2 }] }], content, NOW)
    expect(itemArmor(armorOf(save, content))).toBe(2)

    const dropped = applyEffects(save, [{ kind: 'releaseModifier', modifierKind: 'item', modifierId: 'plate' }], content, NOW)
    expect(totalArmor(armorOf(dropped, content))).toBe(0)

    // A plate found in the next chest is a WHOLE plate, not the battered one's
    // points in a new shape -- which is true here by construction rather than
    // by a correction, because the row that held them is gone.
    const again = applyEffects(dropped, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }], content, NOW)
    expect(itemArmor(armorOf(again, content))).toBe(maxOf(content))
  })

  it('keeps its own pool when another armour item is carried beside it', () => {
    const content = contentWithPlate([
      { ...PLATE, id: 'bracer', name: 'Bracer' },
    ])
    let save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'bracer' },
    ])
    save = applyEffects(save, [{ kind: 'setArmor', pieces: [{ itemId: 'plate', points: 1 }] }], content, NOW)
    const pieces = new Map(armorOf(save, content).pieces.map((piece) => [piece.itemId, piece.points]))
    expect(pieces.get('plate')).toBe(1)
    // Untouched, and NOT the same number as the plate's: two pieces, two pools.
    expect(pieces.get('bracer')).toBe(maxOf(content, 'bracer'))
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
    const content = contentWithPlate()
    const max = maxOf(content)
    // Six apiece is the base stat cap, so this is the most a character can
    // maintain: 60% of the piece, and the arithmetic below is legible at it.
    const maintained = Math.floor(max * maintainedFraction(6, 6))
    expect(maintained).toBeGreaterThan(0)

    let save = running(content, [{ kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' }])
    save = applyEffects(save, [
      { kind: 'adjustBaseStat', stat: 'might', amount: 6 },
      { kind: 'adjustBaseStat', stat: 'intellect', amount: 6 },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 0 }] },
    ], content, NOW)

    const rested = applyEffects(save, [{ kind: 'advanceEncounter' }], content, NOW)
    expect(itemArmor(armorOf(rested, content))).toBe(maintained)

    // And a piece already above the line keeps what it has: this tops up, it
    // never trims.
    const healthy = applyEffects(save, [
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: max }] },
      { kind: 'advanceEncounter' },
    ], content, NOW)
    expect(itemArmor(armorOf(healthy, content))).toBe(max)
  })

  it('repairs nothing at all for a character with neither stat', () => {
    const content = contentWithPlate()
    const save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 1 }] },
      { kind: 'advanceEncounter' },
    ])
    expect(maintainedFraction(0, 0)).toBe(0)
    expect(itemArmor(armorOf(save, content))).toBe(1)
  })

  it('adds what the kit itself repairs on top of the maintained line', () => {
    // A trait whose only slot can be filled is the repair, so it rolls one.
    const content = {
      ...contentWithPlate(),
      traits: [{
        id: 'tinker', kind: 'trait' as const, name: 'Tinker', icon: '',
        derived: [], verbose: ['repair' as const, 'ward' as const],
      }],
    }
    const withTinker = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'tinker' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 0 }] },
      { kind: 'advanceEncounter' },
    ])
    const without = running(contentWithPlate(), [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 0 }] },
      { kind: 'advanceEncounter' },
    ])
    // At no Might and no Intellect the maintained line is zero, so everything
    // that came back is the kit's own repair.
    expect(itemArmor(armorOf(without, contentWithPlate()))).toBe(0)
    expect(itemArmor(armorOf(withTinker, content))).toBeGreaterThan(0)
  })
})

describe('a new level', () => {
  it('makes everything carried over whole again', () => {
    const content = contentWithPlate()
    const save = running(content, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'plate' },
      { kind: 'setArmor', pieces: [{ itemId: 'plate', points: 1 }] },
    ])
    const onward = applyEffects(save, [{ kind: 'advanceLevel' }], content, NOW)
    // It survived (nothing was marked, so the newest find is kept) and it is
    // full: a level is a journey with a rest at either end.
    expect(onward.holdings.map((row) => row.modifierId)).toEqual(['plate'])
    expect(itemArmor(armorOf(onward, content))).toBe(maxOf(content))
  })
})

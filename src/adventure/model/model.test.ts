import { describe, expect, it } from 'vitest'
import { absorb, itemArmor, maintainedFraction, pieceOf, refillArmor, repairAfterFight, totalArmor, type Armor } from './armor'
import { describeEffect, resolveProfile, type Modifier } from './modifiers'
import { createStatBlock } from './stats'
import { resolveCheck, tierForMargin } from './checks'

const noHoldings = { items: 0, traits: 0 }

describe('stat resolution', () => {
  it('caps BASE stats at six but lets modifiers carry past it', () => {
    const base = { ...createStatBlock(0), perception: 9 }
    const spyglass: Modifier = {
      id: 'spyglass',
      kind: 'item',
      name: 'Spyglass',
      icon: '',
      effects: [{ kind: 'statDelta', stat: 'perception', amount: 2 }],
    }
    // Six from the cap, then two from the item: the whole reason the cap is
    // applied in one documented place rather than wherever stats are read.
    expect(resolveProfile(base, [spyglass], noHoldings).stats.perception).toBe(8)
  })

  it('scales a derived value by what is held, recomputed rather than remembered', () => {
    const collector: Modifier = {
      id: 'avid-collector',
      kind: 'trait',
      name: 'Avid Collector',
      icon: '',
      effects: [{ kind: 'derivedPercentPerHolding', derived: 'damageMultiplier', percentPer: 0.1, holding: 'item' }],
    }
    const base = createStatBlock(0)
    const none = resolveProfile(base, [collector], { items: 0, traits: 1 }).derived.damageMultiplier
    const three = resolveProfile(base, [collector], { items: 3, traits: 1 }).derived.damageMultiplier
    expect(three).toBeCloseTo(none * 1.3)
  })

  it('describes an effect with the number it currently has, not the one it was written with', () => {
    const line = describeEffect(
      { kind: 'derivedPercentPerHolding', derived: 'damageMultiplier', percentPer: 0.1, holding: 'item' },
      { items: 3, traits: 0 },
      'verbose',
    )
    // The tab bar shows this string. If it said only "+10% per item" the
    // player would have to do the arithmetic the game already did.
    expect(line).toContain('+10%')
    expect(line).toContain('3 held')
  })

  it('keeps counts whole and chances inside 0..1 after modifiers have had their say', () => {
    const absurd: Modifier = {
      id: 'absurd',
      kind: 'item',
      name: 'Absurd',
      icon: '',
      effects: [
        { kind: 'derivedPercent', derived: 'critChance', percent: 5 },
        { kind: 'derivedPercent', derived: 'encounterChoices', percent: 0.25 },
      ],
    }
    const derived = resolveProfile(createStatBlock(1), [absurd], noHoldings).derived
    expect(derived.critChance).toBe(1)
    expect(Number.isInteger(derived.encounterChoices)).toBe(true)
  })
})

describe('armor', () => {
  const plate: Modifier = {
    id: 'plate',
    kind: 'item',
    name: 'Plate',
    icon: '',
    effects: [{ kind: 'armorSlot', amount: 8 }],
  }
  const tempered: Modifier = {
    id: 'tempered',
    kind: 'item',
    name: 'Tempered Plate',
    icon: '',
    effects: [{ kind: 'armorSlot', amount: 4 }, { kind: 'armorDecayFloor', floor: 2 }],
  }
  const hide: Modifier = {
    id: 'hide',
    kind: 'trait',
    name: 'Thick Hide',
    icon: '',
    effects: [{ kind: 'naturalArmor', amount: 2 }],
  }

  const armorOf = (pieces: readonly Modifier[], natural = 0): Armor => ({
    natural,
    pieces: pieces.flatMap((modifier) => pieceOf(modifier) ?? []),
  })

  /**
   * A piece arrives FULL and its maximum is a property of the item, never of
   * the save -- which is what makes "drop it and its armor goes with it" true
   * with nothing to correct.
   */
  it('gives an item its own pool, full, read from what the item is', () => {
    expect(pieceOf(plate)).toEqual({ itemId: 'plate', points: 8, max: 8, floor: 0 })
    expect(pieceOf(hide)).toBeNull()
  })

  it('reduces damage by the whole shield, every pool together', () => {
    const result = absorb(armorOf([tempered], 2), 8, 0, 1)
    expect(result.absorbed).toBe(6)
    expect(result.damage).toBe(2)
  })

  it('never decays when it did not actually stop anything', () => {
    // Luck 0 makes survival unlikely, so a decay here would be a real one.
    const untested = absorb(armorOf([plate]), 0, 0, 11)
    expect(untested.decayed).toBe(false)
    expect(itemArmor(untested.armor)).toBe(8)
  })

  it('wears down only what items granted, never natural armor', () => {
    let armor = armorOf([plate], 2)
    let rng = 5
    for (let index = 0; index < 200; index += 1) {
      const result = absorb(armor, 4, 0, rng)
      armor = result.armor
      rng = result.rng
    }
    expect(itemArmor(armor)).toBe(0)
    expect(armor.natural).toBe(2)
    expect(totalArmor(armor)).toBe(2)
  })

  it('stops decaying at the floor the item itself carries', () => {
    let armor = armorOf([tempered])
    let rng = 5
    for (let index = 0; index < 200; index += 1) {
      const result = absorb(armor, 4, 0, rng)
      armor = result.armor
      rng = result.rng
    }
    expect(armor.pieces[0].points).toBe(2)
  })

  /**
   * WEAR IS SPREAD, not concentrated: the fullest eligible piece takes the
   * point. Concentrating it would let a big shield rot to nothing beside a
   * pristine bracer, which would make repair -- a share of each piece's own
   * maximum -- mean something different for every kit.
   */
  it('wears the fullest piece, so a kit wears evenly', () => {
    const small: Modifier = { id: 'small', kind: 'item', name: 'Small', icon: '', effects: [{ kind: 'armorSlot', amount: 2 }] }
    let armor = armorOf([plate, small])
    let rng = 5
    for (let index = 0; index < 40; index += 1) {
      const result = absorb(armor, 4, 0, rng)
      armor = result.armor
      rng = result.rng
    }
    const points = new Map(armor.pieces.map((piece) => [piece.itemId, piece.points]))
    // The eight-point piece has to come down to the two-point one before that
    // one is touched at all.
    expect(points.get('plate')).toBeLessThanOrEqual(2)
    expect(points.get('small')! - points.get('plate')!).toBeLessThanOrEqual(1)
  })

  /**
   * THE REPAIR IS A CEILING, NOT A TOP-UP. `(Might + Intellect) / 20` of each
   * piece's maximum is the condition the character can maintain: below it, a
   * fight's wear is undone; above it, nothing happens at all.
   */
  it('brings each piece up to what its owner can maintain, and no further', () => {
    expect(maintainedFraction(2, 2)).toBeCloseTo(0.2)
    const worn: Armor = { natural: 0, pieces: [{ itemId: 'plate', points: 0, max: 10, floor: 0 }] }
    expect(repairAfterFight(worn, 2, 2).pieces[0].points).toBe(2)

    const healthy: Armor = { natural: 0, pieces: [{ itemId: 'plate', points: 9, max: 10, floor: 0 }] }
    expect(repairAfterFight(healthy, 2, 2).pieces[0].points).toBe(9)
  })

  it('adds what the kit repairs on top of the maintained line, capped at whole', () => {
    const worn: Armor = { natural: 0, pieces: [{ itemId: 'plate', points: 0, max: 10, floor: 0 }] }
    expect(repairAfterFight(worn, 2, 2, 3).pieces[0].points).toBe(5)
    const nearly: Armor = { natural: 0, pieces: [{ itemId: 'plate', points: 9, max: 10, floor: 0 }] }
    expect(repairAfterFight(nearly, 2, 2, 3).pieces[0].points).toBe(10)
  })

  it('makes everything whole again at a new level', () => {
    const worn: Armor = { natural: 0, pieces: [{ itemId: 'plate', points: 1, max: 10, floor: 0 }] }
    expect(refillArmor(worn).pieces[0].points).toBe(10)
  })
})

describe('stat checks', () => {
  it('treats the die as the opposition: the stat must match or beat roll + rating', () => {
    // A stat of 6 against DR 0 cannot fail, because the die alone never
    // exceeds 6. The inverse convention would make this a coin flip.
    let rng = 1
    for (let index = 0; index < 200; index += 1) {
      const result = resolveCheck(6, 0, rng)
      rng = result.rng
      expect(result.passed).toBe(true)
    }
  })

  it('cannot be passed at all at a rating of six', () => {
    let rng = 1
    for (let index = 0; index < 200; index += 1) {
      const result = resolveCheck(6, 6, rng)
      rng = result.rng
      expect(result.passed).toBe(false)
    }
  })

  it('reports how well it went, for content that reads in degrees', () => {
    expect(tierForMargin(-1)).toBe('failed')
    expect(tierForMargin(0)).toBe('marginal')
    expect(tierForMargin(2)).toBe('solid')
    expect(tierForMargin(5)).toBe('complete')
  })
})

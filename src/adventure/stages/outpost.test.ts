import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, BASE_CARRY_LIMIT, emptySave, type GameSave } from '../model/gameState'
import { goldBalance } from '../model/gold'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { MARKET_OFFER_COUNT, MARKET_PRICE } from './market'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}
const NOW = 1_700_000_000_000

const screenOf = (save: GameSave) => {
  const screen = currentScreen(save, DEPS)
  if (!screen) throw new Error('no screen')
  return screen
}
const ids = (save: GameSave) => screenOf(save).choices.map((choice) => choice.id)

/** A run standing on the road, having chosen an origin, a trait and an item. */
function onTheRoad(seed = 4242): GameSave {
  let save = choose(enterEntryScreen(emptySave(seed), DEPS, NOW), 'welcome:start', DEPS, NOW).save
  save = choose(save, 'origin:warrior', DEPS, NOW).save
  for (let step = 0; step < 2; step += 1) save = choose(save, screenOf(save).choices[0].id, DEPS, NOW).save
  if (screenOf(save).stageId !== 'regionSelect') throw new Error('not on the road')
  return save
}

const withPurse = (save: GameSave, gold: number, motes: number) => applyEffects(save, [
  ...(gold > 0 ? [{ kind: 'grantGold' as const, units: gold }] : []),
  ...(motes > 0 ? [{ kind: 'grantExperience' as const, units: motes }] : []),
], DEPS.catalog, NOW)

const takeRoad = (save: GameSave) => choose(save, screenOf(save).choices[0].id, DEPS, NOW).save

describe('the outpost', () => {
  it('is skipped entirely when there is nothing to spend', () => {
    // An outpost you can only walk through is a screen that asks nothing.
    expect(screenOf(takeRoad(onTheRoad())).stageId).toBe('encounterSelect')
  })

  it('stands between the road and the level once either purse can afford one', () => {
    expect(screenOf(takeRoad(withPurse(onTheRoad(), MARKET_PRICE, 0))).stageId).toBe('outpost')
    expect(screenOf(takeRoad(withPurse(onTheRoad(), 0, MARKET_PRICE))).stageId).toBe('outpost')
    // One short of the price is nothing to spend.
    expect(screenOf(takeRoad(withPurse(onTheRoad(), MARKET_PRICE - 1, 0))).stageId).toBe('encounterSelect')
  })

  it('offers only the face whose purse can pay it', () => {
    const rich = takeRoad(withPurse(onTheRoad(), MARKET_PRICE, 0))
    expect(ids(rich)).toEqual(['outpost:trader', 'outpost:camp'])

    const wise = takeRoad(withPurse(onTheRoad(), 0, MARKET_PRICE))
    expect(ids(wise)).toEqual(['outpost:oracle', 'outpost:camp'])

    const both = takeRoad(withPurse(onTheRoad(), MARKET_PRICE, MARKET_PRICE))
    expect(ids(both)).toEqual(['outpost:trader', 'outpost:oracle', 'outpost:camp'])
  })

  it('moves on to camp, which is the hub', () => {
    const save = choose(takeRoad(withPurse(onTheRoad(), MARKET_PRICE, 0)), 'outpost:camp', DEPS, NOW).save
    expect(screenOf(save).stageId).toBe('encounterSelect')
  })
})

describe('the trader', () => {
  const visit = (gold: number) =>
    choose(takeRoad(withPurse(onTheRoad(), gold, 0)), 'outpost:trader', DEPS, NOW).save

  it('lays out six, and a way out', () => {
    const save = visit(MARKET_PRICE * 3)
    const offers = ids(save).filter((id) => id.startsWith('buy:'))
    expect(offers).toHaveLength(MARKET_OFFER_COUNT)
    expect(ids(save)).toContain('market:leave')
  })

  it('takes the price, hands over the thing, and spends the offer', () => {
    const save = visit(MARKET_PRICE * 2)
    const buying = ids(save).find((id) => id.startsWith('buy:'))
    if (!buying) throw new Error('nothing on offer')
    const bought = choose(save, buying, DEPS, NOW).save
    const game = activeGame(bought)
    if (!game) throw new Error('no game')

    expect(game.goldSpentOnItems).toBe(MARKET_PRICE)
    expect(goldBalance(game.goldEarned, game.goldSpentOnItems)).toBe(MARKET_PRICE)
    expect(bought.holdings.map((row) => row.modifierId)).toContain(buying.slice('buy:'.length))
    // Bought is gone from the table: what is laid out is what is laid out.
    expect(ids(bought)).not.toContain(buying)
    expect(ids(bought).filter((id) => id.startsWith('buy:'))).toHaveLength(MARKET_OFFER_COUNT - 1)
  })

  it('stops offering the moment the purse cannot pay, rather than refusing a press', () => {
    // Choices are PRE-RESOLVED: a cell in the ring is a thing that will
    // happen, so "you cannot afford this" is an absence, not a refusal.
    const save = visit(MARKET_PRICE)
    const buying = ids(save).find((id) => id.startsWith('buy:'))
    if (!buying) throw new Error('nothing on offer')
    const spent = choose(save, buying, DEPS, NOW).save
    expect(ids(spent)).toEqual(['market:leave'])
  })

  it('gives the outpost back, without rerolling what was on the table', () => {
    const save = visit(MARKET_PRICE * 2)
    const table = ids(save).filter((id) => id.startsWith('buy:'))
    const out = choose(save, 'market:leave', DEPS, NOW).save
    expect(screenOf(out).stageId).toBe('outpost')
    const back = choose(out, 'outpost:trader', DEPS, NOW).save
    expect(ids(back).filter((id) => id.startsWith('buy:'))).toEqual(table)
  })
})

describe('hands full', () => {
  /** A run at the carry limit for items, standing in front of the trader. */
  function atTheLimit(): GameSave {
    const road = onTheRoad(31337)
    const held = new Set(road.holdings.filter((row) => row.kind === 'item').map((row) => row.modifierId))
    const fillers = THOCKQUEST.items
      .filter((item) => !held.has(item.id) && item.effects.some((effect) => effect.kind !== 'tag'))
      .slice(0, BASE_CARRY_LIMIT - held.size)
    const filled = applyEffects(
      withPurse(road, MARKET_PRICE * 2, 0),
      fillers.map((item) => ({ kind: 'acquireModifier' as const, modifierKind: 'item' as const, modifierId: item.id })),
      DEPS.catalog,
      NOW,
    )
    return choose(takeRoad(filled), 'outpost:trader', DEPS, NOW).save
  }

  it('asks what to give up instead of refusing, and has not charged yet', () => {
    const save = atTheLimit()
    expect(save.holdings.filter((row) => row.kind === 'item')).toHaveLength(BASE_CARRY_LIMIT)
    const buying = ids(save).find((id) => id.startsWith('buy:'))
    if (!buying) throw new Error('nothing on offer')

    const asking = choose(save, buying, DEPS, NOW).save
    expect(screenOf(asking).narration.join(' ')).toMatch(/hands are full/i)
    expect(ids(asking).every((id) => id.startsWith('drop:'))).toBe(true)
    expect(ids(asking)).toHaveLength(BASE_CARRY_LIMIT)
    // Nothing paid and nothing taken until the question is answered.
    expect(activeGame(asking)?.goldSpentOnItems).toBe(0)
    expect(asking.holdings.filter((row) => row.kind === 'item')).toHaveLength(BASE_CARRY_LIMIT)
  })

  it('swaps one for the other and charges once, staying at the limit', () => {
    const save = atTheLimit()
    const buying = ids(save).find((id) => id.startsWith('buy:'))
    if (!buying) throw new Error('nothing on offer')
    const incoming = buying.slice('buy:'.length)

    const asking = choose(save, buying, DEPS, NOW).save
    const dropping = ids(asking)[0]
    const dropped = dropping.slice('drop:'.length)
    const done = choose(asking, dropping, DEPS, NOW).save

    const items = done.holdings.filter((row) => row.kind === 'item').map((row) => row.modifierId)
    expect(items).toHaveLength(BASE_CARRY_LIMIT)
    expect(items).toContain(incoming)
    expect(items).not.toContain(dropped)
    expect(activeGame(done)?.goldSpentOnItems).toBe(MARKET_PRICE)
  })
})

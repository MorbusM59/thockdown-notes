import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { choose, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, carryLimit, emptySave, keepAllowance, type GameSave } from '../model/gameState'
import { FAME_UNLOCKS, FAME_UNLOCK_CEILING } from '../model/fameUnlocks'
import { famePointsAvailable } from '../model/gold'
import { ROOT_STAGE_ID, STAGES } from '../stages'

const DEPS: DirectorDeps = { stages: STAGES, content: THOCKQUEST, rootStageId: ROOT_STAGE_ID }
const NOW = 1_700_000_000_000

/** A started run holding `gold` worth of earnings, which is what fame is made of. */
function runWithGold(gold: number): GameSave {
  const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
  return gold > 0 ? applyEffects(started, [{ kind: 'grantGold', units: gold }], DEPS.content, NOW) : started
}

function buy(save: GameSave, unlock: string): GameSave {
  return applyEffects(save, [{ kind: 'buyFameUnlock', unlock }], DEPS.content, NOW)
}

function pointsIn(save: GameSave): number {
  const game = activeGame(save)!
  return famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
}

describe('what a fame point buys', () => {
  it('raises the rule it names, and only that one', () => {
    // The four are a grid -- two rules by two kinds -- so the test that
    // matters is that a purchase lands in exactly one cell of it. A bonus
    // leaking across kinds or across rules is the failure this shape invites.
    const before = runWithGold(10)
    const game = activeGame(before)!
    expect(carryLimit(game, 'item')).toBe(3)

    const after = activeGame(buy(before, 'strongBack'))!
    expect(carryLimit(after, 'item')).toBe(4)
    expect(carryLimit(after, 'trait')).toBe(3)
    expect(keepAllowance(after, 'item')).toBe(1)
    expect(keepAllowance(after, 'trait')).toBe(1)
  })

  it('charges the price on the fame ladder, all of it, once', () => {
    // Large Coffers costs two, and the ladder's threshold moves per POINT --
    // so the second point of a two-point purchase pushes the next one further
    // away than the first did: the thresholds are 10 then 15, so the next
    // one after a two-point purchase stands at 25.
    const save = runWithGold(15)
    expect(pointsIn(save)).toBe(2)

    const after = activeGame(buy(save, 'largeCoffers'))!
    expect(after.famePointsSpent).toBe(2)
    expect(after.goldToNextFamePoint).toBe(25)
    expect(keepAllowance(after, 'item')).toBe(2)
  })

  it('refuses a purchase the run cannot afford, whole', () => {
    // The half-apply this guards is the reason the purchase is ONE effect: a
    // price paid in separate allocations would take the one point that was
    // there and hand over the unlock anyway.
    const save = runWithGold(10)
    expect(pointsIn(save)).toBe(1)

    const after = activeGame(buy(save, 'largeCoffers'))!
    expect(after.famePointsSpent).toBe(0)
    expect(after.fameUnlocks).toEqual([])
    expect(keepAllowance(after, 'item')).toBe(1)
  })

  it('climbs to the ceiling and stops there, however much fame is thrown at it', () => {
    // The property, not one step of it: buying the same unlock far more times
    // than the ceiling allows must leave the rule AT the ceiling and the
    // purchases it refused unpaid. A run with a fortune is the case where an
    // off-by-one in the cap becomes a run carrying twelve items.
    let save = runWithGold(100_000)
    for (let attempt = 0; attempt < 12; attempt += 1) save = buy(save, 'strongBack')

    const game = activeGame(save)!
    expect(carryLimit(game, 'item')).toBe(FAME_UNLOCK_CEILING.carry)
    expect(game.fameUnlocks.filter((id) => id === 'strongBack')).toHaveLength(
      FAME_UNLOCK_CEILING.carry - 3,
    )
  })

  it('reaches every ceiling from every unlock, and no further', () => {
    // Held against the whole table rather than one row: the grid is what
    // makes a fifth unlock cheap to add, and a rule that only holds for the
    // row somebody tested is this codebase's characteristic failure.
    for (const unlock of FAME_UNLOCKS) {
      let save = runWithGold(1_000_000)
      for (let attempt = 0; attempt < 10; attempt += 1) save = buy(save, unlock.id)
      const game = activeGame(save)!
      const reached = unlock.rule === 'carry' ? carryLimit(game, unlock.kind) : keepAllowance(game, unlock.kind)
      expect(reached).toBe(FAME_UNLOCK_CEILING[unlock.rule])
    }
  })

  it('ignores an unlock id this build does not know', () => {
    // Saves outlive content. An id from a build that had a fifth unlock must
    // cost nothing and change nothing rather than throw.
    const save = runWithGold(100)
    const after = activeGame(buy(save, 'sorcerousTote'))!
    expect(after.famePointsSpent).toBe(0)
    expect(after.fameUnlocks).toEqual([])
  })

  it('survives the save, purchases and repeats intact', async () => {
    const { sanitizeGameSave } = await import('../save')
    let save = runWithGold(100_000)
    save = buy(buy(save, 'strongBack'), 'strongBack')

    const reloaded = sanitizeGameSave(JSON.parse(JSON.stringify(save)))!
    const game = activeGame(reloaded)!
    expect(game.fameUnlocks).toEqual(['strongBack', 'strongBack'])
    expect(carryLimit(game, 'item')).toBe(5)
  })
})

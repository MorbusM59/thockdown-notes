import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, armorOf, emptySave, profileOf, type GameSave } from './gameState'
import { BASE_STAT_CAP, deriveStats } from './stats'
import { sanitizeGameSave } from '../save'
import { ROOT_STAGE_ID, STAGES } from '../stages'

const DEPS: DirectorDeps = { stages: STAGES, content: THOCKQUEST, rootStageId: ROOT_STAGE_ID }
const NOW = 1_700_000_000_000

/** A run that has chosen `originId` and nothing else. */
function runAs(originId: string, save: GameSave = emptySave(4242)): GameSave {
  return choose(choose(enterEntryScreen(save, DEPS, NOW), 'welcome:start', DEPS, NOW).save, `origin:${originId}`, DEPS, NOW).save
}

function spendMight(save: GameSave, points: number): GameSave {
  return applyEffects(
    save,
    Array.from({ length: points }, () => ({ kind: 'adjustBaseStat' as const, stat: 'might' as const, amount: 1 })),
    DEPS.content,
    NOW,
  )
}

describe('a class stacks with what the player spends', () => {
  it('leaves every one of the six points to spend, whatever the class gave', () => {
    // THE PROPERTY, across every class rather than one: a class that wrote
    // into the base block spent the player's allowance for them, and the
    // failure that invites is the one where it holds for the class somebody
    // tested. A Warrior used to begin at Might 2 and could put only four more
    // in; now every class begins at nothing spent.
    for (const origin of THOCKQUEST.origins) {
      const save = runAs(origin.id)
      const game = activeGame(save)!
      for (const key of ['might', 'agility', 'perception', 'intellect', 'charisma', 'luck'] as const) {
        expect(game.baseStats[key]).toBe(0)
      }
    }
  })

  it('reaches past the base cap, which is what gear does and what a class now is', () => {
    // Six points of Might is the top of the player's own progression; the
    // Warrior's +2 lands on TOP of it, so the fight sees 8. Before, those two
    // were the same two points counted once.
    const spent = spendMight(runAs('warrior'), BASE_STAT_CAP)
    const game = activeGame(spent)!
    expect(game.baseStats.might).toBe(BASE_STAT_CAP)
    expect(profileOf(spent, game, THOCKQUEST).stats.might).toBe(BASE_STAT_CAP + 2)
  })

  it('carries effects that are not stats, through the modifier vocabulary', () => {
    const plain = runAs('warrior')
    const berserk = { ...plain, games: plain.games.map((game) => ({ ...game, originId: 'berserker' })) }
    const before = profileOf(plain, activeGame(plain)!, THOCKQUEST)
    const after = profileOf(berserk, activeGame(berserk)!, THOCKQUEST)

    // DOUBLED AGAINST ITS OWN STATS, not against the Warrior's: the Berserker
    // carries +4 Might, which raises what the damage formula derives BEFORE
    // the +100% multiplies it. Read through `deriveStats` rather than written
    // out, so this cannot disagree with the formula it is checking.
    expect(after.derived.damageMultiplier).toBeCloseTo(deriveStats(after.stats).damageMultiplier * 2, 10)
    expect(after.stats.might).toBe(before.stats.might + 2)
    expect(after.stats.intellect).toBe(before.stats.intellect - 2)
  })

  it('takes worn armour away from the Berserker and leaves natural armour alone', () => {
    // The trade the class is FOR: no decaying pool from items, but a trait's
    // natural armour still counts, so a Berserker can be tough without ever
    // being armoured.
    const plain = runAs('warrior')
    const berserk = { ...plain, games: plain.games.map((game) => ({ ...game, originId: 'berserker' })) }
    const game = activeGame(berserk)!
    expect(armorOf(berserk, game, THOCKQUEST).pieces).toEqual([])
    expect(profileOf(berserk, game, THOCKQUEST).noDecayingArmor).toBe(true)
    // And the ordinary case is untouched: nothing about worn armour changed
    // for anybody else.
    expect(profileOf(plain, activeGame(plain)!, THOCKQUEST).noDecayingArmor).toBe(false)
  })
})

describe('what a run leaves behind', () => {
  it('is not offered before it is earned', () => {
    const save = choose(enterEntryScreen(emptySave(7), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    const offered = currentScreen(save, DEPS)!.choices.map((choice) => choice.id)
    expect(offered).not.toContain('origin:berserker')
    expect(offered).toContain('origin:warrior')
  })

  it('is earned by reaching the cap in Might, and derived rather than granted', () => {
    // No effect hands this out. It falls out of the run's own state after
    // whatever effect made it true, which is why spending the sixth point is
    // all it takes and no screen has to remember to award anything.
    const five = spendMight(runAs('warrior'), BASE_STAT_CAP - 1)
    expect(five.profile.unlocked).toEqual([])

    const six = spendMight(five, 1)
    expect(six.profile.unlocked).toEqual(['berserker'])
  })

  it('is not lost when the condition stops being true', () => {
    // The set only grows. Nothing takes base stats back today, but an unlock
    // that could be un-earned by a later effect is a promise the save cannot
    // keep -- and "you had it yesterday" is the one thing a permanent unlock
    // must never say.
    const earned = spendMight(runAs('warrior'), BASE_STAT_CAP)
    const spentDown = applyEffects(earned, [{ kind: 'adjustBaseStat', stat: 'might', amount: -6 }], DEPS.content, NOW)
    expect(activeGame(spentDown)!.baseStats.might).toBe(0)
    expect(spentDown.profile.unlocked).toEqual(['berserker'])
  })

  it('outlives the run, and the save', () => {
    const earned = spendMight(runAs('warrior'), BASE_STAT_CAP)
    const reloaded = sanitizeGameSave(JSON.parse(JSON.stringify(earned)))!
    expect(reloaded.profile.unlocked).toEqual(['berserker'])

    // A NEW run on that save is offered the class, which is the whole point.
    const next = choose(enterEntryScreen({ ...reloaded, activeGameId: null, director: { stack: [], narration: [], rng: 11 } }, DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(currentScreen(next, DEPS)!.choices.map((choice) => choice.id)).toContain('origin:berserker')
  })
})

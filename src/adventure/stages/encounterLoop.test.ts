import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'
import { resolveProfile } from '../model/modifiers'
import { lootStage } from './loot'
import { encounterSelectStage } from './encounterSelect'
import { sanitizeGameSave } from '../save'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

/**
 * Plays the game by always taking the first choice that is not "leave",
 * recording which stage each step was answered in.
 *
 * A walk, not a script: the point is that the encounter chain closes on
 * itself, and a script that names each stage in order would pass even if the
 * chain only worked in the order the script happened to write down.
 */
function walk(steps: number, seed: number): { save: GameSave; visited: string[] } {
  let save = enterEntryScreen(emptySave(seed), DEPS, NOW)
  const visited: string[] = []
  for (let step = 0; step < steps; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) break
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) break
    visited.push(screen.stageId)
    save = choose(save, choice.id, DEPS, NOW).save
  }
  return { save, visited }
}

describe('an encounter, end to end', () => {
  it('reaches combat, and comes back to the hub after it', () => {
    // Welcome, three character-creation questions, the road, then the hub --
    // and from there the chain has to close on itself or the walk stalls.
    const { visited } = walk(220, 4242)
    expect(visited).toContain('combat')
    // Back at the hub AFTER a fight is the whole point: the chain returns.
    const afterFirstFight = visited.slice(visited.indexOf('combat') + 1)
    expect(afterFirstFight).toContain('encounterSelect')
  })

  it('never stalls on a screen with nothing to press', () => {
    for (const seed of [1, 7, 99, 4242, 31337]) {
      const { save, visited } = walk(200, seed)
      expect(visited.length).toBe(200)
      expect(currentScreen(save, DEPS)).not.toBeNull()
    }
  })

  it('carries damage out of the fight and onto the record', () => {
    // The round is the fight's working copy; without the effects that mirror
    // it, every blow taken would evaporate when the stage ended.
    let save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let sawDamage = false
    for (let step = 0; step < 400 && !sawDamage; step += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
      if (!choice) break
      save = choose(save, choice.id, DEPS, NOW).save
      const game = activeGame(save)
      if (game && game.hitPoints < 50 + 15 * game.baseStats.might) sawDamage = true
    }
    expect(sawDamage).toBe(true)
  })

  it('never starts two games with the same id, however fast they follow', () => {
    // The id is built from the clock, so a fixed one used to hand the second
    // run the first's id -- the save then held two rows under one id and
    // `activeGame` returned the older, DEAD one: a run beginning at zero hit
    // points and ending on its first blow. A test that passes a constant NOW
    // hits it every time; a person would have to start two runs inside one
    // millisecond.
    let save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    for (let round = 0; round < 3; round += 1) {
      save = choose(save, 'welcome:start', DEPS, NOW).save
      save = enterEntryScreen({ ...save, director: { ...save.director, stack: [] } }, DEPS, NOW)
    }
    expect(new Set(save.games.map((game) => game.id)).size).toBe(save.games.length)
  })
})

describe('the loot stage', () => {
  /** Runs an encounter's spoils directly: the walk cannot win a fight at current tuning. */
  function lootRun(screens: number, motes: number, seed: number) {
    const save = enterEntryScreen(emptySave(seed), DEPS, NOW)
    const started = choose(save, 'welcome:start', DEPS, NOW).save
    const context = {
      save: started,
      game: activeGame(started),
      content: THOCKQUEST,
      catalog: DEPS.catalog,
      profile: activeGame(started)
        ? resolveProfile(activeGame(started)!.baseStats, [], { items: 0, traits: 0 })
        : null,
      held: [],
    }
    const entered = lootStage.enter(
      { encounterIndex: 3, screensLeft: screens, motes, offersLoot: true },
      context,
      seed,
    )
    return { context, entered }
  }

  it('offers gold beside the items, on every screen', () => {
    const { context, entered } = lootRun(2, 3, 99)
    const shown = lootStage.present(entered.state, context)
    expect(shown.choices.some((choice) => choice.id === 'loot:gold')).toBe(true)
  })

  it('applies the pick on an INTERMEDIATE screen, not only the last', () => {
    // Holding them to the end would lose every pick but one, and would roll
    // the next screen's offers against a Luck the player had earned and not
    // yet been given.
    const { context, entered } = lootRun(2, 3, 99)
    const first = lootStage.resolve(entered.state, 'loot:gold', context, entered.rng)
    expect(first.kind).toBe('stay')
    expect(first.effects).toContainEqual({ kind: 'grantGold', units: 1 })
  })

  it('pays the motes once, on the way out, and spends the encounter', () => {
    const { context, entered } = lootRun(1, 4, 99)
    const last = lootStage.resolve(entered.state, 'loot:gold', context, entered.rng)
    expect(last.kind).toBe('replace')
    if (last.kind !== 'replace') throw new Error('unreachable')
    expect(last.stageId).toBe('encounterSelect')
    expect(last.input?.encounterIndex).toBe(4)
    expect(last.effects).toContainEqual({ kind: 'grantExperience', units: 4 })
  })
})

describe('the level counts to ten', () => {
  it('offers the way on only once every encounter is spent', () => {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    const started = choose(save, 'welcome:start', DEPS, NOW).save
    const context = {
      save: started, game: activeGame(started), content: THOCKQUEST, catalog: DEPS.catalog,
      profile: activeGame(started)
        ? resolveProfile(activeGame(started)!.baseStats, [], { items: 0, traits: 0 })
        : null,
      held: [],
    }
    for (let encounter = 1; encounter <= LEVEL_ENCOUNTER_COUNT + 1; encounter += 1) {
      const entered = encounterSelectStage.enter({ encounterIndex: encounter }, context, 5)
      const shown = encounterSelectStage.present(entered.state, context)
      const isLast = encounter > LEVEL_ENCOUNTER_COUNT
      expect(shown.choices.some((choice) => choice.id === 'level:advance')).toBe(isLast)
    }
  })

  it('presents one forced encounter at five, nine and ten', () => {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    const started = choose(save, 'welcome:start', DEPS, NOW).save
    const context = {
      save: started, game: activeGame(started), content: THOCKQUEST, catalog: DEPS.catalog,
      profile: activeGame(started)
        ? resolveProfile(activeGame(started)!.baseStats, [], { items: 0, traits: 0 })
        : null,
      held: [],
    }
    for (const encounter of [5, 9, 10]) {
      const entered = encounterSelectStage.enter({ encounterIndex: encounter }, context, 5)
      const shown = encounterSelectStage.present(entered.state, context)
      expect(shown.choices).toHaveLength(1)
      expect(shown.choices[0].id).toBe('encounter:fixed')
    }
    // ...and three ways to look for one everywhere else.
    const open = encounterSelectStage.enter({ encounterIndex: 4 }, context, 5)
    expect(encounterSelectStage.present(open.state, context).choices).toHaveLength(3)
  })
})

describe('game settings', () => {
  /** Walks to the settings screen from the entry screen. */
  function openSettings(save: GameSave) {
    return choose(save, 'welcome:settings', DEPS, NOW).save
  }

  it('offers every preset, and says which one is current', () => {
    const save = openSettings(enterEntryScreen(emptySave(4242), DEPS, NOW))
    const screen = currentScreen(save, DEPS)
    expect(screen?.stageId).toBe('settings')
    const labels = screen?.choices.map((choice) => choice.label) ?? []
    expect(labels).toEqual(['Easy', 'Medium (current)', 'Hard', 'Extreme', 'Back'])
    // Each preset says what it does, in the two numbers it IS.
    expect(screen?.choices[0].detail?.lines).toEqual([
      'Monster hit points and damage at 50%',
      '+1% compounding each level',
    ])
  })

  it('comes back to the entry screen it was opened from, run and all', () => {
    // PUSH, not replace: the welcome frame knows whether it is sitting on a
    // suspended run, and could not work that out again.
    const playing = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    const reopened = enterEntryScreen(playing, DEPS, NOW)
    const back = choose(openSettings(reopened), 'settings:back', DEPS, NOW).save
    expect(back.director.stack).toEqual(reopened.director.stack)
    expect(currentScreen(back, DEPS)?.choices.map((choice) => choice.id)).toContain('welcome:continue')
  })

  it('applies a preset to the NEXT run and never to the one in progress', () => {
    // A preset changed mid-run would rewrite what every fight already fought
    // was worth.
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(activeGame(started)?.difficulty).toBe('medium')

    const reopened = enterEntryScreen(started, DEPS, NOW)
    const chosen = choose(openSettings(reopened), 'difficulty:extreme', DEPS, NOW).save
    expect(chosen.settings.difficulty).toBe('extreme')
    expect(chosen.games.find((game) => game.id === chosen.activeGameId)?.difficulty).toBe('medium')

    const next = choose(enterEntryScreen(chosen, DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(activeGame(next)?.difficulty).toBe('extreme')
  })

  it('survives the sanitizer, which is the half that has shipped broken before', () => {
    const chosen = choose(
      openSettings(enterEntryScreen(emptySave(4242), DEPS, NOW)),
      'difficulty:easy',
      DEPS,
      NOW,
    ).save
    const readBack = sanitizeGameSave(JSON.parse(JSON.stringify(chosen)))
    expect(readBack?.settings.difficulty).toBe('easy')
    // And a save written before presets existed reads at the default rather
    // than being discarded.
    const older = JSON.parse(JSON.stringify(chosen)) as Record<string, unknown>
    delete older.settings
    expect(sanitizeGameSave(older)?.settings.difficulty).toBe('medium')
  })
})

describe('spending a stat point', () => {
  /** A run standing at the hub with `motes` earned, however it got there. */
  function atHubWith(motes: number): GameSave {
    let save = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    save = choose(save, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 3; step += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) throw new Error('no screen')
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
    if (currentScreen(save, DEPS)?.stageId !== 'encounterSelect') throw new Error('not at the hub')
    return motes > 0 ? applyEffects(save, [{ kind: 'grantExperience', units: motes }], DEPS.catalog, NOW) : save
  }

  const cellIds = (save: GameSave) => currentScreen(save, DEPS)?.choices.map((choice) => choice.id) ?? []

  it('is offered exactly when the ladder has a point waiting', () => {
    // Nine motes is not ten. The threshold is the whole rule, and it is
    // derived from what was earned rather than from a counter -- which is
    // what the counter it replaced could never be, since nothing filled it.
    expect(cellIds(atHubWith(9))).not.toContain('encounter:spendStatPoint')
    expect(cellIds(atHubWith(10))).toContain('encounter:spendStatPoint')
  })

  it('raises the stat, moves the threshold, and takes its own cell away', () => {
    const ready = atHubWith(10)
    const before = activeGame(ready)
    const spending = choose(ready, 'encounter:spendStatPoint', DEPS, NOW).save
    expect(currentScreen(spending, DEPS)?.stageId).toBe('statPoint')

    const spent = choose(spending, 'statPoint:might', DEPS, NOW).save
    const after = activeGame(spent)
    expect(after?.baseStats.might).toBe((before?.baseStats.might ?? 0) + 1)
    expect(after?.statPointsSpent).toBe((before?.statPointsSpent ?? 0) + 1)
    // 10 -> 15: the next point is five further off for each one spent.
    expect(after?.experienceToNextStatPoint).toBe(15)
    expect(cellIds(spent)).not.toContain('encounter:spendStatPoint')
  })

  it('grants the hit points the point is worth, rather than only the room for them', () => {
    const ready = atHubWith(10)
    const before = activeGame(ready)?.hitPoints ?? 0
    const spent = choose(choose(ready, 'encounter:spendStatPoint', DEPS, NOW).save, 'statPoint:might', DEPS, NOW).save
    expect(activeGame(spent)?.hitPoints).toBe(before + 15)
  })

  it('comes back to the SAME encounter, not a freshly rolled one', () => {
    // A `replace` would re-enter the hub and draw different monsters, which
    // would make spending a point a way to reroll the encounter.
    const ready = atHubWith(10)
    const before = ready.director.stack[ready.director.stack.length - 1]
    const spent = choose(choose(ready, 'encounter:spendStatPoint', DEPS, NOW).save, 'statPoint:might', DEPS, NOW).save
    const after = spent.director.stack[spent.director.stack.length - 1]
    expect(after.stageId).toBe('encounterSelect')
    expect(after.state).toEqual(before.state)
  })

  it('says what the point would do, computed rather than written down', () => {
    const spending = choose(atHubWith(10), 'encounter:spendStatPoint', DEPS, NOW).save
    const choices = currentScreen(spending, DEPS)?.choices ?? []
    const might = choices.find((choice) => choice.id === 'statPoint:might')
    expect(might?.detail?.lines).toContain('15 hit points')
    // A stat whose uses are unwritten says so, rather than showing an empty
    // pill that reads as a rendering fault.
    const intellect = choices.find((choice) => choice.id === 'statPoint:intellect')
    expect(intellect?.detail?.lines).toContain('Its uses are not written yet')
  })
})

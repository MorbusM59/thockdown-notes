import { describe, expect, it } from 'vitest'

import { NO_ARMOR } from '../model/armor'

import { catalogFor, rolledPool, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, enterInterlude, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'
import { resolveProfile } from '../model/modifiers'
import { lootStage } from './loot'
import { encounterSelectStage } from './encounterSelect'
import { sanitizeGameSave } from '../save'
import { withSuccessAdjust } from '../model/gameState'
import { famePointsAvailable } from '../model/gold'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  rootStageId: ROOT_STAGE_ID,
}

const CATALOG = catalogFor(THOCKQUEST, 0)
const ITEMS = rolledPool(THOCKQUEST, 0, 'item')
const TRAITS = rolledPool(THOCKQUEST, 0, 'trait')
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
      catalog: CATALOG,
      items: ITEMS,
      traits: TRAITS,
      armor: NO_ARMOR,
      profile: activeGame(started)
        ? resolveProfile(activeGame(started)!.baseStats, [], { items: 0, traits: 0 })
        : null,
      held: [],
    }
    const entered = lootStage.enter(
      { screensLeft: screens, motes, offersLoot: true },
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
    expect(last.effects).toContainEqual({ kind: 'grantExperience', units: 4 })
    // The encounter is spent HERE, by an effect on the record, rather than by
    // handing the next stage a bigger number -- which is what lets the chrome
    // read the count without rummaging in the stack.
    expect(last.effects).toContainEqual({ kind: 'advanceEncounter' })
  })
})

describe('the level counts to ten', () => {
  /**
   * A context standing at the given encounter -- which is now a fact about
   * the RECORD rather than something handed to the stage, so the only honest
   * way to set it up is to advance the record to it.
   */
  function atEncounter(encounter: number) {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let started = choose(save, 'welcome:start', DEPS, NOW).save
    for (let step = 1; step < encounter; step += 1) {
      started = applyEffects(started, [{ kind: 'advanceEncounter' }], DEPS.content, NOW)
    }
    const game = activeGame(started)
    expect(game?.encounterIndex).toBe(encounter)
    return {
      save: started, game, content: THOCKQUEST, catalog: CATALOG,
      items: ITEMS,
      traits: TRAITS,
      armor: NO_ARMOR,
      profile: game ? resolveProfile(game.baseStats, [], { items: 0, traits: 0 }) : null,
      held: [],
    }
  }

  it('offers the way on only once every encounter is spent', () => {
    for (let encounter = 1; encounter <= LEVEL_ENCOUNTER_COUNT + 1; encounter += 1) {
      const context = atEncounter(encounter)
      const entered = encounterSelectStage.enter({}, context, 5)
      const shown = encounterSelectStage.present(entered.state, context)
      const isLast = encounter > LEVEL_ENCOUNTER_COUNT
      expect(shown.choices.some((choice) => choice.id === 'level:advance')).toBe(isLast)
    }
  })

  it('presents one forced encounter at five, nine and ten', () => {
    for (const encounter of [5, 9, 10]) {
      const context = atEncounter(encounter)
      const entered = encounterSelectStage.enter({}, context, 5)
      const shown = encounterSelectStage.present(entered.state, context)
      expect(shown.choices).toHaveLength(1)
      expect(shown.choices[0].id).toBe('encounter:fixed')
    }
    // ...and three ways to look for one everywhere else.
    const open = atEncounter(4)
    const entered = encounterSelectStage.enter({}, open, 5)
    expect(encounterSelectStage.present(entered.state, open).choices).toHaveLength(3)
  })

  it('starts each level over at its first encounter', () => {
    // The count is per level, not per run: a new journey begins at one.
    const context = atEncounter(LEVEL_ENCOUNTER_COUNT + 1)
    const advanced = applyEffects(context.save, [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    expect(activeGame(advanced)?.level).toBe(2)
    expect(activeGame(advanced)?.encounterIndex).toBe(1)
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
    return motes > 0 ? applyEffects(save, [{ kind: 'grantExperience', units: motes }], DEPS.content, NOW) : save
  }

  /** The way in the rail's star gauge takes: an interlude, from wherever you are. */
  const open = (save: GameSave) => enterInterlude(save, 'statPoint', DEPS, NOW)
  const cellIds = (save: GameSave) => currentScreen(save, DEPS)?.choices.map((choice) => choice.id) ?? []

  it('is not a cell on the hub any more, on any screen of it', () => {
    // The rail's gauge is the way in now, so the dial gets that twelfth back.
    expect(cellIds(atHubWith(10))).not.toContain('encounter:spendStatPoint')
    expect(cellIds(atHubWith(0))).not.toContain('encounter:spendStatPoint')
  })

  it('offers nothing to spend when the ladder has nothing waiting', () => {
    // THE GATE IS IN THE STAGE, and it has to be: the screen is reachable at
    // any moment now, and `adjustBaseStat` is not gated the way
    // `allocateStatPoint` is -- so a stat cell offered with no point waiting
    // would hand out the stat for free, every time it was pressed.
    const empty = open(atHubWith(9))
    expect(currentScreen(empty, DEPS)?.stageId).toBe('statPoint')
    expect(cellIds(empty)).toEqual(['statPoint:back'])

    const before = activeGame(empty)?.baseStats.might ?? 0
    // And the id cannot be forced in from outside either: the director only
    // answers what the screen offered.
    const forced = choose(empty, 'statPoint:might', DEPS, NOW).save
    expect(activeGame(forced)?.baseStats.might).toBe(before)
  })

  it('raises the stat and moves the threshold', () => {
    const ready = open(atHubWith(10))
    expect(currentScreen(ready, DEPS)?.stageId).toBe('statPoint')
    const before = activeGame(ready)

    const spent = choose(ready, 'statPoint:might', DEPS, NOW).save
    const after = activeGame(spent)
    expect(after?.baseStats.might).toBe((before?.baseStats.might ?? 0) + 1)
    expect(after?.statPointsSpent).toBe((before?.statPointsSpent ?? 0) + 1)
    // 10 -> 15: the next point is five further off for each one spent.
    expect(after?.experienceToNextStatPoint).toBe(15)
  })

  it('grants the hit points the point is worth, rather than only the room for them', () => {
    const ready = open(atHubWith(10))
    const before = activeGame(ready)?.hitPoints ?? 0
    const spent = choose(ready, 'statPoint:might', DEPS, NOW).save
    expect(activeGame(spent)?.hitPoints).toBe(before + 15)
  })

  it('comes back to the SAME encounter, not a freshly rolled one', () => {
    // A `replace` would re-enter the hub and draw different monsters, which
    // would make spending a point a way to reroll the encounter.
    const ready = atHubWith(10)
    const before = ready.director.stack[ready.director.stack.length - 1]
    const spent = choose(open(ready), 'statPoint:might', DEPS, NOW).save
    const after = spent.director.stack[spent.director.stack.length - 1]
    expect(after.stageId).toBe('encounterSelect')
    expect(after.state).toEqual(before.state)
  })

  it('gives the screen underneath back untouched when nothing is chosen', () => {
    // Arriving by pressing a gauge has to be undoable by choosing nothing --
    // which it was not when the only way in was choosing to spend.
    const ready = atHubWith(10)
    const back = choose(open(ready), 'statPoint:back', DEPS, NOW).save
    expect(back.director.stack).toEqual(ready.director.stack)
    expect(activeGame(back)?.statPointsSpent).toBe(activeGame(ready)?.statPointsSpent)
  })

  it('is reachable mid-fight, and hands the round back exactly as it was', () => {
    // "Spendable at any time" is the design's wording, and the gauge is on
    // every screen -- so the interlude has to survive a stage with a fight in
    // its state.
    let save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    for (let step = 0; step < 200 && currentScreen(save, DEPS)?.stageId !== 'combat'; step += 1) {
      const screen = currentScreen(save, DEPS)
      const choice = screen?.choices.find((candidate) => !candidate.id.endsWith(':leave'))
      if (!choice) break
      save = choose(save, choice.id, DEPS, NOW).save
    }
    expect(currentScreen(save, DEPS)?.stageId).toBe('combat')
    const fight = save.director.stack[save.director.stack.length - 1]

    const looked = open(save)
    expect(currentScreen(looked, DEPS)?.stageId).toBe('statPoint')
    const back = choose(looked, 'statPoint:back', DEPS, NOW).save
    expect(back.director.stack[back.director.stack.length - 1]).toEqual(fight)
  })

  it('is a no-op when it is already on top, so the same press twice costs nothing', () => {
    const once = open(atHubWith(10))
    expect(open(once)).toBe(once)
  })

  it('says what the point would do, computed rather than written down', () => {
    const choices = currentScreen(open(atHubWith(10)), DEPS)?.choices ?? []
    const might = choices.find((choice) => choice.id === 'statPoint:might')
    expect(might?.detail?.lines).toContain('15 hit points')
    // A stat whose uses are unwritten says so, rather than showing an empty
    // pill that reads as a rendering fault.
    const intellect = choices.find((choice) => choice.id === 'statPoint:intellect')
    expect(intellect?.detail?.lines).toContain('Its uses are not written yet')
  })
})

describe('renown', () => {
  /** A run standing at the hub with `gold` earned. */
  function withGold(gold: number): GameSave {
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    return gold > 0 ? applyEffects(started, [{ kind: 'grantGold', units: gold }], DEPS.content, NOW) : started
  }

  it('hands out fame points from the ladder, which it could not do at all before', () => {
    // There WAS a `famePoints` counter, incremented by an effect nothing ever
    // emitted, which `allocateFamePoint` then refused to act without -- so a
    // fame point could be earned and never taken, by construction. Exactly
    // the defect model/milestones.ts describes for stat points, in the
    // sibling that was not fixed with it.
    const rich = withGold(10)
    const game = activeGame(rich)!
    expect(famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)).toBe(1)

    const taken = applyEffects(rich, [{ kind: 'allocateFamePoint' }], DEPS.content, NOW)
    expect(activeGame(taken)?.famePointsSpent).toBe(1)
    // 10 -> 15, the same ladder the stat points climb.
    expect(activeGame(taken)?.goldToNextFamePoint).toBe(15)
  })

  it('declines when the gold is not there, rather than going into debt', () => {
    const poor = withGold(9)
    const asked = applyEffects(poor, [{ kind: 'allocateFamePoint' }], DEPS.content, NOW)
    expect(activeGame(asked)?.famePointsSpent).toBe(0)
    expect(activeGame(asked)?.goldToNextFamePoint).toBe(activeGame(poor)?.goldToNextFamePoint)
  })

  it('does not lose the run its score for spending gold on things', () => {
    // The ladder reads what was EARNED, so buying an item must not push the
    // next fame point away. This is the whole two-fields-not-one design.
    const rich = withGold(10)
    const spent = applyEffects(rich, [{ kind: 'spendGold', units: 10 }], DEPS.content, NOW)
    const game = activeGame(spent)!
    expect(famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)).toBe(1)
  })

  it('opens a screen that reports the standing and invents no unlock for it', () => {
    // What a fame point BUYS is an open question the platform doc says not to
    // fill in, so the screen says so rather than offering something plausible.
    const screen = currentScreen(enterInterlude(withGold(10), 'fame', DEPS, NOW), DEPS)
    expect(screen?.stageId).toBe('fame')
    expect(screen?.choices.map((choice) => choice.id)).toEqual(['fame:back'])
  })
})

describe('the thumb the run is played under', () => {
  it('is fixed at the start, like the preset, and clamped on the way in', () => {
    const tuned: GameSave = { ...emptySave(4242), settings: { difficulty: 'hard', successAdjust: 0.35 } }
    const started = choose(enterEntryScreen(tuned, DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(activeGame(started)?.successAdjust).toBe(0.35)

    const readBack = sanitizeGameSave(JSON.parse(JSON.stringify(started)))
    expect(readBack?.settings.successAdjust).toBe(0.35)
    expect(readBack?.games[0].successAdjust).toBe(0.35)

    // Nonsense from disk is 0 -- the value that changes nothing -- rather
    // than a run silently played at some other tuning.
    const nonsense = JSON.parse(JSON.stringify(started)) as { settings: Record<string, unknown> }
    nonsense.settings.successAdjust = 'plenty'
    expect(sanitizeGameSave(nonsense)?.settings.successAdjust).toBe(0)
  })

  it('is moved LIVE by the debugging slider, unlike the preset', () => {
    // The one thing that deliberately reaches into a run already under way.
    // A difficulty preset is frozen at the start because changing it would
    // rewrite what every fight already fought was worth; the thumb is an
    // instrument, and one that only took effect next run would be answering
    // a question nobody asked.
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    const turned = withSuccessAdjust(started, 0.4)
    expect(turned.settings.successAdjust).toBe(0.4)
    expect(activeGame(turned)?.successAdjust).toBe(0.4)

    // Clamped, and identical in identity when nothing moves -- the host
    // persists on every change, so a no-op must not look like one.
    expect(withSuccessAdjust(turned, 5).settings.successAdjust).toBe(1)
    expect(withSuccessAdjust(turned, 0.4)).toBe(turned)
  })

  it('changes how a fight goes, and nothing else about the run', () => {
    // Same seed, same choices, one dial: the run under the thumb has to be a
    // DIFFERENT run, or the parameter is not reaching the rolls.
    const play = (seed: number, successAdjust: number) => {
      let save: GameSave = { ...emptySave(seed), settings: { difficulty: 'medium', successAdjust } }
      save = enterEntryScreen(save, DEPS, NOW)
      for (let step = 0; step < 200; step += 1) {
        const screen = currentScreen(save, DEPS)
        if (!screen) break
        const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
        if (!choice) break
        save = choose(save, choice.id, DEPS, NOW).save
      }
      return activeGame(save)?.hitPoints ?? 0
    }
    // OVER SEVERAL SEEDS AND A WHOLE RUN of choices, because one seed cut at
    // one arbitrary step is a coin toss dressed as an assertion: the thumb
    // moves the DISTRIBUTION of a fight, and a single walk can land anywhere
    // inside it. Three runs is enough for a parameter that is meant to make
    // the player nearly unkillable at a half-turn.
    const seeds = [31337, 4242, 7]
    const total = (successAdjust: number) => seeds.reduce((sum, seed) => sum + play(seed, successAdjust), 0)
    expect(total(0.5)).toBeGreaterThan(total(0))
  })
})

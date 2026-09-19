import { describe, expect, it } from 'vitest'

import { NO_ARMOR } from '../model/armor'

import { catalogFor, rolledPool, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, enterInterlude, type DirectorDeps } from '../core/director'
import {
  activeGame, applyEffects, emptySave, profileOf, runTuning, withTrueMode, withTuning, type GameSave,
} from '../model/gameState'
import { PROGRESSION_MAX, PROGRESSION_MIN } from '../model/difficulty'
import { AUTO_ADVANCE_MIN_MS } from '../model/autoAdvance'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { createdRun, GAME_EXIT_CHOICE } from '../testing/run'
import { LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'
import { resolveProfile } from '../model/modifiers'
import { lootStage } from './loot'
import { encounterSelectStage } from './encounterSelect'
import { sanitizeGameSave } from '../save'
import { famePointsAvailable } from '../model/gold'
import { omenHealAmount } from '../model/specialEvents'

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
    const choice = screen.choices.find((candidate) => candidate.id !== GAME_EXIT_CHOICE)
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
      const choice = screen.choices.find((candidate) => candidate.id !== GAME_EXIT_CHOICE)
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

  it('stands an omen before the forced encounter at five, nine and ten', () => {
    for (const encounter of [5, 9, 10]) {
      const context = atEncounter(encounter)
      const entered = encounterSelectStage.enter({}, context, 5)

      // THE OMEN COMES FIRST, which is the order the whole thing is for: you
      // are given something before you are shown what it is for. The rest is
      // always on the table; the traits depend on the region, and this
      // context has none, so here it is the rest alone.
      const omen = encounterSelectStage.present(entered.state, context)
      expect(omen.choices.map((choice) => choice.id)).toContain('omen:rest')
      expect(omen.choices.map((choice) => choice.id)).not.toContain('encounter:fixed')

      // Answering it STAYS in this stage, so the boss drawn on entry is the
      // one presented next -- no re-entry and no second draw.
      const answered = encounterSelectStage.resolve(entered.state, 'omen:rest', context, 5)
      if (answered.kind !== 'stay') throw new Error('the omen should stay in the hub')
      const shown = encounterSelectStage.present(answered.state, context)
      expect(shown.choices).toHaveLength(1)
      expect(shown.choices[0].id).toBe('encounter:fixed')
    }
    // ...and two ways to look for one everywhere else. Two, not three:
    // Special Encounter was removed rather than built, and the omen above is
    // what took its place.
    const open = atEncounter(4)
    const entered = encounterSelectStage.enter({}, open, 5)
    const ways = encounterSelectStage.present(entered.state, open).choices
    expect(ways.map((choice) => choice.id)).toEqual(['encounter:hunt', 'encounter:explore'])
  })

  it('pays the rest into a hurt character, and cannot overfill a healthy one', () => {
    // The one thing the omen GIVES, seen arriving. It is also the first
    // healing in the game -- deliberately a rest you give a trait up for at
    // three fixed moments, not a recovery mechanic (docs/adventure-game-design.md).
    const context = atEncounter(5)
    const hurt = applyEffects(context.save, [{ kind: 'adjustHitPoints', amount: -30 }], DEPS.content, NOW)
    const before = activeGame(hurt)!.hitPoints
    const entered = encounterSelectStage.enter({}, { ...context, save: hurt }, 5)
    const answered = encounterSelectStage.resolve(entered.state, 'omen:rest', { ...context, save: hurt }, 5)
    if (answered.kind !== 'stay') throw new Error('the omen should stay in the hub')

    const rested = applyEffects(hurt, answered.effects ?? [], DEPS.content, NOW)
    const might = context.profile?.stats.might ?? 0
    expect(activeGame(rested)!.hitPoints).toBe(before + omenHealAmount(might))

    // And at full health it is clamped rather than banked -- which is what
    // makes taking the trait the obvious call when nothing hurts.
    const full = applyEffects(context.save, answered.effects ?? [], DEPS.content, NOW)
    expect(activeGame(full)!.hitPoints).toBe(activeGame(context.save)!.hitPoints)
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
  /**
   * THE SETTINGS SCREEN IS GONE, and the suite that covered it with it. It
   * held one choice -- a difficulty preset out of four -- which is a slider
   * in the options panel now (model/difficulty.ts), beside the thumb it
   * belongs with. What replaced those tests is below: the run's own tuning,
   * the free/true split that decides which numbers the fight reads, and the
   * sanitizer, which is still the half that has shipped broken before.
   */
  it('offers no settings cell on the entry screen any more', () => {
    const screen = currentScreen(enterEntryScreen(emptySave(4242), DEPS, NOW), DEPS)
    expect(screen?.choices.map((choice) => choice.id)).not.toContain('welcome:settings')
    expect(screen?.choices.map((choice) => choice.id)).toContain('welcome:start')
  })

  it('bakes the tuning into the run, and into its seed', () => {
    // A run's content is a function of what it was set up under, so the same
    // clock at a different progression is a different adventure. That is what
    // makes "this run was won at 1.25" something a later unlock could believe.
    const gentle = emptySave(4242)
    const steep = withTuning(emptySave(4242), { progression: PROGRESSION_MAX })
    const one = choose(enterEntryScreen(gentle, DEPS, NOW), 'welcome:start', DEPS, NOW).save
    const two = choose(enterEntryScreen(steep, DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(activeGame(one)?.progression).toBe(PROGRESSION_MIN)
    expect(activeGame(two)?.progression).toBe(PROGRESSION_MAX)
    expect(activeGame(one)?.seed).not.toBe(activeGame(two)?.seed)
  })

  it('lets the sliders override a run in FREE mode, and not in true mode', () => {
    // The whole of what the toggle is for, from both sides. Free mode reads
    // the live sliders so tuning by feel reaches the fight on screen; true
    // mode reads what the run was created with, so a result means something.
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(activeGame(started)?.progression).toBe(PROGRESSION_MIN)

    const moved = withTuning(started, { progression: 1.2, successAdjust: 0.4 })
    expect(runTuning(activeGame(moved), moved.settings)).toEqual({ progression: 1.2, successAdjust: 0.4 })
    // THE RECORD IS UNTOUCHED, which is the part that used to be written over:
    // a run whose numbers are overwritten every time a slider moves cannot say
    // what it was set up as.
    expect(activeGame(moved)?.progression).toBe(PROGRESSION_MIN)

    const strict = { ...moved, settings: { ...moved.settings, trueMode: true } }
    expect(runTuning(activeGame(strict), strict.settings).progression).toBe(PROGRESSION_MIN)
  })

  it('ends the run when true mode is turned ON, and not when it is turned off', () => {
    // A free-mode run was played under whatever the sliders happened to be,
    // so there is no honest way to carry it into a mode whose entire claim is
    // that the numbers did not move.
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    expect(started.activeGameId).not.toBeNull()

    const strict = withTrueMode(started, true)
    expect(strict.settings.trueMode).toBe(true)
    expect(strict.activeGameId).toBeNull()
    expect(strict.games).toEqual([])
    // The stack goes with it: a frame parked against a run that no longer
    // exists is the one state the director cannot present.
    expect(strict.director.stack).toEqual([])

    const relaxed = withTrueMode(
      choose(enterEntryScreen(strict, DEPS, NOW), 'welcome:start', DEPS, NOW).save,
      false,
    )
    expect(relaxed.settings.trueMode).toBe(false)
    expect(relaxed.activeGameId).not.toBeNull()
  })

  it('clamps whatever a slider hands it, rather than storing it', () => {
    // A slider stepping by 0.05 arrives carrying 0.6000000000000001, and a
    // caller can ask for anything at all.
    const wild = withTuning(emptySave(1), { progression: 99, successAdjust: -5, autoAdvanceMs: 7 })
    expect(wild.settings.progression).toBe(PROGRESSION_MAX)
    expect(wild.settings.successAdjust).toBe(0)
    expect(wild.settings.autoAdvanceMs).toBe(AUTO_ADVANCE_MIN_MS)
  })

  it('survives the sanitizer, which is the half that has shipped broken before', () => {
    const chosen = withTuning(emptySave(4242), {
      progression: 1.2,
      successAdjust: 0.35,
      autoAdvanceScope: 'combat',
      autoAdvanceMs: 150,
    })
    const readBack = sanitizeGameSave(JSON.parse(JSON.stringify({ ...chosen, settings: { ...chosen.settings, trueMode: true } })))
    expect(readBack?.settings).toEqual({
      progression: 1.2,
      successAdjust: 0.35,
      trueMode: true,
      autoAdvanceScope: 'combat',
      autoAdvanceMs: 150,
    })
    // A save written before any of this reads at the defaults rather than
    // being discarded -- the same widening every other field took.
    const older = JSON.parse(JSON.stringify(chosen)) as Record<string, unknown>
    delete older.settings
    expect(sanitizeGameSave(older)?.settings.progression).toBe(PROGRESSION_MIN)
    expect(sanitizeGameSave(older)?.settings.trueMode).toBe(false)
    expect(sanitizeGameSave(older)?.settings.autoAdvanceScope).toBe('nothing')
    // ...and a scope this build does not know is the default, not a crash.
    const alien = JSON.parse(JSON.stringify(chosen)) as Record<string, unknown>
    ;(alien.settings as Record<string, unknown>).autoAdvanceScope = 'untilTheHeatDeath'
    expect(sanitizeGameSave(alien)?.settings.autoAdvanceScope).toBe('nothing')
  })
})

describe('spending a stat point', () => {
  /** A run standing at the hub with `motes` earned, however it got there. */
  function atHubWith(motes: number): GameSave {
    // Creation, then the region: five vector-and-offer questions and the
    // road (testing/run.ts walks the first five).
    let save = createdRun({ seed: 4242 })
    const road = currentScreen(save, DEPS)
    if (!road) throw new Error('no screen')
    save = choose(save, road.choices[0].id, DEPS, NOW).save
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
    // AGAINST THE CEILING IT MOVED, not against a number written here. This
    // said `before + 15`, which is `50 + 15 x Might` with the 50 cancelled --
    // the hit-point formula, restated in a test, which is the exact defect
    // the sim's own health policy was caught with. It was true while nothing
    // could scale hit points; a species that carries "+25% hit points"
    // (model/vectors.ts) makes the point worth 19 and the test wrong about a
    // rule that is working.
    //
    // The rule is that current follows maximum, so the assertion is that the
    // gain IS the rise in the maximum -- read from the profile, which is the
    // thing the rule is about.
    const ready = open(atHubWith(10))
    const game = activeGame(ready)!
    const before = game.hitPoints
    const ceilingBefore = profileOf(ready, game, DEPS.content).derived.maxHitPoints
    const spent = choose(ready, 'statPoint:might', DEPS, NOW).save
    const after = activeGame(spent)!
    const ceilingAfter = profileOf(spent, after, DEPS.content).derived.maxHitPoints
    expect(ceilingAfter).toBeGreaterThan(ceilingBefore)
    expect(after.hitPoints).toBe(before + (ceilingAfter - ceilingBefore))
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
      const choice = screen?.choices.find((candidate) => candidate.id !== GAME_EXIT_CHOICE)
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

  it('offers only what the run can actually take, and always the way back', () => {
    // SUPERSEDES "invents no unlock for it": what a fame point buys is written
    // now (model/famePurchases.ts). The rule that replaced it is that the gate
    // lives in the stage, exactly as it does for stat points -- a cell on the
    // ring can always be taken, so the two-point purchases are absent while
    // only one point is in hand.
    const oneReady = currentScreen(enterInterlude(withGold(10), 'fame', DEPS, NOW), DEPS)
    expect(oneReady?.stageId).toBe('fame')
    // ASCENDANT is on this list and the two-point purchases are not: it costs
    // one, and what it raises is the run's TIER -- the third rule the grid
    // grew when the four vectors landed, and the first that is not per kind.
    expect(oneReady?.choices.map((choice) => choice.id)).toEqual([
      'fame:buy:strongBack',
      'fame:buy:experienced',
      'fame:buy:ascendant',
      'fame:back',
    ])

    // With nothing earned there is nothing to offer, and the screen is the
    // way back alone -- the standing still readable on its detail.
    const none = currentScreen(enterInterlude(withGold(0), 'fame', DEPS, NOW), DEPS)
    expect(none?.choices.map((choice) => choice.id)).toEqual(['fame:back'])
    expect(none?.choices[0].detail?.lines.some((line) => line.startsWith('Large Coffers'))).toBe(true)
  })
})

describe('the thumb the run is played under', () => {
  it('is fixed at the start, like the preset, and clamped on the way in', () => {
    const tuned: GameSave = withTuning(emptySave(4242), { successAdjust: 0.35 })
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

  it('reaches a run already under way, in free mode, without rewriting it', () => {
    // The whole use of tuning by feel: the slider moves and the fight on
    // screen changes. What it does NOT do any more is write the number onto
    // the run -- the record says what the run was SET UP as and `runTuning`
    // decides which of the two the fight reads.
    const started = choose(enterEntryScreen(emptySave(4242), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    const turned = withTuning(started, { successAdjust: 0.4 })
    expect(turned.settings.successAdjust).toBe(0.4)
    expect(runTuning(activeGame(turned), turned.settings).successAdjust).toBe(0.4)
    expect(activeGame(turned)?.successAdjust).toBe(0)

    // Clamped, and identical in identity when nothing moves -- the host
    // persists on every change, so a no-op must not look like one.
    expect(withTuning(turned, { successAdjust: 5 }).settings.successAdjust).toBe(1)
    expect(withTuning(turned, { successAdjust: 0.4 })).toBe(turned)
  })

  it('changes how a fight goes, and nothing else about the run', () => {
    // Same seed, same choices, one dial: the run under the thumb has to be a
    // DIFFERENT run, or the parameter is not reaching the rolls.
    const play = (seed: number, successAdjust: number) => {
      let save: GameSave = withTuning(emptySave(seed), { successAdjust })
      save = enterEntryScreen(save, DEPS, NOW)
      for (let step = 0; step < 200; step += 1) {
        const screen = currentScreen(save, DEPS)
        if (!screen) break
        const choice = screen.choices.find((candidate) => candidate.id !== GAME_EXIT_CHOICE)
        if (!choice) break
        save = choose(save, choice.id, DEPS, NOW).save
      }
      return activeGame(save)?.hitPoints ?? 0
    }
    // OVER MANY SEEDS AND A WHOLE RUN of choices, because one seed cut at one
    // arbitrary step is a coin toss dressed as an assertion: the thumb moves
    // the DISTRIBUTION of a fight, and a single walk can land anywhere inside
    // it. It said THREE was enough and three was not -- it passed on the runs
    // those three seeds happened to produce, and flipped the day origins
    // stopped eating the player's stat points and the walks changed. Measured
    // rather than tuned: at 3 seeds the totals cross, at 10 they separate, and
    // at 25 the thumb is worth about half as much again, which is the size of
    // effect it is meant to have. Seeds spread by a prime so the list is not
    // three numbers somebody liked.
    const seeds = Array.from({ length: 25 }, (_, index) => 1 + index * 7919)
    const total = (successAdjust: number) => seeds.reduce((sum, seed) => sum + play(seed, successAdjust), 0)
    expect(total(0.5)).toBeGreaterThan(total(0))
  })
})

import { describe, expect, it } from 'vitest'
import { buildCatalog, THOCKQUEST, validateContent } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from './director'
import { emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { MAX_STAGE_CHOICES } from './screen'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

function start(seed = 4242): GameSave {
  return enterEntryScreen(emptySave(seed), DEPS, NOW)
}

/** The bar's whole strip as one string -- newest entry first, as it reads. */
function narrationOf(save: GameSave): string {
  return screenOf(save).narration.join(' ')
}

function screenOf(save: GameSave) {
  const screen = currentScreen(save, DEPS)
  if (!screen) throw new Error('no screen')
  return screen
}

/**
 * The first choice that advances the game. Every choice is the stage's own
 * now -- the director contributes none -- but the entry screen's way OUT is
 * not a step forward, and a walk that took it would end on the first move.
 */
function firstStageChoiceId(save: GameSave): string {
  const choice = screenOf(save).choices.find((candidate) => candidate.id !== 'welcome:leave')
  if (!choice) throw new Error('no stage choice on offer')
  return choice.id
}

/** Plays by always taking the first offered choice, recording what was taken. */
function playForward(save: GameSave, steps: number): { save: GameSave; taken: string[] } {
  let current = save
  const taken: string[] = []
  for (let index = 0; index < steps; index += 1) {
    const choiceId = firstStageChoiceId(current)
    taken.push(choiceId)
    current = choose(current, choiceId, DEPS, NOW).save
  }
  return { save: current, taken }
}

describe('content', () => {
  it('is internally consistent', () => {
    expect(validateContent(THOCKQUEST)).toEqual([])
  })
})

describe('director', () => {
  it('puts a player with an empty stack on the root stage, and does it only once', () => {
    const first = start()
    expect(first.director.stack).toHaveLength(1)
    expect(first.director.stack[0].stageId).toBe(ROOT_STAGE_ID)
    // Idempotent, because it runs on a React effect that can re-run.
    expect(enterEntryScreen(first, DEPS, NOW)).toBe(first)
  })

  it('offers the way out on the entry screen, and only there', () => {
    const welcome = start()
    expect(screenOf(welcome).choices.map((choice) => choice.id)).toContain('welcome:leave')

    // Everywhere else the way out is the slot's own exit button. Three
    // standing cells on every screen was the cost this replaced.
    const inGame = playForward(welcome, 1).save
    expect(screenOf(inGame).choices.map((choice) => choice.id)).not.toContain('welcome:leave')
  })

  it('reports leaving as a host action and changes nothing itself', () => {
    const save = start()
    const result = choose(save, 'welcome:leave', DEPS, NOW)
    expect(result.hostAction).toBe('leave')
    expect(result.save).toBe(save)
  })

  it('re-opening lands on the entry screen without disturbing the run underneath', () => {
    // The property item 1 exists for: the persisted stack still means
    // "exactly where you were", but that is offered as a CHOICE rather than
    // dropped on the player mid-swing.
    const playing = playForward(start(88), 4).save
    const reopened = enterEntryScreen(playing, DEPS, NOW)

    expect(screenOf(reopened).stageId).toBe(ROOT_STAGE_ID)
    expect(reopened.director.stack).toHaveLength(playing.director.stack.length + 1)
    // Untouched, frame for frame -- not re-entered, not re-rolled.
    expect(reopened.director.stack.slice(0, -1)).toEqual(playing.director.stack)
    // Idempotent while it is already on top.
    expect(enterEntryScreen(reopened, DEPS, NOW)).toBe(reopened)
  })

  it('continues into exactly the screen that was left, roll state and all', () => {
    const playing = playForward(start(88), 4).save
    const before = screenOf(playing)

    const resumed = choose(enterEntryScreen(playing, DEPS, NOW), 'welcome:continue', DEPS, NOW).save

    expect(resumed.director.stack).toEqual(playing.director.stack)
    const after = screenOf(resumed)
    expect(after.stageId).toBe(before.stageId)
    expect(after.choices.map((choice) => choice.id)).toEqual(before.choices.map((choice) => choice.id))
  })

  it('starting a new adventure clears the suspended run rather than burying it', () => {
    // `reset`, not `replace`. With `replace` the old run would still be
    // sitting underneath, reachable by a pop nobody meant to offer.
    const playing = playForward(start(88), 4).save
    const started = choose(enterEntryScreen(playing, DEPS, NOW), 'welcome:start', DEPS, NOW).save

    expect(started.director.stack).toHaveLength(1)
    expect(started.director.stack[0].stageId).not.toBe(ROOT_STAGE_ID)
  })

  it('offers continuing only when there is something to continue', () => {
    const fresh = start()
    expect(screenOf(fresh).choices.map((choice) => choice.id)).not.toContain('welcome:continue')

    const reopened = enterEntryScreen(playForward(fresh, 2).save, DEPS, NOW)
    expect(screenOf(reopened).choices.map((choice) => choice.id)).toContain('welcome:continue')
  })

  it('ignores a choice that was not on offer rather than corrupting the game', () => {
    const save = playForward(start(), 2).save
    expect(choose(save, 'nonsense:choice', DEPS, NOW).save).toBe(save)
  })

  it('keeps every screen inside the ring budget', () => {
    // The whole budget is the stage's now, so this counts every cell the
    // dial is asked to hold rather than only the stage's share of it.
    let save = start()
    for (let index = 0; index < 12; index += 1) {
      expect(screenOf(save).choices.length).toBeLessThanOrEqual(MAX_STAGE_CHOICES)
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })
})

describe('the promises the platform is built on', () => {
  it('presents the same screen every time it is asked, at every step', () => {
    // `present` is called on every React render, so it has to be a pure
    // function of state. This is what catches a stage that rolls or reads a
    // clock while BUILDING its cells -- which the replay test below cannot
    // see, because a screen is not part of the save. (Checked by breaking
    // it on purpose: a Math.random in a label passes replay and fails here.)
    let save = start(4242)
    for (let index = 0; index < 12; index += 1) {
      expect(currentScreen(save, DEPS)).toEqual(currentScreen(save, DEPS))
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })

  it('replays: the same seed and the same choices produce the same game, every time', () => {
    // The property, not a step: every roll the game makes is threaded
    // through the save, so a game is reproducible from its seed and the
    // choices taken -- which is what makes a defect in it reportable
    // rather than merely describable.
    const first = playForward(start(777), 10)
    const second = playForward(start(777), 10)
    expect(second.taken).toEqual(first.taken)
    expect(second.save).toEqual(first.save)
  })

  it('diverges on a different seed, so the replay above is not passing by being empty', () => {
    const one = playForward(start(1), 10).save
    const two = playForward(start(999_999), 10).save
    expect(two).not.toEqual(one)
  })

  it('survives being written to disk and read back at EVERY screen along the way', () => {
    // The player can close the view at any screen, so every screen has to
    // round trip. A stage that put a closure, a Map or an undefined into
    // its state would break exactly one screen, for exactly the player who
    // quit on it.
    let save = start(31)
    for (let index = 0; index < 12; index += 1) {
      const roundTripped = JSON.parse(JSON.stringify(save)) as GameSave
      expect(roundTripped).toEqual(save)
      // And the round-tripped save must still be playable, not merely equal.
      expect(screenOf(roundTripped).choices.length).toBeGreaterThan(0)
      save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    }
  })

  it('never writes from a stage: looking at a screen twice changes nothing', () => {
    const save = playForward(start(12), 4).save
    const before = JSON.parse(JSON.stringify(save)) as GameSave
    screenOf(save)
    screenOf(save)
    expect(save).toEqual(before)
  })
})

describe('a game, played', () => {
  it('runs from the welcome screen to an encounter, carrying what was chosen', () => {
    let save = start(2024)
    expect(narrationOf(save)).toContain('What would you like to do?')

    save = choose(save, 'welcome:start', DEPS, NOW).save
    expect(narrationOf(save)).toContain('What are you?')
    expect(save.activeGameId).not.toBeNull()

    save = choose(save, 'origin:warrior', DEPS, NOW).save
    const game = save.games.find((candidate) => candidate.id === save.activeGameId)
    expect(game?.baseStats.might).toBe(2)
    expect(game?.baseStats.agility).toBe(1)
    expect(narrationOf(save)).toContain('What are you known for?')

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(narrationOf(save)).toContain('never leave home without')

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(screenOf(save).stageId).toBe('regionSelect')
    // One trait and one item, taken in that order.
    expect(save.holdings.map((row) => row.kind)).toEqual(['trait', 'item'])

    save = choose(save, firstStageChoiceId(save), DEPS, NOW).save
    expect(screenOf(save).stageId).toBe('encounterSelect')
    expect(save.games[0].regionId).not.toBeNull()

    // And the permanent record kept the decisions worth keeping, as rows.
    expect(save.outcomes.map((row) => row.outcome)).toEqual(['origin-chosen', 'region-entered'])
  })

  it('shows a modifier with its live effects, which is what the tab bar reads', () => {
    let save = choose(start(2024), 'welcome:start', DEPS, NOW).save
    save = choose(save, 'origin:warrior', DEPS, NOW).save
    const offer = screenOf(save).choices[0]
    expect(offer.detail?.title).toBeTruthy()
    expect(offer.detail?.lines.length).toBeGreaterThan(0)
  })
})

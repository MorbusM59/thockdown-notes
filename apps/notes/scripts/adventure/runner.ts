// One autoplayed run of ThockQuest, and the policies that choose for it.
//
// Shared by the two harnesses that play the pure model (simulate.ts, the
// pinning and ranking instrument, and balance.ts, the strategy comparison),
// so that "what a step is" -- including the two rail gauges, which are
// chrome presses rather than choices -- has one definition. Two loops would
// disagree about it the first time either changed.
//
// A RUN IS A FUNCTION OF ITS RUN SEED. The game draws its own seed from the
// clock at `startGame` (model/gameState.ts) and the harness's clock is a
// constant, so the run seed is mixed into the clock the run is given. Before
// this, every simulated run shared one game seed -- one rolled catalogue,
// one set of items -- and differed only in what the director dealt after.

import { THOCKQUEST } from '../../src/adventure/content'
import { choose, currentScreen, enterEntryScreen, enterInterlude, type DirectorDeps } from '../../src/adventure/core/director'
import type { Screen } from '../../src/adventure/core/screen'
import { nextFloat, toRngState, type RngState } from '../../src/adventure/core/rng'
import { activeGame, applyEffects, emptySave, profileOf, type GameRecord, type GameSave } from '../../src/adventure/model/gameState'
import { famePointsAvailable } from '../../src/adventure/model/gold'
import type { ModifierKind } from '../../src/adventure/model/modifiers'
import { statPointsAvailable } from '../../src/adventure/model/motes'
import { ROOT_STAGE_ID, STAGES } from '../../src/adventure/stages'
import { FAME_STAGE_ID, STAT_POINT_STAGE_ID } from '../../src/adventure/stages/ids'

export const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  rootStageId: ROOT_STAGE_ID,
}

const CLOCK = 1_700_000_000_000
/** A run that has not died or reached the level cap by here is not going to. */
const MAX_CHOICES = 20_000
/** The clock a run with this seed is played at -- see the header. */
export const clockFor = (runSeed: number) => CLOCK + runSeed

/**
 * The harness's OWN randomness, for the policies that need some (a random
 * player, a lookahead player's sampled futures). A separate stream from the
 * game's, so a policy consulting it never moves a draw the game makes.
 */
export function harnessRandom(seed: number): () => number {
  let state: RngState = toRngState(seed ^ 0x5bd1e995)
  return () => {
    const draw = nextFloat(state)
    state = draw.rng
    return draw.value
  }
}

export interface Situation {
  screen: Screen
  save: GameSave
  /** 0..1, or null before there is a run. */
  health: number | null
  /** Modifier ids this run is trying to acquire, in order of preference. */
  prefer: readonly string[]
  /** The harness's stream, never the game's. */
  random: () => number
}

export type Policy = (situation: Situation) => string

export const healthOf = (save: GameSave, game: GameRecord | null): number | null => (
  // THE REAL CEILING, read through `profileOf` rather than restated: the sim
  // once copied the hit-point formula here and reported the game as harder
  // the moment the copy went stale.
  game ? Math.min(1, game.hitPoints / Math.max(1, profileOf(save, game, DEPS.content).derived.maxHitPoints)) : null
)

/** Encounters behind the run, across levels -- the one measure of how far it got. */
export const progressOf = (game: GameRecord) => (game.level - 1) * 10 + Math.min(10, game.encounterIndex - 1)

/**
 * Takes a preferred modifier whenever one is on the screen. Offers name the
 * modifier in their choice id (`offer:spyglass`, `loot:item:whetstone`), so
 * this needs no knowledge of which stage it is standing in.
 */
function preferred(screen: Screen, prefer: readonly string[]): string | null {
  for (const id of prefer) {
    const choice = screen.choices.find((candidate) => candidate.id.endsWith(`:${id}`))
    if (choice) return choice.id
  }
  return null
}

const pick = (screen: Screen, ...ids: string[]): string | null =>
  ids.find((id) => screen.choices.some((choice) => choice.id === id)) ?? null

/** Everything a player could press except quitting the game from its title screen. */
export const realChoices = (screen: Screen) => {
  const real = screen.choices.filter((choice) => choice.id !== 'welcome:leave')
  return real.length > 0 ? real : screen.choices
}

const firstReal = (screen: Screen): string => realChoices(screen)[0].id

/**
 * Plays a fight the way a person would: never take a blow you can avoid, and
 * run when the next one would kill you. Everywhere else, the first cell.
 */
export const careful: Policy = ({ screen, health, prefer }) => {
  const wanted = preferred(screen, prefer)
  if (wanted) return wanted
  // THE FIRST CELL IS THE RECOMMENDATION. On the player's action the ring is
  // sorted strongest-spell-first and then Attack (stages/combat.ts), so a
  // simulated player who takes the leading offensive cell is playing the way
  // the ring is built to be played -- and is the only way the magic Intellect
  // buys reaches these numbers at all.
  const offensive = screen.choices.find((choice) => choice.id.startsWith('spell:'))
  if (offensive) return offensive.id
  if (health !== null && health < 0.25) {
    const flee = pick(screen, 'defence:flee')
    if (flee) return flee
  }
  return pick(screen, 'defence:dodge', 'defence:defend', 'combat:attack') ?? firstReal(screen)
}

/**
 * Always takes aim first: Prepare whenever it is on offer, then swing.
 *
 * Here to MEASURE Prepare, which `careful` never touches -- it presses the
 * leading offensive cell, and Prepare is deliberately the last one.
 */
const patient: Policy = (input) => pick(input.screen, 'combat:prepare') ?? careful(input)

/** Never gives ground: no dodging, no fleeing, and takes every hit. */
const reckless: Policy = ({ screen, prefer }) =>
  pick(screen, 'combat:attack', 'defence:takeTheHit', 'defence:defend')
  ?? preferred(screen, prefer)
  ?? firstReal(screen)

/** The walk the tests use: the first cell, always. The worst case, and the one that finds stalls. */
const first: Policy = ({ screen }) => firstReal(screen)

/**
 * A uniformly random press. A way BACK is taken too -- a person does -- and
 * the gauges' re-entry guard in `step` is what keeps that from looping.
 */
const random: Policy = ({ screen, random: draw }) => {
  const real = realChoices(screen)
  return real[Math.floor(draw() * real.length)].id
}

/**
 * HOW GOOD A POSITION IS, for the lookahead player to compare futures by.
 *
 * Progress dominates (an encounter behind you is worth more than any amount
 * of health), staying alive is worth a few encounters, and health, motes and
 * gold break ties.
 *
 * HEALTH IS COUNTED IN HIT POINTS, not as a fraction of the maximum. A
 * fraction cannot see a maximum: a character at 70% of 140 and one at 70% of
 * 80 scored the same, so every choice that trades maximum health for
 * something else (Might, a species' -15%, an item's +25) was judged with
 * the health half of the trade invisible. Two a point puts a fresh character
 * (around a hundred) where the fraction used to. A heuristic and stated as one: the lookahead is only as
 * clever as this, and a balance finding that rests on it has to be read
 * against it.
 */
export function valueOf(save: GameSave): number {
  const game = activeGame(save)
  if (!game) return 0
  const alive = game.status !== 'over'
  return 100 * progressOf(game)
    + (alive ? 400 + 2 * game.hitPoints : 0)
    + game.experienceEarned
    + 0.5 * game.goldEarned
}

export interface CleverOptions {
  /** Sampled futures per candidate. */
  samples: number
}

/**
 * THE CLEVER PLAYER: the best choice given the hand it is dealt, found by
 * looking ahead rather than by a rule.
 *
 * At every screen with more than one choice it tries each one in `samples`
 * futures and takes the best average `valueOf`. Each future is played out by
 * `careful` until the run is one encounter further on (two, for a choice made
 * outside a fight, whose consequences arrive later) or over.
 *
 * IT DOES NOT SEE THE DICE. The game is deterministic in its seed, so
 * replaying from the real state would show the lookahead the exact rolls
 * ahead of it -- a player who knows whether the next swing hits. Every future
 * is re-seeded from the harness's own stream instead, so the lookahead knows
 * what a person at the screen knows (the stats, the offers, the monster) and
 * not what the dice will say. The same re-seeds are used for every candidate
 * (common random numbers), so two choices are compared on the same futures
 * and the noise in the comparison is the choices' and not the samples'.
 */
export function clever({ samples }: CleverOptions): Policy {
  return ({ screen, save, prefer, random: draw }) => {
    const wanted = preferred(screen, prefer)
    if (wanted) return wanted
    const candidates = realChoices(screen)
    if (candidates.length === 1) return candidates[0].id
    const game = activeGame(save)
    const target = game ? horizonOf(screen.stageId, game) : 0
    const seeds = Array.from({ length: samples }, () => toRngState(draw() * 2 ** 32))
    const scored = candidates.map((candidate) => {
      let total = 0
      for (const seed of seeds) total += rollout(save, candidate.id, seed, target)
      return { id: candidate.id, total }
    })
    // TIES ARE SPLIT AT RANDOM, from the harness's stream. Taking the first
    // of a tie is what made the first region 100% and every other 0%: the
    // choice had no consequence inside the horizon, every candidate scored
    // the same, and the report read the ring's ORDER as a verdict.
    const bestValue = Math.max(...scored.map((entry) => entry.total))
    const tied = scored.filter((entry) => entry.total >= bestValue - 1e-9)
    return tied[Math.floor(draw() * tied.length)].id
  }
}

/**
 * HOW FAR AHEAD A CHOICE HAS TO BE PLAYED OUT BEFORE ITS CONSEQUENCES ARRIVE,
 * as the progress the rollout stops at.
 *
 * A fight's choice lands within the encounter. A shopping or loot choice
 * within a couple. But a REGION decides nothing until its omens (before the
 * mini bosses and the boss), a KEEP purchase pays only at the level's end,
 * and a character is the whole run -- judged two encounters out, all of them
 * tie or lose to whatever pays immediately, and the report then reads the
 * instrument's myopia as the game's balance. Those are played to the end of
 * the level they are taken in, plus one encounter so a level's last choice
 * still sees the next level begin.
 */
const LONG_SIGHTED_STAGES = new Set(['characterCreation', 'regionSelect', 'fame', 'outpost'])

function horizonOf(stageId: string, game: GameRecord): number {
  const progress = progressOf(game)
  if (stageId === 'combat') return progress + 1
  if (LONG_SIGHTED_STAGES.has(stageId)) return Math.max(progress + 2, game.level * 10 + 1)
  return progress + 2
}

const ROLLOUT_STEPS = 3000

function rollout(from: GameSave, choiceId: string, seed: RngState, target: number): number {
  const reseeded: GameSave = { ...from, director: { ...from.director, rng: seed } }
  let save = choose(reseeded, choiceId, DEPS, clockFor(seed)).save
  if (save === reseeded) return -Infinity
  const draw = harnessRandom(seed)
  const memory: StepMemory = { fameSeen: null }
  for (let index = 0; index < ROLLOUT_STEPS; index += 1) {
    const game = activeGame(save)
    if (!game || game.status === 'over' || progressOf(game) >= target) break
    const next = step(save, careful, [], draw, memory, clockFor(seed))
    if (!next) break
    save = next.save
  }
  return valueOf(save)
}

export const POLICIES = {
  careful,
  patient,
  reckless,
  first,
  random,
  clever: clever({ samples: 4 }),
} as const satisfies Record<string, Policy>

export type PolicyName = keyof typeof POLICIES

/** What `step` remembers between calls, so a declined gauge is not pressed forever. */
export interface StepMemory {
  /** The fame state the renown screen was last entered at. */
  fameSeen: string | null
}

export interface StepResult {
  save: GameSave
  /** The screen a choice was made on, or null when the step was a gauge press. */
  screen: Screen | null
  choiceId: string | null
}

/**
 * ONE STEP: a gauge press when a point is waiting, otherwise one choice.
 *
 * A STAT POINT IN HAND IS WORTH NOTHING, so the stat gauge is pressed the
 * moment one lands -- the route a real player takes (docs/adventure-platform.md,
 * entry 75); which stat it goes on is the policy's choice on the screen that
 * opens. The FAME gauge the same, whenever something on it is affordable --
 * but a screen with a way back can be left unspent, so it is pressed once per
 * change in what is affordable rather than whenever it could be, or a policy
 * that turns back would be sent straight back in.
 *
 * Returns null when there is nothing to do or the choice was declined.
 */
export function step(
  save: GameSave,
  policy: Policy,
  prefer: readonly string[],
  random: () => number,
  memory: StepMemory,
  nowMs: number,
): StepResult | null {
  const screen = currentScreen(save, DEPS)
  if (!screen) return null
  const game = activeGame(save)
  if (game && game.status !== 'over' && screen.stageId !== STAT_POINT_STAGE_ID && screen.stageId !== FAME_STAGE_ID) {
    if (statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent) > 0) {
      return { save: enterInterlude(save, STAT_POINT_STAGE_ID, DEPS, nowMs), screen: null, choiceId: null }
    }
    const fame = famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
    const fameKey = `${fame}:${game.famePurchases.length}`
    if (fame > 0 && memory.fameSeen !== fameKey) {
      memory.fameSeen = fameKey
      return { save: enterInterlude(save, FAME_STAGE_ID, DEPS, nowMs), screen: null, choiceId: null }
    }
  }
  const choiceId = policy({ screen, save, health: healthOf(save, game), prefer, random })
  const next = choose(save, choiceId, DEPS, nowMs).save
  if (next === save) return null
  return { save: next, screen, choiceId }
}

/**
 * WHAT THIS HARNESS PINS: a name and an id, never a resolved modifier.
 *
 * Everything is rolled per run (model/modifierSlots.ts), so there is no such
 * object as "the Spyglass" outside of one run. Pinning by id means a ranking
 * row measures what a Spyglass is worth ON AVERAGE ACROSS RUNS.
 */
export interface PinRef {
  kind: ModifierKind
  id: string
  name: string
}

/**
 * A VECTOR TO PIN (model/vectors.ts). A modifier is something a run MIGHT
 * acquire; a vector is something the run IS from its first screen -- a
 * different measurement, kept apart so the two are never mixed.
 */
export interface VectorPin {
  vector: 'build' | 'species' | 'class'
  id: string
  name: string
}

/** A run's state at the moment it entered a level. */
export interface LevelSnapshot {
  level: number
  health: number
  experience: number
  gold: number
  statPointsSpent: number
  famePurchases: number
  items: number
  traits: number
}

/** One decision: what was on the screen and what was taken. */
export interface Decision {
  stageId: string
  offered: readonly string[]
  taken: string
}

export interface RunResult {
  died: boolean
  /** Levels reached (1-based). */
  level: number
  /** Encounters behind the run, across levels (`progressOf`). */
  progress: number
  /** Where a dead run died: the stage on screen when it ended. */
  diedIn: string | null
  fights: number
  /** Turns the player took in a fight (screens offering Attack). */
  actions: number
  choices: number
  damageTaken: number
  gold: number
  motes: number
  itemsHeld: number
  traitsHeld: number
  /** The build, species and class the run played. */
  vectors: { build: string; species: string; class: string } | null
  levels: LevelSnapshot[]
  decisions: Decision[]
}

export interface RunOptions {
  runSeed: number
  progression: number
  policy: Policy
  levelCap: number
  prefer?: readonly string[]
  pin?: readonly PinRef[]
  successAdjust?: number
  vectors?: readonly VectorPin[]
  /** Keep every decision (for pick rates). Off by default: it is most of a run's memory. */
  recordDecisions?: boolean
}

/**
 * PINNING beats preferring, for measuring what one thing is worth: a
 * preference only fires when the thing happens to be offered, so most runs
 * would come back identical to the baseline. Pinning hands it to the
 * character outright, the moment creation is over.
 */
export function playRun(options: RunOptions): RunResult {
  const { runSeed, progression, policy, levelCap } = options
  const prefer = options.prefer ?? []
  const pin = options.pin ?? []
  const vectors = options.vectors ?? []
  const nowMs = clockFor(runSeed)
  const random = harnessRandom(runSeed)
  const memory: StepMemory = { fameSeen: null }

  const start = emptySave(runSeed)
  let save: GameSave = {
    ...start,
    settings: { ...start.settings, progression, successAdjust: options.successAdjust ?? 0 },
  }
  save = enterEntryScreen(save, DEPS, nowMs)

  const result: RunResult = {
    died: false, level: 1, progress: 0, diedIn: null, fights: 0, actions: 0, choices: 0,
    damageTaken: 0, gold: 0, motes: 0, itemsHeld: 0, traitsHeld: 0, vectors: null, levels: [], decisions: [],
  }
  let lastStage = ''
  let pinned = false
  let lastHitPoints: number | null = null
  let lastScreen: Screen | null = null

  for (let index = 0; index < MAX_CHOICES; index += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) break
    let game = activeGame(save)
    // AFTER CREATION HAS FINISHED: the vector screens WRITE the record, so a
    // pin applied before them is overwritten by whatever the run then picks.
    const creating = screen.stageId === 'characterCreation'
    if ((pin.length > 0 || vectors.length > 0) && game && !pinned && !creating) {
      save = applyEffects(
        save,
        [
          ...pin.map((ref) => ({ kind: 'acquireModifier' as const, modifierKind: ref.kind, modifierId: ref.id })),
          ...vectors.map((ref) => ({ kind: 'setVector' as const, vector: ref.vector, id: ref.id })),
        ],
        DEPS.content,
        nowMs,
      )
      game = activeGame(save)
      pinned = true
    }

    if (game) {
      if (lastHitPoints !== null && game.hitPoints < lastHitPoints) result.damageTaken += lastHitPoints - game.hitPoints
      lastHitPoints = game.hitPoints
      if (game.status === 'over') {
        result.died = game.endedReason === 'defeat'
        result.diedIn = result.died ? (lastScreen?.stageId ?? null) : null
        break
      }
      if (game.level > levelCap) break
      if (!creating && result.levels.at(-1)?.level !== game.level) {
        result.levels.push({
          level: game.level,
          health: healthOf(save, game) ?? 0,
          experience: game.experienceEarned,
          gold: game.goldEarned,
          statPointsSpent: game.statPointsSpent,
          famePurchases: game.famePurchases.length,
          items: save.holdings.filter((row) => row.gameId === game!.id && row.kind === 'item').length,
          traits: save.holdings.filter((row) => row.gameId === game!.id && row.kind === 'trait').length,
        })
      }
    }

    if (screen.stageId === 'combat' && lastStage !== 'combat') result.fights += 1
    // The player's own turn is the one screen that offers Attack.
    if (screen.stageId === 'combat' && screen.choices.some((choice) => choice.id === 'combat:attack')) result.actions += 1
    lastStage = screen.stageId

    const next = step(save, policy, prefer, random, memory, nowMs)
    if (!next) break
    if (next.screen && next.choiceId) {
      result.choices += 1
      lastScreen = next.screen
      if (options.recordDecisions && next.screen.choices.length > 1) {
        result.decisions.push({
          stageId: next.screen.stageId,
          offered: realChoices(next.screen).map((choice) => choice.id),
          taken: next.choiceId,
        })
      }
    }
    save = next.save
  }

  const game = activeGame(save)
  if (game) {
    result.gold = game.goldEarned
    result.motes = game.experienceEarned
    result.level = game.level
    result.progress = progressOf(game)
    if (game.status === 'over' && game.endedReason === 'defeat') result.died = true
    result.vectors = { build: game.buildId ?? '', species: game.speciesId ?? '', class: game.classId ?? '' }
    result.itemsHeld = save.holdings.filter((row) => row.gameId === game.id && row.kind === 'item').length
    result.traitsHeld = save.holdings.filter((row) => row.gameId === game.id && row.kind === 'trait').length
  }
  return result
}

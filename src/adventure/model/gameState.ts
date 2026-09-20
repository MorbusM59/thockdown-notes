// The save model, and the one function that changes it.
//
// Shaped as TABLES even though it is currently written as a single JSON
// document through the app-state path: `profile` is a row, `games` are
// rows, `holdings` and `outcomes` are rows referring to a game by id. That
// is not ceremony -- it is so that moving this into the app's SQLite
// database (electron/databaseService.ts) is an insert loop per array rather
// than a redesign. The one deliberate exception is the director's stack,
// which holds opaque stage state by design and is therefore a blob wherever
// it lives.
//
// TWO STORES, and the boundary is absolute:
//   - CONTENT (../content) ships with the app, is never written, and
//     changes every release.
//   - SAVE (here) belongs to the player and is migrated.
// Save refers to content BY ID and tolerates an id content no longer has --
// dropped, never crashed on. That is what lets a monster or a trinket be
// deleted without breaking somebody's game.
//
// WHY THE DIRECTOR'S STACK IS NOT ON THE GAME ROW: the welcome screen runs
// before any game exists and after one ends, so the stack outlives every
// individual game. It sits beside `activeGameId`, which says what the
// current stack is playing. A second game slot is a matter of suspending a
// stack into its row, and nothing here forecloses it -- but the field for
// it is not written until something uses it.

import { pieceOf, refillArmor, repairAfterFight, type Armor, type ArmorPiece } from './armor'
import { resolveProfile, type EffectiveProfile, type HoldingCounts, type Modifier, type ModifierKind, type Situation } from './modifiers'
import { catalogFor, type Content } from '../content'
import { clampBaseStats, createStatBlock, deriveStats, type StatBlock } from './stats'
import type { Effect } from './effects'
import { FIRST_MILESTONE_THRESHOLD, milestonesAvailable, takeMilestone } from './milestones'
import { guardianLuckiness } from './guardian'
import { canAllocateStatPoint } from './motes'
import { canAllocateFamePoint, famePointsAvailable, fameReached } from './gold'
import { canBuyMore, famePurchaseById, famePurchaseBonus } from './famePurchases'
import { withUnlocksEarnedBy } from './permanentUnlocks'
import type { JsonObject } from '../core/json'
import { createSeed, seedFrom, type RngState } from '../core/rng'
import { clampProgression, DEFAULT_PROGRESSION } from './difficulty'
import {
  clampAutoAdvanceMs, DEFAULT_AUTO_ADVANCE_MS, DEFAULT_AUTO_ADVANCE_SCOPE, type AutoAdvanceScope,
} from './autoAdvance'
import { BASE_PLAYER_TIER, buildModifier, type CombatClass } from './vectors'
import { speciesModifier } from './monsters'

/**
 * Bumped when the SHAPE below changes incompatibly, which DISCARDS the save
 * (save.ts returns null for any other version) rather than migrating it.
 *
 * 2: experience split into `experienceEarned` / `experienceSpentOnTraits`
 * with a stored `experienceToNextStatPoint`. A v1 save has one running
 * balance, and there is no honest way to read a total out of it -- whatever
 * was spent is simply gone from the number. Guessing would put a run at the
 * wrong distance from its next stat point with nothing to say so.
 *
 * 3: gold split the same way (`goldEarned` / `goldSpentOnItems`) now that it
 * drives a ladder of its own, and fame became that ladder's points
 * (`famePoints` / `famePointsSpent` / `goldToNextFamePoint`) rather than a
 * bare score. `statPointsAcquired` was renamed `statPointsSpent`, which is
 * what it always counted -- it is incremented by the allocation, not by the
 * attainment, and the old name had already cost one wrapper function written
 * purely to hide it. A v2 save's `goldUnits` is a balance with the same
 * unrecoverable total as v1's motes.
 *
 * v4 renamed `fameUnlocks` to `famePurchases` (model/famePurchases.ts): the
 * word "unlock" now means a permanent one and nothing else. The version is
 * bumped rather than the old key tolerated, because a v3 save read under the
 * new name would load with an EMPTY purchase list -- a run that bought Strong
 * Back twice would carry on with the base limit and nothing would say so.
 * Discarding the save states the loss; reading it silently mis-states the run.
 *
 * v5 is THE FOUR VECTORS (model/vectors.ts). `originId` is gone, replaced by
 * `buildId`/`speciesId`/`classId`, and a monster is no longer a class-and-type
 * with stat deltas. A v4 run has an origin that no longer exists, a stat block
 * the new arithmetic would not have produced, and a stack that may be parked
 * mid-fight against a monster this build cannot rebuild. There is no honest
 * reading of it.
 */
export const SAVE_VERSION = 5

/** One frame of the director's stack: which stage, and its own private state. */
export interface StageFrame {
  stageId: string
  state: JsonObject
}

/**
 * Where the player is, independent of which game they are in. Persisted in
 * full, which is the whole of "leave at any moment and come back to the
 * same screen" -- including halfway through a fight or a nested menu.
 */
export interface DirectorState {
  stack: StageFrame[]
  /**
   * What the chapter bar is showing, NEWEST FIRST. Narration belongs to the
   * TRANSITION, not to the screen: it is the result of the previous choice
   * and the frame for the next one, so it is carried here rather than
   * regenerated by whichever stage happens to be current.
   *
   * A LIST because a stage may have a sequence to show rather than a line --
   * see core/stage.ts. The director stores whatever the last transition
   * handed it and never adds to it: a stage that accumulates keeps its own
   * entries in its own state, so leaving mid-round and coming back finds the
   * round's story where the round itself is.
   */
  narration: string[]
  rng: RngState
}

/** Permanent, across every game ever played. One row. */
export interface Profile {
  gamesStarted: number
  gamesEnded: number
  bestFame: number
  /**
   * PERMANENT UNLOCKS, earned by what a run reached and kept for every run
   * after (model/permanentUnlocks.ts). The one thing that crosses between
   * runs: fame and stat points do not.
   */
  unlocked: readonly string[]
}

export const EMPTY_PROFILE: Profile = { gamesStarted: 0, gamesEnded: 0, bestFame: 0, unlocked: [] }

/** One game slot. Multiple are possible by construction; only one is offered today. */
export interface GameRecord {
  id: string
  /** Where this game's randomness began. With the choices made, it replays the game. */
  seed: RngState
  createdAtMs: number
  updatedAtMs: number
  status: 'active' | 'over'
  endedReason?: 'defeat' | 'retired'
  /** 1-based. */
  level: number
  /**
   * WHICH of the level's ten encounters the run is on, 1-based, and it counts
   * PAST the last one -- eleven means the level is done (stages/levelProgress.ts).
   *
   * On the record rather than threaded through the encounter chain as stage
   * input, which is where it lived first. Input threading was answering a
   * real constraint (a stage cannot update its own state while pushing a
   * child, and every stage in the chain replaces the last at the same depth,
   * so there is no parent frame to hold it) -- but the counter is a property
   * of the RUN, not of any one screen, and the moment something outside the
   * stack had to read it (the chrome's identity line, which says `V-3`) a
   * threaded value could not answer. Two copies of it -- one on the record
   * for display, one in the chain for sequencing -- is the drift this
   * codebase is made of, so there is one, and it is here.
   */
  encounterIndex: number
  /**
   * WHAT THIS RUN WAS CREATED WITH -- the two tuning numbers as the settings
   * stood at the moment it began, and never written again.
   *
   * They are also mixed into `seed`, so a run's content is a function of the
   * tuning it was set up under: the same clock under a different progression
   * is a different adventure, which is what "baked in" has to mean if a
   * later unlock is ever to depend on how a run was played.
   *
   * WHICH OF THESE THE FIGHT ACTUALLY READS is `runTuning`'s answer and not
   * this record's: in free mode the live sliders override them. They are
   * what the run was SET UP as, not necessarily what it was played as, and
   * that distinction is the whole of what true mode is for.
   */
  progression: number
  successAdjust: number
  /**
   * What the player has MARKED to carry into the next level, in the order
   * they marked it. Everything else is given up when the level ends.
   *
   * A LIST rather than one id, because how many survive is a number the rules
   * own (`keepAllowance`) rather than an assumption: it is one of each today
   * and a fame unlock is expected to raise it. Marks beyond the allowance
   * cannot accumulate -- see `withKeepMark`.
   *
   * Modifier IDS, which name a holding exactly: duplicates cannot exist
   * (`acquireModifier`). Fewer marks than the allowance is the ordinary case
   * and not an empty state -- see `keptModifierIds`.
   */
  keepItemIds: string[]
  keepTraitIds: string[]
  regionId: string | null
  baseStats: StatBlock
  /** Points ever spent on a stat -- what pushes the next threshold away. */
  statPointsSpent: number
  /**
   * Every mote this run has ever earned. MONOTONIC: spending never reduces
   * it, because it is the milestone track as well as the source of the
   * currency. See model/motes.ts for why the two are stored apart.
   */
  experienceEarned: number
  /** Of those, how many have gone on traits. The balance is the difference. */
  experienceSpentOnTraits: number
  /** What `experienceEarned` must reach for the next stat point. Starts at 10. */
  experienceToNextStatPoint: number
  /**
   * Every gold piece this run has ever earned. MONOTONIC, for the same
   * reason `experienceEarned` is: it is the fame ladder's position as well
   * as the source of the currency. See model/gold.ts.
   */
  goldEarned: number
  /** Of those, how many have gone on items. The balance is the difference. */
  goldSpentOnItems: number
  /** What `goldEarned` must reach for the next fame point. Starts at 10. */
  goldToNextFamePoint: number
  /**
   * Points ever spent -- what pushes the next fame threshold away.
   *
   * There is no companion "points in hand" field, and there was: a
   * `famePoints` counter that `grantFamePoints` incremented and nothing ever
   * emitted, which `allocateFamePoint` then gated on. What is WAITING is
   * derived from the ladder (model/gold.ts's `famePointsAvailable`), exactly
   * as it is for stat points.
   */
  famePointsSpent: number
  /**
   * WHAT THE RUN BOUGHT WITH ITS FAME, one entry per purchase (they repeat --
   * see model/famePurchases.ts, where the ceiling is on the rule rather than on
   * the count). A LIST of ids rather than counters per unlock, for the same
   * reason `outcomes` is rows rather than columns: a new unlock is a new id
   * and touches no schema, and an id this build no longer knows is ignored by
   * the readers rather than crashing them.
   */
  famePurchases: readonly string[]
  /**
   * THE THREE CONTENT VECTORS this run is playing, by id -- the build, the
   * species and the class (model/vectors.ts). The fourth, TIER, is not stored:
   * it is derived from what fame has bought (`playerTierOf`), the same way
   * every other rule of the run's shape is derived from `famePurchases`
   * rather than kept as a second copy that can disagree.
   *
   * None of the three is written into `baseStats`. The build's points arrive
   * as a modifier layer above the base-stat clamp and the species' effects
   * arrive as another, so the base block stays purely what the player SPENT
   * and every run gets all six points in every stat whatever it plays as.
   *
   * Null before the choice is made. A run cannot be in progress without all
   * three, but character creation asks for them one screen at a time.
   */
  buildId: string | null
  speciesId: string | null
  classId: string | null
  hitPoints: number
}

export interface HoldingRow {
  gameId: string
  kind: ModifierKind
  modifierId: string
  /** Order of acquisition, so "keep one" can show them as they were found. */
  seq: number
  /**
   * ARMOR POINTS LEFT ON THIS ITEM, where it carries an armor slot.
   *
   * On the HOLDING rather than on the game record, which is the whole of the
   * rule "armor is tracked by the item, not the player": dropping the item
   * deletes the row, and its armor is gone with nothing to correct. A pool on
   * the record would have had to guess how much of itself went with a dropped
   * shield, and would have had no *each* for "restore each item to the
   * condition its owner can maintain" to act on.
   *
   * Absent means FULL. A row written before this field existed, and a row
   * written the moment something is acquired, both mean the same thing -- so
   * the widening and the default are one value rather than two.
   */
  armorPoints?: number
}

export interface OutcomeRow {
  gameId: string
  seq: number
  /** Content introduces new kinds; the schema never changes for them. */
  outcome: string
  payload: JsonObject
}

/**
 * What the player has chosen for the game itself, rather than for any one
 * run. Persisted across runs, and copied onto a run when it starts.
 */
export interface GameSettings {
  /**
   * PROGRESSION: the base of the exponential a monster's power is raised by,
   * 1.01 to 1.25 (model/difficulty.ts). The options panel's slider.
   */
  progression: number
  /**
   * LUCK, as the slider calls it: it scales a player's chance to FAIL and a
   * monster's chance to SUCCEED (model/chance.ts's `pressThumb`), which puts
   * a thumb on the scale while leaving both sides reading the same stat
   * table. 0 changes nothing.
   *
   * Still `successAdjust` in the code, deliberately: that is what it DOES,
   * and the game already has a stat called Luck. The slider's word is for the
   * reader; a second identifier would be two names for one number.
   */
  successAdjust: number
  /**
   * TRUE MODE: whether the two sliders above SET UP a run or OVERRIDE one.
   *
   * Off (the default, and what a run is played under while it is being
   * built): both sliders reach the run in progress immediately, so tuning by
   * feel is a thing you do while watching a fight.
   *
   * On: the run keeps the numbers it was CREATED with and the sliders only
   * decide what the next one starts under. That is the mode a result means
   * something in -- and it is why turning it on discards a run that was
   * played under overrides, which `runTuning` could not otherwise tell apart
   * from an honest one.
   */
  trueMode: boolean
  /** How far holding the space bar carries (model/autoAdvance.ts). */
  autoAdvanceScope: AutoAdvanceScope
  /** Milliseconds between auto-advanced presses, 50..1000. */
  autoAdvanceMs: number
  /**
   * VERBOSE DESCRIPTIONS: whether a description EXPLAINS itself, or only
   * says what changed (model/modifiers.ts's `DescriptionStyle`).
   *
   * On by default, because a player meeting "+20% to Hit" for the first
   * time has no way to know it is a share of the misses rather than twenty
   * points. Off once they do: the explanation is then read at every fight
   * forever, and it is what stops a narration line fitting a narrow slot.
   */
  verboseDescriptions: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  progression: DEFAULT_PROGRESSION,
  successAdjust: 0,
  trueMode: false,
  autoAdvanceScope: DEFAULT_AUTO_ADVANCE_SCOPE,
  autoAdvanceMs: DEFAULT_AUTO_ADVANCE_MS,
  verboseDescriptions: true,
}

export interface GameSave {
  version: number
  profile: Profile
  settings: GameSettings
  games: GameRecord[]
  holdings: HoldingRow[]
  outcomes: OutcomeRow[]
  activeGameId: string | null
  director: DirectorState
}

export function emptySave(rng: RngState): GameSave {
  return {
    version: SAVE_VERSION,
    profile: EMPTY_PROFILE,
    settings: DEFAULT_SETTINGS,
    games: [],
    holdings: [],
    outcomes: [],
    activeGameId: null,
    director: { stack: [], narration: [], rng },
  }
}

/**
 * THE TWO TUNING NUMBERS THE FIGHT ACTUALLY READS, resolved in one place.
 *
 * FREE MODE (the default): the live sliders, so moving one reaches the fight
 * on screen. That is the whole use of tuning by feel, and a control that did
 * nothing until the next run would be answering a question nobody asked.
 *
 * TRUE MODE: the run's own record, fixed when it was created. A result only
 * means something if the curve it was got under did not move while it was
 * being got.
 *
 * RESOLVED rather than WRITTEN, which is the part worth holding on to. The
 * free-mode override used to be written into the record, and that destroyed
 * the one thing the record is for: a run whose numbers are overwritten every
 * time a slider moves cannot say what it was set up as, so nothing later can
 * ask. Reading instead leaves the record honest and costs one function.
 */
export function runTuning(
  game: Pick<GameRecord, 'progression' | 'successAdjust' | 'level'> | null,
  settings: GameSettings,
): { progression: number; successAdjust: number } {
  const chosen = !settings.trueMode || !game
    ? { progression: clampProgression(settings.progression), successAdjust: settings.successAdjust }
    : { progression: clampProgression(game.progression), successAdjust: game.successAdjust }
  // THE GUARDIAN ANGEL IS A FLOOR under both modes and under either answer
  // above (model/guardian.ts). It is not a setting, so true mode does not
  // freeze it and free mode does not override it; it is the game declining to
  // be brutal on the first levels, and it lifts off by itself by the fourth.
  // A reader who has turned their own Luckiness up past it never meets it.
  if (!game) return chosen
  return { ...chosen, successAdjust: Math.max(chosen.successAdjust, guardianLuckiness(game.level)) }
}

/** The same answer for whatever run is active, which is what every caller wants. */
export function activeTuning(save: GameSave): { progression: number; successAdjust: number } {
  return runTuning(activeGame(save), save.settings)
}

/**
 * Moves a slider. SETTINGS ONLY -- the record is written once, at creation.
 *
 * Not an `Effect`, and that is not an oversight: the effect vocabulary is
 * what a STAGE may ask the world to change (model/effects.ts), and these are
 * the host's own controls rather than anything the game offers.
 */
export function withTuning(save: GameSave, patch: Partial<GameSettings>): GameSave {
  const next: GameSettings = { ...save.settings, ...patch }
  // Rounded as well as clamped: a slider stepping by 0.05 arrives carrying
  // 0.6000000000000001, and that is what would be stored, read back and
  // eventually shown to somebody as a percentage.
  const settings: GameSettings = {
    ...next,
    progression: Math.round(clampProgression(next.progression) * 100) / 100,
    successAdjust: Math.round(Math.max(0, Math.min(1, next.successAdjust)) * 100) / 100,
    autoAdvanceMs: clampAutoAdvanceMs(next.autoAdvanceMs),
  }
  const unchanged = (Object.keys(settings) as (keyof GameSettings)[])
    .every((key) => settings[key] === save.settings[key])
  return unchanged ? save : { ...save, settings }
}

/**
 * TURNING TRUE MODE ON DISCARDS THE RUN IN PROGRESS, and turning it off does
 * not.
 *
 * A free-mode run was played under whatever the sliders happened to be at
 * each moment, and its record holds only what it was SET UP with -- so there
 * is no honest way to carry it into a mode whose entire claim is that the
 * numbers did not move. Rather than let it become a true-mode run by
 * assertion, it ends.
 *
 * Going the other way costs nothing: a true-mode run continuing under
 * overrides is a run that stops counting, which is exactly what free mode
 * says it is.
 */
export function withTrueMode(save: GameSave, trueMode: boolean): GameSave {
  const settings = { ...save.settings, trueMode }
  if (!trueMode || !save.activeGameId) return { ...save, settings }
  return {
    ...save,
    settings,
    activeGameId: null,
    games: save.games.filter((game) => game.id !== save.activeGameId),
    holdings: save.holdings.filter((row) => row.gameId !== save.activeGameId),
    outcomes: save.outcomes.filter((row) => row.gameId !== save.activeGameId),
    // The stack goes with it: a frame parked mid-fight against a monster
    // whose run no longer exists is the one state the director cannot
    // present, and leaving it would show the game a screen with no game.
    director: { ...save.director, stack: [], narration: [] },
  }
}

export function activeGame(save: GameSave): GameRecord | null {
  return save.games.find((game) => game.id === save.activeGameId) ?? null
}

/** The most recent game that can still be played, for "continue". */
export function resumableGame(save: GameSave): GameRecord | null {
  return (
    [...save.games]
      .filter((game) => game.status === 'active')
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0] ?? null
  )
}

export function holdingsOf(save: GameSave, gameId: string): HoldingRow[] {
  return save.holdings.filter((row) => row.gameId === gameId).sort((left, right) => left.seq - right.seq)
}

/** Held modifiers, resolved against content. Ids content no longer has are dropped. */
export function heldModifiers(save: GameSave, gameId: string, catalog: ReadonlyMap<string, Modifier>): Modifier[] {
  return holdingsOf(save, gameId).flatMap((row) => {
    const modifier = catalog.get(row.modifierId)
    return modifier ? [modifier] : []
  })
}

/**
 * THE RUN'S ARMOR, assembled: one piece per held item that carries an armor
 * slot, plus every non-decaying point the run's traits and items grant.
 *
 * DERIVED, never stored whole. A piece's maximum and its decay floor are
 * properties of the item as this run rolled it (model/itemSlots.ts), so the
 * only thing worth persisting is how many points are left -- and that lives on
 * the holding. `natural` is derived outright: nothing spends it, so a stored
 * copy could only ever disagree with the traits that granted it.
 */
export function armorOf(save: GameSave, game: GameRecord, content: Content): Armor {
  const catalog = catalogFor(content, game.seed)
  const pieces: ArmorPiece[] = []
  for (const row of holdingsOf(save, game.id)) {
    const modifier = catalog.get(row.modifierId)
    if (!modifier || modifier.kind !== 'item') continue
    const piece = pieceOf(modifier, row.armorPoints)
    if (piece) pieces.push(piece)
  }
  const held = heldModifiers(save, game.id, catalog)
  // Through the run's own resolver, so an origin that forbids worn armour
  // (`noDecayingArmor`) is read here rather than only where stats are.
  const profile = resolveRunProfile(game, content, held)
  return { natural: profile.naturalArmor, pieces: profile.noDecayingArmor ? [] : pieces }
}



/**
 * Writes a set of armor pieces back onto the holdings they belong to. The one
 * way points are persisted -- the fight mirrors its working copy back through
 * `setArmor`, and the between-fight rules below go through the same door.
 */
function writeArmor(save: GameSave, gameId: string, armor: Armor): GameSave {
  const byItem = new Map(armor.pieces.map((piece) => [piece.itemId, Math.max(0, Math.floor(piece.points))]))
  if (byItem.size === 0) return save
  return {
    ...save,
    holdings: save.holdings.map((row) => {
      if (row.gameId !== gameId || row.kind !== 'item') return row
      const points = byItem.get(row.modifierId)
      return points === undefined || points === row.armorPoints ? row : { ...row, armorPoints: points }
    }),
  }
}

/**
 * HOW MANY of each kind survive a level. One, today.
 *
 * A function of the RUN rather than a constant at the one call site, because
 * the design expects a fame unlock to raise it -- and because "one" appearing
 * inline in the level's end is exactly the kind of assumption that has to be
 * found again later in three places. Nothing raises it yet; what a fame point
 * buys is unwritten (docs/adventure-platform.md), and this is the seam it
 * will be bought with rather than a guess at the price.
 */
export const BASE_KEEP_ALLOWANCE = 1

export function keepAllowance(game: GameRecord, kind: ModifierKind): number {
  return BASE_KEEP_ALLOWANCE + famePurchaseBonus(game.famePurchases, 'keep', kind, BASE_KEEP_ALLOWANCE)
}

/**
 * HOW MANY of each kind a run may carry at once. Three, today.
 *
 * A function of the run for the same reason the keep allowance is: a fame
 * unlock is expected to raise it, and the seam belongs where the rule is
 * rather than where a number happened to be typed. The two are separate
 * quantities and always were -- what you can carry through a level and what
 * survives the end of one answer different questions -- so neither is derived
 * from the other.
 *
 * At the limit, taking something new means giving something up: that is a
 * CHOICE rather than a refusal, and it is made in the ring, because it is a
 * step in the game (stages/carry.ts).
 */
export const BASE_CARRY_LIMIT = 3

export function carryLimit(game: GameRecord, kind: ModifierKind): number {
  return BASE_CARRY_LIMIT + famePurchaseBonus(game.famePurchases, 'carry', kind, BASE_CARRY_LIMIT)
}

/** What the run is carrying of one kind, as holdings rather than as resolved modifiers. */
export function holdingsOfKind(save: GameSave, gameId: string, kind: ModifierKind): HoldingRow[] {
  return holdingsOf(save, gameId).filter((row) => row.kind === kind)
}

function markedIds(game: GameRecord, kind: ModifierKind): string[] {
  return kind === 'item' ? game.keepItemIds : game.keepTraitIds
}

/**
 * WHAT SURVIVES THE LEVEL, for one kind: the marks that are still held, in
 * the order they were made, topped up with the most recently acquired until
 * the allowance is full.
 *
 * The top-up is not a fallback for an error case -- it is the rule for a
 * player who marked nothing, or marked fewer than they are allowed, and it
 * takes the newest finds because those are the ones they have had least use
 * out of. Which means the strip can always light exactly
 * `min(allowance, held)` pills per kind and have every one of them be true:
 * there is no "nothing selected" state to draw.
 */
export function keptModifierIds(save: GameSave, game: GameRecord, kind: ModifierKind): string[] {
  const rows = holdingsOf(save, game.id).filter((row) => row.kind === kind)
  const allowance = Math.max(0, Math.floor(keepAllowance(game, kind)))
  const held = new Set(rows.map((row) => row.modifierId))

  const kept = markedIds(game, kind).filter((id) => held.has(id)).slice(0, allowance)
  if (kept.length >= allowance) return kept

  const newestFirst = [...rows].sort((left, right) => right.seq - left.seq)
  for (const row of newestFirst) {
    if (kept.length >= allowance) break
    if (!kept.includes(row.modifierId)) kept.push(row.modifierId)
  }
  return kept
}

/**
 * Marks (or unmarks) what to keep. A HOST action, like `withSuccessAdjust`:
 * the strip's pills are pressed by the player directly rather than through a
 * stage, so this is not in the effect vocabulary -- which is what a STAGE may
 * ask the world to change (model/effects.ts).
 *
 * Pressing a marked one CLEARS it, which is what makes the pills toggles.
 * Pressing an unmarked one when the allowance is already full drops the
 * OLDEST mark to make room, which is what makes an allowance of one behave as
 * a single choice that moves, and any larger allowance behave as a set the
 * player can keep rearranging without first having to empty it.
 */
export function withKeepMark(save: GameSave, kind: ModifierKind, modifierId: string): GameSave {
  const game = activeGame(save)
  if (!game) return save
  const field = kind === 'item' ? 'keepItemIds' : 'keepTraitIds'
  const current = markedIds(game, kind)

  const next = current.includes(modifierId)
    ? current.filter((id) => id !== modifierId)
    : [...current, modifierId].slice(-Math.max(1, Math.floor(keepAllowance(game, kind))))

  return {
    ...save,
    games: save.games.map((candidate) => (candidate.id === game.id ? { ...candidate, [field]: next } : candidate)),
  }
}

export function holdingCounts(held: readonly Modifier[]): HoldingCounts {
  return {
    items: held.filter((modifier) => modifier.kind === 'item').length,
    traits: held.filter((modifier) => modifier.kind === 'trait').length,
  }
}

/**
 * WHAT THE RUN'S TIER IS: the base, plus what fame has bought.
 *
 * Derived from the purchase list rather than stored, which is the rule every
 * other fame-bought quantity already follows (`carryLimit`, `keepAllowance`):
 * a stored copy is a second answer that a save from another build can put out
 * of step with the list it was supposed to summarise.
 */
export function playerTierOf(game: GameRecord): number {
  return BASE_PLAYER_TIER
    + statPointsEarned(game)
    + famePurchaseBonus(game.famePurchases, 'tier', null, BASE_PLAYER_TIER)
}

/**
 * HOW MANY STAT POINTS THIS RUN HAS BEEN AWARDED, spent or not.
 *
 * Tier rises with this rather than with `statPointsSpent`, so an advancement
 * is worth two points and neither depends on the other: the tier point is
 * apportioned by the build the moment it is earned, and the stat point sits
 * waiting until the player decides where to put it. Keying the tier off the
 * SPEND would have made a player who is saving a point weaker than one who
 * spent theirs badly, which is a choice nobody should be punished for making
 * carefully.
 *
 * Both halves are derived (model/milestones.ts): what has been taken is on
 * the record, and what is waiting is read off the ladder, because two
 * representations of "a point is waiting" is one too many.
 */
export function statPointsEarned(game: GameRecord): number {
  return game.statPointsSpent
    + milestonesAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
}

/**
 * THE RUN'S TWO PROFILE VECTORS, AS MODIFIERS -- because that is what they
 * are: the same effect vocabulary as an item, resolved in the same pass.
 *
 * Neither is a HELD modifier. They occupy no carry slot, appear on no strip
 * and are counted in no holding total; they are prepended to the list the
 * resolver reads and nothing else, which is why `holdingCounts` is still
 * taken from what is actually held.
 *
 * The CLASS is deliberately absent. It contributes nothing to a profile --
 * it swaps combat choices and touches no number a stat block implies -- and
 * a class that leaked into the resolver would be a species with a different
 * name (model/vectors.ts).
 */
export function runVectorModifiers(game: GameRecord, content: Content): Modifier[] {
  const build = content.builds.find((candidate) => candidate.id === game.buildId) ?? null
  const species = content.species.find((candidate) => candidate.id === game.speciesId) ?? null
  return [buildModifier(build, playerTierOf(game)), speciesModifier(species)]
    .filter((layer): layer is Modifier => layer !== null)
}

/** The run's class, or null. What combat asks for its moves. */
export function runClass(game: GameRecord, content: Content): CombatClass | null {
  return content.combatClasses.find((candidate) => candidate.id === game.classId) ?? null
}

/**
 * THE PLAYER AS EVERY FORMULA SEES THEM, and the ONE place a run's profile is
 * resolved.
 *
 * Four call sites used to spell out the same triple -- base stats, held
 * modifiers, holding counts -- and an origin that resolves with the modifiers
 * would have had to be remembered at every one of them. That is this
 * codebase's characteristic failure written out in advance, so the triple is
 * a function instead: there is now no way to resolve a run's profile without
 * its origin in it.
 */
export function resolveRunProfile(
  game: GameRecord,
  content: Content,
  held: readonly Modifier[],
  situation?: Situation,
): EffectiveProfile {
  return resolveProfile(
    game.baseStats,
    [...runVectorModifiers(game, content), ...held],
    holdingCounts(held),
    situation,
  )
}

export function profileOf(save: GameSave, game: GameRecord, content: Content): EffectiveProfile {
  const held = heldModifiers(save, game.id, catalogFor(content, game.seed))
  // The record's own hit points ride along, so a conditional effect ("harder
  // to kill with their back to the wall") is already in every number every
  // caller reads. The record is written after each blow, so this is current
  // inside a fight as well as outside one.
  return resolveRunProfile(game, content, held, { hitPoints: game.hitPoints })
}

function nextSeq(rows: readonly { gameId: string; seq: number }[], gameId: string): number {
  return rows.reduce((highest, row) => (row.gameId === gameId ? Math.max(highest, row.seq) : highest), 0) + 1
}

function createGame(id: string, seed: RngState, nowMs: number, settings: GameSettings): GameRecord {
  const baseStats = createStatBlock(0)
  return {
    id,
    seed,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    status: 'active',
    level: 1,
    encounterIndex: 1,
    progression: clampProgression(settings.progression),
    successAdjust: settings.successAdjust,
    keepItemIds: [],
    keepTraitIds: [],
    regionId: null,
    baseStats,
    statPointsSpent: 0,
    experienceEarned: 0,
    experienceSpentOnTraits: 0,
    experienceToNextStatPoint: FIRST_MILESTONE_THRESHOLD,
    goldEarned: 0,
    goldSpentOnItems: 0,
    goldToNextFamePoint: FIRST_MILESTONE_THRESHOLD,
    famePointsSpent: 0,
    famePurchases: [],
    buildId: null,
    speciesId: null,
    classId: null,
    hitPoints: deriveStats(clampBaseStats(baseStats)).maxHitPoints,
  }
}

/**
 * Applies ONE effect to the save. Every write passes through here, which is
 * what makes "modules never write" enforceable rather than merely stated: a
 * stage that wants to change something it has no effect for has to add one,
 * in public, rather than reach into state from wherever it happens to be.
 *
 * Effects that need a game act on the ACTIVE one and are no-ops without it,
 * rather than throwing: a stage asking to heal a player who no longer
 * exists is a bug to see in a test, not a crash in somebody's evening.
 */
export function applyEffect(
  save: GameSave,
  effect: Effect,
  content: Content,
  nowMs: number,
): GameSave {
  if (effect.kind === 'startGame') {
    // The seed is drawn HERE, from the clock, because this is the director
    // acting rather than a stage: a stage that could read a clock would
    // stop being a pure function of its inputs, and the game would stop
    // being replayable. See core/rng.ts.
    // ...AND THE TUNING IS BAKED INTO IT. A run's content is a function of
    // what it was set up under, so the same clock at a different progression
    // is a different adventure -- which is what makes "this run was won at
    // 1.25" a thing a later unlock could be allowed to believe. Mixed rather
    // than stored twice: the record keeps the numbers as numbers (they are
    // read back and shown), and the seed keeps them as a fingerprint.
    const tuning = `${clampProgression(save.settings.progression).toFixed(2)}:${save.settings.successAdjust.toFixed(2)}`
    const seed = seedFrom(createSeed(nowMs), tuning)
    // The id is built from the CLOCK, so two games started in the same
    // millisecond were handed the same one -- the save then held two rows
    // with one id and `activeGame` returned the older, dead one, which is a
    // run that begins at zero hit points and ends on its first blow. Rare by
    // hand and instant in a test that passes a fixed clock. Disambiguated
    // against what the save already holds rather than made likelier to be
    // unique.
    let id = `game-${nowMs.toString(36)}-${seed.toString(36)}`
    for (let suffix = 2; save.games.some((existing) => existing.id === id); suffix += 1) {
      id = `game-${nowMs.toString(36)}-${seed.toString(36)}-${suffix}`
    }
    const game = createGame(id, seed, nowMs, save.settings)
    return {
      ...save,
      games: [...save.games, game],
      activeGameId: game.id,
      director: { ...save.director, rng: seed },
      profile: { ...save.profile, gamesStarted: save.profile.gamesStarted + 1 },
    }
  }

  if (effect.kind === 'openGame') {
    return save.games.some((game) => game.id === effect.gameId) ? { ...save, activeGameId: effect.gameId } : save
  }

  if (effect.kind === 'closeGame') return { ...save, activeGameId: null }

  const game = activeGame(save)
  if (!game) return save
  const gameId = game.id
  // The run's own catalog: items are rolled from the run's seed, so "what is a
  // Spyglass" is a different answer per run and there is nothing to thread in
  // from outside (content/index.ts's `catalogFor`, which memoizes).
  const catalog = catalogFor(content, game.seed)

  const replace = (next: Partial<GameRecord>): GameSave => ({
    ...save,
    games: save.games.map((candidate) => (candidate.id === gameId ? { ...candidate, ...next } : candidate)),
  })

  switch (effect.kind) {
    case 'adjustBaseStat':
      return replace({
        baseStats: clampBaseStats({ ...game.baseStats, [effect.stat]: game.baseStats[effect.stat] + effect.amount }),
      })

    case 'acquireModifier': {
      // ONE OF EACH THING, EVER. Two copies of an item are not two items --
      // every effect it carries is declarative and would simply apply twice,
      // so a duplicate is a silent doubling rather than a second object. The
      // pools that OFFER things already exclude what is held; this is the
      // same rule at the place it is actually applied, because an offer
      // filter is a rule stated at one caller and this is its sibling.
      const alreadyHeld = holdingsOf(save, gameId)
        .some((row) => row.kind === effect.modifierKind && row.modifierId === effect.modifierId)
      if (alreadyHeld) return save

      // ARMOR NEEDS NO SPECIAL CASE HERE any more, and that is the point of
      // putting it on the item: a new holding carries no `armorPoints`, which
      // means FULL (`armorOf`), so a fresh acquisition arrives whole without
      // an on-acquire event to fire exactly once and without a pool on the
      // record to add to.
      return {
        ...save,
        holdings: [
          ...save.holdings,
          { gameId, kind: effect.modifierKind, modifierId: effect.modifierId, seq: nextSeq(save.holdings, gameId) },
        ],
      }
    }

    case 'releaseModifier':
      return {
        ...save,
        holdings: save.holdings.filter(
          (row) => !(row.gameId === gameId && row.kind === effect.modifierKind && row.modifierId === effect.modifierId),
        ),
      }

    case 'adjustHitPoints': {
      const max = profileOf(save, game, content).derived.maxHitPoints
      return replace({ hitPoints: Math.max(0, Math.min(max, game.hitPoints + effect.amount)) })
    }

    case 'setArmor':
      // Points only. A piece's maximum and floor are what the item IS, so the
      // fight has nothing to say about them and cannot write them wrong.
      return writeArmor(save, gameId, { natural: 0, pieces: effect.pieces.map((piece) => ({ ...piece, max: piece.points, floor: 0 })) })

    case 'grantExperience':
      // Earning only ever adds. Spending is `spendExperience`, and it is a
      // different field on purpose -- see model/motes.ts.
      return replace({ experienceEarned: Math.max(0, game.experienceEarned + effect.units) })

    case 'spendExperience':
      return replace({
        experienceSpentOnTraits: Math.max(0, game.experienceSpentOnTraits + effect.units),
      })

    case 'allocateStatPoint': {
      // Gated on the LADDER, which is the only representation of "a point is
      // waiting" there is now. It used to be gated on a stored counter that
      // nothing incremented, so this effect could never do anything at all.
      if (!canAllocateStatPoint(game.experienceEarned, game.experienceToNextStatPoint)) return save
      const taken = takeMilestone(game.experienceToNextStatPoint, game.statPointsSpent)
      return replace({
        statPointsSpent: taken.pointsSpent,
        experienceToNextStatPoint: taken.threshold,
      })
    }

    case 'grantGold':
      // Earning only ever adds, exactly as with experience: the total is the
      // fame ladder's position. Spending is `spendGold`.
      return replace({ goldEarned: Math.max(0, game.goldEarned + effect.units) })

    case 'spendGold':
      return replace({ goldSpentOnItems: Math.max(0, game.goldSpentOnItems + effect.units) })

    case 'allocateFamePoint': {
      // The mirror of allocateStatPoint, on the same ladder, and gated the
      // same way: on the LADDER, which is the only representation of "a point
      // is waiting" there is. What a fame point BUYS is not written yet --
      // this only moves the ladder, which is the half that is settled.
      if (!canAllocateFamePoint(game.goldEarned, game.goldToNextFamePoint)) return save
      const taken = takeMilestone(game.goldToNextFamePoint, game.famePointsSpent)
      return replace({
        famePointsSpent: taken.pointsSpent,
        goldToNextFamePoint: taken.threshold,
      })
    }

    case 'buyFamePurchase': {
      // ONE EFFECT, so paid-but-not-granted and granted-but-not-paid are both
      // inexpressible. The obvious alternative -- the screen emitting
      // `allocateFamePoint` once per point of the price, then a grant -- is
      // two facts a caller has to keep in step, and a two-point unlock bought
      // with one point waiting would take the point and hand over the unlock
      // anyway, because each effect is applied against the state the last one
      // left.
      const purchase = famePurchaseById(effect.purchase)
      if (!purchase) return save
      const base = purchase.rule === 'carry' ? BASE_CARRY_LIMIT : BASE_KEEP_ALLOWANCE
      if (!canBuyMore(game.famePurchases, purchase, base)) return save
      if (famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent) < purchase.cost) {
        return save
      }
      // The ladder charges per point and the threshold moves each time, which
      // is what makes the SECOND point of a two-point unlock cost more gold to
      // have earned than the first. Iterating the price is not a retry: the
      // count is known before the loop starts.
      let threshold = game.goldToNextFamePoint
      let spent = game.famePointsSpent
      for (let point = 0; point < purchase.cost; point += 1) {
        const taken = takeMilestone(threshold, spent)
        threshold = taken.threshold
        spent = taken.pointsSpent
      }
      return replace({
        famePointsSpent: spent,
        goldToNextFamePoint: threshold,
        famePurchases: [...game.famePurchases, purchase.id],
      })
    }

    case 'setVector':
      // RECORDED, not applied. The build's points and the species' effects
      // resolve with the modifiers (`runVectorModifiers`), so the base block
      // stays purely what the player spent -- writing them in is what used to
      // cost a Warrior two of their own six Might points. ONE effect for the
      // three, keyed by which vector it sets, because they are the same act
      // three times and three near-identical effects is three places for the
      // next vector to be forgotten.
      return replace(
        effect.vector === 'build' ? { buildId: effect.id }
        : effect.vector === 'species' ? { speciesId: effect.id }
        : { classId: effect.id },
      )

    case 'setRegion':
      return replace({ regionId: effect.regionId })

    case 'advanceEncounter': {
      // One step along the level's ten, emitted by whatever stage SPENT the
      // encounter -- which is the loot screen on the way out, and combat
      // itself when the player ran. It counts past ten on purpose: eleven is
      // how the hub knows the level is over (stages/levelProgress.ts).
      //
      // AND THE KIT IS SEEN TO, here rather than in an effect of its own --
      // "after the fight" is exactly the moment this effect names, and every
      // stage that ends an encounter already emits it. A `repairArmor` effect
      // beside it would be a second statement of the same moment, and the
      // stage that forgot to emit it would be the one nobody noticed.
      const profile = profileOf(save, game, content)
      const repaired = repairAfterFight(
        armorOf(save, game, content),
        profile.stats.might,
        profile.stats.intellect,
        profile.armorRepair,
      )
      return writeArmor(replace({ encounterIndex: game.encounterIndex + 1 }), gameId, repaired)
    }

    case 'advanceLevel': {
      // A level is its own journey: the player rests up between them, gives
      // up everything they are carrying but what they marked to keep (one of
      // each kind today -- `keepAllowance`), and sets out again. Three things happen here and their ORDER is the rule (see
      // docs/adventure-game-design.md):
      //
      //   1. RESTORE hit points, against the maximum as it stands WITH
      //      everything still held.
      //   2. RELEASE what is not kept, which lowers that maximum.
      //   3. Let the ceiling rule bring the pool down to it
      //      (`followMaxHitPoints`, around every effect).
      //
      // Restoring first is what keeps the fall landing on a FULL pool rather
      // than driving a depleted one somewhere it should never go. The clamp
      // makes the result the same either way today -- the order is what makes
      // it stay that way when something subtracts a delta instead.
      const heldBefore = heldModifiers(save, gameId, catalog)
      const restored = resolveRunProfile(game, content, heldBefore).derived.maxHitPoints

      // Everything that survives, both kinds, as the holdings that carry
      // those ids. Duplicates cannot exist (`acquireModifier`), so an id
      // names one row and there is nothing to choose between.
      const kept = new Set((['item', 'trait'] as const).flatMap((kind) => keptModifierIds(save, game, kind)))

      const holdings = save.holdings.filter((row) => row.gameId !== gameId || kept.has(row.modifierId))

      // WHOLE AGAIN. A level is a journey with a rest at either end, so what
      // survives it is repaired outright -- which is also what makes carrying
      // a battered shield over a real choice rather than a formality.
      const refilled = writeArmor(
        { ...save, holdings },
        gameId,
        refillArmor(armorOf({ ...save, holdings }, game, content)),
      )

      return {
        ...refilled,
        games: refilled.games.map((candidate) => (candidate.id === gameId
          ? {
              ...candidate,
              level: candidate.level + 1,
              // A new journey starts at its first encounter. The counter is
              // per level, not per run.
              encounterIndex: 1,
              hitPoints: restored,
              // The marks are spent. A new level's default is its own newest
              // find, not a decision taken a level ago.
              keepItemIds: [],
              keepTraitIds: [],
            }
          : candidate)),
      }
    }

    case 'endGame': {
      const ended = replace({ status: 'over', endedReason: effect.reason })
      return {
        ...ended,
        profile: {
          ...ended.profile,
          gamesEnded: ended.profile.gamesEnded + 1,
          // Everything the run ever ATTAINED, not what is left in hand: a
          // player who spent their fame points did not score less for it.
          bestFame: Math.max(
            ended.profile.bestFame,
            fameReached(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent),
          ),
        },
      }
    }

    case 'recordOutcome':
      return {
        ...save,
        outcomes: [
          ...save.outcomes,
          { gameId, seq: nextSeq(save.outcomes, gameId), outcome: effect.outcome, payload: effect.payload ?? {} },
        ],
      }
  }
}

/**
 * HIT POINTS FOLLOW THEIR CEILING, in both directions, after every single
 * effect.
 *
 * This is NOT healing, and the rule says why (docs/adventure-game-design.md):
 * current and maximum move TOGETHER, so nothing that was lost is restored and
 * the equation stays readable. Raising the maximum on its own would be
 * *taking damage* equal to the delta -- which is the real reason the grant is
 * not optional, over and above "+25 hit points" otherwise being a number on
 * the tab bar that changed nothing.
 *
 * A fall is the same rule from the other end: dropping the item that granted
 * the ceiling cannot leave a character standing above their own maximum. Its
 * one planned moment is the end of a level, where items and traits are given
 * up -- and there the ORDER matters: restore hit points first, then remove
 * them, so the fall lands on a full pool rather than driving a depleted one
 * to nothing.
 *
 * Applied here, once, around every effect, rather than in the two or three
 * branches that happen to change a maximum today -- a rule stated once has to
 * hold everywhere it applies, and the next effect that moves the ceiling will
 * not know to ask.
 */
function followMaxHitPoints(before: GameSave, after: GameSave, content: Content): GameSave {
  const previous = activeGame(before)
  const current = activeGame(after)
  if (!current) return after
  // A run that has only just started has no hit points to follow: character
  // creation fills them at the end, on purpose (see that stage).
  if (!previous || previous.id !== current.id) return after

  const wasMax = profileOf(before, previous, content).derived.maxHitPoints
  const nowMax = profileOf(after, current, content).derived.maxHitPoints
  const gained = Math.max(0, nowMax - wasMax)
  const hitPoints = Math.max(0, Math.min(nowMax, current.hitPoints + gained))
  if (hitPoints === current.hitPoints) return after
  return {
    ...after,
    games: after.games.map((game) => (game.id === current.id ? { ...game, hitPoints } : game)),
  }
}

export function applyEffects(
  save: GameSave,
  effects: readonly Effect[],
  content: Content,
  nowMs: number,
): GameSave {
  const next = effects.reduce(
    (current, effect) => followMaxHitPoints(current, applyEffect(current, effect, content, nowMs), content),
    save,
  )
  if (!next.activeGameId) return next
  const stamped = {
    ...next,
    games: next.games.map((game) => (game.id === next.activeGameId ? { ...game, updatedAtMs: nowMs } : game)),
  }
  // PERMANENT UNLOCKS ARE DERIVED, here, after every effect -- for the same
  // reason `followMaxHitPoints` is applied here rather than in the branches
  // that happen to move a ceiling today: the next effect that satisfies a
  // condition will not know to ask. The set only grows, so this cannot
  // retract one that a later effect made false again.
  const unlocked = withUnlocksEarnedBy(stamped.profile.unlocked, activeGame(stamped))
  return unlocked === stamped.profile.unlocked
    ? stamped
    : { ...stamped, profile: { ...stamped.profile, unlocked } }
}

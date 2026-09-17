// The master: it decides which stage is current, composes the ring, and is
// the only thing in the game that writes.
//
// Everything the player sees is one Screen, and the stage on top of the
// stack supplies all of it. The director USED to add cells of its own --
// acquired items, acquired traits, leave -- to every screen; it no longer
// adds any. Three permanent cells cost three of the twelve the dial can
// hold, on every screen, to say things that are either always available
// elsewhere (what you are carrying now lives on the timeline strip, always
// visible, rather than behind a cell and a screen) or needed on exactly one
// screen (leaving, which the welcome stage offers as an ordinary choice).
// What is left here is sequencing and nothing else, which is what this file
// always claimed to be.
//
// A STACK, not a current stage, because the design has interludes: looking
// at your traits is reachable from every screen and must give you back the
// screen you were on, and a fight has decisions inside it that are not the
// fight itself. One current stage could only express that by making every
// stage save and restore its own suspended state, which is the same
// mechanism written once per stage instead of once here.
//
// The director holds NO rules. It does not know that zero hit points ends a
// game or that a boss ends a level; a stage that deals the damage says so
// by handing off. Everything the director knows is in this file, and it is
// all about sequencing.

import { applyEffects, activeGame, armorOf, heldModifiers, profileOf, type GameSave, type StageFrame } from '../model/gameState'
import { NO_ARMOR } from '../model/armor'
import { catalogFor, rolledItems } from '../content'
import type { Effect } from '../model/effects'
import type { Content } from '../content'
import type { JsonObject } from './json'
import type { RngState } from './rng'
import type { Screen } from './screen'
import type { Narration, StageContext, StageModule, StageRegistry, Transition } from './stage'

export interface DirectorDeps {
  stages: StageRegistry
  content: Content
  /** Where an empty stack starts, and what opening the view puts on top. */
  rootStageId: string
}

/**
 * THE CATALOG IS A FUNCTION OF THE RUN, not a dependency handed in.
 *
 * Items are rolled from the run's own seed (content/index.ts's `catalogFor`),
 * so a catalog built once at start-up would describe whichever game happened
 * to be open then -- and would go on describing it after the player started
 * another. Resolving it from the save at every context build is both correct
 * by construction and free: `catalogFor` memoizes per seed.
 */
export function buildContext(save: GameSave, deps: DirectorDeps): StageContext {
  const game = activeGame(save)
  const catalog = catalogFor(deps.content, game?.seed ?? 0)
  const held = game ? heldModifiers(save, game.id, catalog) : []
  return {
    save,
    game,
    content: deps.content,
    catalog,
    items: rolledItems(deps.content, game?.seed ?? 0),
    profile: game ? profileOf(save, game, deps.content) : null,
    armor: game ? armorOf(save, game, catalog) : NO_ARMOR,
    held,
  }
}

/**
 * A stage's narration as the director stores it: newest first, always a list.
 *
 * The one narration rule the director holds, and it is a shape rule rather
 * than a policy one -- see core/stage.ts for why appending is deliberately
 * not on offer.
 *
 * Hands back the PREVIOUS array when the entries are the same, because
 * `withDirector` decides "did anything change" by identity: a stage that
 * narrates the same line twice (every stage that declines a choice does)
 * would otherwise hand back a fresh array every time and make the save look
 * changed, which persists a byte-identical save to disk. Comparing content
 * here rather than teaching `withDirector` about this one field keeps that
 * function's rule general.
 */
function narrationLog(narration: Narration, previous: string[]): string[] {
  const next = typeof narration === 'string' ? [narration] : [...narration]
  const same = next.length === previous.length && next.every((entry, index) => entry === previous[index])
  return same ? previous : next
}

function stageOf(deps: DirectorDeps, stageId: string): StageModule | null {
  return deps.stages.get(stageId) ?? null
}

function topFrame(save: GameSave): StageFrame | null {
  return save.director.stack[save.director.stack.length - 1] ?? null
}

interface Applied {
  save: GameSave
  rng: RngState
}

function commit(
  save: GameSave,
  effects: readonly Effect[] | undefined,
  rng: RngState,
  deps: DirectorDeps,
  nowMs: number,
): Applied {
  const next = effects && effects.length > 0 ? applyEffects(save, effects, deps.content, nowMs) : save
  return { save: next, rng }
}

/**
 * Patches the director, and returns the SAME save when the patch changes
 * nothing.
 *
 * Identity is load-bearing here rather than an optimisation: the host
 * commits (and therefore persists) exactly when `choose` hands back a
 * different save, so a transition that genuinely changes nothing --
 * leaving, an unrecognised choice, a stage that declines -- must come back
 * identical or every one of them writes a byte-identical save to disk. It
 * is also what makes "reports leaving as a host action and changes nothing
 * itself" a testable claim instead of a description.
 */
function withDirector(
  save: GameSave,
  next: Partial<GameSave['director']>,
): GameSave {
  const merged = { ...save.director, ...next }
  const keys = Object.keys(next) as (keyof GameSave['director'])[]
  const changed = keys.some((key) => merged[key] !== save.director[key])
  return changed ? { ...save, director: merged } : save
}

/**
 * Enters a stage and puts it on the stack at `depth`, discarding anything
 * at or above it. `enter` may roll and may emit effects -- it runs once per
 * entry, which is the point: a fight generates its enemy here, not while
 * being looked at.
 */
function enterStage(
  save: GameSave,
  stageId: string,
  input: JsonObject,
  depth: number,
  deps: DirectorDeps,
  nowMs: number,
): GameSave {
  const stage = stageOf(deps, stageId)
  if (!stage) return save

  const entry = stage.enter(input, buildContext(save, deps), save.director.rng)
  const committed = commit(save, entry.effects, entry.rng, deps, nowMs)
  const stack = [...committed.save.director.stack.slice(0, depth), { stageId, state: entry.state }]

  return withDirector(committed.save, {
    stack,
    rng: entry.rng,
    narration: entry.narration === undefined ? committed.save.director.narration : narrationLog(entry.narration, committed.save.director.narration),
  })
}

/**
 * What opening the view puts on screen: ALWAYS the root stage, pushed on top
 * of whatever was already there.
 *
 * Coming back to the exact screen you left is what the persisted stack is
 * for, and it stays true -- but it is not what a player wants the moment
 * they open the view. Re-entering a fight mid-swing with no idea how you got
 * there is disorienting, and there is no way back out to "start a new one"
 * from inside it. So the entry screen goes ON TOP: the run underneath is
 * untouched, and answering "continue" is a `pop` back into it, exactly the
 * screen, exactly the roll state. Nothing is discarded to offer the choice.
 *
 * The root frame is told whether it landed on top of a suspended run
 * (`hasSuspendedRun`), because that is a fact about the stack and a stage
 * does not read the stack -- it reads what it was entered with.
 *
 * THIS IS AN EVENT, NOT A CONDITION, and the name says so because getting
 * that wrong is exactly what happened: its predecessor was "put the player
 * somewhere if they are nowhere", which is a condition and was therefore
 * safe to re-check on every save change -- which is what its one caller
 * does. Re-checking THIS on every save change pushes the entry screen back
 * on top after every choice, so the player can never leave it. It is called
 * once per opening (see useAdventureEscapeMenu), and the root-already-on-top
 * guard below is a second belt for a double-invoked effect, not the thing
 * that makes it correct.
 *
 * Called when the view OPENS rather than during render, because entering a
 * stage may roll, and a roll during render is the one thing determinism
 * cannot survive (core/rng.ts).
 */
export function enterEntryScreen(save: GameSave, deps: DirectorDeps, nowMs: number): GameSave {
  const frame = topFrame(save)
  if (frame?.stageId === deps.rootStageId) return save
  return enterStage(
    save,
    deps.rootStageId,
    { hasSuspendedRun: save.director.stack.length > 0 },
    save.director.stack.length,
    deps,
    nowMs,
  )
}

/**
 * Opens an INTERLUDE on top of whatever is on screen: a stage reached from
 * the chrome rather than from the ring.
 *
 * The chrome's rail reports two standing quantities of the run, and pressing
 * one goes to where that quantity is spent (escapeMenuContract.ts's
 * `EscapeMenuChromeGauge`). That is a way IN, not a decision -- the decision
 * is still taken in the ring, on the screen this puts there -- but the
 * director is the only thing that writes, so it has to come through here
 * rather than through a stage that does not know it is being asked.
 *
 * PUSHED, never replaced, for the reason the stat-point screen already gives:
 * what is underneath keeps its rolled encounter or its half-fought round, and
 * the interlude pops back onto it untouched.
 *
 * ALREADY ON TOP is a no-op, which is what makes the same press twice
 * harmless -- and, because `withDirector` compares by identity, hands back
 * the same save so nothing is persisted for it.
 *
 * An EVENT, like `enterEntryScreen`, and named so for the same reason: it is
 * called from a press, never re-checked as a condition.
 */
export function enterInterlude(save: GameSave, stageId: string, deps: DirectorDeps, nowMs: number): GameSave {
  if (topFrame(save)?.stageId === stageId) return save
  return enterStage(save, stageId, {}, save.director.stack.length, deps, nowMs)
}

/**
 * What to show right now. Pure: no rolls, no writes, no effects. Safe to
 * call on every render, which is exactly why it has to be.
 */
export function currentScreen(save: GameSave, deps: DirectorDeps): Screen | null {
  const frame = topFrame(save)
  if (!frame) return null
  const stage = stageOf(deps, frame.stageId)
  if (!stage) return null

  const context = buildContext(save, deps)
  const presentation = stage.present(frame.state, context)

  return {
    stageId: frame.stageId,
    // Depth is part of the key so that pushing an interlude and popping
    // back counts as a new question for the dial, even when the stage
    // underneath is presenting exactly what it was before.
    screenKey: `${save.director.stack.length}:${frame.stageId}:${presentation.screenKey ?? frame.stageId}`,
    narration: save.director.narration,
    choices: presentation.choices,
  }
}

export interface ChoiceResult {
  save: GameSave
  /**
   * The one act the game cannot perform for itself: giving the editor slot
   * back. Null unless the player asked to leave.
   */
  hostAction: 'leave' | null
}

function applyTransition(
  save: GameSave,
  transition: Transition,
  depth: number,
  deps: DirectorDeps,
  nowMs: number,
): ChoiceResult {
  const committed = commit(save, transition.effects, transition.rng, deps, nowMs)
  const narrated = withDirector(committed.save, {
    rng: transition.rng,
    narration: 'narration' in transition && transition.narration !== undefined
      ? narrationLog(transition.narration, committed.save.director.narration)
      : committed.save.director.narration,
  })

  switch (transition.kind) {
    case 'stay': {
      const stack = [...narrated.director.stack]
      stack[depth] = { stageId: stack[depth].stageId, state: transition.state }
      return { save: withDirector(narrated, { stack }), hostAction: null }
    }

    case 'push':
      return {
        save: enterStage(narrated, transition.stageId, transition.input ?? {}, depth + 1, deps, nowMs),
        hostAction: null,
      }

    case 'replace':
      return {
        save: enterStage(narrated, transition.stageId, transition.input ?? {}, depth, deps, nowMs),
        hostAction: null,
      }

    case 'pop': {
      const stack = narrated.director.stack.slice(0, depth)
      // Popping the last frame leaves the player nowhere, so the root stage
      // catches them. That is how a finished game gets back to the welcome
      // screen without every ending stage having to name it.
      if (stack.length === 0) {
        return { save: enterStage(withDirector(narrated, { stack }), deps.rootStageId, {}, 0, deps, nowMs), hostAction: null }
      }
      return { save: withDirector(narrated, { stack }), hostAction: null }
    }

    case 'reset':
      // The only transition that discards frames BELOW it. Starting a new
      // adventure from the entry screen has to clear the suspended run it
      // was offered on top of; `replace` swaps one frame and would leave
      // that run buried under the new one, reachable by a pop nobody meant.
      return {
        save: enterStage(narrated, transition.stageId, transition.input ?? {}, 0, deps, nowMs),
        hostAction: null,
      }

    case 'leave':
      return { save: narrated, hostAction: 'leave' }
  }
}

/**
 * Answers the current screen. The single entry point for player input, and
 * therefore the single place a game changes.
 *
 * An unknown choice id returns the save UNCHANGED rather than throwing: the
 * ring can only offer what was presented, so an id that is not on offer is
 * either a stale click during a rebuild or a bug, and neither is worth
 * corrupting a game over.
 */
export function choose(save: GameSave, choiceId: string, deps: DirectorDeps, nowMs: number): ChoiceResult {
  const frame = topFrame(save)
  if (!frame) return { save, hostAction: null }

  const context = buildContext(save, deps)
  const depth = save.director.stack.length - 1

  const stage = stageOf(deps, frame.stageId)
  if (!stage) return { save, hostAction: null }

  const offered = stage.present(frame.state, context).choices
  if (!offered.some((choice) => choice.id === choiceId)) return { save, hostAction: null }

  const transition = stage.resolve(frame.state, choiceId, context, save.director.rng)
  return applyTransition(save, transition, depth, deps, nowMs)
}

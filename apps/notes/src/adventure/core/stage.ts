// WHAT A STAGE IS, stated precisely.
//
// A stage is a VALUE of the `StageModule` interface below: an id, a title,
// and three functions. There is no class, no instance and no lifecycle --
// the thirteen stages are module-level constants collected into one
// `ReadonlyMap<string, StageModule>` keyed by id. "Entering combat" is
// pushing the string "combat" onto an array and calling `combat.enter` once.
//
// The three functions partition the job:
//
//   enter(input, context, rng)            -> StageEntry
//       Called ONCE, when a frame for this stage is created. May consume
//       randomness. May return effects.
//   present(state, context)               -> StagePresentation
//       Called on EVERY render, arbitrarily often. Takes no rng and its
//       result type has no effects field, so it can do neither.
//   resolve(state, choiceId, context, rng) -> Transition
//       Called once per choice taken. May consume randomness. May return
//       effects. Says what happens to the stack.
//
// PURE, in the mathematical sense: the result is determined by the arguments
// and evaluating it changes nothing. `present` is pure outright --
// present(s, c) = present(s, c), which matters because React decides how
// often it runs. `enter` and `resolve` are pure too despite rolling dice:
// the generator is a number passed in as `rng` and its successor comes back
// in the result (core/rng.ts), so randomness is threaded rather than
// ambient, which is what makes a run replayable from its seed alone.
//
// NEVER WRITES means: no stage function has `GameSave` in its return type.
// A stage that wants the save changed returns values of type `Effect` --
// { kind: 'addGold', amount: 30 } and so on -- which are inert data. One
// function turns them into a new save:
//
//   applyEffects(save, effects, content, nowMs) -> GameSave
//
// It is a fold: each effect is applied to the state the previous one left,
// and it returns a new object rather than mutating. Its only callers are
// `applyTransition` and `enterStage` in core/director.ts. So every rule
// about when a change is legal lives in one place, and a stage is testable
// by calling it with a literal state object and comparing the effect array
// it hands back -- no database, no app.
//
// A stage also does not touch the ring, and does not know another stage
// exists; it names a successor only by id, in a Transition.
//
// THREE RULES ARE ENFORCED BY THESE TYPES RATHER THAN BY DISCIPLINE:
//
//   1. Stage state is `JsonObject` -- no closures, no class instances, no
//      Maps. The player can leave at ANY screen and come back to it, which
//      is only true if every frame of the stack survives a round trip
//      through disk. One live object anywhere and that promise breaks for
//      whoever happens to quit at that moment, with nothing to catch it.
//
//   2. `present` receives NO random state. Every roll happens in `enter` or
//      `resolve` and its outcome is stored in stage state until it is
//      shown. A stage that rolled while building its cells would make the
//      draw order depend on how many times React re-rendered -- and the
//      game would stop being replayable with no symptom at all.
//
//   3. `present` cannot return effects. Looking at a screen changes
//      nothing; only answering it does.
//
// The second rule is also a design one. Choices are PRE-RESOLVED: "dodge"
// appears in the ring because the dodge roll already succeeded, so picking
// it cannot fail. The ring tells you what is possible, which is how a stat
// point shows itself -- as options appearing, rather than as a number you
// are asked to trust.

import type { JsonObject } from './json'
import type { RngState } from './rng'
import type { Effect } from '../model/effects'
import type { DescriptionStyle, EffectiveProfile, Modifier } from '../model/modifiers'
import type { Armor } from '../model/armor'
import type { GameRecord, GameSave } from '../model/gameState'
import type { Content } from '../content'
import type { Choice } from './screen'

/**
 * Everything a stage may read. All of it is a snapshot: a stage that wants
 * something changed says so in an effect.
 */
export interface StageContext {
  save: GameSave
  /** Null on the welcome screen, which runs before any game exists. */
  game: GameRecord | null
  content: Content
  catalog: ReadonlyMap<string, Modifier>
  /**
   * THE RUN'S TWO POOLS, rolled -- content's templates as this run made them,
   * in content's own order (model/modifierSlots.ts). Beside `catalog` because
   * a stage offering something needs the POOL and not only a lookup, and
   * rolling one per stage would have every stage remember to pass the run's
   * seed.
   *
   * Two fields rather than one list a stage filters: gold buys from one and
   * experience from the other, and every screen that offers already knows
   * which of the two it is.
   */
  items: readonly Modifier[]
  traits: readonly Modifier[]
  /** Resolved stats, or null when there is no game to resolve them for. */
  profile: EffectiveProfile | null
  /**
   * THE RUN'S ARMOR, assembled from the items that carry it plus every
   * non-decaying point (model/armor.ts). Beside the profile rather than on it:
   * a profile is what a character is WORTH and is recomputed from nothing,
   * while armor is a quantity currently SPENT DOWN and lives on the holdings.
   */
  armor: Armor
  /** Everything the active game holds, in acquisition order. */
  held: readonly Modifier[]
  /**
   * HOW MUCH A DESCRIPTION EXPLAINS ITSELF (model/modifiers.ts), resolved
   * from the save's settings ONCE by the director rather than re-derived at
   * every describer call. A stage passes it on; it never reads the setting.
   */
  describe: DescriptionStyle
}

/**
 * What a stage says the bar should show, NEWEST FIRST.
 *
 * A bare string is one entry and the ordinary case. A LIST is a stage that
 * accumulates -- a combat round shows every action in it, newest at the head
 * -- and it hands back the WHOLE list every time rather than an instruction
 * to append.
 *
 * That is deliberate and it is what keeps the director free of narration
 * policy: appending would make the director own a log, and owning a log means
 * owning the question of when it is cleared, which is a rule about rounds
 * that only the fight knows. A stage that accumulates keeps its own entries in
 * its own state, where they are already persisted with everything else it
 * remembers, and cuts them back when its own rules say the sequence is over.
 */
export type Narration = string | readonly string[]

/** What a stage hands back when it is entered. */
export interface StageEntry {
  state: JsonObject
  /** What just happened. Shown on the chapter bar above the first screen this stage presents. */
  narration?: Narration
  effects?: readonly Effect[]
  rng: RngState
}

/** What a stage hands back when it has resolved a choice. */
export type Transition =
  /** Stay in this stage with new state -- the next screen is this stage's too. */
  | { kind: 'stay'; state: JsonObject; narration?: Narration; effects?: readonly Effect[]; rng: RngState }
  /** Put another stage on top of this one. This stage's state is kept, untouched, underneath. */
  | { kind: 'push'; stageId: string; input?: JsonObject; narration?: Narration; effects?: readonly Effect[]; rng: RngState }
  /** Finish, and give the screen back to whatever was underneath. */
  | { kind: 'pop'; narration?: Narration; effects?: readonly Effect[]; rng: RngState }
  /** Finish, and hand off to another stage at the same depth. */
  | {
      kind: 'replace'
      stageId: string
      input?: JsonObject
      narration?: Narration
      effects?: readonly Effect[]
      rng: RngState
    }
  /**
   * Clear the WHOLE stack and start again at this stage. Its own kind
   * rather than a flag on `replace`, because every other transition here
   * preserves what it did not touch and starting over is exactly the act
   * that does not.
   */
  | {
      kind: 'reset'
      stageId: string
      input?: JsonObject
      narration?: Narration
      effects?: readonly Effect[]
      rng: RngState
    }
  /** Close the whole game view and give the editor slot back. The one thing only the host can do. */
  | { kind: 'leave'; effects?: readonly Effect[]; rng: RngState }

export interface StagePresentation {
  choices: Choice[]
  /**
   * Changes exactly when this stage is asking a NEW question, so the ring
   * can reset its dial. Defaults to the stage id when omitted, which is
   * right for a stage that only ever asks one thing.
   */
  screenKey?: string
}

export interface StageModule {
  id: string
  /**
   * What this stage is called on the chrome's counter -- "Combat",
   * "Character Creation". The stage names itself because the name belongs to
   * the stage, not to a table somewhere that has to be kept in step with the
   * registry; a stage added without one will not compile.
   */
  title: string
  /** Builds initial state. May roll: this runs once, when the stage is entered. */
  enter(input: JsonObject, context: StageContext, rng: RngState): StageEntry
  /** Builds the current screen. Pure, no rolls, no effects -- see the module comment. */
  present(state: JsonObject, context: StageContext): StagePresentation
  /** Answers the current screen. This is where rolls happen. */
  resolve(state: JsonObject, choiceId: string, context: StageContext, rng: RngState): Transition
}

export type StageRegistry = ReadonlyMap<string, StageModule>

export function registerStages(stages: readonly StageModule[]): StageRegistry {
  return new Map(stages.map((stage) => [stage.id, stage]))
}

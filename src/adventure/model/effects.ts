// What a stage can ask the world to change.
//
// Stages are pure and NEVER write. A stage resolving a choice returns a
// list of these, and the director applies them to game state in order --
// which is what keeps every stage testable without a database, keeps
// persistence in exactly one place, and makes "what did that choice
// actually do" a value you can print rather than a trail through call
// sites.
//
// The vocabulary is deliberately small and grows only when a screen needs
// something it cannot say. An effect that exists because it might be useful
// one day is an effect nobody can delete later.

import type { Difficulty } from './difficulty'
import type { StatKey } from './stats'
import type { ModifierKind } from './modifiers'
import type { JsonObject } from '../core/json'

export type Effect =
  /**
   * Opens a new game slot and makes it the active one. Carries no seed and
   * no id: the director owns the clock, so that a stage -- which must be a
   * pure function of its inputs to stay replayable -- never sees one.
   */
  | { kind: 'startGame' }
  /**
   * The difficulty the NEXT run is played at. Not the current one: a preset
   * changed mid-run would rewrite what every fight already fought was worth
   * (model/gameState.ts).
   */
  | { kind: 'setDifficulty'; difficulty: Difficulty }
  /** Makes an existing slot active -- "continue previous adventure". */
  | { kind: 'openGame'; gameId: string }
  /** Leaves the current slot without ending the game. Back to the welcome screen. */
  | { kind: 'closeGame' }
  /** Character creation and stat points. Clamped to the base cap on apply. */
  | { kind: 'adjustBaseStat'; stat: StatKey; amount: number }
  /** Takes a modifier into the game: holdings, and any on-acquire effect it carries. */
  | { kind: 'acquireModifier'; modifierKind: ModifierKind; modifierId: string }
  /** Drops one, by id. Used by end-of-level keep-one-of-each. */
  | { kind: 'releaseModifier'; modifierKind: ModifierKind; modifierId: string }
  /** Negative for damage taken, positive for healing. Clamped to 0..max on apply. */
  | { kind: 'adjustHitPoints'; amount: number }
  /**
   * Armor after an absorb, per ITEM -- the fight's working copy mirrored back
   * onto the holdings that own the points (model/armor.ts).
   *
   * Points only. A piece's maximum and its decay floor are properties of the
   * item as this run rolled it, so there is nothing about them for a fight to
   * write, and no way for a fight to write them wrong.
   */
  | { kind: 'setArmor'; pieces: readonly { itemId: string; points: number }[] }
  /** Quantized: one unit buys one selection at the start of a level. */
  | { kind: 'grantExperience'; units: number }
  /**
   * Spending motes on a trait. A DIFFERENT effect from earning, not a
   * negative grant: the milestone track reads only what was earned, so
   * spending must not be able to reach it (model/motes.ts).
   */
  | { kind: 'spendExperience'; units: number }
  /**
   * Putting an EARNED stat point into a stat. Pushes the next threshold away;
   * the STAT it goes into is `adjustBaseStat`, emitted alongside, because
   * which stat is the game's business and the threshold is the platform's.
   *
   * Whether a point is available is DERIVED from the ladder
   * (`model/milestones.ts`) rather than stored, so there is nothing to grant
   * and no counter that can disagree with the earnings that produced it.
   */
  | { kind: 'allocateStatPoint' }
  | { kind: 'grantGold'; units: number }
  | { kind: 'spendGold'; units: number }
  /**
   * Spending a fame point. Like `allocateStatPoint`, whether one is available
   * is DERIVED from the ladder (`model/gold.ts`) rather than stored -- there
   * is no grant to go with it, and no counter that can disagree with the
   * gold that produced it.
   */
  | { kind: 'allocateFamePoint' }
  /**
   * BUYING one of the run's fame purchases (model/famePurchases.ts), price and
   * grant together.
   *
   * Atomic on purpose: the price is several points for some of them, and a
   * screen emitting `allocateFamePoint` once per point followed by a grant
   * would be able to half-apply -- each effect is applied against the state
   * the last one left, so a two-point purchase made with one point waiting
   * would take the point and hand over the purchase anyway. Refused outright
   * when the run cannot afford it or the rule is already at its ceiling.
   */
  | { kind: 'buyFamePurchase'; purchase: string }
  /**
   * Which CLASS this run is playing. Recorded rather than applied: a class
   * resolves with the modifiers (model/gameState.ts's `originModifier`), so
   * the base stat block stays purely what the player spent and every run has
   * all six points in every stat to spend.
   */
  | { kind: 'setOrigin'; originId: string }
  /** Which region this level is being played in, and therefore which pools are in scope. */
  | { kind: 'setRegion'; regionId: string }
  /** One of the level's ten encounters spent. See stages/levelProgress.ts. */
  | { kind: 'advanceEncounter' }
  | { kind: 'advanceLevel' }
  /** Ends the game. `defeat` when hit points ran out, `retired` at the player's word. */
  | { kind: 'endGame'; reason: 'defeat' | 'retired' }
  /**
   * Appends to the game's permanent history. ROWS, not columns: new content
   * introduces a new `kind` and touches no schema, which is what keeps
   * outcome tracking additive as the game grows.
   */
  | { kind: 'recordOutcome'; outcome: string; payload?: JsonObject }

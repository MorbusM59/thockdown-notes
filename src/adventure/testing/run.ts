// Test-only helpers for getting a run into a state worth asserting about.
//
// NOT SHIPPED CODE -- nothing outside a `.test.ts` imports this, and
// `testing.contract.test.ts` fails if anything does. It lives in `src/` rather
// than beside one of the suites because five of them walk character creation
// and five copies of that walk is five places to update the day a question is
// added to it. That day was today: creation went from three questions to five
// when the four vectors landed, and every one of those copies broke.

import { choose, currentScreen, type DirectorDeps } from '../core/director'
import { THOCKQUEST } from '../content'
import { applyEffects, emptySave, type GameSave } from '../model/gameState'
import { STAGES, ROOT_STAGE_ID } from '../stages'
import { enterEntryScreen } from '../core/director'

export const DEPS: DirectorDeps = { stages: STAGES, content: THOCKQUEST, rootStageId: ROOT_STAGE_ID }

export const NOW = 1_700_000_000_000

/** A save sitting on the welcome screen, with nothing played. */
export function freshSave(seed = 1): GameSave {
  return enterEntryScreen(emptySave(seed), DEPS, NOW)
}

/**
 * A run walked all the way through character creation and standing on the
 * region select.
 *
 * TAKES THE FIRST CELL of every screen rather than naming what it wants, and
 * that is not laziness -- character creation DEALS its vectors from a larger
 * pool (`CREATION_OFFER_COUNT`), so an id named here is an id that may simply
 * not be on the ring for this seed, and the walk would stall on a screen with
 * no visible reason. A test that needs a particular build or class says so
 * with `withVectors` below, which writes the record directly.
 */
export function createdRun(options: { seed?: number } = {}): GameSave {
  let save = freshSave(options.seed ?? 1)
  save = choose(save, 'welcome:start', DEPS, NOW).save
  // Five questions: build, species, class, trait, item.
  for (let step = 0; step < 5; step += 1) {
    const first = currentScreen(save, DEPS)?.choices[0]
    if (!first) break
    save = choose(save, first.id, DEPS, NOW).save
  }
  return save
}

/**
 * The run's vectors, set directly.
 *
 * Through the real effect, so it goes the one route every write goes -- but
 * WITHOUT the screen, because what a test wants here is a character, not a
 * walk through the cells that would have produced one.
 */
export function withVectors(
  save: GameSave,
  vectors: { build?: string; species?: string; combatClass?: string },
): GameSave {
  const effects = [
    ...(vectors.build ? [{ kind: 'setVector' as const, vector: 'build' as const, id: vectors.build }] : []),
    ...(vectors.species ? [{ kind: 'setVector' as const, vector: 'species' as const, id: vectors.species }] : []),
    ...(vectors.combatClass ? [{ kind: 'setVector' as const, vector: 'class' as const, id: vectors.combatClass }] : []),
  ]
  return applyEffects(save, effects, THOCKQUEST, NOW)
}

/** The stage currently on top, for a test that wants to assert where it landed. */
export function stageOf(save: GameSave): string {
  return currentScreen(save, DEPS)?.stageId ?? ''
}

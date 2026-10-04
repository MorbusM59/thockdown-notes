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

/**
 * The run's vectors set AND everything it picked up at creation dropped, so
 * the character is EXACTLY the three vectors and the tier and nothing else.
 *
 * Creation hands out a trait and an item as well as the three vectors, and
 * both are dealt -- so a test that pins only the vectors still has two
 * unnamed modifiers deciding how hard it hits and how long it lives. That is
 * fine until the content grows and the deals shift, at which point a suite
 * whose premise was "a fight that lasts" quietly becomes one about a fight
 * that does not. Naming the whole character is the only version of the
 * premise that survives a content edit.
 */
export function withVectorsOnly(
  save: GameSave,
  vectors: { build?: string; species?: string; combatClass?: string },
): GameSave {
  const game = save.games.find((candidate) => candidate.id === save.activeGameId)
  if (!game) return save
  const dropped = applyEffects(
    save,
    save.holdings
      .filter((row) => row.gameId === game.id)
      .map((row) => ({ kind: 'releaseModifier' as const, modifierKind: row.kind, modifierId: row.modifierId })),
    THOCKQUEST,
    NOW,
  )
  return withVectors(dropped, vectors)
}

/**
 * THE CELL A WALKING TEST SHOULD PRESS: the first one that is not the way
 * OUT OF THE GAME.
 *
 * Seven copies of this lived across five suites as
 * `!candidate.id.endsWith(':leave')`, which is the right idea and the wrong
 * predicate: it was written to avoid `welcome:leave`, the one cell that shuts
 * the adventure down, and it also caught `market:leave` -- an ordinary way
 * back from a screen whose only other cells are things you cannot currently
 * afford. A walk that reached a market with an empty purse therefore found
 * nothing to press and stopped, reporting itself as the game stalling.
 *
 * Latent for as long as no seed reached that state, and found the day the
 * content grew enough to shift the deals. Named by id rather than by shape,
 * because "the cell that ends the game" is one specific cell and there is no
 * general property that distinguishes it from a way back.
 */
export const GAME_EXIT_CHOICE = 'welcome:leave'

export function nextChoiceId(screen: { choices: readonly { id: string }[] } | null): string | null {
  return screen?.choices.find((choice) => choice.id !== GAME_EXIT_CHOICE)?.id ?? null
}

// A stage that says, in the game, what has not been built yet.
//
// Hunting, exploring, combat and loot all have rules that are still being
// written (the action economy, what damage multiplies, what a region's
// pools contain). Rather than stub them with plausible behaviour -- which
// is how a draft acquires numbers nobody chose and then defends them -- the
// platform routes them here and says so out loud.
//
// It is not a placeholder in the apologetic sense: it keeps the loop whole,
// so the stack, the persistence and the ring can all be exercised end to
// end while the rules underneath are still an argument.

import type { StageModule } from '../core/stage'
import { ENCOUNTER_SELECT_STAGE_ID, UNDER_CONSTRUCTION_STAGE_ID } from './ids'


export const underConstructionStage: StageModule = {
  id: UNDER_CONSTRUCTION_STAGE_ID,
  title: 'Unwritten',

  enter: (input, _context, rng) => {
    const what = typeof input.what === 'string' ? input.what : 'That'
    return {
      // Nothing to carry: looking at a wall does not spend one of the level's
      // ten, and the count is not this stage's to pass along any more -- it
      // sits on the record and only an `advanceEncounter` moves it.
      state: { what },
      narration: `${what} is not built yet — its rules are still being written.`,
      rng,
    }
  },

  present: (state) => ({
    screenKey: typeof state.what === 'string' ? state.what : 'unknown',
    choices: [{ id: 'underConstruction:back', label: 'Turn back', icon: 'fa-solid fa-rotate-left' }],
  }),

  resolve: (_state, _choiceId, _context, rng) => ({
    kind: 'replace',
    stageId: ENCOUNTER_SELECT_STAGE_ID,
    narration: 'You take a moment to consider your options.',
    rng,
  }),
}

export { UNDER_CONSTRUCTION_STAGE_ID }

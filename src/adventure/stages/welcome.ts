// The entry screen: the only stage that runs without a game, and the only
// one the player is guaranteed to see every time the view opens.
//
// It is the root of the stack, so it is where anything that pops past the
// bottom lands -- a game that ended does not have to know the way home. It
// is ALSO pushed on top whenever the view opens (director.ts's
// `ensureEntered`), which is what makes "continue or start fresh" the first
// question rather than being dropped back mid-swing into a fight with no
// way out of it. The suspended run is untouched underneath: continuing is a
// `pop` into the exact screen and the exact roll state that were left.
//
// It is also the one screen that offers LEAVING. The director used to add
// that cell to every screen, which cost one of the twelve the dial can hold
// on all of them to serve a need that is really only acute in one place --
// someone who opened the game by accident and wants straight back out. From
// anywhere else the way out is the slot's own exit button, which is where a
// reader already looks for "close this".

import type { StageModule } from '../core/stage'
import { resumableGame } from '../model/gameState'
import { WELCOME_STAGE_ID } from './ids'


const CHOICE = {
  start: 'welcome:start',
  continue: 'welcome:continue',
  leave: 'welcome:leave',
} as const

/**
 * Whether this frame was pushed ON TOP of a run in progress. A fact about
 * the STACK, and a stage does not read the stack -- it reads what it was
 * entered with, captured at the moment it was true.
 */
function hasSuspendedRun(state: Record<string, unknown>): boolean {
  return state.hasSuspendedRun === true
}

export const welcomeStage: StageModule = {
  id: WELCOME_STAGE_ID,
  title: 'Camp',

  enter: (input, _context, rng) => ({
    state: { hasSuspendedRun: input.hasSuspendedRun === true },
    narration: 'What would you like to do?',
    rng,
  }),

  present: (state, context) => {
    // Two different continuations, and the difference matters. A suspended
    // run is resumed EXACTLY, by popping back into it. A run with no stack
    // -- one saved before the view started preserving them -- can only be
    // re-entered at the encounter hub, which is a worse promise, so the two
    // are not merged into one branch that quietly does the lesser thing.
    const suspended = hasSuspendedRun(state)
    const resumable = suspended || resumableGame(context.save) !== null

    return {
      choices: [
        { id: CHOICE.start, label: 'Start new adventure', icon: 'fa-solid fa-flag' },
        ...(resumable
          ? [{ id: CHOICE.continue, label: 'Continue previous adventure', icon: 'fa-solid fa-play' }]
          : []),
        // THE SETTINGS CELL IS GONE, and so is the stage behind it. It held
        // one choice -- a difficulty preset out of four -- and that is a
        // SLIDER now, in the options panel beside the thumb it belongs with
        // (model/difficulty.ts). Two ways to set one number is the overlap
        // the vectors were separated to end, and a screen inside the game
        // could not show a continuous value anyway.
        { id: CHOICE.leave, label: 'Leave the game', icon: 'fa-solid fa-xmark' },
      ],
    }
  },

  resolve: (state, choiceId, context, rng) => {
    if (choiceId === CHOICE.start) {
      // `reset`, not `replace`: this frame may be sitting on top of a
      // suspended run, and starting a new adventure has to clear it rather
      // than bury it under one.
      return {
        kind: 'reset',
        stageId: 'characterCreation',
        input: { step: 'origin' },
        effects: [{ kind: 'startGame' }],
        rng,
      }
    }

    if (choiceId === CHOICE.continue) {
      if (hasSuspendedRun(state)) {
        return { kind: 'pop', narration: 'You take up where you left off.', rng }
      }
      const game = resumableGame(context.save)
      if (!game) return { kind: 'stay', state, rng }
      return {
        kind: 'replace',
        stageId: 'encounterSelect',
        effects: [{ kind: 'openGame', gameId: game.id }],
        narration: 'You take up where you left off.',
        rng,
      }
    }

    if (choiceId === CHOICE.leave) return { kind: 'leave', rng }

    return { kind: 'stay', state, rng }
  },
}

export { WELCOME_STAGE_ID }

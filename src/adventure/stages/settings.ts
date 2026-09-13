// Game settings: the choices that belong to the PLAYER rather than to a run.
//
// One so far -- the difficulty preset -- and it is deliberately not applied
// to the run in progress. A preset changed mid-run would rewrite what every
// fight already fought was worth, so this writes the SETTINGS and a run
// copies them when it starts (model/gameState.ts). The screen says so, in
// the narration, rather than leaving the player to find out at the next
// monster.
//
// PUSHED from the welcome screen rather than replacing it, so leaving comes
// back to exactly the entry screen that was there -- including whether it
// was sitting on top of a suspended run, which is state the welcome frame
// captured and cannot recompute.

import type { StageModule } from '../core/stage'
import {
  DIFFICULTIES, DIFFICULTY_LABELS, describeDifficulty, isDifficulty, type Difficulty,
} from '../model/difficulty'
import { SETTINGS_STAGE_ID } from './ids'


const PRESET_ICONS: Readonly<Record<Difficulty, string>> = {
  easy: 'fa-solid fa-feather',
  medium: 'fa-solid fa-scale-balanced',
  hard: 'fa-solid fa-fire',
  extreme: 'fa-solid fa-skull-crossbones',
}

function narrationFor(difficulty: Difficulty): string {
  const [monsters, growth] = describeDifficulty(difficulty)
  return `**${DIFFICULTY_LABELS[difficulty]}.** *${monsters}, ${growth.toLowerCase()}. A change takes effect on your next adventure.*`
}

export const settingsStage: StageModule = {
  id: SETTINGS_STAGE_ID,
  title: 'Settings',

  enter: (_input, context, rng) => ({
    state: {},
    narration: narrationFor(context.save.settings.difficulty),
    rng,
  }),

  present: (_state, context) => {
    const current = context.save.settings.difficulty
    return {
      screenKey: `settings:${current}`,
      choices: [
        ...DIFFICULTIES.map((difficulty) => ({
          id: `difficulty:${difficulty}`,
          // The current one says so in the LABEL, which is what the ring's
          // centre shows while the dial is on it -- a mark on the cell would
          // be a second thing to look at for one bit of information.
          label: difficulty === current
            ? `${DIFFICULTY_LABELS[difficulty]} (current)`
            : DIFFICULTY_LABELS[difficulty],
          icon: PRESET_ICONS[difficulty],
          detail: { title: DIFFICULTY_LABELS[difficulty], lines: describeDifficulty(difficulty) },
        })),
        { id: 'settings:back', label: 'Back', icon: 'fa-solid fa-rotate-left' },
      ],
    }
  },

  resolve: (_state, choiceId, _context, rng) => {
    const chosen = choiceId.startsWith('difficulty:') ? choiceId.slice('difficulty:'.length) : null
    if (isDifficulty(chosen)) {
      return {
        kind: 'pop',
        effects: [{ kind: 'setDifficulty', difficulty: chosen }],
        narration: `**${DIFFICULTY_LABELS[chosen]}.** *Your next adventure will be played at this setting.*`,
        rng,
      }
    }
    return { kind: 'pop', narration: 'What would you like to do?', rng }
  },
}

export { SETTINGS_STAGE_ID }

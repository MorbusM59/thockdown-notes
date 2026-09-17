// What the run is FOR, and the one screen that has to say so without
// pretending to know.
//
// Fame is the ladder gold feeds, on the same numbers stat points sit on
// (model/milestones.ts). What a fame point BUYS is not written yet -- it is
// one of the open questions docs/adventure-platform.md names and says not to
// fill in -- so this stage does not invent an unlock to spend one on. It
// reports the standing and offers the way back, which is the whole of what is
// settled.
//
// It exists as a stage rather than as a tooltip because the way in is the
// rail's CROWN GAUGE, pressed, and a gauge that opened nothing would be a
// control that does nothing -- and because this is where the unlocks land the
// day they are decided. The screen is the placeholder, not the rules.
//
// PUSHED and popped, exactly like the stat-point screen beside it: looking at
// your renown mid-fight must give the fight back untouched.

import type { StageModule } from '../core/stage'
import { famePointsAvailable, fameReached } from '../model/gold'
import { FAME_STAGE_ID } from './ids'


const BACK_CHOICE = 'fame:back'

export const fameStage: StageModule = {
  id: FAME_STAGE_ID,
  title: 'Renown',

  enter: (_input, context, rng) => {
    const game = context.game
    if (!game) return { state: {}, rng }
    const waiting = famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
    return {
      state: {},
      narration: waiting > 0
        ? `**${waiting}** fame point${waiting === 1 ? '' : 's'} in hand. *Word of you has travelled — what it buys is not yet told.*`
        : 'No fame yet. *Gold earns it, and spending the gold does not cost it.*',
      rng,
    }
  },

  present: (_state, context) => {
    const game = context.game
    const lines = game
      ? [
          `${fameReached(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)} fame reached`,
          `${game.goldEarned} gold earned, next point at ${game.goldToNextFamePoint}`,
          'What a point unlocks is still being written',
        ]
      : ['There is no run to be famous for']
    return {
      screenKey: `fame:${game?.famePointsSpent ?? 0}`,
      // ONE cell, and it is the way out. A cell that spent a point would have
      // to say what the point bought, and nothing does yet -- an unlock
      // invented to fill a screen is how a draft acquires rules nobody chose
      // (stages/underConstruction.ts makes the same argument out loud).
      choices: [{
        id: BACK_CHOICE,
        label: 'Turn back',
        icon: 'fa-solid fa-rotate-left',
        isBack: true,
        detail: { title: 'Renown', lines },
      }],
    }
  },

  resolve: (_state, _choiceId, _context, rng) => ({ kind: 'pop', rng }),
}

export { FAME_STAGE_ID }

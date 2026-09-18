// What the run is FOR, and what its renown buys.
//
// Fame is the ladder gold feeds, on the same numbers stat points sit on
// (model/milestones.ts). What a point BUYS is the run's SHAPE: how much it can
// carry at once, and how much of that survives a level -- the two rules that
// were written as seams long before there was anything to put in them
// (model/gameState.ts's `carryLimit` and `keepAllowance`, both functions of
// the run precisely because "a fame unlock is expected to raise it").
//
// FAME IS SPENT WITHIN THE RUN. The original plan had it persist between runs;
// what persists instead will be a separate list of permanent unlocks, earned
// by what a run spent rather than carried over as currency. Those are not
// written and this screen does not anticipate them.
//
// THE GATE IS HERE, the same way it is on the stat-point screen beside this
// one: `buyFameUnlock` refuses what the run cannot afford or has already
// raised to its ceiling, and this screen declines to OFFER those, so a cell
// that is on the ring can always be taken. The full ladder -- every unlock,
// its price, and how far this run has taken it -- is on the way-back cell's
// detail, because a player saving up needs to see what they are saving for
// even while none of it is affordable.
//
// PUSHED and popped, exactly like the stat-point screen: looking at your
// renown mid-fight must give the fight back untouched.

import type { StageModule } from '../core/stage'
import { famePointsAvailable, fameReached } from '../model/gold'
import {
  BASE_CARRY_LIMIT,
  BASE_KEEP_ALLOWANCE,
  carryLimit,
  keepAllowance,
  type GameRecord,
} from '../model/gameState'
import {
  canBuyMore,
  FAME_UNLOCKS,
  FAME_UNLOCK_CEILING,
  fameUnlockById,
  type FameUnlock,
} from '../model/fameUnlocks'
import { FAME_STAGE_ID } from './ids'

const BACK_CHOICE = 'fame:back'
const CHOICE_PREFIX = 'fame:buy:'

/** The base a rule starts from, which is also what its ceiling is measured against. */
function baseFor(unlock: FameUnlock): number {
  return unlock.rule === 'carry' ? BASE_CARRY_LIMIT : BASE_KEEP_ALLOWANCE
}

/** What this run currently has of the rule an unlock raises. */
function standingFor(game: GameRecord, unlock: FameUnlock): number {
  return unlock.rule === 'carry' ? carryLimit(game, unlock.kind) : keepAllowance(game, unlock.kind)
}

/** The rule an unlock raises, named as the readout names it. */
function ruleWords(unlock: FameUnlock): string {
  const noun = unlock.kind === 'item' ? 'items' : 'traits'
  return unlock.rule === 'carry' ? `${noun} carried` : `${noun} kept between levels`
}

/** The same fact as prose, for the narration pill, where a readout's phrasing reads as broken English. */
function gainWords(unlock: FameUnlock): string {
  const noun = unlock.kind === 'item' ? 'item' : 'trait'
  return unlock.rule === 'carry'
    ? `One more ${noun} in your hands.`
    : `One more ${noun} survives the level.`
}

/**
 * What buying this would DO, in the same shape the stat screen uses: the
 * number as it is and as it would be, read from the live rule rather than
 * restated, so it cannot disagree with what the purchase actually changes.
 */
function purchaseLines(game: GameRecord, unlock: FameUnlock): string[] {
  const now = standingFor(game, unlock)
  return [
    `${ruleWords(unlock)} ${now} → ${now + 1}`,
    `Costs ${unlock.cost} fame point${unlock.cost === 1 ? '' : 's'}`,
    `Up to ${FAME_UNLOCK_CEILING[unlock.rule]}`,
  ]
}

/** The whole ladder, affordable or not -- what a player saving up is saving for. */
function ladderLines(game: GameRecord, waiting: number): string[] {
  return FAME_UNLOCKS.map((unlock) => {
    const now = standingFor(game, unlock)
    const atCeiling = !canBuyMore(game.fameUnlocks, unlock, baseFor(unlock))
    const suffix = atCeiling
      ? 'at its limit'
      : waiting >= unlock.cost
        ? `${unlock.cost} to raise`
        : `${unlock.cost} fame`
    return `${unlock.name}: ${now} — ${suffix}`
  })
}

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
        ? `**${waiting}** fame point${waiting === 1 ? '' : 's'} in hand. *Word of you has travelled — spend it on what you can carry.*`
        : 'No fame yet. *Gold earns it, and spending the gold does not cost it.*',
      rng,
    }
  },

  present: (_state, context) => {
    const game = context.game
    const waiting = game
      ? famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
      : 0
    const lines = game
      ? [
          `${fameReached(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)} fame reached`,
          `${waiting} to spend, next point at ${game.goldToNextFamePoint} gold`,
          ...ladderLines(game, waiting),
        ]
      : ['There is no run to be famous for']
    const back = {
      id: BACK_CHOICE,
      label: 'Turn back',
      icon: 'fa-solid fa-rotate-left',
      isBack: true,
      detail: { title: 'Renown', lines },
    }
    if (!game) return { screenKey: 'fame:none', choices: [back] }

    const affordable = FAME_UNLOCKS.filter((unlock) => (
      unlock.cost <= waiting && canBuyMore(game.fameUnlocks, unlock, baseFor(unlock))
    ))
    return {
      // Keyed on what the run has BOUGHT as well as what it has spent, so
      // taking a purchase deals a new screen rather than leaving the ring on
      // a cell that has just changed meaning.
      screenKey: `fame:${game.famePointsSpent}:${game.fameUnlocks.length}`,
      choices: [
        ...affordable.map((unlock) => ({
          id: `${CHOICE_PREFIX}${unlock.id}`,
          label: unlock.name,
          icon: unlock.icon,
          detail: { title: unlock.name, lines: purchaseLines(game, unlock) },
        })),
        back,
      ],
    }
  },

  resolve: (state, choiceId, _context, rng) => {
    if (!choiceId.startsWith(CHOICE_PREFIX)) return { kind: 'pop', rng }
    const unlock = fameUnlockById(choiceId.slice(CHOICE_PREFIX.length))
    if (!unlock) return { kind: 'pop', rng }
    return {
      // STAYS on the screen rather than popping, unlike a stat point: these
      // come in fours at two prices, so a player with several points in hand
      // is usually making several decisions, and being thrown back to the
      // fight after each one would make the second cost a gauge press.
      kind: 'stay',
      state,
      effects: [
        { kind: 'buyFameUnlock', unlock: unlock.id },
        { kind: 'recordOutcome', outcome: 'fame-unlock-bought', payload: { unlock: unlock.id } },
      ],
      narration: `**${unlock.name}.** *${gainWords(unlock)}*`,
      rng,
    }
  },
}

export { FAME_STAGE_ID }

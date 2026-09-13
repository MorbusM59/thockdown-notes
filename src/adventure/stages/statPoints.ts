// Spending a stat point: the one place a character grows by decision rather
// than by what a fight happened to drop.
//
// SPENDABLE AT ANY TIME is the design's own wording, and "any time" here means
// between encounters -- the hub offers it whenever the ladder has a point
// waiting. Not on every screen: the director contributes no cells to anything
// (core/director.ts), and a cell standing in the middle of a fight would be a
// decision taken while a monster waits.
//
// PUSHED, so the hub underneath keeps the encounter it had already rolled: a
// replace would re-enter it and draw a different set of monsters, which would
// turn "spend a point" into "reroll the encounter" for anyone who noticed.
//
// It offers one cell per stat and nothing else. There is no confirmation and
// no going back, which is deliberate: the ring's centre names the cell you are
// about to activate and its detail says what the point would do, so the
// decision is made before the press rather than after it.

import type { StageModule } from '../core/stage'
import { statPointsAvailable } from '../model/motes'
import { deriveStats, STAT_ICONS, STAT_KEYS, STAT_LABELS, type StatKey } from '../model/stats'
import { addStats } from '../model/stats'
import { STAT_POINT_STAGE_ID } from './ids'


/**
 * What one point in this stat would actually change, computed the same way
 * everything else is -- derive the block with the point in it and say what
 * moved. A written list ("Might: damage and hit points") would be a second
 * statement of stats.ts's formulas, and would go stale the day one changes.
 */
function differenceFrom(stat: StatKey, stats: ReturnType<typeof addStats>): string[] {
  const before = deriveStats(stats)
  const after = deriveStats(addStats(stats, { [stat]: 1 }))
  const lines: string[] = [`${STAT_LABELS[stat]} ${stats[stat]} → ${stats[stat] + 1}`]
  if (after.maxHitPoints !== before.maxHitPoints) {
    lines.push(`${after.maxHitPoints - before.maxHitPoints} hit points`)
  }
  if (after.damageMultiplier !== before.damageMultiplier) {
    lines.push(`+${Math.round((after.damageMultiplier - before.damageMultiplier) * 100)}% damage`)
  }
  if (after.actionsPerRound !== before.actionsPerRound) {
    lines.push(`+${after.actionsPerRound - before.actionsPerRound} action a round`)
  }
  for (const [key, label] of [['dodgeChance', 'dodge'], ['hitChance', 'accuracy'], ['critChance', 'crit']] as const) {
    if (after[key] !== before[key]) lines.push(`+${Math.round((after[key] - before[key]) * 100)}% ${label}`)
  }
  for (const [key, label] of [['encounterChoices', 'encounter choices'], ['offerChoices', 'offers']] as const) {
    if (after[key] !== before[key]) lines.push(`+${after[key] - before[key]} ${label}`)
  }
  // Intellect and Charisma derive nothing yet. Saying so is better than an
  // empty detail pill, which reads as a rendering fault rather than as a
  // stat whose uses are unwritten.
  if (lines.length === 1) lines.push('Its uses are not written yet')
  return lines
}

export const statPointStage: StageModule = {
  id: STAT_POINT_STAGE_ID,
  title: 'Reflection',

  enter: (_input, context, rng) => {
    const game = context.game
    const waiting = game
      ? statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
      : 0
    return {
      state: {},
      narration: `**${waiting}** stat point${waiting === 1 ? '' : 's'} to spend. *What has all this taught you?*`,
      rng,
    }
  },

  present: (_state, context) => {
    // BASE stats, not effective: a point goes into what the character IS, and
    // showing the item-inflated figure would promise a different number than
    // the one that changes.
    const stats = context.game?.baseStats
    if (!stats) return { screenKey: 'statPoint:none', choices: [] }
    return {
      screenKey: `statPoint:${context.game?.statPointsSpent ?? 0}`,
      choices: STAT_KEYS.map((stat) => ({
        id: `statPoint:${stat}`,
        label: STAT_LABELS[stat],
        icon: STAT_ICONS[stat],
        detail: { title: STAT_LABELS[stat], lines: differenceFrom(stat, stats) },
      })),
    }
  },

  resolve: (_state, choiceId, _context, rng) => {
    const stat = STAT_KEYS.find((candidate) => `statPoint:${candidate}` === choiceId)
    if (!stat) return { kind: 'pop', rng }
    return {
      kind: 'pop',
      // TWO effects, and the split is the platform's rule showing through:
      // which stat is the game's business (`adjustBaseStat`) and the ladder
      // is the platform's (`allocateStatPoint`). The order matters only in
      // that both are applied before anything reads the profile again.
      effects: [
        { kind: 'adjustBaseStat', stat, amount: 1 },
        { kind: 'allocateStatPoint' },
        { kind: 'recordOutcome', outcome: 'stat-point-spent', payload: { stat } },
      ],
      narration: `**${STAT_LABELS[stat]}.** *You are more than you were.*`,
      rng,
    }
  },
}

export { STAT_POINT_STAGE_ID }

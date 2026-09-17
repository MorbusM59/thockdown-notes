// Spending a stat point: the one place a character grows by decision rather
// than by what a fight happened to drop.
//
// SPENDABLE AT ANY TIME is the design's own wording, and it is now literally
// true: the way in is the rail's STAR GAUGE, pressed, on whatever screen the
// player is looking at (see escapeMenuContract.ts's `EscapeMenuChromeGauge`).
// It used to be a cell on the hub, which could only ever mean "spendable when
// the level lets you" -- and putting that cell on every screen instead was
// never on offer, because a cell standing in the middle of a fight is a
// decision taken while a monster waits. The gauge is not a cell: it is the
// place the quantity is already reported, and pressing it goes to where that
// quantity is spent. The decision itself is still taken in the ring.
//
// PUSHED, so whatever is underneath is untouched and comes back exactly as it
// was: the hub keeps the encounter it had already rolled (a replace would
// re-enter it and draw a different set of monsters, turning "spend a point"
// into "reroll the encounter"), and a fight keeps its round mid-swing.
//
// THE GATE IS HERE, not in whoever offers the way in, and that is the whole
// difference reachability made. `allocateStatPoint` declines when the ladder
// has nothing waiting, but `adjustBaseStat` -- emitted beside it, because
// which stat is the game's business and the ladder is the platform's -- does
// not, so a screen that offered its stat cells with no point waiting would
// hand out the stat for free. The stats are offered only when there is a
// point to spend; otherwise the screen says so and the only cell is the way
// back out.
//
// There is no confirmation: the ring's centre names the cell you are about to
// activate and its detail says what the point would do, so the decision is
// made before the press rather than after it. There IS a way back, which
// there was not when the only route in was choosing to spend -- arriving by
// pressing a gauge has to be undoable by not choosing anything.

import type { StageModule } from '../core/stage'
import { statPointsAvailable } from '../model/motes'
import { deriveStats, STAT_ICONS, STAT_KEYS, STAT_LABELS, type StatKey } from '../model/stats'
import { addStats } from '../model/stats'
import { STAT_POINT_STAGE_ID } from './ids'

const BACK_CHOICE = 'statPoint:back'


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
      narration: waiting > 0
        ? `**${waiting}** stat point${waiting === 1 ? '' : 's'} to spend. *What has all this taught you?*`
        : 'No stat points yet. *Motes earn them; the next one is further off each time.*',
      rng,
    }
  },

  present: (_state, context) => {
    // BASE stats, not effective: a point goes into what the character IS, and
    // showing the item-inflated figure would promise a different number than
    // the one that changes.
    const game = context.game
    const stats = game?.baseStats
    const back = {
      id: BACK_CHOICE,
      label: 'Turn back',
      icon: 'fa-solid fa-rotate-left',
      isBack: true,
      detail: { title: 'Turn back', lines: ['Nothing is spent'] },
    }
    const waiting = game
      ? statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
      : 0
    if (!stats || waiting <= 0) return { screenKey: 'statPoint:none', choices: [back] }
    return {
      screenKey: `statPoint:${game?.statPointsSpent ?? 0}`,
      choices: [
        ...STAT_KEYS.map((stat) => ({
          id: `statPoint:${stat}`,
          label: STAT_LABELS[stat],
          icon: STAT_ICONS[stat],
          detail: { title: STAT_LABELS[stat], lines: differenceFrom(stat, stats) },
        })),
        back,
      ],
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

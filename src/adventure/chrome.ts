// What the CHROME around the editor shows, assembled by the director's side
// of the house rather than by the hook: these are game numbers, and React has
// no opinion about them.
//
// A mode owning a slot owns all six of that slot's chrome surfaces (see
// escapeMenuContract.ts's EscapeMenuModeChrome). This file fills four of them
// -- the readouts, the narration line, the identity box with its two meters,
// and the strip -- and RESERVES the other two.
//
// Reserved, not omitted. Nothing in the game has claimed the toggle or the
// snapshot button yet, and leaving the editor's own showing underneath would
// report on a document this slot is not displaying -- but dropping them
// closes the gap they hold and shifts the panels beside them, which is how
// the word-count panel acquired a leading space it never had. The manual-save
// position matters most: it is the corner the scrollbar and the timeline both
// extend from, so an empty one throws the whole column's balance. See
// escapeMenuContract.ts's EscapeMenuChromeToggle.
//
// The design's status line is `health | six stats | gold, experience,
// points, fame`, with armor beside health -- each named by an ICON and its
// value, the words living in the tooltip. One thing it also asks for is NOT
// here, for a reason worth stating rather than silently dropping: MOTES
// UNTIL THE NEXT STAT POINT. The threshold is specified (10 + 5 * points
// acquired), but whether spending experience on traits also consumes
// progress toward it is not. Showing a number computed from an unresolved
// rule would make the rule look decided.

import type { EscapeMenuChromeGauge, EscapeMenuChromePill, EscapeMenuModeChrome, EscapeMenuReadout } from '../escapeMenu/escapeMenuContract'
import { totalArmor } from './model/armor'
import { famePointsSpent, moteBalance, statPointProgress, statPointSpan, statPointsSpent } from './model/motes'
import { activeGame, heldModifiers, holdingCounts, profileOf, type GameSave } from './model/gameState'
import { describeModifier, type Modifier } from './model/modifiers'
import { STAT_ICONS, STAT_KEYS, STAT_LABELS } from './model/stats'

/**
 * The icon per non-stat readout. The six stats bring their own
 * (model/stats.ts's STAT_ICONS, from the same design document's status line);
 * these are the quantities on either side of them.
 *
 * Two of them are FIXED BY THE RAIL rather than chosen here: fame is the
 * crown and a stat point is the star on the gauges below (chromeGauges), and
 * the same quantity carrying two different glyphs in two places on the same
 * chrome would read as two different quantities.
 */
const READOUT_ICONS = {
  hp: 'fa-solid fa-heart',
  armor: 'fa-solid fa-shield-halved',
  points: 'fa-solid fa-star',
  fame: 'fa-solid fa-crown',
  games: 'fa-solid fa-dice-d20',
} as const

/**
 * The two currencies, on the STATS ROW rather than up with the stats.
 *
 * They buy what the strip between them holds -- gold buys items, motes buy
 * traits -- so they belong beside it: a balance read on the tab bar and the
 * things it was spent on read a whole editor away were two halves of one
 * thought in two places. Gold leads (items read out from the left), motes
 * trail (traits read in from the right), each mirroring its own half.
 *
 * The book, not a second gem: this is what motes are SPENT ON, and the icon
 * beside a balance names what the balance is for.
 */
const METER_ICONS = {
  gold: 'fa-solid fa-coins',
  motes: 'fa-solid fa-book',
} as const

export function statusReadouts(save: GameSave, catalog: ReadonlyMap<string, Modifier>): EscapeMenuReadout[] {
  const game = activeGame(save)
  if (!game) {
    return [
      { key: 'games', icon: READOUT_ICONS.games, label: 'Games started', value: String(save.profile.gamesStarted) },
      { key: 'best', icon: READOUT_ICONS.fame, label: 'Best fame', value: String(save.profile.bestFame) },
    ]
  }

  const profile = profileOf(save, game, catalog)
  const armor = totalArmor(game.armor)

  return [
    { key: 'hp', icon: READOUT_ICONS.hp, label: 'Hit points', value: `${game.hitPoints}/${profile.derived.maxHitPoints}` },
    ...(armor > 0 ? [{ key: 'armor', icon: READOUT_ICONS.armor, label: 'Armor', value: String(armor) }] : []),
    // Effective stats, not base: what a check actually rolls against is
    // what the player needs to see. The base cap is a rule about
    // progression, not about what is true of them right now.
    ...STAT_KEYS.map((key) => ({
      key,
      icon: STAT_ICONS[key],
      label: STAT_LABELS[key],
      value: String(profile.stats[key]),
    })),
    ...(game.statPoints > 0 ? [{ key: 'points', icon: READOUT_ICONS.points, label: 'Stat points to spend', value: String(game.statPoints) }] : []),
  ]
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]

/**
 * The level, in roman numerals, because the counter is read as a heading for
 * the run rather than as a quantity -- and because it has to sit beside two
 * arabic numbers (the round and the actions left) without being mistaken for
 * one of them.
 */
export function romanNumeral(value: number): string {
  let remaining = Math.max(0, Math.floor(value))
  if (remaining === 0) return '—'
  let out = ''
  for (const [amount, symbol] of ROMAN) {
    while (remaining >= amount) {
      out += symbol
      remaining -= amount
    }
  }
  return out
}

/**
 * The one line in the note-id position: `IV [Combat] 3 | 4` -- level, the
 * stage you are in, and how far through it you are. It answers the same
 * question a note's `$id` box does, which is why it sits there: WHICH one is
 * this, at a glance, in a box that does not move as the answer changes.
 *
 * The progress pair is ABSENT rather than zeroed until there is something
 * that counts rounds and actions: combat is deliberately unbuilt (see
 * docs/adventure-platform.md), and `3 | 4` with nothing behind it would read
 * as a working feature reporting zero.
 */
export function chromeIdentity(save: GameSave, stageTitle: string): string {
  const game = activeGame(save)
  const level = game ? `${romanNumeral(game.level)} ` : ''
  return `${level}[${stageTitle}]`
}

/**
 * The two currencies, flanking the strip. See METER_ICONS for why they are
 * here rather than on the tab bar with the stats.
 *
 * Both are BALANCES -- what is left to spend -- not totals earned. Motes have
 * two numbers and this is deliberately the smaller one: how close the next
 * stat point is reads the TOTAL instead, and that is the rail's job (see
 * model/motes.ts for why one running balance could not express both).
 */
export function chromeMeters(save: GameSave): EscapeMenuModeChrome['meters'] {
  const game = activeGame(save)
  if (!game) return undefined
  return {
    leading: {
      key: 'gold',
      icon: METER_ICONS.gold,
      label: 'Gold to spend',
      value: String(game.goldUnits),
    },
    trailing: {
      key: 'motes',
      icon: METER_ICONS.motes,
      label: 'Motes to spend',
      value: String(moteBalance(game.experienceEarned, game.experienceSpentOnTraits)),
    },
  }
}

function pillsOf(held: readonly Modifier[], kind: Modifier['kind'], counts: ReturnType<typeof holdingCounts>): EscapeMenuChromePill[] {
  return held
    .filter((modifier) => modifier.kind === kind)
    // Acquisition order, and duplicates kept: two of the same item are two
    // things the run is carrying, and collapsing them would hide that from
    // the one surface that shows what you have.
    .map((modifier, index) => ({
      key: `${modifier.id}:${index}`,
      icon: modifier.icon,
      label: modifier.name,
      detail: describeModifier(modifier, counts),
    }))
}

/**
 * What the run is carrying, across the width the snapshot timeline occupies:
 * items reading out from the left, traits in from the right.
 *
 * This is what replaced the two permanent ring cells and the two screens
 * behind them. It costs nothing per screen and is always true, where those
 * cost three of twelve cells everywhere to be true on demand.
 */
export function chromeStrip(save: GameSave, catalog: ReadonlyMap<string, Modifier>): EscapeMenuModeChrome['strip'] {
  const game = activeGame(save)
  if (!game) return undefined
  const held = heldModifiers(save, game.id, catalog)
  const counts = holdingCounts(held)
  return {
    leading: pillsOf(held, 'item', counts),
    trailing: pillsOf(held, 'trait', counts),
  }
}

/**
 * A position the game holds without using yet.
 *
 * Both of the chrome's buttons are like this today, and both for the same
 * reason: the game has not claimed them, and the editor's own must not show
 * through. Reserving keeps the composition -- see this file's header.
 */
function reservedPosition(label: string) {
  return { label, isActive: false }
}

/** The slot's toggle position, on the timeline row. Held, unused. */
export function chromeToggle() {
  return reservedPosition('Reserved')
}

/** The chapter bar's leading toggle position. Held, unused. */
export function chromeBarToggle() {
  return reservedPosition('Reserved')
}

/**
 * The manual-save position. Held, unused, and the most important of the two
 * to hold: it is the corner the scrollbar and the timeline both extend from.
 */
export function chromeAction() {
  return reservedPosition('Reserved')
}

/**
 * The rail's gauges, top to bottom: FAME, then the next stat point.
 *
 * Each carries, under its icon, the number of that gauge's own points this
 * run has SPENT -- the bar is progress toward the next one, the tally is what
 * the previous ones bought. Fame's is always zero and honestly so: nothing
 * can spend a fame point yet (model/motes.ts's famePointsSpent).
 *
 * Fame is the run's score and the top half of the rail, because it is what
 * the whole run is for; the stat-point bar below it is the shorter, faster
 * cycle underneath. Fame carries NO RATIO: the score is real and named, and
 * the curve that scales it is explicitly unwritten (open question 12 in
 * docs/adventure-platform.md). An empty track says "this is here and has
 * nothing to report"; a zeroed one would claim the answer is none, and a
 * fabricated one would make an undecided rule look settled. The number itself
 * is on the tab bar, where it is true without a curve.
 *
 * The stat-point gauge reads the run's TOTAL experience against the moving
 * threshold, so it does not move when motes are spent on a trait -- which is
 * the whole of the mote design and the thing a single running balance could
 * not express.
 */
export function chromeGauges(save: GameSave): EscapeMenuChromeGauge[] {
  const game = activeGame(save)
  if (!game) return []

  const span = statPointSpan(game.statPointsAcquired)
  const into = Math.max(0, game.experienceEarned - (game.experienceToNextStatPoint - span))
  return [
    {
      key: 'fame',
      icon: 'fa-solid fa-crown',
      count: famePointsSpent(),
      label: 'Fame',
      detail: [
        `${game.fame} fame`,
        `${famePointsSpent()} fame points spent`,
        'The curve that scales this bar is not written yet',
      ],
    },
    {
      key: 'statPoint',
      icon: 'fa-solid fa-star',
      ratio: statPointProgress(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsAcquired),
      count: statPointsSpent(game.statPointsAcquired),
      label: 'Next stat point',
      detail: [
        `${into} of ${span} motes earned toward it`,
        `${game.experienceEarned} earned in total, next point at ${game.experienceToNextStatPoint}`,
        `${statPointsSpent(game.statPointsAcquired)} stat points spent`,
      ],
    },
  ]
}

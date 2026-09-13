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
import { moteBalance, statPointProgress, statPointsAvailable, statPointStanding } from './model/motes'
import { famePointProgress, famePointStanding, goldBalance } from './model/gold'
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
  const waiting = statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)

  return [
    { key: 'hp', icon: READOUT_ICONS.hp, label: 'Hit points', value: `${game.hitPoints}/${profile.derived.maxHitPoints}` },
    {
      key: 'armor',
      icon: READOUT_ICONS.armor,
      // BOTH POOLS, never their sum. Armor is two numbers that behave
      // differently -- item armor is spent as it absorbs, natural armor
      // cannot be worn away (model/armor.ts) -- so a player reading `11`
      // cannot tell what a fight is about to cost them. The parenthesis is
      // the part that survives it.
      //
      // Shown at zero rather than hidden, unlike its own first version:
      // armor is a standing property of the character the way hit points
      // are, and a readout that appears only once it is non-zero teaches
      // that armor is a thing that happens to you rather than a thing you
      // have. The row is a status line, not a list of what is currently
      // interesting.
      label: 'Armor (natural)',
      value: `${Math.max(0, game.armor.fromItems)}(${Math.max(0, game.armor.natural)})`,
    },
    // Effective stats, not base: what a check actually rolls against is
    // what the player needs to see. The base cap is a rule about
    // progression, not about what is true of them right now.
    ...STAT_KEYS.map((key) => ({
      key,
      icon: STAT_ICONS[key],
      label: STAT_LABELS[key],
      value: String(profile.stats[key]),
    })),
    // Only when there is one waiting, and DERIVED from the ladder rather
    // than read off a counter -- the counter it used to read was never
    // incremented by anything, so this readout could not appear.
    ...(waiting > 0
      ? [{ key: 'points', icon: READOUT_ICONS.points, label: 'Stat points to spend', value: String(waiting) }]
      : []),
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
      value: String(goldBalance(game.goldEarned, game.goldSpentOnItems)),
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
 * the previous ones bought.
 *
 * THE TWO ARE THE SAME LADDER (model/milestones.ts), which is why they sit
 * one above the other: fame is what gold earns and stat points are what
 * experience earns, on identical numbers. Fame is on top because it is what
 * the whole run is for; the stat-point cycle below it is the one that grows
 * the character that earns the gold.
 *
 * Both read their stream's TOTAL against the moving threshold, so neither
 * moves when the currency is spent -- gold on an item, motes on a trait.
 * That is the whole of the two-fields-not-one design and the thing a single
 * running balance could not express.
 */
export function chromeGauges(save: GameSave): EscapeMenuChromeGauge[] {
  const game = activeGame(save)
  if (!game) return []

  const fame = famePointStanding(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
  const stat = statPointStanding(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
  return [
    {
      key: 'fame',
      icon: 'fa-solid fa-crown',
      ratio: famePointProgress(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent),
      count: game.famePointsSpent,
      label: 'Next fame point',
      detail: [
        `${fame.into} of ${fame.span} gold earned toward it`,
        `${game.goldEarned} earned in total, next point at ${game.goldToNextFamePoint}`,
        `${game.famePoints} in hand, ${game.famePointsSpent} spent`,
      ],
    },
    {
      key: 'statPoint',
      icon: 'fa-solid fa-star',
      ratio: statPointProgress(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent),
      count: game.statPointsSpent,
      label: 'Next stat point',
      detail: [
        `${stat.into} of ${stat.span} motes earned toward it`,
        `${game.experienceEarned} earned in total, next point at ${game.experienceToNextStatPoint}`,
        `${statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)} waiting, ${game.statPointsSpent} spent`,
      ],
    },
  ]
}

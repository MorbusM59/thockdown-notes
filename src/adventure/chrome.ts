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
import { famePointProgress, famePointsAvailable, famePointStanding, goldBalance } from './model/gold'
import { displayEncounter } from './stages/levelProgress'
import { activeGame, armorOf, heldModifiers, keptModifierIds, playerTierOf, profileOf, type GameRecord, type GameSave } from './model/gameState'
import { itemArmor } from './model/armor'
import type { Content } from './content'
import { buildWeightInitials } from './model/vectors'
import { describeModifier, descriptionStyleOf, type DescriptionStyle, type Modifier, type ModifierKind } from './model/modifiers'
import { STAT_ICONS, STAT_KEYS, STAT_LABELS } from './model/stats'

/**
 * The icon per non-stat readout. The six stats bring their own
 * (model/stats.ts's STAT_ICONS, from the same design document's status line);
 * these are the quantities on either side of them.
 *
 * One is FIXED BY THE RAIL rather than chosen here: fame is the crown on the
 * gauge below (chromeGauges), and the same quantity carrying two different
 * glyphs in two places on the same chrome would read as two different
 * quantities. It appears here only where there is no run at all, as the
 * profile's best.
 *
 * A stat point waiting used to have a readout too, in the star. It does not
 * now: the rail's own star gauge says how many are waiting, under the bar
 * that fills toward the next -- and the same number in two places on one
 * chrome is the thing the paragraph above is about.
 */
const READOUT_ICONS = {
  hp: 'fa-solid fa-heart',
  armor: 'fa-solid fa-shield-halved',
  fame: 'fa-solid fa-crown',
  games: 'fa-solid fa-dice-d20',
  tier: 'fa-solid fa-arrow-up-right-dots',
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

export function statusReadouts(save: GameSave, content: Content): EscapeMenuReadout[] {
  const game = activeGame(save)
  if (!game) {
    return [
      { key: 'games', icon: READOUT_ICONS.games, label: 'Games started', value: String(save.profile.gamesStarted) },
      { key: 'best', icon: READOUT_ICONS.fame, label: 'Best fame', value: String(save.profile.bestFame) },
    ]
  }

  const profile = profileOf(save, game, content)
  const armor = armorOf(save, game, content)

  return [
    { key: 'hp', icon: READOUT_ICONS.hp, label: 'Health', value: `${game.hitPoints}/${profile.derived.maxHitPoints}` },
    {
      key: 'armor',
      icon: READOUT_ICONS.armor,
      // BOTH POOLS, never their sum. Armor is two numbers that behave
      // differently -- item armor is spent as it absorbs and is now spent
      // PER ITEM, natural armor cannot be worn away (model/armor.ts) -- so a
      // player reading `11` cannot tell what a fight is about to cost them.
      // The parenthesis is the part that survives it.
      //
      // The items' pools are summed into one figure rather than listed: which
      // piece is wearing is the strip's business (each item's own pill), and a
      // status line that grew a number per carried item would be four
      // quantities where the reader wanted one.
      //
      // Shown at zero rather than hidden, unlike its own first version:
      // armor is a standing property of the character the way hit points
      // are, and a readout that appears only once it is non-zero teaches
      // that armor is a thing that happens to you rather than a thing you
      // have. The row is a status line, not a list of what is currently
      // interesting.
      label: 'Armor (natural)',
      value: `${itemArmor(armor)}(${Math.max(0, armor.natural)})`,
    },
    // HOW FAR YOU HAVE COME, and nothing else. The tier is a quantity and
    // the only one fame buys (Ascendant), so it is a figure like every other
    // pill on this row.
    //
    // It used to carry the three content vectors in its tooltip, which put
    // two different kinds of fact behind one glyph: a BUILD is how a
    // character grows -- a set of proportions, fixed from creation -- and a
    // TIER is how far they have got along it. Reading "Tier -- Hulking
    // Mertok Duelist" made the tier look like a property of the build. They
    // are separate now, and the vectors have nameplates of their own below.
    {
      key: 'tier',
      icon: READOUT_ICONS.tier,
      // The NOUN alone. Every readout on this row composes its own tooltip
      // and accessible name as "<label>: <value>" (EscapeMenuStatus.tsx), so
      // a label that already carried the figure read as "Tier: 5: 5".
      label: 'Tier',
      value: String(playerTierOf(game)),
    },
    // WHAT YOU ARE: three nameplates, one per content vector, each an icon
    // and a tooltip and no figure at all (escapeMenuContract.ts). A name is
    // not a quantity, and three word-pills among eight glyph-and-figure ones
    // would read as a different bar -- but the glyph is how a player
    // recognises what they chose, and before this there was no way to see
    // any of the three again after creation.
    //
    // A vector the run has not answered is simply absent, because character
    // creation asks one screen at a time and a half-built character is a
    // real state rather than a broken one.
    ...vectorNameplates(game, content),
    // Effective stats, not base: what a check actually rolls against is
    // what the player needs to see. The base cap is a rule about
    // progression, not about what is true of them right now.
    ...STAT_KEYS.map((key) => ({
      key,
      icon: STAT_ICONS[key],
      label: STAT_LABELS[key],
      value: String(profile.stats[key]),
    })),
  ]
}

/**
 * The build, the species and the class, as icon-only pills.
 *
 * The BUILD's tooltip carries its weights as repeated initials -- "Brutish
 * (MMMA)" -- because the weights are the whole of what a build is and there
 * is no other place in a run to read them. The other two are nouns and their
 * name is all there is to say.
 *
 * Each vector's own icon, so the pill is recognisable as the thing that was
 * picked at creation rather than as a generic marker.
 */
function vectorNameplates(game: GameRecord, content: Content): EscapeMenuReadout[] {
  const build = content.builds.find((candidate) => candidate.id === game.buildId)
  const species = content.species.find((candidate) => candidate.id === game.speciesId)
  const combatClass = content.combatClasses.find((candidate) => candidate.id === game.classId)
  const plates: EscapeMenuReadout[] = []
  if (build) plates.push({ key: 'build', icon: build.icon, label: `${build.name} (${buildWeightInitials(build)})` })
  if (species) plates.push({ key: 'species', icon: species.icon, label: species.name })
  if (combatClass) plates.push({ key: 'class', icon: combatClass.icon, label: combatClass.name })
  return plates
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
 * The one line in the note-id position: `V-3 [Combat]` -- where in the run
 * you are, and what you are looking at. It answers the same question a
 * note's `$id` box does, which is why it sits there: WHICH one is this, at a
 * glance, in a box that does not move as the answer changes.
 *
 * LEVEL-ENCOUNTER, on one hyphen, because they are one position: a level is
 * ten encounters and neither half locates you without the other. The level
 * stays roman and the encounter is arabic, which is what keeps a two-part
 * address from reading as a range -- and the roman half is a heading for the
 * run rather than a quantity, exactly as `romanNumeral` says.
 *
 * The encounter is the one the player is ON, which after a spoils screen is
 * the one they are preparing for rather than the one they just finished:
 * everything about that fight is behind them (stages/levelProgress.ts).
 */
export function chromeIdentity(save: GameSave, stageTitle: string): string {
  const game = activeGame(save)
  const where = game ? `${romanNumeral(game.level)}-${displayEncounter(game)} ` : ''
  return `${where}[${stageTitle}]`
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

function pillsOf(
  held: readonly Modifier[],
  kind: Modifier['kind'],
  kept: readonly string[],
  onKeep: ((kind: ModifierKind, modifierId: string) => void) | undefined,
  describe: DescriptionStyle,
): EscapeMenuChromePill[] {
  return held
    .filter((modifier) => modifier.kind === kind)
    // Acquisition order. One pill per thing held, which is also one per thing
    // there IS: a run cannot hold two of anything (model/gameState.ts's
    // `acquireModifier`), so the id is the key.
    .map((modifier) => ({
      key: modifier.id,
      icon: modifier.icon,
      label: modifier.name,
      detail: [
        ...describeModifier(modifier, describe),
        // What the lit one MEANS, said on the pill rather than left to be
        // discovered at the end of the level. Exactly one per kind is lit at
        // all times (`keptModifierId` defaults to the newest find), so this
        // line is on exactly one pill per kind too.
        kept.includes(modifier.id)
          ? 'Kept when this level ends'
          : 'Press to keep this one when the level ends',
      ],
      isActive: kept.includes(modifier.id),
      onActivate: onKeep ? () => onKeep(kind, modifier.id) : undefined,
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
export function chromeStrip(
  save: GameSave,
  catalog: ReadonlyMap<string, Modifier>,
  onKeep?: (kind: ModifierKind, modifierId: string) => void,
): EscapeMenuModeChrome['strip'] {
  const game = activeGame(save)
  if (!game) return undefined
  const held = heldModifiers(save, game.id, catalog)
  const describe = descriptionStyleOf(save.settings)
  return {
    leading: pillsOf(held, 'item', keptModifierIds(save, game, 'item'), onKeep, describe),
    trailing: pillsOf(held, 'trait', keptModifierIds(save, game, 'trait'), onKeep, describe),
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
 * Each carries, under its icon, how many of that gauge's own points are
 * WAITING TO BE SPENT -- the bar is progress toward the next one, the tally
 * is what is already in hand. It was the count SPENT first, which is a true
 * number nobody acts on: what the reader wants from that column is whether
 * there is anything to do, and the bar directly above it is filling toward
 * exactly that. Both are derived from the ladder rather than stored, so
 * neither can disagree with the earnings behind it (model/milestones.ts).
 *
 * THE TWO ARE THE SAME LADDER, which is why they sit one above the other:
 * fame is what gold earns and stat points are what experience earns, on
 * identical numbers. Fame is on top because it is what the whole run is for;
 * the stat-point cycle below it is the one that grows the character that
 * earns the gold.
 *
 * Both read their stream's TOTAL against the moving threshold, so neither
 * moves when the currency is spent -- gold on an item, motes on a trait.
 * That is the whole of the two-fields-not-one design and the thing a single
 * running balance could not express.
 *
 * EACH ONE IS PRESSED to reach where its points are spent, and that is why
 * `onOpen` is passed in rather than the two screens being named here: this
 * file assembles numbers, and which stage a press opens is the hook's
 * business (see useAdventureEscapeMenu). A gauge leads there whether or not
 * anything is waiting -- a way in that appears only when it is useful is one
 * the player cannot go looking for, and both screens are worth reading
 * empty.
 */
export function chromeGauges(
  save: GameSave,
  onOpen?: (gauge: 'fame' | 'statPoint') => void,
): EscapeMenuChromeGauge[] {
  const game = activeGame(save)
  if (!game) return []

  const fame = famePointStanding(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
  const fameWaiting = famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
  const stat = statPointStanding(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
  const statWaiting = statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
  return [
    {
      key: 'fame',
      icon: 'fa-solid fa-crown',
      ratio: famePointProgress(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent),
      count: fameWaiting,
      label: 'Next fame point',
      detail: [
        `${fame.into} of ${fame.span} gold earned toward it`,
        `${game.goldEarned} earned in total, next point at ${game.goldToNextFamePoint}`,
        `${fameWaiting} in hand, ${game.famePointsSpent} spent`,
      ],
      ...(onOpen ? { action: { label: 'Open your renown', onActivate: () => onOpen('fame') } } : {}),
    },
    {
      key: 'statPoint',
      icon: 'fa-solid fa-star',
      ratio: statPointProgress(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent),
      count: statWaiting,
      label: 'Next stat point',
      detail: [
        `${stat.into} of ${stat.span} motes earned toward it`,
        `${game.experienceEarned} earned in total, next point at ${game.experienceToNextStatPoint}`,
        `${statWaiting} waiting, ${game.statPointsSpent} spent`,
      ],
      ...(onOpen ? { action: { label: 'Spend a stat point', onActivate: () => onOpen('statPoint') } } : {}),
    },
  ]
}

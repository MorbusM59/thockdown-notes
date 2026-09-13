// The six stats, and everything they imply.
//
// Stats are DECLARED, not written as fields: every formula reads a
// StatBlock, so a seventh stat is a line in STAT_KEYS plus a formula rather
// than a change to combat, gear, offers and the save format at once. That
// is not a hypothetical -- the design document's own hit-point formula
// names a stat ("Resilience") that is not in its own list of six, which is
// exactly the shape of mistake a declared list makes cheap to correct.
//
// The cap is on BASE stats only. "All stats are capped at 6 before item
// gains" is the reason effective stats are resolved in one documented order
// (modifiers.ts) instead of being clamped wherever they are read: a run's
// own progression stops at 6, and gear is what carries you past it.
//
// Nothing here is random, stateful, or aware of rounds, enemies or menus.

export const STAT_KEYS = ['might', 'agility', 'perception', 'intellect', 'charisma', 'luck'] as const

export type StatKey = (typeof STAT_KEYS)[number]

export type StatBlock = Readonly<Record<StatKey, number>>

/** What a game's own progression can reach. Items and traits add on top. */
export const BASE_STAT_CAP = 6

export const STAT_LABELS: Readonly<Record<StatKey, string>> = {
  might: 'Might',
  agility: 'Agility',
  perception: 'Perception',
  intellect: 'Intellect',
  charisma: 'Charisma',
  luck: 'Luck',
}

/**
 * The tab bar's icon per stat, per the design document's status line.
 *
 * Charisma is the one that is not the design document's own choice: it asks
 * for `fa-lips`, which is Font Awesome PRO and so does not exist in the free
 * set shipped here (@fortawesome/fontawesome-free). `fa-masks-theater` was
 * chosen over the nearest lips-forward free glyph (`fa-face-kiss`) because
 * it matches what charisma DOES rather than what the original icon depicts.
 */
export const STAT_ICONS: Readonly<Record<StatKey, string>> = {
  might: 'fa-solid fa-hand-fist',
  agility: 'fa-solid fa-feather-pointed',
  perception: 'fa-solid fa-eye',
  intellect: 'fa-solid fa-brain',
  charisma: 'fa-solid fa-masks-theater',
  luck: 'fa-solid fa-clover',
}

export function createStatBlock(fill = 0): StatBlock {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, fill])) as StatBlock
}

export function addStats(base: StatBlock, delta: Partial<Record<StatKey, number>>): StatBlock {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, base[key] + (delta[key] ?? 0)])) as StatBlock
}

/** Clamps to [0, BASE_STAT_CAP]. Applied to BASE stats only -- see the module comment. */
export function clampBaseStats(stats: StatBlock): StatBlock {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, Math.max(0, Math.min(BASE_STAT_CAP, Math.floor(stats[key])))]),
  ) as StatBlock
}

// --- Derived values --------------------------------------------------------

/**
 * Everything a stat block implies, named in one record rather than computed
 * at each call site -- so an item can modify a derived value directly
 * without its consumer knowing which stat produced it, and so a formula
 * change is one line here rather than a search.
 */
export interface DerivedStats {
  /** Starting and maximum hit points. See MAX_HIT_POINTS. */
  maxHitPoints: number
  /** Multiplier on outgoing damage (Might). */
  damageMultiplier: number
  /** Chance to avoid an incoming attack entirely (Agility). */
  dodgeChance: number
  /** Actions this actor gets per combat round (Agility). */
  actionsPerRound: number
  /** Choices offered at each step of a level (Perception). */
  encounterChoices: number
  /** Chance an outgoing attack lands (Perception). */
  hitChance: number
  /** Offers shown per selection when spending gold or experience (Luck). */
  offerChoices: number
  /** Chance an attack deals double damage (Luck). */
  critChance: number
}

export type DerivedKey = keyof DerivedStats

export const DERIVED_KEYS: readonly DerivedKey[] = [
  'maxHitPoints',
  'damageMultiplier',
  'dodgeChance',
  'actionsPerRound',
  'encounterChoices',
  'hitChance',
  'offerChoices',
  'critChance',
]

export const DERIVED_LABELS: Readonly<Record<DerivedKey, string>> = {
  maxHitPoints: 'Hit points',
  damageMultiplier: 'Damage',
  dodgeChance: 'Dodge',
  actionsPerRound: 'Actions',
  encounterChoices: 'Encounter choices',
  hitChance: 'Accuracy',
  offerChoices: 'Offers',
  critChance: 'Crit',
}

/**
 * OPEN QUESTION, recorded rather than quietly decided. The design document
 * writes hit points as `50 + 15 * Resilience`, and Resilience is not one of
 * the six stats it lists -- but the formula is written under Might. Read
 * against Might here. If Resilience is meant to be a seventh stat, it is
 * one entry in STAT_KEYS and one word in this function.
 */
const MAX_HIT_POINTS = (stats: StatBlock) => 50 + 15 * stats.might

/**
 * Which derived values are counts (whole, non-negative) and which are
 * chances (0..1). Kept as data because modifiers.ts has to re-apply the
 * same discipline after items have had their say: a "+1 action" trait and a
 * "+15% crit" charm must not each invent their own rounding.
 */
const COUNT_KEYS: ReadonlySet<DerivedKey> = new Set<DerivedKey>([
  'maxHitPoints',
  'actionsPerRound',
  'encounterChoices',
  'offerChoices',
])

const CHANCE_KEYS: ReadonlySet<DerivedKey> = new Set<DerivedKey>(['dodgeChance', 'hitChance', 'critChance'])

/**
 * Intellect and Charisma carry no numeric derivation yet: the design
 * document gives them UNLOCKS (spells, charisma actions) rather than
 * curves, and neither list is written. They are declared stats with real
 * effects pending, not stats without a purpose -- see the open questions in
 * docs/adventure-platform.md.
 */
export function deriveStats(effective: StatBlock): DerivedStats {
  return normalizeDerived({
    maxHitPoints: MAX_HIT_POINTS(effective),
    damageMultiplier: 0.5 + 0.15 * effective.might,
    dodgeChance: 0.5 + 0.05 * effective.agility,
    actionsPerRound: 2 + effective.agility / 2,
    encounterChoices: 2 + effective.perception / 2,
    hitChance: 0.5 + 0.05 * effective.perception,
    offerChoices: 2 + effective.luck / 2,
    critChance: 0.2 + 0.1 * effective.luck,
  })
}

/**
 * Puts every derived value back into its legal shape: counts whole and
 * non-negative (2 + Perception/2 at Perception 3 is three choices, not
 * three and a half), chances inside 0..1, open-ended multipliers merely
 * non-negative. Exported because items apply AFTER the formulas and have to
 * land in the same shape -- see modifiers.ts.
 */
export function normalizeDerived(derived: DerivedStats): DerivedStats {
  const result = { ...derived }
  for (const key of DERIVED_KEYS) {
    const value = result[key]
    if (COUNT_KEYS.has(key)) result[key] = Math.max(0, Math.floor(value))
    else if (CHANCE_KEYS.has(key)) result[key] = Math.max(0, Math.min(1, value))
    else result[key] = Math.max(0, value)
  }
  return result
}

/** How a derived value reads to a player. Chances as percentages, counts as counts. */
export function formatDerived(key: DerivedKey, value: number): string {
  if (CHANCE_KEYS.has(key)) return `${Math.round(value * 100)}%`
  if (key === 'damageMultiplier') return `${Math.round(value * 100)}%`
  return String(value)
}

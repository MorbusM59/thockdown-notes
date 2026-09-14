// Thockquest, the game this platform currently runs.
//
// The platform is named for what it is (an adventure reached from the
// escape ring); the GAME is Thockquest, and it lives here, in content, so
// that a second game would be a second file rather than a second engine.
//
// EVERY PLACEHOLDER IN THIS FILE IS LABELLED. An entry that exists by name
// but whose effect has not been decided carries a `tag` effect saying exactly
// that, so it shows up as unspecified rather than as a number somebody would
// otherwise have to guess was real. Do not replace those with plausible
// values -- filling in blanks that were left open on purpose is how the last
// draft of this game went wrong. They are also not OFFERED (see
// `isOfferable`): an unspecified entry stays in content under the design's
// own name and out of the ring, where a choice between two of them was a
// choice between two nothings.
//
// The items and traits that are NOT placeholders were written here rather
// than in the design document, and they are the one part of this file that is
// mine to have invented. They aim at a spread rather than a ladder: a flat
// one, a scaling one, a conditional one, one that recovers, one that costs
// something. Nothing in the list is strictly better than anything else in it,
// which is the only balance rule they were held to -- the numbers themselves
// are a first pass and expect tuning.

import type { Content, MonsterClass, MonsterClassId, Origin, Region, Species } from './index'
import type { Modifier } from '../model/modifiers'

/** The effect of something that has a name and nothing else yet. */
function unspecified(what: string): Modifier['effects'] {
  return [{ kind: 'tag', tag: 'unspecified', description: `${what} — effect not yet specified` }]
}

/**
 * PLACEHOLDER STAT SPREADS. Only the Warrior's is specified (+2 Might, +1
 * Agility). The other three are named in the design document with no
 * numbers at all; theirs are shaped to match the Warrior's budget so that
 * character creation is playable, and they are NOT balanced, considered, or
 * agreed. Replace them with real ones before any of this is tuned.
 */
const ORIGINS: readonly Origin[] = [
  { id: 'warrior', name: 'Warrior', icon: 'fa-solid fa-hand-fist', statDeltas: { might: 2, agility: 1 } },
  { id: 'thief', name: 'Thief', icon: 'fa-solid fa-mask', statDeltas: { agility: 2, luck: 1 } },
  { id: 'mage', name: 'Mage', icon: 'fa-solid fa-wand-sparkles', statDeltas: { intellect: 2, perception: 1 } },
  { id: 'bard', name: 'Bard', icon: 'fa-solid fa-music', statDeltas: { charisma: 2, luck: 1 } },
]

/**
 * Named in the design document's sample playthrough. Which encounters and
 * monsters each one brings into scope is NOT specified, so a region is
 * currently a place with a name.
 */
const REGIONS: readonly Region[] = [
  { id: 'caves', name: 'A sprawling cave system', icon: 'fa-solid fa-mountain-sun' },
  { id: 'foothills', name: 'The foothills of a snowy range', icon: 'fa-solid fa-snowflake' },
  { id: 'island', name: 'A remote island', icon: 'fa-solid fa-umbrella-beach' },
]

const TRAITS: readonly Modifier[] = [
  {
    id: 'avid-collector',
    kind: 'trait',
    name: 'Avid Collector',
    icon: 'fa-solid fa-box-archive',
    // The one fully specified trait, and the reason modifier effects are
    // declarative data: its number cannot be written down in advance.
    effects: [{ kind: 'derivedScalePerHolding', derived: 'damageMultiplier', factorPer: 0.1, holding: 'item' }],
  },
  {
    id: 'iron-constitution',
    kind: 'trait',
    name: 'Iron Constitution',
    icon: 'fa-solid fa-heart-pulse',
    // Flat hit points, which are granted rather than merely permitted -- see
    // `followMaxHitPoints`. A quarter of a starting warrior, and the plainest
    // thing in the list on purpose: not every choice should need thinking
    // about.
    effects: [{ kind: 'derivedDelta', derived: 'maxHitPoints', amount: 25 }],
  },
  {
    id: 'cornered-animal',
    kind: 'trait',
    name: 'Cornered Animal',
    icon: 'fa-solid fa-paw',
    // Worth nothing at all until a fight has gone badly, and then worth more
    // than anything else on offer. The interesting property is that it
    // rewards NOT running, which is the decision Flee is there to make hard.
    effects: [{ kind: 'derivedScaleWhileHurt', derived: 'damageMultiplier', factor: 1.6, belowFraction: 1 / 3 }],
  },
  {
    id: 'battle-trance',
    kind: 'trait',
    name: 'Battle Trance',
    icon: 'fa-solid fa-fire-flame-curved',
    // An extra ACTION when it matters, which is the largest single thing that
    // can happen to a character: the round's turn order is a ratio of action
    // pools, so this buys attacks and answers at once.
    effects: [{ kind: 'derivedScaleWhileHurt', derived: 'actionsPerRound', factor: 1.5, belowFraction: 0.5 }],
  },
  {
    id: 'patient-hunter',
    kind: 'trait',
    name: 'Patient Hunter',
    icon: 'fa-solid fa-crosshairs',
    // The third of the three "back to the wall" traits, and each is on a
    // different axis: Cornered Animal hits harder, Battle Trance acts more
    // often, and this one stops missing. With no healing in the game, a
    // character at low hit points is where every run ends up, so what happens
    // there is worth three answers rather than one.
    effects: [{ kind: 'derivedScaleWhileHurt', derived: 'hitChance', factor: 1.3, belowFraction: 0.5 }],
  },
  {
    id: 'duelists-read',
    kind: 'trait',
    name: "Duelist's Read",
    // The dodge glyph, because that is what it buys -- see stages/combatLog.ts.
    icon: 'fa-solid fa-wind',
    effects: [{ kind: 'derivedDelta', derived: 'dodgeChance', amount: 0.1 }],
  },
  {
    id: 'opportunist',
    kind: 'trait',
    name: 'Opportunist',
    icon: 'fa-solid fa-star',
    effects: [{ kind: 'derivedDelta', derived: 'critChance', amount: 0.1 }],
  },
  {
    id: 'light-sleeper',
    kind: 'trait',
    name: 'Light Sleeper',
    icon: 'fa-solid fa-eye',
    effects: [
      { kind: 'statDelta', stat: 'perception', amount: 1 },
      { kind: 'derivedDelta', derived: 'hitChance', amount: 0.05 },
    ],
  },
  {
    id: 'pack-instinct',
    kind: 'trait',
    name: 'Pack Instinct',
    icon: 'fa-solid fa-users',
    // The mirror of Avid Collector, on the other axis: this one pays for
    // narrow specialisation in traits rather than for hoarding items.
    effects: [{ kind: 'derivedScalePerHolding', derived: 'maxHitPoints', factorPer: 0.08, holding: 'trait' }],
  },
  {
    id: 'second-skin',
    kind: 'trait',
    name: 'Second Skin',
    icon: 'fa-solid fa-fingerprint',
    // Armor that cannot decay, which is the only kind worth having over a
    // whole level: everything in the item list wears through.
    effects: [{ kind: 'naturalArmor', amount: 3 }],
  },
  { id: 'short-fuse', kind: 'trait', name: 'Short Fuse', icon: 'fa-solid fa-fire', effects: unspecified('Short Fuse') },
  {
    id: 'disarming-smile',
    kind: 'trait',
    name: 'Disarming Smile',
    icon: 'fa-solid fa-face-smile',
    effects: unspecified('Disarming Smile'),
  },
  {
    id: 'sense-of-style',
    kind: 'trait',
    name: 'Sense of Style',
    icon: 'fa-solid fa-hat-cowboy',
    effects: unspecified('Sense of Style'),
  },
]

const ITEMS: readonly Modifier[] = [
  {
    id: 'spyglass',
    kind: 'item',
    name: 'Spyglass',
    icon: 'fa-solid fa-binoculars',
    effects: [{ kind: 'statDelta', stat: 'perception', amount: 2 }],
  },
  {
    id: 'boiled-leather-jerkin',
    kind: 'item',
    name: 'Boiled Leather Jerkin',
    icon: 'fa-solid fa-shirt',
    // Armor is spent as it absorbs, so the FLOOR is the interesting half:
    // this one wears down to a jerkin and stops, rather than to nothing.
    effects: [
      { kind: 'armorOnAcquire', amount: 8 },
      { kind: 'armorDecayFloor', floor: 2 },
    ],
  },
  {
    id: 'whetstone',
    kind: 'item',
    name: 'Whetstone',
    icon: 'fa-solid fa-hammer',
    // A SCALE, so it is worth more the harder you already hit -- which makes
    // it the item a Might build wants and a nice-to-have for anyone else.
    effects: [{ kind: 'derivedScale', derived: 'damageMultiplier', factor: 1.2 }],
  },
  {
    id: 'iron-buckler',
    kind: 'item',
    name: 'Iron Buckler',
    icon: 'fa-solid fa-shield-halved',
    // The first thing in the game that COSTS something. Armor that never
    // decays, paid for in the one defence that takes no damage at all.
    effects: [
      { kind: 'naturalArmor', amount: 3 },
      { kind: 'derivedDelta', derived: 'dodgeChance', amount: -0.05 },
    ],
  },
  {
    id: 'cracked-hourglass',
    kind: 'item',
    name: 'Cracked Hourglass',
    icon: 'fa-solid fa-hourglass-half',
    // The biggest swing on offer, and deliberately dangerous: an extra action
    // every round for fifteen hit points off the top, on a character who
    // starts with eighty and cannot heal without help.
    effects: [
      { kind: 'derivedDelta', derived: 'actionsPerRound', amount: 1 },
      { kind: 'derivedDelta', derived: 'maxHitPoints', amount: -15 },
    ],
  },
  {
    id: 'duelists-cape',
    kind: 'item',
    name: "Duelist's Cape",
    icon: 'fa-solid fa-user-ninja',
    // The mirror of the buckler: that one buys armor with dodge, this one
    // buys dodge with damage. Two ways to pay for not being hit, which is the
    // only economy there is once hit points stop coming back.
    effects: [
      { kind: 'derivedDelta', derived: 'dodgeChance', amount: 0.1 },
      { kind: 'derivedScale', derived: 'damageMultiplier', factor: 0.9 },
    ],
  },
  {
    id: 'featherweight-boots',
    kind: 'item',
    name: 'Featherweight Boots',
    icon: 'fa-solid fa-shoe-prints',
    effects: [
      { kind: 'statDelta', stat: 'agility', amount: 1 },
      { kind: 'derivedDelta', derived: 'dodgeChance', amount: 0.05 },
    ],
  },
  {
    id: 'lucky-copper-coin',
    kind: 'item',
    name: 'Lucky Copper Coin',
    icon: 'fa-solid fa-clover',
    // Luck is the widest stat in the game -- crit, offers, and the escalating
    // loot check all read it -- so a point of it is worth more than its
    // single line suggests.
    effects: [
      { kind: 'statDelta', stat: 'luck', amount: 1 },
      { kind: 'derivedDelta', derived: 'critChance', amount: 0.05 },
    ],
  },
  {
    id: 'duelists-chalk',
    kind: 'item',
    name: "Duelist's Chalk",
    icon: 'fa-solid fa-crosshairs',
    effects: [{ kind: 'derivedDelta', derived: 'hitChance', amount: 0.1 }],
  },
  {
    id: 'thock-keycap',
    kind: 'item',
    name: 'Thock Keycap',
    icon: 'fa-solid fa-keyboard',
    // It is a keycap. It is not from around here.
    effects: [{ kind: 'derivedScalePerHolding', derived: 'damageMultiplier', factorPer: 0.08, holding: 'trait' }],
  },
  {
    id: 'bronze-talisman',
    kind: 'item',
    name: 'Bronze Talisman',
    icon: 'fa-solid fa-circle-notch',
    effects: unspecified('Bronze Talisman'),
  },
  {
    id: 'nail-clipper',
    kind: 'item',
    name: 'Nail Clipper',
    icon: 'fa-solid fa-scissors',
    effects: unspecified('Nail Clipper'),
  },
]

/**
 * The three monster classes, on the player origins' own stat scale -- the
 * design's "similar to the player classes", taken literally so there is one
 * scale in the game rather than two that have to be kept comparable.
 */
const MONSTER_CLASSES: readonly MonsterClass[] = [
  { id: 'warrior', name: 'Warrior', icon: 'fa-solid fa-hand-fist', statDeltas: { might: 2, agility: 1 } },
  { id: 'thief', name: 'Thief', icon: 'fa-solid fa-mask', statDeltas: { agility: 2, luck: 1 } },
  { id: 'mage', name: 'Mage', icon: 'fa-solid fa-wand-sparkles', statDeltas: { intellect: 2, perception: 1 } },
]

/**
 * WHAT you fight, and what it is called at each rank.
 *
 * A species carries stat modifiers of its own and a name per type, plus which
 * classes it may take at that type -- a Goblin Chieftain is always a warrior,
 * a Goblin Lord always a mage, and a plain Goblin can be anything.
 *
 * A type may have SEVERAL forms. Beasts are the reason: a beast group is a
 * pack of wolves or a pack of boars, and the choice decides the name and the
 * class together.
 *
 * `classes: []` means any class.
 */
const ANY: readonly MonsterClassId[] = []

const SPECIES: readonly Species[] = [
  {
    id: 'goblin',
    name: 'Goblin',
    statDeltas: { luck: 2, might: -1, charisma: -2, agility: 1 },
    forms: {
      group: [{ name: 'Band of Goblins', classes: ['thief'] }],
      regular: [{ name: 'Goblin', classes: ANY }],
      elite: [{ name: 'Goblin Veteran', classes: ANY }],
      miniBoss: [{ name: 'Goblin Chieftain', classes: ['warrior'] }],
      boss: [{ name: 'Goblin Lord', classes: ['mage'] }],
    },
  },
  {
    id: 'orc',
    name: 'Orc',
    statDeltas: { might: 2, intellect: -1, charisma: -2, perception: 1 },
    forms: {
      group: [{ name: 'Pack of Orcs', classes: ['warrior'] }],
      regular: [{ name: 'Orc', classes: ANY }],
      elite: [{ name: 'Orc Brute', classes: ['warrior'] }],
      miniBoss: [{ name: 'Orc Squad Leader', classes: ['mage'] }],
      boss: [{ name: 'Orc Demon', classes: ['warrior'] }],
    },
  },
  {
    id: 'beast',
    name: 'Beast',
    statDeltas: { perception: 2, intellect: -3, agility: 1 },
    forms: {
      group: [
        { name: 'Pack of Wolves', classes: ['thief'] },
        { name: 'Pack of Boars', classes: ['warrior'] },
      ],
      regular: [
        { name: 'Large Wolf', classes: ['thief'] },
        { name: 'Large Boar', classes: ['warrior'] },
      ],
      elite: [
        { name: 'Dire Wolf', classes: ['warrior'] },
        { name: 'Enraged Boar', classes: ['warrior'] },
      ],
      miniBoss: [
        { name: 'Dire Bear', classes: ['warrior'] },
        { name: 'Shadow Stag', classes: ['mage'] },
      ],
      boss: [{ name: 'Hulking Grizzly', classes: ['warrior'] }],
    },
  },
]

export const THOCKQUEST: Content = {
  origins: ORIGINS,
  items: ITEMS,
  traits: TRAITS,
  regions: REGIONS,
  monsterClasses: MONSTER_CLASSES,
  species: SPECIES,
}

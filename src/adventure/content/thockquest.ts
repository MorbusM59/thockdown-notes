// Thockquest, the game this platform currently runs.
//
// The platform is named for what it is (an adventure reached from the
// escape ring); the GAME is Thockquest, and it lives here, in content, so
// that a second game would be a second file rather than a second engine.
//
// EVERY PLACEHOLDER IN THIS FILE IS LABELLED, and there are a lot of them:
// the design is a third written. An entry that exists by name but whose
// effect has not been decided carries a `tag` effect saying exactly that,
// so it shows up in the tab bar as unspecified rather than as a number
// somebody would otherwise have to guess was real. Do not replace those
// with plausible values -- filling in blanks that were left open on purpose
// is how the last draft of this game went wrong.

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
  { id: 'warrior', statDeltas: { might: 2, agility: 1 } },
  { id: 'thief', statDeltas: { agility: 2, luck: 1 } },
  { id: 'mage', statDeltas: { intellect: 2, perception: 1 } },
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

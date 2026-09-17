// ThockQuest, the game this platform currently runs.
//
// The platform is named for what it is (an adventure reached from the
// escape ring); the GAME is ThockQuest -- capital Q wherever a player can
// read it -- and it lives here, in content, so that a second game would be a
// second file rather than a second engine.
//
// EVERY PLACEHOLDER IN THIS FILE IS LABELLED. An entry that exists by name
// but whose effect has not been decided carries a `tag` effect saying exactly
// that, so it shows up as unspecified rather than as a number somebody would
// otherwise have to guess was real. Do not replace those with plausible
// values -- filling in blanks that were left open on purpose is how the last
// draft of this game went wrong. They are also not OFFERED (see
// `isOfferable`): an unspecified entry stays in content under the design's
// own name and out of the ring, where a choice between two of them was a
// choice between two nothings. THREE TRAITS are in that state; no item is,
// and cannot be -- see the item templates below.
//
// TRAITS ARE WRITTEN AND ITEMS ARE ROLLED, and the two halves of this file
// read differently because of it. A trait names its own effect. An item names
// only what it is ABOUT, and the run decides what it is (model/itemSlots.ts).
//
// The traits that are not placeholders were written here rather than in the
// design document, and they are the one part of this file that is mine to
// have invented. They aim at a spread rather than a ladder: a plain one, a
// scaling one, three conditional ones on three different axes. Nothing in the
// list is strictly better than anything else in it, which is the only balance
// rule they were held to -- the numbers themselves are a first pass and expect
// tuning. THEIR POWER HAS NOT BEEN REVISITED against the rolled items yet;
// that is the next session's work (docs/adventure-platform.md).

import type { Content, MonsterClass, MonsterClassId, Origin, Region, Species } from './index'
import type { ItemTemplate } from '../model/itemSlots'
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
    effects: [{ kind: 'derivedPercentPerHolding', derived: 'damageMultiplier', percentPer: 0.1, holding: 'item' }],
  },
  {
    id: 'iron-constitution',
    kind: 'trait',
    name: 'Iron Constitution',
    icon: 'fa-solid fa-heart-pulse',
    // Hit points, granted rather than merely permitted -- see
    // `followMaxHitPoints`. A PERCENTAGE rather than the flat +25 it shipped
    // as: a flat pool is a third of a starting warrior and a rounding error on
    // a late one, so it had to be re-tuned every time the curve moved
    // (model/modifiers.ts). The plainest thing in the list on purpose: not
    // every choice should need thinking about.
    effects: [{ kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.3 }],
  },
  {
    id: 'cornered-animal',
    kind: 'trait',
    name: 'Cornered Animal',
    icon: 'fa-solid fa-paw',
    // Worth nothing at all until a fight has gone badly, and then worth more
    // than anything else on offer. The interesting property is that it
    // rewards NOT running, which is the decision Flee is there to make hard.
    effects: [{ kind: 'derivedPercentWhileHurt', derived: 'damageMultiplier', percent: 0.6, belowFraction: 1 / 3 }],
  },
  {
    id: 'battle-trance',
    kind: 'trait',
    name: 'Battle Trance',
    icon: 'fa-solid fa-fire-flame-curved',
    // An extra ACTION when it matters, which is the largest single thing that
    // can happen to a character: the round's turn order is a ratio of action
    // pools, so this buys attacks and answers at once.
    effects: [{ kind: 'derivedPercentWhileHurt', derived: 'actionsPerRound', percent: 0.5, belowFraction: 0.5 }],
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
    // A percentage of the MISSES, not of the chance -- which is what a
    // percentage of a probability means everywhere in this game
    // (model/chance.ts). Thirty percent of what still misses.
    effects: [{ kind: 'derivedPercentWhileHurt', derived: 'hitChance', percent: 0.3, belowFraction: 0.5 }],
  },
  {
    id: 'duelists-read',
    kind: 'trait',
    name: "Duelist's Read",
    // The dodge glyph, because that is what it buys -- see stages/combatLog.ts.
    icon: 'fa-solid fa-wind',
    // A fifth of the blows that would land, rather than the flat ten points
    // it shipped as: points added to a probability stack into certainty, and
    // a share of the remainder cannot (model/chance.ts).
    effects: [{ kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.2 }],
  },
  {
    id: 'opportunist',
    kind: 'trait',
    name: 'Opportunist',
    icon: 'fa-solid fa-star',
    effects: [{ kind: 'derivedPercent', derived: 'critChance', percent: 0.2 }],
  },
  {
    id: 'light-sleeper',
    kind: 'trait',
    name: 'Light Sleeper',
    icon: 'fa-solid fa-eye',
    effects: [
      { kind: 'statDelta', stat: 'perception', amount: 1 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.1 },
    ],
  },
  {
    id: 'pack-instinct',
    kind: 'trait',
    name: 'Pack Instinct',
    icon: 'fa-solid fa-users',
    // The mirror of Avid Collector, on the other axis: this one pays for
    // narrow specialisation in traits rather than for hoarding items.
    effects: [{ kind: 'derivedPercentPerHolding', derived: 'maxHitPoints', percentPer: 0.08, holding: 'trait' }],
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

/**
 * THE ITEM TEMPLATES. Thirty of them, and not one of them says what it does.
 *
 * A template says what an item is ABOUT -- which stats it would plausibly
 * sharpen, which odds or quantities it would plausibly move, which of the
 * richer effects suit it, and whether it is armour -- and the run rolls which
 * of those it actually is (model/itemSlots.ts). So this file no longer holds
 * a single tuned number for an item, which is the point: thirty hand-balanced
 * items is thirty things to re-tune every time a formula moves, and the
 * previous ten were already a "first pass expecting tuning" that nobody was
 * ever going to do thirty of.
 *
 * WHAT IS AUTHORED HERE IS THE THEME, and it is the only thing that has to be
 * right. A spyglass sharpens Perception and what Perception buys; it has no
 * opinion about Might, so it cannot roll one. A warhorn is Charisma and Might
 * and the noise a round opens with. Get the lists wrong and the game produces
 * a coherent item that means nothing -- which is a content mistake you can see
 * by reading, rather than a balance mistake you can only see by playing.
 *
 * ARMOUR IS A PROPERTY OF THE FICTION, not a roll: eight of the thirty carry
 * an armor range, they always fill that slot, and it is taken first (see the
 * module comment in model/itemSlots.ts). The other twenty-two never have
 * armor, however the dice fall, because a spyglass is not a shield.
 *
 * TWO OF THESE WERE PLACEHOLDERS. The Bronze Talisman and the Nail Clipper
 * were named by the design document and carried an `unspecified` tag, on the
 * rule that a blank left open on purpose is not ours to fill. They are filled
 * now because the AUTHOR filled them -- what an item is is no longer a number
 * somebody has to choose, so "unspecified" stopped being a state an item could
 * be in. The three unspecified TRAITS above are untouched.
 */
const ITEMS: readonly ItemTemplate[] = [
  // --- Armour ---------------------------------------------------------------
  {
    id: 'boiled-leather-jerkin',
    name: 'Boiled Leather Jerkin',
    icon: 'fa-solid fa-shirt',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['tempered', 'repair', 'desperate'],
    armor: [6, 10],
  },
  {
    id: 'iron-buckler',
    name: 'Iron Buckler',
    icon: 'fa-solid fa-shield-halved',
    stats: ['might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['tempered', 'ward', 'finisher'],
    armor: [5, 9],
  },
  {
    id: 'scaled-bracers',
    name: 'Scaled Bracers',
    icon: 'fa-solid fa-mitten',
    stats: ['agility', 'might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['tempered', 'opener'],
    armor: [4, 7],
  },
  {
    id: 'chain-coif',
    name: 'Chain Coif',
    icon: 'fa-solid fa-helmet-safety',
    stats: ['might', 'perception'],
    derived: ['maxHitPoints', 'hitChance'],
    verbose: ['tempered', 'ward'],
    armor: [5, 8],
  },
  {
    id: 'oaken-shield',
    name: 'Oaken Shield',
    icon: 'fa-solid fa-shield',
    stats: ['might'],
    derived: ['maxHitPoints', 'dodgeChance'],
    // The big slow one: most armor in the game, and the verbose options all
    // make it last longer rather than hit harder.
    verbose: ['tempered', 'repair', 'desperate'],
    armor: [8, 13],
  },
  {
    id: 'plated-greaves',
    name: 'Plated Greaves',
    icon: 'fa-solid fa-socks',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'actionsPerRound'],
    verbose: ['tempered', 'ward'],
    armor: [6, 10],
  },
  {
    id: 'tinkers-harness',
    name: "Tinker's Harness",
    icon: 'fa-solid fa-toolbox',
    // The one piece of armour Intellect wants: what it rolls is often the
    // repair, and the repair reads the whole kit rather than itself.
    stats: ['intellect', 'might'],
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['repair', 'tempered'],
    armor: [4, 8],
  },
  {
    id: 'bonemail',
    name: 'Bonemail',
    icon: 'fa-solid fa-bone',
    stats: ['might', 'luck'],
    derived: ['maxHitPoints', 'critChance'],
    verbose: ['tempered', 'desperate'],
    armor: [5, 9],
  },

  // --- Everything else ------------------------------------------------------
  {
    id: 'spyglass',
    name: 'Spyglass',
    icon: 'fa-solid fa-binoculars',
    stats: ['perception', 'luck'],
    derived: ['hitChance', 'encounterChoices', 'critChance'],
    verbose: ['opener', 'studied'],
  },
  {
    id: 'whetstone',
    name: 'Whetstone',
    icon: 'fa-solid fa-hammer',
    stats: ['might'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'cracked-hourglass',
    name: 'Cracked Hourglass',
    icon: 'fa-solid fa-hourglass-half',
    // Actions are the largest thing that can happen to a character -- the
    // round's turn order is a ratio of action pools -- so this is the one
    // template whose derived list leads with them.
    stats: ['agility', 'perception'],
    derived: ['actionsPerRound', 'dodgeChance'],
    verbose: ['opener', 'finisher', 'desperate'],
  },
  {
    id: 'duelists-cape',
    name: "Duelist's Cape",
    icon: 'fa-solid fa-user-ninja',
    stats: ['agility', 'charisma'],
    derived: ['dodgeChance', 'critChance'],
    verbose: ['finisher', 'desperate'],
  },
  {
    id: 'featherweight-boots',
    name: 'Featherweight Boots',
    icon: 'fa-solid fa-shoe-prints',
    stats: ['agility'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['opener'],
  },
  {
    id: 'lucky-copper-coin',
    name: 'Lucky Copper Coin',
    icon: 'fa-solid fa-clover',
    // Luck is the widest stat in the game -- crit, offers, armor's own
    // survival and the escalating loot check all read it.
    stats: ['luck'],
    derived: ['critChance', 'offerChoices'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'duelists-chalk',
    name: "Duelist's Chalk",
    icon: 'fa-solid fa-crosshairs',
    stats: ['perception', 'agility'],
    derived: ['hitChance', 'critChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'thock-keycap',
    name: 'Thock Keycap',
    icon: 'fa-solid fa-keyboard',
    // It is a keycap. It is not from around here.
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'bronze-talisman',
    name: 'Bronze Talisman',
    icon: 'fa-solid fa-circle-notch',
    stats: ['charisma', 'luck'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['ward', 'desperate'],
  },
  {
    id: 'nail-clipper',
    name: 'Nail Clipper',
    icon: 'fa-solid fa-scissors',
    stats: ['agility', 'perception'],
    derived: ['critChance', 'hitChance'],
    verbose: ['finisher'],
  },
  {
    id: 'hunters-quiver',
    name: "Hunter's Quiver",
    icon: 'fa-solid fa-feather-pointed',
    stats: ['perception', 'might'],
    derived: ['damageMultiplier', 'hitChance'],
    verbose: ['opener'],
  },
  {
    id: 'salted-rations',
    name: 'Salted Rations',
    icon: 'fa-solid fa-drumstick-bite',
    // The plainest thing in the list, on purpose: not every choice should
    // need thinking about. There is no healing in this game, so a bigger
    // pool is the only thing food can honestly buy.
    stats: ['might', 'intellect'],
    // Actions beside the pool, because a below-hit-points effect cannot act on
    // the pool itself -- raising a ceiling only while its owner is under it is
    // a loop (model/itemSlots.ts). Running on reserves is the same idea, in
    // the one currency that can express it.
    derived: ['maxHitPoints', 'actionsPerRound'],
    verbose: ['repair', 'desperate'],
  },
  {
    id: 'ravens-feather',
    name: "Raven's Feather",
    icon: 'fa-solid fa-feather',
    stats: ['perception', 'charisma'],
    derived: ['encounterChoices', 'offerChoices'],
    verbose: ['studied'],
  },
  {
    id: 'glass-phial',
    name: 'Glass Phial',
    icon: 'fa-solid fa-flask',
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'iron-knuckles',
    name: 'Iron Knuckles',
    icon: 'fa-solid fa-hand-fist',
    stats: ['might', 'agility'],
    derived: ['damageMultiplier', 'hitChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'gamblers-dice',
    name: "Gambler's Dice",
    icon: 'fa-solid fa-dice',
    stats: ['luck'],
    derived: ['critChance', 'offerChoices', 'damageMultiplier'],
    verbose: ['collector'],
  },
  {
    id: 'widows-locket',
    name: "Widow's Locket",
    icon: 'fa-solid fa-heart-crack',
    stats: ['charisma', 'luck'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['desperate', 'ward'],
  },
  {
    id: 'cinder-flask',
    name: 'Cinder Flask',
    icon: 'fa-solid fa-fire',
    stats: ['intellect', 'might'],
    derived: ['damageMultiplier'],
    verbose: ['opener', 'desperate'],
  },
  {
    id: 'silk-wraps',
    name: 'Silk Wraps',
    icon: 'fa-solid fa-ribbon',
    stats: ['agility', 'charisma'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['finisher', 'ward'],
  },
  {
    id: 'surveyors-rod',
    name: "Surveyor's Rod",
    icon: 'fa-solid fa-ruler-combined',
    stats: ['perception', 'intellect'],
    derived: ['encounterChoices', 'hitChance'],
    verbose: ['studied'],
  },
  {
    id: 'warhorn',
    name: 'Warhorn',
    icon: 'fa-solid fa-bullhorn',
    // Charisma and Might, and a noise a round opens with: the one template
    // whose verbose list is weighted at the round's first action.
    stats: ['charisma', 'might'],
    derived: ['damageMultiplier', 'actionsPerRound'],
    verbose: ['opener', 'collector'],
  },
  {
    id: 'brass-compass',
    name: 'Brass Compass',
    icon: 'fa-solid fa-compass',
    stats: ['perception', 'intellect'],
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['opener', 'studied'],
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

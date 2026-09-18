// ThockQuest, the game this platform currently runs.
//
// The platform is named for what it is (an adventure reached from the
// escape ring); the GAME is ThockQuest -- capital Q wherever a player can
// read it -- and it lives here, in content, so that a second game would be a
// second file rather than a second engine.
//
// NOTHING IN THIS FILE SAYS WHAT IT DOES, and that is the shape of it. Both
// halves -- items and traits -- are TEMPLATES: a template names what a thing
// is ABOUT, and the run rolls what it actually is
// (model/modifierSlots.ts). Sixty templates is sixty things in one run and a
// different sixty in the next, without sixty numbers to hand-tune.
//
// WHAT IS AUTHORED HERE IS THE THEME, and it is the only thing that has to be
// right. A spyglass sharpens Perception and what Perception buys; it has no
// opinion about Might. Get the lists wrong and the game produces a coherent
// thing that means nothing -- which is a content mistake you can see by
// reading, rather than a balance mistake you can only see by playing.
//
// THE PLACEHOLDER MECHANISM IS GONE, and it is worth saying why rather than
// letting it vanish. Five entries used to exist by NAME and carry an
// `unspecified` tag saying their effect had not been decided, so that a blank
// left open on purpose read as a blank rather than as a number somebody
// guessed; they were kept out of every pool that offers, because a choice
// between two of them was a choice between two nothings. What a thing does is
// no longer a number anybody chooses, so "unspecified" stopped being a state
// one can be in -- the tag effect, `isOfferable` and the filters that read it
// are all deleted rather than left standing over a case that cannot arise.

import type { Content, MonsterClass, MonsterClassId, Origin, Region, Species } from './index'
import type { ModifierTemplate } from '../model/modifierSlots'

/**
 * PLACEHOLDER STAT SPREADS for the four starting classes. Only the Warrior's
 * is specified (+2 Might, +1 Agility). The other three are named in the
 * design document with no numbers at all; theirs are shaped to match the
 * Warrior's budget so that character creation is playable, and they are NOT
 * balanced, considered, or agreed. Replace them with real ones before any of
 * this is tuned.
 *
 * The BERSERKER is specified, and it is the first class that has to be
 * earned: reach Might 6 in a run and it is available at the start of every
 * run after (model/permanentUnlocks.ts). It is also the first class to carry
 * effects that are not stats -- which is what a class sharing the modifier
 * vocabulary buys, rather than a second kind of declaration.
 */
const ORIGINS: readonly Origin[] = [
  {
    id: 'warrior',
    name: 'Warrior',
    icon: 'fa-solid fa-hand-fist',
    effects: [
      { kind: 'statDelta', stat: 'might', amount: 2 },
      { kind: 'statDelta', stat: 'agility', amount: 1 },
    ],
  },
  {
    id: 'thief',
    name: 'Thief',
    icon: 'fa-solid fa-mask',
    effects: [
      { kind: 'statDelta', stat: 'agility', amount: 2 },
      { kind: 'statDelta', stat: 'luck', amount: 1 },
    ],
  },
  {
    id: 'mage',
    name: 'Mage',
    icon: 'fa-solid fa-wand-sparkles',
    effects: [
      { kind: 'statDelta', stat: 'intellect', amount: 2 },
      { kind: 'statDelta', stat: 'perception', amount: 1 },
    ],
  },
  {
    id: 'bard',
    name: 'Bard',
    icon: 'fa-solid fa-music',
    effects: [
      { kind: 'statDelta', stat: 'charisma', amount: 2 },
      { kind: 'statDelta', stat: 'luck', amount: 1 },
    ],
  },
  {
    id: 'berserker',
    name: 'Berserker',
    icon: 'fa-solid fa-khanda',
    requiresUnlock: 'berserker',
    effects: [
      { kind: 'statDelta', stat: 'might', amount: 4 },
      { kind: 'statDelta', stat: 'agility', amount: 2 },
      { kind: 'statDelta', stat: 'intellect', amount: -2 },
      // A FRACTION, like every other percentage in the vocabulary (the slot
      // ranges are 0.1 to 0.5): 1 is +100%, which doubles the damage.
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 1 },
      // Worn armour is worth nothing to them; a trait's natural armour still
      // is, so a Berserker can be tough without ever being armoured.
      { kind: 'noDecayingArmor' },
    ],
  },
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

/**
 * THE TRAIT TEMPLATES. Thirty of them, and, exactly as with the items, not one
 * of them says what it does.
 *
 * WHAT MAKES A TRAIT DIFFERENT FROM AN ITEM is two lines of the slot plan and
 * nothing else (`model/modifierSlots.ts`'s `SLOT_PLAN`). An item is GEAR: it
 * has two stat slots, because the base stat cap is the thing gear exists to
 * carry a character past. A trait is something you ARE and cannot be picked
 * up, so it has none, and spends those two slots on VERBOSE effects instead --
 * which makes traits the odd and the particular half of the game, and items
 * the half that moves the table.
 *
 * Its armor slot is NATURAL armor, flat and unwearable, at a third of what an
 * item's decaying pool rolls. A point that survives a whole level is worth
 * several that do not.
 *
 * THREE OF THESE WERE PLACEHOLDERS. Short Fuse, Disarming Smile and Sense of
 * Style were named by the design document and carried an `unspecified` tag,
 * on the rule that a blank left open on purpose is not ours to fill. They are
 * filled now because the AUTHOR filled them -- what a trait is is no longer a
 * number anybody has to choose -- and the tag mechanism is gone with them,
 * because "unspecified" stopped being a state a modifier can be in.
 */
const TRAITS: readonly ModifierTemplate[] = [
  {
    id: 'avid-collector',
    kind: 'trait',
    name: 'Avid Collector',
    icon: 'fa-solid fa-box-archive',
    // The trait the declarative vocabulary was built for: its number cannot be
    // written down in advance, because it depends on what is being carried.
    derived: ['damageMultiplier', 'maxHitPoints'],
    verbose: ['collector', 'studied', 'desperate'],
  },
  {
    id: 'iron-constitution',
    kind: 'trait',
    name: 'Iron Constitution',
    icon: 'fa-solid fa-heart-pulse',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['desperate', 'finisher'],
    armor: true,
  },
  {
    id: 'cornered-animal',
    kind: 'trait',
    name: 'Cornered Animal',
    icon: 'fa-solid fa-paw',
    // Worth nothing at all until a fight has gone badly, and then worth more
    // than anything else on offer. The interesting property is that it rewards
    // NOT running, which is the decision Flee is there to make hard.
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'battle-trance',
    kind: 'trait',
    name: 'Battle Trance',
    icon: 'fa-solid fa-fire-flame-curved',
    // Actions are the largest single thing that can happen to a character: the
    // round's turn order is a ratio of action pools, so they buy attacks and
    // answers at once.
    derived: ['actionsPerRound', 'damageMultiplier'],
    verbose: ['desperate', 'opener'],
  },
  {
    id: 'patient-hunter',
    kind: 'trait',
    name: 'Patient Hunter',
    icon: 'fa-solid fa-crosshairs',
    derived: ['hitChance', 'critChance'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'duelists-read',
    kind: 'trait',
    name: "Duelist's Read",
    // The dodge glyph, because that is what it buys -- see stages/combatLog.ts.
    icon: 'fa-solid fa-wind',
    derived: ['dodgeChance', 'hitChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'opportunist',
    kind: 'trait',
    name: 'Opportunist',
    icon: 'fa-solid fa-star',
    derived: ['critChance', 'offerChoices'],
    verbose: ['finisher', 'collector'],
  },
  {
    id: 'light-sleeper',
    kind: 'trait',
    name: 'Light Sleeper',
    icon: 'fa-solid fa-eye',
    derived: ['hitChance', 'dodgeChance'],
    verbose: ['opener', 'studied'],
  },
  {
    id: 'pack-instinct',
    kind: 'trait',
    name: 'Pack Instinct',
    icon: 'fa-solid fa-users',
    // The mirror of Avid Collector, on the other axis: this one pays for
    // narrow specialisation in traits rather than for hoarding items.
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['studied', 'collector'],
  },
  {
    id: 'second-skin',
    kind: 'trait',
    name: 'Second Skin',
    icon: 'fa-solid fa-fingerprint',
    // Armor that cannot decay, which is the only kind worth having over a
    // whole level: everything in the item list wears through. A trait's armor
    // slot IS that -- which is why no trait names `ward` beside it.
    derived: ['dodgeChance', 'maxHitPoints'],
    verbose: ['desperate', 'opener'],
    armor: true,
  },
  {
    id: 'short-fuse',
    kind: 'trait',
    name: 'Short Fuse',
    icon: 'fa-solid fa-fire',
    derived: ['damageMultiplier', 'actionsPerRound'],
    verbose: ['opener', 'desperate'],
  },
  {
    id: 'disarming-smile',
    kind: 'trait',
    name: 'Disarming Smile',
    icon: 'fa-solid fa-face-smile',
    derived: ['dodgeChance', 'offerChoices'],
    verbose: ['opener', 'collector'],
  },
  {
    id: 'sense-of-style',
    kind: 'trait',
    name: 'Sense of Style',
    icon: 'fa-solid fa-hat-cowboy',
    derived: ['offerChoices', 'critChance'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'thick-skinned',
    kind: 'trait',
    name: 'Thick Skinned',
    icon: 'fa-solid fa-shield-heart',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['repair', 'desperate'],
    armor: true,
  },
  {
    id: 'quick-study',
    kind: 'trait',
    name: 'Quick Study',
    icon: 'fa-solid fa-brain',
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['studied', 'opener'],
  },
  {
    id: 'grudge-bearer',
    kind: 'trait',
    name: 'Grudge Bearer',
    icon: 'fa-solid fa-hand-back-fist',
    derived: ['damageMultiplier', 'hitChance'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'silver-tongue',
    kind: 'trait',
    name: 'Silver Tongue',
    icon: 'fa-solid fa-comment-dots',
    // The one that buys nothing in a fight at all: what it moves is what the
    // world puts in front of you, which is the other half of a run.
    derived: ['offerChoices', 'encounterChoices'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'cave-sense',
    kind: 'trait',
    name: 'Cave Sense',
    icon: 'fa-solid fa-mountain-sun',
    derived: ['encounterChoices', 'dodgeChance'],
    verbose: ['studied', 'opener'],
  },
  {
    id: 'steady-hands',
    kind: 'trait',
    name: 'Steady Hands',
    icon: 'fa-solid fa-hand-sparkles',
    derived: ['hitChance', 'critChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'hoarder',
    kind: 'trait',
    name: 'Hoarder',
    icon: 'fa-solid fa-sack-xmark',
    derived: ['maxHitPoints', 'offerChoices'],
    verbose: ['collector', 'repair'],
  },
  {
    id: 'night-owl',
    kind: 'trait',
    name: 'Night Owl',
    icon: 'fa-solid fa-moon',
    derived: ['dodgeChance', 'critChance'],
    verbose: ['opener', 'desperate'],
  },
  {
    id: 'scar-tissue',
    kind: 'trait',
    name: 'Scar Tissue',
    icon: 'fa-solid fa-bandage',
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['desperate', 'finisher'],
    armor: true,
  },
  {
    id: 'bloodhound',
    kind: 'trait',
    name: 'Bloodhound',
    icon: 'fa-solid fa-dog',
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['finisher', 'studied'],
  },
  {
    id: 'stubborn-streak',
    kind: 'trait',
    name: 'Stubborn Streak',
    icon: 'fa-solid fa-anchor',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['desperate', 'studied'],
  },
  {
    id: 'feral-grace',
    kind: 'trait',
    name: 'Feral Grace',
    icon: 'fa-solid fa-cat',
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'cold-blooded',
    kind: 'trait',
    name: 'Cold Blooded',
    icon: 'fa-solid fa-snowflake',
    derived: ['critChance', 'hitChance'],
    verbose: ['finisher', 'opener'],
  },
  {
    id: 'lucky-streak',
    kind: 'trait',
    name: 'Lucky Streak',
    icon: 'fa-solid fa-dice-d20',
    derived: ['critChance', 'offerChoices'],
    verbose: ['collector', 'finisher'],
  },
  {
    id: 'wary-traveller',
    kind: 'trait',
    name: 'Wary Traveller',
    icon: 'fa-solid fa-person-walking',
    derived: ['dodgeChance', 'encounterChoices'],
    verbose: ['opener', 'studied'],
  },
  {
    id: 'deep-breather',
    kind: 'trait',
    name: 'Deep Breather',
    icon: 'fa-solid fa-lungs',
    derived: ['maxHitPoints', 'actionsPerRound'],
    verbose: ['desperate', 'repair'],
  },
  {
    id: 'pit-fighter',
    kind: 'trait',
    name: 'Pit Fighter',
    icon: 'fa-solid fa-khanda',
    derived: ['damageMultiplier', 'dodgeChance'],
    verbose: ['finisher', 'desperate'],
  },
]

/**
 * THE ITEM TEMPLATES. Thirty of them.
 *
 * An ITEM IS GEAR, which is the whole of what makes this half different from
 * the traits above: it has two STAT slots, because the base stat cap is the
 * thing gear exists to carry a character past, and one verbose slot where a
 * trait has two.
 *
 * ARMOUR IS A PROPERTY OF THE FICTION, not a roll: eight of the thirty are
 * armour, they always fill that slot, and it is taken first (see the module
 * comment in model/modifierSlots.ts). The other twenty-two never have armor,
 * however the dice fall, because a spyglass is not a shield. HOW MUCH is not
 * written here -- one range per slot, declared beside every other slot's, so
 * that a shield is not eight hand-tuned numbers waiting to go stale.
 *
 * TWO OF THESE WERE PLACEHOLDERS -- the Bronze Talisman and the Nail Clipper.
 * See this file's header for what happened to that mechanism.
 */
const ITEMS: readonly ModifierTemplate[] = [
  // --- Armour ---------------------------------------------------------------
  {
    id: 'boiled-leather-jerkin',
    kind: 'item',
    name: 'Boiled Leather Jerkin',
    icon: 'fa-solid fa-shirt',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['tempered', 'repair', 'desperate'],
    armor: true,
  },
  {
    id: 'iron-buckler',
    kind: 'item',
    name: 'Iron Buckler',
    icon: 'fa-solid fa-shield-halved',
    stats: ['might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['tempered', 'ward', 'finisher'],
    armor: true,
  },
  {
    id: 'scaled-bracers',
    kind: 'item',
    name: 'Scaled Bracers',
    icon: 'fa-solid fa-mitten',
    stats: ['agility', 'might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['tempered', 'opener'],
    armor: true,
  },
  {
    id: 'chain-coif',
    kind: 'item',
    name: 'Chain Coif',
    icon: 'fa-solid fa-helmet-safety',
    stats: ['might', 'perception'],
    derived: ['maxHitPoints', 'hitChance'],
    verbose: ['tempered', 'ward'],
    armor: true,
  },
  {
    id: 'oaken-shield',
    kind: 'item',
    name: 'Oaken Shield',
    icon: 'fa-solid fa-shield',
    stats: ['might'],
    derived: ['maxHitPoints', 'dodgeChance'],
    // The big slow one: most armor in the game, and the verbose options all
    // make it last longer rather than hit harder.
    verbose: ['tempered', 'repair', 'desperate'],
    armor: true,
  },
  {
    id: 'plated-greaves',
    kind: 'item',
    name: 'Plated Greaves',
    icon: 'fa-solid fa-socks',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'actionsPerRound'],
    verbose: ['tempered', 'ward'],
    armor: true,
  },
  {
    id: 'tinkers-harness',
    kind: 'item',
    name: "Tinker's Harness",
    icon: 'fa-solid fa-toolbox',
    // The one piece of armour Intellect wants: what it rolls is often the
    // repair, and the repair reads the whole kit rather than itself.
    stats: ['intellect', 'might'],
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['repair', 'tempered'],
    armor: true,
  },
  {
    id: 'bonemail',
    kind: 'item',
    name: 'Bonemail',
    icon: 'fa-solid fa-bone',
    stats: ['might', 'luck'],
    derived: ['maxHitPoints', 'critChance'],
    verbose: ['tempered', 'desperate'],
    armor: true,
  },

  // --- Everything else ------------------------------------------------------
  {
    id: 'spyglass',
    kind: 'item',
    name: 'Spyglass',
    icon: 'fa-solid fa-binoculars',
    stats: ['perception', 'luck'],
    derived: ['hitChance', 'encounterChoices', 'critChance'],
    verbose: ['opener', 'studied'],
  },
  {
    id: 'whetstone',
    kind: 'item',
    name: 'Whetstone',
    icon: 'fa-solid fa-hammer',
    stats: ['might'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'cracked-hourglass',
    kind: 'item',
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
    kind: 'item',
    name: "Duelist's Cape",
    icon: 'fa-solid fa-user-ninja',
    stats: ['agility', 'charisma'],
    derived: ['dodgeChance', 'critChance'],
    verbose: ['finisher', 'desperate'],
  },
  {
    id: 'featherweight-boots',
    kind: 'item',
    name: 'Featherweight Boots',
    icon: 'fa-solid fa-shoe-prints',
    stats: ['agility'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['opener'],
  },
  {
    id: 'lucky-copper-coin',
    kind: 'item',
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
    kind: 'item',
    name: "Duelist's Chalk",
    icon: 'fa-solid fa-crosshairs',
    stats: ['perception', 'agility'],
    derived: ['hitChance', 'critChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'thock-keycap',
    kind: 'item',
    name: 'Thock Keycap',
    icon: 'fa-solid fa-keyboard',
    // It is a keycap. It is not from around here.
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'bronze-talisman',
    kind: 'item',
    name: 'Bronze Talisman',
    icon: 'fa-solid fa-circle-notch',
    stats: ['charisma', 'luck'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['ward', 'desperate'],
  },
  {
    id: 'nail-clipper',
    kind: 'item',
    name: 'Nail Clipper',
    icon: 'fa-solid fa-scissors',
    stats: ['agility', 'perception'],
    derived: ['critChance', 'hitChance'],
    verbose: ['finisher'],
  },
  {
    id: 'hunters-quiver',
    kind: 'item',
    name: "Hunter's Quiver",
    icon: 'fa-solid fa-feather-pointed',
    stats: ['perception', 'might'],
    derived: ['damageMultiplier', 'hitChance'],
    verbose: ['opener'],
  },
  {
    id: 'salted-rations',
    kind: 'item',
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
    kind: 'item',
    name: "Raven's Feather",
    icon: 'fa-solid fa-feather',
    stats: ['perception', 'charisma'],
    derived: ['encounterChoices', 'offerChoices'],
    verbose: ['studied'],
  },
  {
    id: 'glass-phial',
    kind: 'item',
    name: 'Glass Phial',
    icon: 'fa-solid fa-flask',
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'finisher'],
  },
  {
    id: 'iron-knuckles',
    kind: 'item',
    name: 'Iron Knuckles',
    icon: 'fa-solid fa-hand-fist',
    stats: ['might', 'agility'],
    derived: ['damageMultiplier', 'hitChance'],
    verbose: ['opener', 'finisher'],
  },
  {
    id: 'gamblers-dice',
    kind: 'item',
    name: "Gambler's Dice",
    icon: 'fa-solid fa-dice',
    stats: ['luck'],
    derived: ['critChance', 'offerChoices', 'damageMultiplier'],
    verbose: ['collector'],
  },
  {
    id: 'widows-locket',
    kind: 'item',
    name: "Widow's Locket",
    icon: 'fa-solid fa-heart-crack',
    stats: ['charisma', 'luck'],
    derived: ['maxHitPoints', 'dodgeChance'],
    verbose: ['desperate', 'ward'],
  },
  {
    id: 'cinder-flask',
    kind: 'item',
    name: 'Cinder Flask',
    icon: 'fa-solid fa-fire',
    stats: ['intellect', 'might'],
    derived: ['damageMultiplier'],
    verbose: ['opener', 'desperate'],
  },
  {
    id: 'silk-wraps',
    kind: 'item',
    name: 'Silk Wraps',
    icon: 'fa-solid fa-ribbon',
    stats: ['agility', 'charisma'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['finisher', 'ward'],
  },
  {
    id: 'surveyors-rod',
    kind: 'item',
    name: "Surveyor's Rod",
    icon: 'fa-solid fa-ruler-combined',
    stats: ['perception', 'intellect'],
    derived: ['encounterChoices', 'hitChance'],
    verbose: ['studied'],
  },
  {
    id: 'warhorn',
    kind: 'item',
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
    kind: 'item',
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

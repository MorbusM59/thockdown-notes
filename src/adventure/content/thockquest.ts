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

import type { Content, Region } from './index'
import { BUILDS } from './builds'
import { SPECIES } from './species'
import { COMBAT_CLASSES } from './classes'
import type { ModifierTemplate } from '../model/modifierSlots'

const REGION_RING: readonly { id: string; name: string; icon: string }[] = [
  { id: 'caves', name: 'A sprawling cave system', icon: 'fa-solid fa-mountain-sun' },
  { id: 'foothills', name: 'The foothills of a snowy range', icon: 'fa-solid fa-snowflake' },
  { id: 'ruins', name: 'A city gone to ruin', icon: 'fa-solid fa-archway' },
  { id: 'fen', name: 'A fever-ridden fen', icon: 'fa-solid fa-frog' },
  { id: 'wastes', name: 'The ember wastes', icon: 'fa-solid fa-volcano' },
  { id: 'island', name: 'A remote island', icon: 'fa-solid fa-umbrella-beach' },
]

/**
 * ONE GROUP PER BORDER, in the ring's own order: group `i` lies between
 * region `i` and region `i + 1`, and the last closes the circle back to the
 * first. Five traits each, thirty in all, none repeated.
 */
const BORDER_TRAITS: readonly { name: string; traits: readonly string[] }[] = [
  {
    // caves | foothills. What it takes to keep going where the ground is hard
    // and the air is thin.
    name: 'Stone and cold',
    traits: ['iron-constitution', 'thick-skinned', 'deep-breather', 'cold-blooded', 'stubborn-streak'],
  },
  {
    // foothills | ruins. The road between them is watchful work: sleeping
    // light, reading ground, keeping your hands steady.
    name: 'The long march',
    traits: ['patient-hunter', 'wary-traveller', 'light-sleeper', 'quick-study', 'steady-hands'],
  },
  {
    // ruins | fen. Two places people pick over, and the habits of everyone
    // who lives off what is left.
    name: 'Scavengers',
    traits: ['avid-collector', 'hoarder', 'opportunist', 'grudge-bearer', 'scar-tissue'],
  },
  {
    // fen | wastes. Where nothing is fair, what keeps you alive is the part
    // of you that stops being careful.
    name: 'Desperation',
    traits: ['cornered-animal', 'battle-trance', 'short-fuse', 'pit-fighter', 'bloodhound'],
  },
  {
    // wastes | island. The far edges of the map: chancers, castaways, and
    // whatever you can talk your way out of.
    name: 'Fortune',
    traits: ['lucky-streak', 'disarming-smile', 'sense-of-style', 'silver-tongue', 'duelists-read'],
  },
  {
    // island | caves. Smugglers' coves and sunless tunnels want the same
    // things: senses that work without light, and instinct.
    name: 'In the dark',
    traits: ['cave-sense', 'night-owl', 'feral-grace', 'pack-instinct', 'second-skin'],
  },
]

const REGIONS: readonly Region[] = REGION_RING.map((region, index) => {
  // The two borders this region lies on: the one behind it and the one ahead.
  // `+ length` before the modulo so the first region reaches round to the last
  // border rather than to index -1.
  const behind = BORDER_TRAITS[(index - 1 + BORDER_TRAITS.length) % BORDER_TRAITS.length]
  const ahead = BORDER_TRAITS[index]
  return {
    ...region,
    borders: [behind.name, ahead.name],
    traits: [...behind.traits, ...ahead.traits],
  }
})

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
    verbose: ['opener', 'finisher', 'hale'],
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
    verbose: ['finisher', 'opener', 'hale'],
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
    verbose: ['opener', 'studied', 'hale'],
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
    verbose: ['repair', 'desperate'],
    armor: true,
  },
  {
    id: 'iron-buckler',
    kind: 'item',
    name: 'Iron Buckler',
    icon: 'fa-solid fa-shield-halved',
    stats: ['might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['ward', 'finisher', 'hale'],
    armor: true,
  },
  {
    id: 'scaled-bracers',
    kind: 'item',
    name: 'Scaled Bracers',
    icon: 'fa-solid fa-mitten',
    stats: ['agility', 'might'],
    derived: ['dodgeChance', 'damageMultiplier'],
    verbose: ['opener', 'hale'],
    armor: true,
  },
  {
    id: 'chain-coif',
    kind: 'item',
    name: 'Chain Coif',
    icon: 'fa-solid fa-helmet-safety',
    stats: ['might', 'perception'],
    derived: ['maxHitPoints', 'hitChance'],
    verbose: ['ward', 'hale'],
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
    verbose: ['repair', 'desperate'],
    armor: true,
  },
  {
    id: 'plated-greaves',
    kind: 'item',
    name: 'Plated Greaves',
    icon: 'fa-solid fa-socks',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'actionsPerRound'],
    verbose: ['ward', 'hale'],
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
    verbose: ['repair'],
    armor: true,
  },
  {
    id: 'bonemail',
    kind: 'item',
    name: 'Bonemail',
    icon: 'fa-solid fa-bone',
    stats: ['might', 'luck'],
    derived: ['maxHitPoints', 'critChance'],
    verbose: ['desperate'],
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
    verbose: ['finisher', 'ward', 'hale'],
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

export const THOCKQUEST: Content = {
  builds: BUILDS,
  items: ITEMS,
  traits: TRAITS,
  regions: REGIONS,
  species: SPECIES,
  combatClasses: COMBAT_CLASSES,
}

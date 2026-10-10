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

// `favours` is a director's call against the design's open question 9
// (which monsters a region brings into scope), taken to make the region a
// choice of what to face. Every monster species is favoured by exactly one
// region, so no region is the only way to meet something often, and no
// region favours a whole encounter pool, since weighting every species in a
// pool equally leaves its draw exactly uniform.
//
// `hazard` is what every monster met there carries on top of its species
// (model/monsters.ts): the region's own challenge, and the dial that keeps
// the six equally hard (docs/adventure-game-design.md, "Regions steer a
// build"). Each one is a trade -- stronger at one thing, weaker at another
// -- so a region is a different fight rather than simply a harder one. The
// sizes are tuned with `npm run adventure:balance -- --by-region`.
const REGION_RING: readonly Omit<Region, 'borders' | 'traits' | 'items'>[] = [
  {
    id: 'caves', name: 'A sprawling cave system', icon: 'fa-solid fa-mountain-sun',
    favours: ['spider', 'kobold', 'troll', 'slime'],
    hazard: { name: 'Ambush', effects: [
      { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 0.6, position: 'first' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.05 },
    ] },
  },
  {
    id: 'foothills', name: 'The foothills of a snowy range', icon: 'fa-solid fa-snowflake',
    favours: ['wolf', 'bear', 'ogre', 'gargoyle', 'wraith'],
    hazard: { name: 'Hardy', effects: [
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.25 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.15 },
    ] },
  },
  {
    id: 'ruins', name: 'A city gone to ruin', icon: 'fa-solid fa-archway',
    favours: ['ghoul', 'lich', 'golem', 'goblin'],
    hazard: { name: 'Vigilant', effects: [
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.1 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
    ] },
  },
  {
    id: 'fen', name: 'A fever-ridden fen', icon: 'fa-solid fa-frog',
    favours: ['serpent', 'swarm', 'wisp', 'basilisk'],
    hazard: { name: 'Fever', effects: [
      { kind: 'tactic', tactic: 'poison', percent: 0.06 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.05 },
    ] },
  },
  {
    id: 'wastes', name: 'The ember wastes', icon: 'fa-solid fa-volcano',
    favours: ['drake', 'imp', 'manticore', 'orc'],
    hazard: { name: 'Searing', effects: [
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 0.05 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.4 },
    ] },
  },
  {
    id: 'island', name: 'A remote island', icon: 'fa-solid fa-umbrella-beach',
    favours: ['harpy', 'boar', 'shade', 'minotaur'],
    hazard: { name: 'Elusive', effects: [
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.1 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
    ] },
  },
]

/**
 * ONE GROUP PER BORDER, in the ring's own order: group `i` lies between
 * region `i` and region `i + 1`, and the last closes the circle back to the
 * first. Five traits and five items each, none repeated.
 *
 * A BORDER IS A MECHANIC, not a mood: each carries one fight-shape tactic and
 * one or two of the conditional or scaling rules, and every template in it is
 * authored to that signature (the table in docs/adventure-game-design.md,
 * "Regions steer a build"). A region is the two borders it lies between, so
 * it offers two engines that sit well together, and the region opposite it
 * shares neither.
 */
const BORDERS: readonly { name: string; traits: readonly string[]; items: readonly string[] }[] = [
  {
    // What it takes to keep going where the ground is hard: armour, and the patience to let attackers break on it. THORNS, and armour that lasts (repair, ward).
    name: 'Stone and cold',
    traits: ['iron-constitution', 'thick-skinned', 'deep-breather', 'cold-blooded', 'stubborn-streak'],
    items: ['boiled-leather-jerkin', 'oaken-shield', 'plated-greaves', 'bonemail', 'tinkers-harness'],
  },
  {
    // Watchful work: reading the ground, and making the round's last blow count. MARK, the finisher, and a narrow, studied kit.
    name: 'The long march',
    traits: ['patient-hunter', 'wary-traveller', 'light-sleeper', 'quick-study', 'steady-hands'],
    items: ['spyglass', 'surveyors-rod', 'brass-compass', 'chain-coif', 'hunters-quiver'],
  },
  {
    // The habits of everyone who lives off what is left: carry everything, and let small wounds do the work. POISON, and kits that grow with what is carried.
    name: 'Scavengers',
    traits: ['avid-collector', 'hoarder', 'opportunist', 'grudge-bearer', 'scar-tissue'],
    items: ['glass-phial', 'thock-keycap', 'cinder-flask', 'ravens-feather', 'salted-rations'],
  },
  {
    // Where nothing is fair, what keeps you alive is the part of you that stops being careful. COMBO, and fighting harder the worse it goes.
    name: 'Desperation',
    traits: ['cornered-animal', 'battle-trance', 'short-fuse', 'pit-fighter', 'bloodhound'],
    items: ['iron-knuckles', 'whetstone', 'cracked-hourglass', 'warhorn', 'scaled-bracers'],
  },
  {
    // Chancers and castaways: a lucky first blow, then the finish, and staying whole while it lasts. SETUP, and luck that holds while you are healthy.
    name: 'Fortune',
    traits: ['lucky-streak', 'disarming-smile', 'sense-of-style', 'silver-tongue', 'duelists-read'],
    items: ['lucky-copper-coin', 'gamblers-dice', 'bronze-talisman', 'widows-locket', 'nail-clipper'],
  },
  {
    // Smugglers' coves and sunless tunnels: strike first, be elsewhere when they answer, and answer back. COUNTER, and the round's opening blow.
    name: 'In the dark',
    traits: ['cave-sense', 'night-owl', 'feral-grace', 'pack-instinct', 'second-skin'],
    items: ['duelists-cape', 'featherweight-boots', 'silk-wraps', 'iron-buckler', 'duelists-chalk'],
  },
]

const REGIONS: readonly Region[] = REGION_RING.map((region, index) => {
  // The two borders this region lies on: the one behind it and the one ahead.
  // `+ length` before the modulo so the first region reaches round to the last
  // border rather than to index -1.
  const behind = BORDERS[(index - 1 + BORDERS.length) % BORDERS.length]
  const ahead = BORDERS[index]
  return {
    ...region,
    borders: [behind.name, ahead.name],
    traits: [...behind.traits, ...ahead.traits],
    items: [...behind.items, ...ahead.items],
  }
})

/**
 * THE TRAIT TEMPLATES. Thirty of them, grouped by the border they belong to,
 * and not one of them says what it does: the run rolls that
 * (model/modifierSlots.ts). What is authored is which of its border's
 * mechanics it may roll.
 *
 * WHAT MAKES A TRAIT DIFFERENT FROM AN ITEM is two lines of the slot plan and
 * nothing else (`SLOT_PLAN`). An item is GEAR: it has two stat slots, because
 * the base stat cap is the thing gear exists to carry a character past. A
 * trait is something you ARE and cannot be picked up, so it has none, and
 * spends those slots on a second VERBOSE effect -- which is why every trait
 * names both of its border's rules where it can.
 *
 * Its armor slot is NATURAL armor, flat and unwearable, at a third of what an
 * item's decaying pool rolls. Every Stone and cold trait is armour, because
 * Thorns throws back a share of the armour that stopped a blow.
 */
const TRAITS: readonly ModifierTemplate[] = [
  // --- Stone and cold ---
  {
    id: 'iron-constitution',
    kind: 'trait',
    name: 'Iron Constitution',
    icon: 'fa-solid fa-heart-pulse',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['thorns', 'repair'],
    armor: true,
  },
  {
    id: 'thick-skinned',
    kind: 'trait',
    name: 'Thick Skinned',
    icon: 'fa-solid fa-shield-heart',
    derived: ['maxHitPoints'],
    verbose: ['thorns', 'repair'],
    armor: true,
  },
  {
    id: 'deep-breather',
    kind: 'trait',
    name: 'Deep Breather',
    icon: 'fa-solid fa-lungs',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['repair', 'thorns'],
    armor: true,
  },
  {
    id: 'cold-blooded',
    kind: 'trait',
    name: 'Cold Blooded',
    icon: 'fa-solid fa-snowflake',
    derived: ['damageMultiplier', 'maxHitPoints'],
    verbose: ['thorns', 'repair'],
    armor: true,
  },
  {
    id: 'stubborn-streak',
    kind: 'trait',
    name: 'Stubborn Streak',
    icon: 'fa-solid fa-anchor',
    derived: ['maxHitPoints'],
    verbose: ['repair', 'thorns'],
    armor: true,
  },
  // --- The long march ---
  {
    id: 'patient-hunter',
    kind: 'trait',
    name: 'Patient Hunter',
    icon: 'fa-solid fa-crosshairs',
    derived: ['hitChance', 'critChance'],
    verbose: ['mark', 'finisher', 'studied'],
  },
  {
    id: 'wary-traveller',
    kind: 'trait',
    name: 'Wary Traveller',
    icon: 'fa-solid fa-person-walking',
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['mark', 'studied'],
  },
  {
    id: 'light-sleeper',
    kind: 'trait',
    name: 'Light Sleeper',
    icon: 'fa-solid fa-eye',
    derived: ['critChance', 'encounterChoices'],
    verbose: ['finisher', 'mark'],
  },
  {
    id: 'quick-study',
    kind: 'trait',
    name: 'Quick Study',
    icon: 'fa-solid fa-brain',
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['studied', 'finisher'],
  },
  {
    id: 'steady-hands',
    kind: 'trait',
    name: 'Steady Hands',
    icon: 'fa-solid fa-hand-sparkles',
    derived: ['hitChance', 'critChance'],
    verbose: ['finisher', 'mark'],
  },
  // --- Scavengers ---
  {
    id: 'avid-collector',
    kind: 'trait',
    name: 'Avid Collector',
    icon: 'fa-solid fa-box-archive',
    derived: ['damageMultiplier', 'offerChoices'],
    verbose: ['collector', 'poison'],
  },
  {
    id: 'hoarder',
    kind: 'trait',
    name: 'Hoarder',
    icon: 'fa-solid fa-sack-xmark',
    derived: ['maxHitPoints', 'offerChoices'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'opportunist',
    kind: 'trait',
    name: 'Opportunist',
    icon: 'fa-solid fa-star',
    derived: ['damageMultiplier', 'offerChoices'],
    verbose: ['poison', 'collector'],
  },
  {
    id: 'grudge-bearer',
    kind: 'trait',
    name: 'Grudge Bearer',
    icon: 'fa-solid fa-hand-back-fist',
    derived: ['damageMultiplier', 'maxHitPoints'],
    verbose: ['poison', 'studied'],
  },
  {
    id: 'scar-tissue',
    kind: 'trait',
    name: 'Scar Tissue',
    icon: 'fa-solid fa-bandage',
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['collector', 'poison'],
  },
  // --- Desperation ---
  {
    id: 'cornered-animal',
    kind: 'trait',
    name: 'Cornered Animal',
    icon: 'fa-solid fa-paw',
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'combo'],
  },
  {
    id: 'battle-trance',
    kind: 'trait',
    name: 'Battle Trance',
    icon: 'fa-solid fa-fire-flame-curved',
    derived: ['actionsPerRound', 'damageMultiplier'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'short-fuse',
    kind: 'trait',
    name: 'Short Fuse',
    icon: 'fa-solid fa-fire',
    derived: ['damageMultiplier', 'actionsPerRound'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'pit-fighter',
    kind: 'trait',
    name: 'Pit Fighter',
    icon: 'fa-solid fa-khanda',
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'bloodhound',
    kind: 'trait',
    name: 'Bloodhound',
    icon: 'fa-solid fa-dog',
    derived: ['actionsPerRound', 'critChance'],
    verbose: ['desperate', 'combo'],
  },
  // --- Fortune ---
  {
    id: 'lucky-streak',
    kind: 'trait',
    name: 'Lucky Streak',
    icon: 'fa-solid fa-dice-d20',
    derived: ['critChance', 'offerChoices'],
    verbose: ['setup', 'hale'],
  },
  {
    id: 'disarming-smile',
    kind: 'trait',
    name: 'Disarming Smile',
    icon: 'fa-solid fa-face-smile',
    derived: ['critChance', 'offerChoices'],
    verbose: ['hale', 'setup'],
  },
  {
    id: 'sense-of-style',
    kind: 'trait',
    name: 'Sense of Style',
    icon: 'fa-solid fa-hat-cowboy',
    derived: ['offerChoices', 'critChance'],
    verbose: ['setup', 'hale'],
  },
  {
    id: 'silver-tongue',
    kind: 'trait',
    name: 'Silver Tongue',
    icon: 'fa-solid fa-comment-dots',
    derived: ['offerChoices', 'hitChance'],
    verbose: ['hale', 'setup'],
  },
  {
    id: 'duelists-read',
    kind: 'trait',
    name: "Duelist's Read",
    icon: 'fa-solid fa-wind',
    derived: ['critChance', 'hitChance'],
    verbose: ['setup', 'hale'],
  },
  // --- In the dark ---
  {
    id: 'cave-sense',
    kind: 'trait',
    name: 'Cave Sense',
    icon: 'fa-solid fa-mountain-sun',
    derived: ['dodgeChance', 'encounterChoices'],
    verbose: ['opener', 'counter'],
  },
  {
    id: 'night-owl',
    kind: 'trait',
    name: 'Night Owl',
    icon: 'fa-solid fa-moon',
    derived: ['dodgeChance', 'critChance'],
    verbose: ['counter', 'opener'],
  },
  {
    id: 'feral-grace',
    kind: 'trait',
    name: 'Feral Grace',
    icon: 'fa-solid fa-cat',
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['counter', 'opener'],
  },
  {
    id: 'pack-instinct',
    kind: 'trait',
    name: 'Pack Instinct',
    icon: 'fa-solid fa-users',
    derived: ['actionsPerRound', 'dodgeChance'],
    verbose: ['opener', 'counter'],
  },
  {
    id: 'second-skin',
    kind: 'trait',
    name: 'Second Skin',
    icon: 'fa-solid fa-fingerprint',
    derived: ['dodgeChance'],
    verbose: ['counter', 'opener'],
    armor: true,
  },
]

/**
 * THE ITEM TEMPLATES. Thirty of them, grouped by border like the traits.
 *
 * ARMOUR IS A PROPERTY OF THE FICTION, not a roll: the armour pieces always
 * fill that slot, and it is taken first (model/modifierSlots.ts). HOW MUCH is
 * not written here -- one range per slot, declared beside every other slot's.
 * An item's `ward` is natural armor beside its decaying pool; a trait cannot
 * name it, its own armor slot already being that.
 */
const ITEMS: readonly ModifierTemplate[] = [
  // --- Stone and cold ---
  {
    id: 'boiled-leather-jerkin',
    kind: 'item',
    name: 'Boiled Leather Jerkin',
    icon: 'fa-solid fa-shirt',
    stats: ['might', 'agility'],
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['thorns', 'repair'],
    armor: true,
  },
  {
    id: 'oaken-shield',
    kind: 'item',
    name: 'Oaken Shield',
    icon: 'fa-solid fa-shield',
    stats: ['might'],
    derived: ['maxHitPoints'],
    verbose: ['thorns', 'ward'],
    armor: true,
  },
  {
    id: 'plated-greaves',
    kind: 'item',
    name: 'Plated Greaves',
    icon: 'fa-solid fa-socks',
    stats: ['might', 'intellect'],
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['ward', 'repair'],
    armor: true,
  },
  {
    id: 'bonemail',
    kind: 'item',
    name: 'Bonemail',
    icon: 'fa-solid fa-bone',
    stats: ['might', 'luck'],
    derived: ['maxHitPoints', 'damageMultiplier'],
    verbose: ['thorns'],
    armor: true,
  },
  {
    id: 'tinkers-harness',
    kind: 'item',
    name: "Tinker's Harness",
    icon: 'fa-solid fa-toolbox',
    stats: ['intellect', 'might'],
    derived: ['maxHitPoints'],
    verbose: ['repair', 'thorns'],
    armor: true,
  },
  // --- The long march ---
  {
    id: 'spyglass',
    kind: 'item',
    name: 'Spyglass',
    icon: 'fa-solid fa-binoculars',
    stats: ['perception', 'luck'],
    derived: ['hitChance', 'encounterChoices'],
    verbose: ['mark', 'studied'],
  },
  {
    id: 'surveyors-rod',
    kind: 'item',
    name: "Surveyor's Rod",
    icon: 'fa-solid fa-ruler-combined',
    stats: ['perception', 'intellect'],
    derived: ['encounterChoices', 'hitChance'],
    verbose: ['studied', 'finisher'],
  },
  {
    id: 'brass-compass',
    kind: 'item',
    name: 'Brass Compass',
    icon: 'fa-solid fa-compass',
    stats: ['perception', 'intellect'],
    derived: ['hitChance', 'critChance'],
    verbose: ['finisher', 'mark'],
  },
  {
    id: 'chain-coif',
    kind: 'item',
    name: 'Chain Coif',
    icon: 'fa-solid fa-helmet-safety',
    stats: ['might', 'perception'],
    derived: ['hitChance', 'maxHitPoints'],
    verbose: ['mark', 'finisher'],
    armor: true,
  },
  {
    id: 'hunters-quiver',
    kind: 'item',
    name: "Hunter's Quiver",
    icon: 'fa-solid fa-feather-pointed',
    stats: ['perception', 'might'],
    derived: ['critChance', 'hitChance'],
    verbose: ['mark', 'finisher'],
  },
  // --- Scavengers ---
  {
    id: 'glass-phial',
    kind: 'item',
    name: 'Glass Phial',
    icon: 'fa-solid fa-flask',
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'offerChoices'],
    verbose: ['poison', 'collector'],
  },
  {
    id: 'thock-keycap',
    kind: 'item',
    name: 'Thock Keycap',
    icon: 'fa-solid fa-keyboard',
    stats: ['intellect', 'luck'],
    derived: ['damageMultiplier', 'offerChoices'],
    verbose: ['collector', 'studied'],
  },
  {
    id: 'cinder-flask',
    kind: 'item',
    name: 'Cinder Flask',
    icon: 'fa-solid fa-fire',
    stats: ['intellect', 'might'],
    derived: ['damageMultiplier'],
    verbose: ['poison', 'collector'],
  },
  {
    id: 'ravens-feather',
    kind: 'item',
    name: "Raven's Feather",
    icon: 'fa-solid fa-feather',
    stats: ['luck', 'intellect'],
    derived: ['offerChoices', 'maxHitPoints'],
    verbose: ['collector', 'poison'],
  },
  {
    id: 'salted-rations',
    kind: 'item',
    name: 'Salted Rations',
    icon: 'fa-solid fa-drumstick-bite',
    stats: ['might', 'intellect'],
    derived: ['maxHitPoints', 'offerChoices'],
    verbose: ['collector', 'studied'],
  },
  // --- Desperation ---
  {
    id: 'iron-knuckles',
    kind: 'item',
    name: 'Iron Knuckles',
    icon: 'fa-solid fa-hand-fist',
    stats: ['might', 'agility'],
    derived: ['damageMultiplier', 'actionsPerRound'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'whetstone',
    kind: 'item',
    name: 'Whetstone',
    icon: 'fa-solid fa-hammer',
    stats: ['might'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'combo'],
  },
  {
    id: 'cracked-hourglass',
    kind: 'item',
    name: 'Cracked Hourglass',
    icon: 'fa-solid fa-hourglass-half',
    stats: ['agility', 'might'],
    derived: ['actionsPerRound', 'damageMultiplier'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'warhorn',
    kind: 'item',
    name: 'Warhorn',
    icon: 'fa-solid fa-bullhorn',
    stats: ['might', 'charisma'],
    derived: ['damageMultiplier', 'actionsPerRound'],
    verbose: ['combo', 'desperate'],
  },
  {
    id: 'scaled-bracers',
    kind: 'item',
    name: 'Scaled Bracers',
    icon: 'fa-solid fa-mitten',
    stats: ['agility', 'might'],
    derived: ['damageMultiplier', 'critChance'],
    verbose: ['desperate', 'combo'],
    armor: true,
  },
  // --- Fortune ---
  {
    id: 'lucky-copper-coin',
    kind: 'item',
    name: 'Lucky Copper Coin',
    icon: 'fa-solid fa-clover',
    stats: ['luck'],
    derived: ['critChance', 'offerChoices'],
    verbose: ['setup', 'hale'],
  },
  {
    id: 'gamblers-dice',
    kind: 'item',
    name: "Gambler's Dice",
    icon: 'fa-solid fa-dice',
    stats: ['luck', 'charisma'],
    derived: ['critChance', 'offerChoices'],
    verbose: ['setup', 'hale'],
  },
  {
    id: 'bronze-talisman',
    kind: 'item',
    name: 'Bronze Talisman',
    icon: 'fa-solid fa-circle-notch',
    stats: ['charisma', 'luck'],
    derived: ['critChance', 'hitChance'],
    verbose: ['hale', 'setup'],
  },
  {
    id: 'widows-locket',
    kind: 'item',
    name: "Widow's Locket",
    icon: 'fa-solid fa-heart-crack',
    stats: ['charisma', 'luck'],
    derived: ['hitChance', 'offerChoices'],
    verbose: ['hale', 'setup'],
  },
  {
    id: 'nail-clipper',
    kind: 'item',
    name: 'Nail Clipper',
    icon: 'fa-solid fa-scissors',
    stats: ['luck', 'perception'],
    derived: ['critChance', 'hitChance'],
    verbose: ['setup', 'hale'],
  },
  // --- In the dark ---
  {
    id: 'duelists-cape',
    kind: 'item',
    name: "Duelist's Cape",
    icon: 'fa-solid fa-user-ninja',
    stats: ['agility', 'charisma'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['counter', 'opener'],
  },
  {
    id: 'featherweight-boots',
    kind: 'item',
    name: 'Featherweight Boots',
    icon: 'fa-solid fa-shoe-prints',
    stats: ['agility'],
    derived: ['dodgeChance', 'actionsPerRound'],
    verbose: ['opener', 'counter'],
  },
  {
    id: 'silk-wraps',
    kind: 'item',
    name: 'Silk Wraps',
    icon: 'fa-solid fa-ribbon',
    stats: ['agility', 'perception'],
    derived: ['dodgeChance', 'hitChance'],
    verbose: ['counter', 'opener'],
  },
  {
    id: 'iron-buckler',
    kind: 'item',
    name: 'Iron Buckler',
    icon: 'fa-solid fa-shield-halved',
    stats: ['might', 'agility'],
    derived: ['dodgeChance'],
    verbose: ['counter', 'opener'],
    armor: true,
  },
  {
    id: 'duelists-chalk',
    kind: 'item',
    name: "Duelist's Chalk",
    icon: 'fa-solid fa-crosshairs',
    stats: ['perception', 'agility'],
    derived: ['dodgeChance', 'hitChance'],
    verbose: ['opener', 'counter'],
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

// VECTOR THREE: the species. A noun, and everything about a creature that is
// not a stat and not a choice.
//
// Effects are the MODIFIER vocabulary (model/modifiers.ts) and a species may
// not carry `statDelta` -- stats belong to the build and the tier, and a
// species that could hand out Might would be a second, hidden build.
// `validateContent` fails on one that tries.
//
// Reading rules:
//
//   * Percentages are FRACTIONS. `percent: 1` is +100%.
//   * A QUANTITY takes them additively; a CHANCE takes a share of what is
//     left, so `+0.2` accuracy removes a fifth of the misses and can never
//     overshoot. Neither needs a clamp.
//   * Every species should be answerable. A thing that is only stronger is a
//     tier; a species is a thing that is stronger at SOMETHING, and the
//     interesting ones pay for it.
//   * The noun is the MIDDLE word of a monster's name, so it has to read
//     between an adjective and a class: "Dashing Orc Bruiser".
//
// PLAYABLE species are the peoples; the rest are what you fight. That is
// the only split, and it is a flag rather than two lists because a rule
// about which pool a thing is drawn from belongs to the screen doing the
// drawing, not to the thing.

import type { Species } from '../model/vectors'

export const SPECIES: readonly Species[] = [
  // --- The peoples, which character creation deals six of ------------------
  {
    id: 'masurian',
    name: 'Masurian',
    icon: 'fa-solid fa-chess-rook',
    playable: true,
    effects: [
      // Builders and besiegers: they carry their walls with them.
      { kind: 'naturalArmor', amount: 2 },
      { kind: 'armorRepairAfterCombat', amount: 2 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.15 },
    ],
  },
  {
    id: 'davalian',
    name: 'Davalian',
    icon: 'fa-solid fa-dove',
    playable: true,
    effects: [
      // Duellists. Everything happens in the first exchange or not at all.
      { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 0.75, position: 'first' },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.2 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.1 },
    ],
  },
  {
    id: 'mertok',
    name: 'Mertok',
    icon: 'fa-solid fa-hand-fist',
    playable: true,
    effects: [
      // They do not wear armour; they are armour, and they are worse for it
      // the longer a fight runs.
      { kind: 'noDecayingArmor' },
      { kind: 'naturalArmor', amount: 3 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.25 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.2 },
    ],
  },
  {
    id: 'ysmari',
    name: 'Ysmari',
    icon: 'fa-solid fa-moon',
    playable: true,
    effects: [
      // Scholars of the long game: everything they own makes them sharper.
      { kind: 'derivedPercentPerHolding', derived: 'critChance', percentPer: 0.06, holding: 'item' },
      { kind: 'derivedPercentPerHolding', derived: 'hitChance', percentPer: 0.04, holding: 'trait' },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.1 },
    ],
  },
  {
    id: 'korrun',
    name: 'Korrun',
    icon: 'fa-solid fa-fire',
    playable: true,
    effects: [
      // Cornered is where they want to be, and they never quite manage to be
      // safe -- the hit points are low so the condition actually fires.
      { kind: 'derivedPercentWhileHealth', derived: 'damageMultiplier', percent: 1, band: 'maimed', subject: 'self' },
      { kind: 'derivedPercentWhileHealth', derived: 'critChance', percent: 0.3, band: 'maimed', subject: 'self' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.15 },
    ],
  },
  {
    id: 'thessil',
    name: 'Thessil',
    icon: 'fa-solid fa-clover',
    playable: true,
    effects: [
      // Fortune's own, and fortune is a late-round thing: the last action of
      // a round is no rarer at high Agility, so this never dilutes.
      { kind: 'derivedPercent', derived: 'critChance', percent: 0.25 },
      { kind: 'derivedPercentOnAction', derived: 'critChance', percent: 0.4, position: 'last' },
      { kind: 'derivedPercent', derived: 'offerChoices', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.1 },
    ],
  },

  {
    id: 'brannoch',
    name: 'Brannoch',
    icon: 'fa-solid fa-hammer',
    playable: true,
    effects: [
      // Smiths. What they carry lasts, and they mend it between fights.
      { kind: 'armorRepairAfterCombat', amount: 4 },
      { kind: 'naturalArmor', amount: 1 },
      { kind: 'derivedPercent', derived: 'critChance', percent: -0.2 },
      // The first swing on something still whole is the one a smith knows how
      // to place. Falls away as the fight wears on, which is the opposite
      // curve to Korrun's and is why the two read as different peoples.
      { kind: 'derivedPercentWhileHealth', derived: 'damageMultiplier', percent: 0.6, band: 'healthy', subject: 'target' },
    ],
  },
  {
    id: 'saoric',
    name: 'Saoric',
    icon: 'fa-solid fa-wind',
    playable: true,
    effects: [
      // They act more often than anyone and each act is worth less.
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.25 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.15 },
    ],
  },
  {
    id: 'velkar',
    name: 'Velkar',
    icon: 'fa-solid fa-eye',
    playable: true,
    effects: [
      // They see what is coming and what is worth taking.
      { kind: 'derivedPercent', derived: 'encounterChoices', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'offerChoices', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.25 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
      // What they see first is an opening. Reads the TARGET, so it is worth
      // nothing on a fresh monster and everything on one that has been worked
      // down -- which is the shape that makes a fight worth finishing.
      { kind: 'derivedPercentWhileHealth', derived: 'critChance', percent: 0.5, band: 'injured', subject: 'target' },
    ],
  },

  // --- What you fight ----------------------------------------------------
  {
    id: 'goblin',
    name: 'Goblin',
    icon: 'fa-solid fa-child-reaching',
    effects: [
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.3 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.2 },
    ],
  },
  {
    id: 'orc',
    name: 'Orc',
    icon: 'fa-solid fa-hand-fist',
    effects: [
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 0.4 },
      { kind: 'naturalArmor', amount: 1 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.2 },
    ],
  },
  {
    id: 'wolf',
    name: 'Wolf',
    icon: 'fa-solid fa-paw',
    effects: [
      { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 0.6, position: 'first' },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.15 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.15 },
    ],
  },
  {
    id: 'bear',
    name: 'Bear',
    icon: 'fa-solid fa-otter',
    effects: [
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.5 },
      { kind: 'naturalArmor', amount: 2 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.25 },
    ],
  },
  {
    id: 'spider',
    name: 'Spider',
    icon: 'fa-solid fa-spider',
    effects: [
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.3 },
      { kind: 'derivedPercent', derived: 'critChance', percent: 0.2 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.25 },
    ],
  },
  {
    id: 'troll',
    name: 'Troll',
    icon: 'fa-solid fa-hill-rockslide',
    effects: [
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.8 },
      { kind: 'armorRepairAfterCombat', amount: 3 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: -0.25 },
    ],
  },
  {
    id: 'wraith',
    name: 'Wraith',
    icon: 'fa-solid fa-ghost',
    effects: [
      // Nothing to armour and nothing to hit.
      { kind: 'noDecayingArmor' },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.45 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.35 },
    ],
  },
  {
    id: 'kobold',
    name: 'Kobold',
    icon: 'fa-solid fa-user-ninja',
    effects: [
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 0.25 },
      { kind: 'derivedPercent', derived: 'critChance', percent: 0.3 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.3 },
    ],
  },
  {
    id: 'harpy',
    name: 'Harpy',
    icon: 'fa-solid fa-crow',
    effects: [
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.3 },
      { kind: 'derivedPercentOnAction', derived: 'critChance', percent: 0.5, position: 'first' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
    ],
  },
  {
    id: 'ogre',
    name: 'Ogre',
    icon: 'fa-solid fa-hammer',
    effects: [
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 0.9 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.2 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: -0.3 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.25 },
    ],
  },
  {
    id: 'imp',
    name: 'Imp',
    icon: 'fa-solid fa-fire-flame-simple',
    effects: [
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 0.75 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.45 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.3 },
    ],
  },
  {
    id: 'serpent',
    name: 'Serpent',
    icon: 'fa-solid fa-staff-snake',
    effects: [
      { kind: 'derivedPercent', derived: 'critChance', percent: 0.45 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.15 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.15 },
    ],
  },
  {
    id: 'golem',
    name: 'Golem',
    icon: 'fa-solid fa-cubes-stacked',
    effects: [
      { kind: 'naturalArmor', amount: 5 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.4 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.5 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.25 },
    ],
  },
  {
    id: 'ghoul',
    name: 'Ghoul',
    icon: 'fa-solid fa-skull-crossbones',
    effects: [
      { kind: 'derivedPercentWhileHealth', derived: 'damageMultiplier', percent: 0.8, band: 'injured', subject: 'self' },
      { kind: 'derivedPercentWhileHealth', derived: 'actionsPerRound', percent: 0.5, band: 'injured', subject: 'self' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.2 },
    ],
  },
  {
    id: 'boar',
    name: 'Boar',
    icon: 'fa-solid fa-hippo',
    effects: [
      { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 1.2, position: 'first' },
      { kind: 'naturalArmor', amount: 1 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: -0.2 },
    ],
  },
  {
    id: 'drake',
    name: 'Drake',
    icon: 'fa-solid fa-dragon',
    effects: [
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 0.5 },
      { kind: 'naturalArmor', amount: 3 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.3 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.2 },
    ],
  },
  {
    id: 'basilisk',
    name: 'Basilisk',
    icon: 'fa-solid fa-eye',
    effects: [
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.5 },
      { kind: 'naturalArmor', amount: 2 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.3 },
    ],
  },
  {
    id: 'gargoyle',
    name: 'Gargoyle',
    icon: 'fa-solid fa-chess-rook',
    effects: [
      { kind: 'naturalArmor', amount: 4 },
      { kind: 'armorRepairAfterCombat', amount: 2 },
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: -0.25 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.15 },
    ],
  },
  {
    id: 'slime',
    name: 'Slime',
    icon: 'fa-solid fa-droplet',
    effects: [
      // Nothing to cut, and nothing much to hit you with.
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 1 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.5 },
      { kind: 'derivedPercent', derived: 'critChance', percent: -0.5 },
    ],
  },
  {
    id: 'manticore',
    name: 'Manticore',
    icon: 'fa-solid fa-dragon',
    effects: [
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 0.5 },
      { kind: 'derivedPercent', derived: 'critChance', percent: 0.3 },
      { kind: 'naturalArmor', amount: 2 },
      { kind: 'derivedPercent', derived: 'hitChance', percent: -0.2 },
    ],
  },
  {
    id: 'wisp',
    name: 'Wisp',
    icon: 'fa-solid fa-star',
    effects: [
      // Almost impossible to touch, and almost nothing when you do.
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.6 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.6 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.2 },
    ],
  },
  {
    id: 'minotaur',
    name: 'Minotaur',
    icon: 'fa-solid fa-khanda',
    effects: [
      { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 1.5, position: 'first' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: 0.35 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.3 },
    ],
  },
  {
    id: 'shade',
    name: 'Shade',
    icon: 'fa-solid fa-user-secret',
    effects: [
      { kind: 'derivedPercentOnAction', derived: 'critChance', percent: 0.8, position: 'first' },
      { kind: 'derivedPercent', derived: 'hitChance', percent: 0.35 },
      { kind: 'noDecayingArmor' },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.3 },
    ],
  },
  {
    id: 'lich',
    name: 'Lich',
    icon: 'fa-solid fa-book-skull',
    effects: [
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 0.6 },
      { kind: 'derivedPercentWhileHealth', derived: 'actionsPerRound', percent: 1, band: 'maimed', subject: 'self' },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: -0.25 },
    ],
  },
  {
    id: 'swarm',
    name: 'Swarm',
    icon: 'fa-solid fa-bugs',
    effects: [
      // Many small things at once, which is what the action pool is for.
      { kind: 'derivedPercent', derived: 'actionsPerRound', percent: 1.25 },
      { kind: 'derivedPercent', derived: 'damageMultiplier', percent: -0.6 },
      { kind: 'derivedPercent', derived: 'maxHitPoints', percent: -0.4 },
      { kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.2 },
    ],
  },
]

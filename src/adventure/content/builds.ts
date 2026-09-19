// VECTOR ONE: the builds. An adjective and a set of stat weights.
//
// A build says what SHAPE a creature is, at any tier -- see
// model/vectors.ts. Reading rules for this list:
//
//   * Weights are RATIOS. `{ might: 3 }` and `{ might: 30 }` are the same
//     build; small integers are used so the ratio is readable at a glance.
//   * A stat left out weighs nothing. A creature can be genuinely bad at
//     something, which is where most of the character comes from.
//   * No two builds may share a normalised ratio -- two names for one shape
//     is a choice the player cannot make meaningfully. The contract test
//     checks it.
//   * The adjective is the FIRST word of a monster's name, so it has to read
//     in front of a species and a class: "Dashing Orc Bruiser".

import type { Build } from '../model/vectors'

export const BUILDS: readonly Build[] = [
  // --- Single-stat: the purest shapes, and the strongest at what they do.
  {
    id: 'hulking',
    name: 'Hulking',
    icon: 'fa-solid fa-mountain',
    weights: { might: 1 },
  },
  {
    id: 'fleeting',
    name: 'Fleeting',
    icon: 'fa-solid fa-wind',
    weights: { agility: 1 },
  },
  {
    id: 'hawkeyed',
    name: 'Hawk-Eyed',
    icon: 'fa-solid fa-binoculars',
    weights: { perception: 1 },
  },
  {
    id: 'erudite',
    name: 'Erudite',
    icon: 'fa-solid fa-book-open',
    weights: { intellect: 1 },
  },
  {
    id: 'resplendent',
    name: 'Resplendent',
    icon: 'fa-solid fa-crown',
    weights: { charisma: 1 },
  },
  {
    id: 'blessed',
    name: 'Blessed',
    icon: 'fa-solid fa-clover',
    weights: { luck: 1 },
  },

  // --- Two-stat, weighted: a lead stat and a second it leans on.
  {
    id: 'brutish',
    name: 'Brutish',
    icon: 'fa-solid fa-hammer',
    weights: { might: 3, agility: 1 },
  },
  {
    id: 'dashing',
    name: 'Dashing',
    icon: 'fa-solid fa-feather',
    weights: { agility: 2, charisma: 1 },
  },
  {
    id: 'wiry',
    name: 'Wiry',
    icon: 'fa-solid fa-person-running',
    weights: { agility: 2, might: 1 },
  },
  {
    id: 'grim',
    name: 'Grim',
    icon: 'fa-solid fa-skull',
    weights: { might: 2, perception: 1 },
  },
  {
    id: 'sly',
    name: 'Sly',
    icon: 'fa-solid fa-mask',
    weights: { agility: 2, perception: 1 },
  },
  {
    id: 'storied',
    name: 'Storied',
    icon: 'fa-solid fa-scroll',
    weights: { charisma: 2, intellect: 1 },
  },
  {
    id: 'brooding',
    name: 'Brooding',
    icon: 'fa-solid fa-cloud-bolt',
    weights: { intellect: 2, might: 1 },
  },
  {
    id: 'watchful',
    name: 'Watchful',
    icon: 'fa-solid fa-eye',
    weights: { perception: 2, intellect: 1 },
  },
  {
    id: 'ponderous',
    name: 'Ponderous',
    icon: 'fa-solid fa-weight-hanging',
    weights: { might: 4, perception: 1 },
  },

  // --- Two-stat, even: a creature that is two things equally.
  {
    id: 'feral',
    name: 'Feral',
    icon: 'fa-solid fa-paw',
    weights: { might: 1, agility: 1 },
  },
  {
    id: 'cunning',
    name: 'Cunning',
    icon: 'fa-solid fa-chess-knight',
    weights: { intellect: 1, perception: 1 },
  },
  {
    id: 'volatile',
    name: 'Volatile',
    icon: 'fa-solid fa-fire-flame-curved',
    weights: { might: 1, luck: 1 },
  },
  {
    id: 'uncanny',
    name: 'Uncanny',
    icon: 'fa-solid fa-hat-wizard',
    weights: { perception: 1, luck: 1 },
  },
  {
    id: 'beguiling',
    name: 'Beguiling',
    icon: 'fa-solid fa-masks-theater',
    weights: { charisma: 1, agility: 1 },
  },

  // --- Three and more: less of each, harder to answer.
  {
    id: 'nimblefingered',
    name: 'Nimble-Fingered',
    icon: 'fa-solid fa-hand-sparkles',
    weights: { agility: 2, perception: 1, luck: 1 },
  },
  {
    id: 'shrewd',
    name: 'Shrewd',
    icon: 'fa-solid fa-scale-balanced',
    weights: { intellect: 2, charisma: 1, luck: 1 },
  },
  {
    id: 'seasoned',
    name: 'Seasoned',
    icon: 'fa-solid fa-shield-halved',
    weights: { might: 2, perception: 2, intellect: 1 },
  },
  {
    id: 'wayward',
    name: 'Wayward',
    icon: 'fa-solid fa-compass',
    weights: { luck: 2, agility: 1, charisma: 1 },
  },
  {
    // The flat one. It is the WORST build at everything and the only one that
    // is never caught out, which at low tiers is worth more than it looks --
    // a tier of 5 spread six ways is six zeroes and a one, so this is a shape
    // that has to grow into itself.
    id: 'journeyman',
    name: 'Journeyman',
    icon: 'fa-solid fa-person-walking',
    weights: { might: 1, agility: 1, perception: 1, intellect: 1, charisma: 1, luck: 1 },
  },
  {
    id: 'indomitable',
    name: 'Indomitable',
    icon: 'fa-solid fa-shield',
    weights: { might: 3, intellect: 1 },
  },
  {
    id: 'mercurial',
    name: 'Mercurial',
    icon: 'fa-solid fa-bolt',
    weights: { agility: 3, luck: 1 },
  },
  {
    id: 'oracular',
    name: 'Oracular',
    icon: 'fa-solid fa-eye-low-vision',
    weights: { intellect: 3, perception: 1 },
  },
  {
    id: 'imperious',
    name: 'Imperious',
    icon: 'fa-solid fa-chess-king',
    weights: { charisma: 3, might: 1 },
  },
  {
    id: 'inscrutable',
    name: 'Inscrutable',
    icon: 'fa-solid fa-user-secret',
    weights: { intellect: 2, agility: 1, luck: 1 },
  },
  {
    id: 'weathered',
    name: 'Weathered',
    icon: 'fa-solid fa-tree',
    weights: { might: 3, perception: 2, agility: 1 },
  },
  {
    id: 'mesmeric',
    name: 'Mesmeric',
    icon: 'fa-solid fa-spiral',
    weights: { charisma: 2, intellect: 2, luck: 1 },
  },
  {
    id: 'relentless',
    name: 'Relentless',
    icon: 'fa-solid fa-person-hiking',
    weights: { might: 2, agility: 2, perception: 1 },
  },
]

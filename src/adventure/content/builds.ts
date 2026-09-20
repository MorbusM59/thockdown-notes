// VECTOR ONE: the builds. An adjective and a set of stat weights.
//
// The roster has two layers: the 15 pair-only archetype builds, each with a
// 1:1 split and a permanent unlock, and the 60 ordinary 2:2:1 builds that are
// available from the start. The list is deliberately grouped so the pair and
// its four variants read as one cluster.
//
// The weight formula is:
//   * pair archetypes use 1:1 for their two stats
//   * ordinary builds use 2:2:1 across three stats
//   * no stat outside that set is weighted at all

import type { Build } from '../model/vectors'

const ARCHETYPE_BUILDS = [
  { id: 'might-agility', name: 'Balanced', icon: 'fa-solid fa-hammer', weights: { might: 1, agility: 1 }, requiresUnlock: 'might-agility' },
  { id: 'might-perception', name: 'Measured', icon: 'fa-solid fa-eye', weights: { might: 1, perception: 1 }, requiresUnlock: 'might-perception' },
  { id: 'might-intellect', name: 'Steadfast', icon: 'fa-solid fa-brain', weights: { might: 1, intellect: 1 }, requiresUnlock: 'might-intellect' },
  { id: 'might-charisma', name: 'Commanding', icon: 'fa-solid fa-crown', weights: { might: 1, charisma: 1 }, requiresUnlock: 'might-charisma' },
  { id: 'might-luck', name: 'Destined', icon: 'fa-solid fa-clover', weights: { might: 1, luck: 1 }, requiresUnlock: 'might-luck' },
  { id: 'agility-perception', name: 'Nimble', icon: 'fa-solid fa-binoculars', weights: { agility: 1, perception: 1 }, requiresUnlock: 'agility-perception' },
  { id: 'agility-intellect', name: 'Spry', icon: 'fa-solid fa-bolt', weights: { agility: 1, intellect: 1 }, requiresUnlock: 'agility-intellect' },
  { id: 'agility-charisma', name: 'Vivacious', icon: 'fa-solid fa-feather', weights: { agility: 1, charisma: 1 }, requiresUnlock: 'agility-charisma' },
  { id: 'agility-luck', name: 'Cunning', icon: 'fa-solid fa-dice', weights: { agility: 1, luck: 1 }, requiresUnlock: 'agility-luck' },
  { id: 'perception-intellect', name: 'Observant', icon: 'fa-solid fa-eye-low-vision', weights: { perception: 1, intellect: 1 }, requiresUnlock: 'perception-intellect' },
  { id: 'perception-charisma', name: 'Dignified', icon: 'fa-solid fa-masks-theater', weights: { perception: 1, charisma: 1 }, requiresUnlock: 'perception-charisma' },
  { id: 'perception-luck', name: 'Learned', icon: 'fa-solid fa-star', weights: { perception: 1, luck: 1 }, requiresUnlock: 'perception-luck' },
  { id: 'intellect-charisma', name: 'Mirthful', icon: 'fa-solid fa-scroll', weights: { intellect: 1, charisma: 1 }, requiresUnlock: 'intellect-charisma' },
  { id: 'intellect-luck', name: 'Incandescent', icon: 'fa-solid fa-moon', weights: { intellect: 1, luck: 1 }, requiresUnlock: 'intellect-luck' },
  { id: 'charisma-luck', name: 'Glorious', icon: 'fa-solid fa-gem', weights: { charisma: 1, luck: 1 }, requiresUnlock: 'charisma-luck' },
] satisfies ReadonlyArray<Build>

export const BUILDS: readonly Build[] = [
  ...ARCHETYPE_BUILDS,
  // --- Might + Agility
  { id: 'might-agility-perception', name: 'Brutal', icon: 'fa-solid fa-hammer', weights: { might: 2, agility: 2, perception: 1 } },
  { id: 'might-agility-intellect', name: 'Ferocious', icon: 'fa-solid fa-hammer', weights: { might: 2, agility: 2, intellect: 1 } },
  { id: 'might-agility-charisma', name: 'Dashing', icon: 'fa-solid fa-hammer', weights: { might: 2, agility: 2, charisma: 1 } },
  { id: 'might-agility-luck', name: 'Fortunate', icon: 'fa-solid fa-hammer', weights: { might: 2, agility: 2, luck: 1 } },

  // --- Might + Perception
  { id: 'might-perception-agility', name: 'Grim', icon: 'fa-solid fa-eye', weights: { might: 2, perception: 2, agility: 1 } },
  { id: 'might-perception-intellect', name: 'Vigilant', icon: 'fa-solid fa-eye', weights: { might: 2, perception: 2, intellect: 1 } },
  { id: 'might-perception-charisma', name: 'Imposing', icon: 'fa-solid fa-eye', weights: { might: 2, perception: 2, charisma: 1 } },
  { id: 'might-perception-luck', name: 'Propitious', icon: 'fa-solid fa-eye', weights: { might: 2, perception: 2, luck: 1 } },

  // --- Might + Intellect
  { id: 'might-intellect-agility', name: 'Stoic', icon: 'fa-solid fa-brain', weights: { might: 2, intellect: 2, agility: 1 } },
  { id: 'might-intellect-perception', name: 'Sagacious', icon: 'fa-solid fa-brain', weights: { might: 2, intellect: 2, perception: 1 } },
  { id: 'might-intellect-charisma', name: 'Imperial', icon: 'fa-solid fa-brain', weights: { might: 2, intellect: 2, charisma: 1 } },
  { id: 'might-intellect-luck', name: 'Blessed', icon: 'fa-solid fa-brain', weights: { might: 2, intellect: 2, luck: 1 } },

  // --- Might + Charisma
  { id: 'might-charisma-agility', name: 'Valiant', icon: 'fa-solid fa-crown', weights: { might: 2, charisma: 2, agility: 1 } },
  { id: 'might-charisma-perception', name: 'Persuasive', icon: 'fa-solid fa-crown', weights: { might: 2, charisma: 2, perception: 1 } },
  { id: 'might-charisma-intellect', name: 'Noble', icon: 'fa-solid fa-crown', weights: { might: 2, charisma: 2, intellect: 1 } },
  { id: 'might-charisma-luck', name: 'Fortuitous', icon: 'fa-solid fa-crown', weights: { might: 2, charisma: 2, luck: 1 } },

  // --- Might + Luck
  { id: 'might-luck-agility', name: 'Rugged', icon: 'fa-solid fa-clover', weights: { might: 2, luck: 2, agility: 1 } },
  { id: 'might-luck-perception', name: 'Canny', icon: 'fa-solid fa-clover', weights: { might: 2, luck: 2, perception: 1 } },
  { id: 'might-luck-intellect', name: 'Regal', icon: 'fa-solid fa-clover', weights: { might: 2, luck: 2, intellect: 1 } },
  { id: 'might-luck-charisma', name: 'Lucky', icon: 'fa-solid fa-clover', weights: { might: 2, luck: 2, charisma: 1 } },

  // --- Agility + Perception
  { id: 'agility-perception-might', name: 'Lithe', icon: 'fa-solid fa-binoculars', weights: { agility: 2, perception: 2, might: 1 } },
  { id: 'agility-perception-intellect', name: 'Keen', icon: 'fa-solid fa-binoculars', weights: { agility: 2, perception: 2, intellect: 1 } },
  { id: 'agility-perception-charisma', name: 'Poised', icon: 'fa-solid fa-binoculars', weights: { agility: 2, perception: 2, charisma: 1 } },
  { id: 'agility-perception-luck', name: 'Favored', icon: 'fa-solid fa-binoculars', weights: { agility: 2, perception: 2, luck: 1 } },

  // --- Agility + Intellect
  { id: 'agility-intellect-might', name: 'Swift', icon: 'fa-solid fa-bolt', weights: { agility: 2, intellect: 2, might: 1 } },
  { id: 'agility-intellect-perception', name: 'Precise', icon: 'fa-solid fa-bolt', weights: { agility: 2, intellect: 2, perception: 1 } },
  { id: 'agility-intellect-charisma', name: 'Graceful', icon: 'fa-solid fa-bolt', weights: { agility: 2, intellect: 2, charisma: 1 } },
  { id: 'agility-intellect-luck', name: 'Serendipitous', icon: 'fa-solid fa-bolt', weights: { agility: 2, intellect: 2, luck: 1 } },

  // --- Agility + Charisma
  { id: 'agility-charisma-might', name: 'Wily', icon: 'fa-solid fa-feather', weights: { agility: 2, charisma: 2, might: 1 } },
  { id: 'agility-charisma-perception', name: 'Dapper', icon: 'fa-solid fa-feather', weights: { agility: 2, charisma: 2, perception: 1 } },
  { id: 'agility-charisma-intellect', name: 'Elegant', icon: 'fa-solid fa-feather', weights: { agility: 2, charisma: 2, intellect: 1 } },
  { id: 'agility-charisma-luck', name: 'Bountiful', icon: 'fa-solid fa-feather', weights: { agility: 2, charisma: 2, luck: 1 } },

  // --- Agility + Luck
  { id: 'agility-luck-might', name: 'Elusive', icon: 'fa-solid fa-dice', weights: { agility: 2, luck: 2, might: 1 } },
  { id: 'agility-luck-perception', name: 'Furtive', icon: 'fa-solid fa-dice', weights: { agility: 2, luck: 2, perception: 1 } },
  { id: 'agility-luck-intellect', name: 'Lustrous', icon: 'fa-solid fa-dice', weights: { agility: 2, luck: 2, intellect: 1 } },
  { id: 'agility-luck-charisma', name: 'Fateful', icon: 'fa-solid fa-dice', weights: { agility: 2, luck: 2, charisma: 1 } },

  // --- Perception + Intellect
  { id: 'perception-intellect-might', name: 'Astute', icon: 'fa-solid fa-eye-low-vision', weights: { perception: 2, intellect: 2, might: 1 } },
  { id: 'perception-intellect-agility', name: 'Calculated', icon: 'fa-solid fa-eye-low-vision', weights: { perception: 2, intellect: 2, agility: 1 } },
  { id: 'perception-intellect-charisma', name: 'Refined', icon: 'fa-solid fa-eye-low-vision', weights: { perception: 2, intellect: 2, charisma: 1 } },
  { id: 'perception-intellect-luck', name: 'Sage', icon: 'fa-solid fa-eye-low-vision', weights: { perception: 2, intellect: 2, luck: 1 } },

  // --- Perception + Charisma
  { id: 'perception-charisma-might', name: 'Composed', icon: 'fa-solid fa-masks-theater', weights: { perception: 2, charisma: 2, might: 1 } },
  { id: 'perception-charisma-agility', name: 'Courteous', icon: 'fa-solid fa-masks-theater', weights: { perception: 2, charisma: 2, agility: 1 } },
  { id: 'perception-charisma-intellect', name: 'Majestic', icon: 'fa-solid fa-masks-theater', weights: { perception: 2, charisma: 2, intellect: 1 } },
  { id: 'perception-charisma-luck', name: 'Auspicious', icon: 'fa-solid fa-masks-theater', weights: { perception: 2, charisma: 2, luck: 1 } },

  // --- Perception + Luck
  { id: 'perception-luck-might', name: 'Watchful', icon: 'fa-solid fa-star', weights: { perception: 2, luck: 2, might: 1 } },
  { id: 'perception-luck-agility', name: 'Wary', icon: 'fa-solid fa-star', weights: { perception: 2, luck: 2, agility: 1 } },
  { id: 'perception-luck-intellect', name: 'Immaculate', icon: 'fa-solid fa-star', weights: { perception: 2, luck: 2, intellect: 1 } },
  { id: 'perception-luck-charisma', name: 'Opportune', icon: 'fa-solid fa-star', weights: { perception: 2, luck: 2, charisma: 1 } },

  // --- Intellect + Charisma
  { id: 'intellect-charisma-might', name: 'Scholarly', icon: 'fa-solid fa-scroll', weights: { intellect: 2, charisma: 2, might: 1 } },
  { id: 'intellect-charisma-agility', name: 'Polished', icon: 'fa-solid fa-scroll', weights: { intellect: 2, charisma: 2, agility: 1 } },
  { id: 'intellect-charisma-perception', name: 'Erudite', icon: 'fa-solid fa-scroll', weights: { intellect: 2, charisma: 2, perception: 1 } },
  { id: 'intellect-charisma-luck', name: 'Provident', icon: 'fa-solid fa-scroll', weights: { intellect: 2, charisma: 2, luck: 1 } },

  // --- Intellect + Luck
  { id: 'intellect-luck-might', name: 'Arcane', icon: 'fa-solid fa-moon', weights: { intellect: 2, luck: 2, might: 1 } },
  { id: 'intellect-luck-agility', name: 'Omniscient', icon: 'fa-solid fa-moon', weights: { intellect: 2, luck: 2, agility: 1 } },
  { id: 'intellect-luck-perception', name: 'Sly', icon: 'fa-solid fa-moon', weights: { intellect: 2, luck: 2, perception: 1 } },
  { id: 'intellect-luck-charisma', name: 'Premonitory', icon: 'fa-solid fa-moon', weights: { intellect: 2, luck: 2, charisma: 1 } },

  // --- Charisma + Luck
  { id: 'charisma-luck-might', name: 'Gilded', icon: 'fa-solid fa-gem', weights: { charisma: 2, luck: 2, might: 1 } },
  { id: 'charisma-luck-agility', name: 'Radiant', icon: 'fa-solid fa-gem', weights: { charisma: 2, luck: 2, agility: 1 } },
  { id: 'charisma-luck-perception', name: 'Golden', icon: 'fa-solid fa-gem', weights: { charisma: 2, luck: 2, perception: 1 } },
  { id: 'charisma-luck-intellect', name: 'Splendid', icon: 'fa-solid fa-gem', weights: { charisma: 2, luck: 2, intellect: 1 } },
] satisfies ReadonlyArray<Build>

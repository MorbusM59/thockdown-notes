// VECTOR FOUR: the classes. A noun, and the combat choices it swaps.
//
// A class changes WHICH CELL IS ON THE RING and what pressing it is worth --
// nothing else. It touches no stat, no derived value and no armour pool; a
// class that did would be a species with a different name (model/vectors.ts).
//
// Reading rules:
//
//   * A move REPLACES a choice, never adds one. The pace constraint is the
//     reason: a fight is a dozen levels of ten encounters of twenty actions,
//     so a class that put two more cells on every screen would cost more
//     reading than the whole fight is worth. A swap costs no press.
//   * FIRST DECLARED WINS where two moves could take the same cell, so the
//     rarer or stronger move goes above the commoner one.
//   * Shares, not points: `damageShare: 0.6` is 60% of a nominal blow, and
//     `hitShare: 0.5` removes half the misses (model/chance.ts).
//   * A move should be a DECISION THE PLAYER DID NOT HAVE TO MAKE. It fires
//     on its own and says so on the cell, which is what lets a class be
//     interesting without being another thing to think about.
//   * The noun is the LAST word of a monster's name: "Dashing Orc Bruiser".

import type { CombatClass } from '../model/vectors'

export const COMBAT_CLASSES: readonly CombatClass[] = [
  {
    id: 'bruiser',
    name: 'Bruiser',
    icon: 'fa-solid fa-hammer',
    moves: [
      {
        id: 'bruiser:haymaker',
        name: 'Haymaker',
        icon: 'fa-solid fa-hand-back-fist',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.25 },
        damageShare: 2,
        hitShare: -0.35,
        flavour: 'Everything, or nothing at all.',
      },
    ],
  },
  {
    id: 'assassin',
    name: 'Assassin',
    icon: 'fa-solid fa-user-ninja',
    moves: [
      {
        id: 'assassin:ambush',
        name: 'Ambush',
        icon: 'fa-solid fa-user-secret',
        replaces: 'attack',
        when: { kind: 'firstActionOfEncounter' },
        damageShare: 2.5,
        hitShare: 0.6,
        ignoresArmor: true,
        flavour: 'They did not know you were there.',
      },
      {
        id: 'assassin:backstab',
        name: 'Backstab',
        icon: 'fa-solid fa-khanda',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.2 },
        damageShare: 1.2,
        critShare: 0.5,
      },
    ],
  },
  {
    id: 'juggler',
    name: 'Juggler',
    icon: 'fa-solid fa-circle-nodes',
    moves: [
      // CASCADE FIRST: the rarer move has to be declared above the
      // unconditional one or it can never fire, since the first declared
      // wins. `validateContent` caught this the other way round.
      {
        id: 'juggler:cascade',
        name: 'Cascade',
        icon: 'fa-solid fa-water',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.15 },
        strikes: 4,
        damageShare: 0.45,
      },
      {
        id: 'juggler:flurry',
        name: 'Flurry',
        icon: 'fa-solid fa-shuffle',
        replaces: 'attack',
        when: { kind: 'always' },
        strikes: 2,
        damageShare: 0.6,
        flavour: 'Two things in the air at once, always.',
      },
    ],
  },
  {
    id: 'warlock',
    name: 'Warlock',
    icon: 'fa-solid fa-book-skull',
    moves: [
      {
        id: 'warlock:hex',
        name: 'Hex',
        icon: 'fa-solid fa-wand-sparkles',
        replaces: 'attack',
        when: { kind: 'always' },
        damageShare: 0.85,
        ignoresArmor: true,
        flavour: 'Plate was never the problem.',
      },
      {
        id: 'warlock:sap',
        name: 'Sap Will',
        icon: 'fa-solid fa-hourglass-half',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 2,
        stealsActions: 1,
        flavour: 'They forget what they were about to do.',
      },
    ],
  },
  {
    id: 'bard',
    name: 'Bard',
    icon: 'fa-solid fa-guitar',
    moves: [
      {
        id: 'bard:mockery',
        name: 'Mockery',
        icon: 'fa-solid fa-face-laugh-wink',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.35 },
        damageShare: 0.7,
        stealsActions: 1,
        flavour: 'The verse is not the weapon. The pause is.',
      },
      {
        id: 'bard:sidestep',
        name: 'Sidestep',
        icon: 'fa-solid fa-shoe-prints',
        replaces: 'flee',
        when: { kind: 'always' },
        riposteShare: 0.5,
        flavour: 'Leaving, with a parting shot.',
      },
    ],
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    icon: 'fa-solid fa-fire',
    moves: [
      {
        id: 'pyromancer:scorch',
        name: 'Scorch',
        icon: 'fa-solid fa-fire-flame-curved',
        replaces: 'attack',
        when: { kind: 'always' },
        damageShare: 1.15,
        ignoresArmor: true,
        hitShare: -0.2,
        flavour: 'Wild, and it does not care what you are wearing.',
      },
      {
        id: 'pyromancer:backdraft',
        name: 'Backdraft',
        icon: 'fa-solid fa-explosion',
        replaces: 'takeTheHit',
        when: { kind: 'always' },
        riposteShare: 1.2,
        flavour: 'Let it land. Let it catch.',
      },
    ],
  },
  {
    id: 'duelist',
    name: 'Duelist',
    icon: 'fa-solid fa-khanda',
    moves: [
      {
        id: 'duelist:riposte',
        name: 'Riposte',
        icon: 'fa-solid fa-reply',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 1,
        riposteShare: 0.8,
        flavour: 'The parry was the setup.',
      },
      {
        id: 'duelist:lunge',
        name: 'Lunge',
        icon: 'fa-solid fa-arrow-right-long',
        replaces: 'attack',
        when: { kind: 'firstActionOfRound' },
        damageShare: 1.4,
        hitShare: 0.3,
      },
    ],
  },
  {
    id: 'skirmisher',
    name: 'Skirmisher',
    icon: 'fa-solid fa-person-running',
    moves: [
      {
        id: 'skirmisher:harry',
        name: 'Harry',
        icon: 'fa-solid fa-angles-right',
        replaces: 'attack',
        when: { kind: 'always' },
        strikes: 2,
        damageShare: 0.5,
        hitShare: 0.25,
      },
      {
        id: 'skirmisher:withdraw',
        name: 'Fighting Withdrawal',
        icon: 'fa-solid fa-arrows-left-right',
        replaces: 'flee',
        when: { kind: 'always' },
        guard: 3,
        flavour: 'Going, and hard to stop.',
      },
    ],
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    icon: 'fa-solid fa-shield-halved',
    moves: [
      {
        id: 'sentinel:bulwark',
        name: 'Bulwark',
        icon: 'fa-solid fa-shield',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 4,
        flavour: 'Nothing gets through. Nothing needs to.',
      },
      {
        id: 'sentinel:brace',
        name: 'Brace',
        icon: 'fa-solid fa-anchor',
        replaces: 'takeTheHit',
        when: { kind: 'always' },
        guard: 2,
        riposteShare: 0.4,
      },
    ],
  },
  {
    id: 'brawler',
    name: 'Brawler',
    icon: 'fa-solid fa-hand-fist',
    moves: [
      {
        id: 'brawler:grapple',
        name: 'Grapple',
        icon: 'fa-solid fa-handshake-angle',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.3 },
        damageShare: 0.8,
        stealsActions: 2,
        flavour: 'Held, and going nowhere.',
      },
      {
        id: 'brawler:secondwind',
        name: 'Second Wind',
        icon: 'fa-solid fa-lungs',
        replaces: 'attack',
        when: { kind: 'health', band: 'maimed' },
        strikes: 3,
        damageShare: 0.7,
        flavour: 'The part of the fight they are good at.',
      },
    ],
  },
  {
    id: 'trickster',
    name: 'Trickster',
    icon: 'fa-solid fa-dice',
    moves: [
      {
        id: 'trickster:sleight',
        name: 'Sleight',
        icon: 'fa-solid fa-hand-sparkles',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.4 },
        damageShare: 0.9,
        critShare: 0.4,
        ignoresArmor: true,
      },
      {
        id: 'trickster:vanish',
        name: 'Vanish',
        icon: 'fa-solid fa-eye-slash',
        replaces: 'dodge',
        when: { kind: 'always' },
        riposteShare: 0.6,
        flavour: 'Not there, and behind them.',
      },
    ],
  },
  {
    id: 'reaver',
    name: 'Reaver',
    icon: 'fa-solid fa-gavel',
    moves: [
      {
        id: 'reaver:cleave',
        name: 'Cleave',
        icon: 'fa-solid fa-burst',
        replaces: 'attack',
        when: { kind: 'lastActionOfRound' },
        damageShare: 1.8,
        critShare: 0.25,
        flavour: 'Everything left, at the end of the round.',
      },
    ],
  },
  {
    id: 'warden',
    name: 'Warden',
    icon: 'fa-solid fa-tree',
    moves: [
      {
        id: 'warden:entangle',
        name: 'Entangle',
        icon: 'fa-solid fa-seedling',
        replaces: 'attack',
        when: { kind: 'firstActionOfEncounter' },
        damageShare: 0.5,
        stealsActions: 3,
        flavour: 'The ground itself takes a turn.',
      },
      {
        id: 'warden:rootstand',
        name: 'Rootstand',
        icon: 'fa-solid fa-mound',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 3,
        riposteShare: 0.3,
      },
    ],
  },
  {
    // THE DESIGN'S OWN THIRD EXAMPLE, written out as it was given: "has a
    // 25% chance to replace regular attack with stunning blow".
    id: 'mauler',
    name: 'Mauler',
    icon: 'fa-solid fa-gavel',
    moves: [
      {
        id: 'mauler:stunningBlow',
        name: 'Stunning Blow',
        icon: 'fa-solid fa-star-of-life',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.25 },
        damageShare: 1.1,
        stealsActions: 1,
        flavour: 'They lose the thread of what they were doing.',
      },
    ],
  },
  {
    id: 'monk',
    name: 'Monk',
    icon: 'fa-solid fa-hands',
    moves: [
      {
        id: 'monk:hundredhands',
        name: 'Hundred Hands',
        icon: 'fa-solid fa-hand-dots',
        replaces: 'attack',
        when: { kind: 'always' },
        strikes: 3,
        damageShare: 0.45,
        hitShare: 0.15,
        flavour: 'Not hard. Often.',
      },
      {
        id: 'monk:flow',
        name: 'Flow',
        icon: 'fa-solid fa-water',
        replaces: 'dodge',
        when: { kind: 'always' },
        riposteShare: 0.7,
        flavour: 'Not there, and the momentum was theirs.',
      },
    ],
  },
  {
    id: 'templar',
    name: 'Templar',
    icon: 'fa-solid fa-place-of-worship',
    moves: [
      {
        id: 'templar:absolve',
        name: 'Absolve',
        icon: 'fa-solid fa-hands-praying',
        replaces: 'takeTheHit',
        when: { kind: 'always' },
        guard: 5,
        riposteShare: 0.7,
        flavour: 'Standing still, on purpose, and it costs them.',
      },
      {
        id: 'templar:smite',
        name: 'Smite',
        icon: 'fa-solid fa-bolt',
        replaces: 'attack',
        when: { kind: 'firstActionOfRound' },
        damageShare: 1.3,
        ignoresArmor: true,
      },
    ],
  },
  {
    id: 'corsair',
    name: 'Corsair',
    icon: 'fa-solid fa-anchor',
    moves: [
      {
        id: 'corsair:broadside',
        name: 'Broadside',
        icon: 'fa-solid fa-sailboat',
        replaces: 'attack',
        when: { kind: 'lastActionOfRound' },
        strikes: 2,
        damageShare: 1.1,
      },
      {
        id: 'corsair:cutandrun',
        name: 'Cut and Run',
        icon: 'fa-solid fa-scissors',
        replaces: 'flee',
        when: { kind: 'always' },
        riposteShare: 0.9,
        guard: 2,
        flavour: 'Leaving is not the same as going quietly.',
      },
    ],
  },
  {
    id: 'shieldbreaker',
    name: 'Shieldbreaker',
    icon: 'fa-solid fa-shield-virus',
    moves: [
      {
        id: 'shieldbreaker:sunder',
        name: 'Sunder',
        icon: 'fa-solid fa-hammer',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.3 },
        damageShare: 1.5,
        ignoresArmor: true,
        critShare: 0.2,
      },
      {
        id: 'shieldbreaker:pry',
        name: 'Pry',
        icon: 'fa-solid fa-screwdriver',
        replaces: 'attack',
        when: { kind: 'always' },
        damageShare: 0.9,
        ignoresArmor: true,
        flavour: 'Around the plate rather than through it.',
      },
    ],
  },
  {
    id: 'falconer',
    name: 'Falconer',
    icon: 'fa-solid fa-crow',
    moves: [
      {
        id: 'falconer:stoop',
        name: 'Stoop',
        icon: 'fa-solid fa-feather-pointed',
        replaces: 'attack',
        when: { kind: 'firstActionOfEncounter' },
        strikes: 2,
        damageShare: 1.4,
        critShare: 0.4,
        flavour: 'It was circling before you arrived.',
      },
      {
        id: 'falconer:harass',
        name: 'Harass',
        icon: 'fa-solid fa-dove',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.35 },
        damageShare: 0.6,
        stealsActions: 1,
      },
    ],
  },
  {
    id: 'alchemist',
    name: 'Alchemist',
    icon: 'fa-solid fa-flask',
    moves: [
      {
        id: 'alchemist:vitriol',
        name: 'Vitriol',
        icon: 'fa-solid fa-flask-vial',
        replaces: 'attack',
        when: { kind: 'chance', chance: 0.4 },
        damageShare: 1.3,
        ignoresArmor: true,
        flavour: 'Plate is just a bigger surface.',
      },
      {
        id: 'alchemist:smoke',
        name: 'Smoke',
        icon: 'fa-solid fa-smog',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 3,
        stealsActions: 1,
        flavour: 'They have to find you again.',
      },
    ],
  },
  {
    id: 'revenantKnight',
    name: 'Revenant',
    icon: 'fa-solid fa-skull',
    moves: [
      {
        id: 'revenant:grudge',
        name: 'Grudge',
        icon: 'fa-solid fa-hourglass-end',
        replaces: 'attack',
        when: { kind: 'health', band: 'injured' },
        damageShare: 1.9,
        hitShare: 0.3,
        flavour: 'It remembers every one of them.',
      },
      {
        id: 'revenant:endure',
        name: 'Endure',
        icon: 'fa-solid fa-bone',
        replaces: 'defend',
        when: { kind: 'always' },
        guard: 2,
        riposteShare: 0.5,
      },
    ],
  },
  {
    // EARNED, not picked. This is what the old Berserker origin was trying to
    // be before the vectors were separated: it wanted to be a stat gift, a
    // damage percentage and an armour rule at once, and so it was none of
    // them cleanly. What is actually distinctive about a berserker is HOW
    // THEY FIGHT -- they do not defend, and the not-defending is the damage.
    id: 'berserker',
    name: 'Berserker',
    icon: 'fa-solid fa-fire-flame-curved',
    requiresUnlock: 'berserker',
    moves: [
      {
        id: 'berserker:frenzy',
        name: 'Frenzy',
        icon: 'fa-solid fa-burst',
        replaces: 'attack',
        when: { kind: 'health', band: 'injured' },
        strikes: 3,
        damageShare: 1,
        flavour: 'Hurt is the point at which they start.',
      },
      {
        id: 'berserker:reckless',
        name: 'Reckless Swing',
        icon: 'fa-solid fa-hammer',
        replaces: 'attack',
        when: { kind: 'always' },
        damageShare: 1.6,
        hitShare: -0.15,
      },
      {
        id: 'berserker:rage',
        name: 'Rage',
        icon: 'fa-solid fa-face-angry',
        replaces: 'defend',
        when: { kind: 'always' },
        riposteShare: 1.5,
        flavour: 'No guard at all, and it costs them more than it costs you.',
      },
    ],
  },
]

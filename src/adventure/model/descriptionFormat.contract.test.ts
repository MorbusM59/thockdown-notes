// HOW A DESCRIPTION IS WRITTEN, held as a property of every description the
// game can produce rather than as a note somebody has to remember.
//
// These are the author's formatting rules, and they apply to BOTH styles
// (model/modifiers.ts's `DescriptionStyle`). They are checked against every
// effect of every item, trait, species and build in the catalogue, and every
// move of every class -- so a content author who writes a new effect gets the
// rules enforced without having read them:
//
//   1. Stat and derived-value names are CAPITALISED (Agility, Damage, Armor,
//      Natural Armor, Hit points). They are proper names of quantities.
//   2. Nothing else is capitalised at the start of a description. A
//      description is a phrase, not a sentence, and a capital letter at the
//      front of one makes a row of them read as a list of sentences that
//      have all lost their full stops.
//   3. No trailing period, for the same reason.
//   4. No "--". It is an em dash or it is a hyphen; "--" is neither.
//
// FLAVOUR IS EXEMPT and is not an oversight: a move's `flavour` IS a
// sentence, deliberately, and it appears only in the verbose style, which is
// why it is filtered out below rather than tested and excused.

import { describe, expect, it } from 'vitest'

import { THOCKQUEST, catalogFor } from '../content'
import { ROUND_POSITION_WORD, describeModifier, type DescriptionStyle } from './modifiers'
import { MOVE_TERMS, describeMove } from './moves'
import { DERIVED_LABELS, STAT_LABELS } from './stats'
import { TACTIC_LABELS } from './tactics'
import { describeBuild } from './vectors'

const STYLES: readonly DescriptionStyle[] = ['verbose', 'concise']
/**
 * The words a description may open with in upper case: the six stats, the
 * eight derived values, and the names the concise style coins for quantities
 * that had no single word before. Read from the label tables rather than
 * listed, so a renamed stat cannot fall out of this set.
 */
const CAPITALISED_NOUNS = new Set<string>([
  ...Object.values(STAT_LABELS),
  ...Object.values(DERIVED_LABELS),
  ...Object.values(ROUND_POSITION_WORD),
  ...MOVE_TERMS,
  // The six fight-shape rules name themselves, and the name IS the concise
  // description ("Combo (5)"). Read from the label table for the same reason
  // MOVE_TERMS is read rather than listed: a renamed tactic must not need a
  // second edit here to stay legal.
  ...Object.values(TACTIC_LABELS),
  'Natural',
  'Mending',
  'Armor',
].map((word) => word.split(' ')[0]))

function complaintsFor(line: string, where: string): string[] {
  const out: string[] = []
  if (line.includes('--')) out.push(`${where}: "${line}" contains "--"`)
  if (line.endsWith('.')) out.push(`${where}: "${line}" ends with a period`)
  const first = line.split(/\s+/)[0] ?? ''
  if (/^[A-Z]/.test(first) && !CAPITALISED_NOUNS.has(first)) {
    out.push(`${where}: "${line}" opens with a capital that is not a stat name`)
  }
  return out
}

/** Every description the game can write, in one style, with where it came from. */
function everyDescription(style: DescriptionStyle): { line: string; where: string }[] {
  const catalog = catalogFor(THOCKQUEST, 1234)
  const lines: { line: string; where: string }[] = []
  for (const modifier of catalog.values()) {
    for (const line of describeModifier(modifier, style)) {
      lines.push({ line, where: `${modifier.kind} ${modifier.id}` })
    }
  }
  for (const species of THOCKQUEST.species) {
    const asModifier = { id: species.id, kind: 'trait' as const, name: species.name, icon: species.icon, effects: species.effects }
    for (const line of describeModifier(asModifier, style)) {
      lines.push({ line, where: `species ${species.id}` })
    }
  }
  for (const build of THOCKQUEST.builds) {
    for (const line of describeBuild(build)) lines.push({ line, where: `build ${build.id}` })
  }
  for (const combatClass of THOCKQUEST.combatClasses) {
    for (const move of combatClass.moves) {
      for (const line of describeMove(move, style)) {
        // The flavour line is a sentence on purpose, and only verbose shows it.
        if (line === move.flavour) continue
        lines.push({ line, where: `move ${move.id}` })
      }
    }
  }
  return lines
}

describe('how a description is written', () => {
  for (const style of STYLES) {
    it(`obeys the format rules in every ${style} description the game can write`, () => {
      const all = everyDescription(style)
      // A guard on the guard: an empty sweep would pass every rule.
      expect(all.length).toBeGreaterThan(200)
      const complaints = all.flatMap(({ line, where }) => complaintsFor(line, where))
      expect(complaints).toEqual([])
    })
  }

  it('says strictly less in concise than in verbose, and never more', () => {
    // The property that makes the toggle meaningful: concise drops
    // explanation, so no concise description may be LONGER than the verbose
    // one it replaces. (Equal is fine -- most effects have nothing to
    // explain and read the same either way.)
    const verbose = everyDescription('verbose')
    const concise = everyDescription('concise')
    expect(concise.length).toBeLessThanOrEqual(verbose.length)
    const totalVerbose = verbose.reduce((sum, { line }) => sum + line.length, 0)
    const totalConcise = concise.reduce((sum, { line }) => sum + line.length, 0)
    expect(totalConcise).toBeLessThan(totalVerbose)
  })

  it('never says "tier" in a description the PLAYER reads about themselves', () => {
    // A tier is how far the run has come and belongs on the bar; a build is
    // how it grows and belongs to the build. A monster's tier is a different
    // matter and is deliberately still in `monsterDetailLines`, because that
    // is how two offers on a screen are compared.
    for (const build of THOCKQUEST.builds) {
      for (const line of describeBuild(build)) expect(line.toLowerCase()).not.toContain('tier')
    }
    for (const style of STYLES) {
      for (const { line } of everyDescription(style)) expect(line.toLowerCase()).not.toContain('tier')
    }
  })
})

describe('a percentage of a chance', () => {
  it('says "to" wherever it appears, and a quantity never does', () => {
    // ONE FORM for an item's effect and a class move's share alike: they were
    // always the same arithmetic and had two vocabularies, which is what made
    // a player unable to tell that "+20% Crit" and "20% hit to crit" would
    // compose. The preposition marks the ladder a chance moves an outcome
    // along; a quantity is added and has no direction to name.
    for (const style of STYLES) {
      for (const { line, where } of everyDescription(style)) {
        if (!/^[+-]\d+%/.test(line)) continue
        if (/\b(Hit|Crit|Dodge)\b/.test(line)) {
          // A round-position adjective may sit between the preposition and
          // its object -- "+50% to Initial Dodge" -- and nothing else may.
          expect(line, `${where}: "${line}"`).toMatch(/% to (Initial |Final )?(Hit|Crit|Dodge)\b/)
        } else {
          expect(line, `${where}: "${line}"`).not.toContain('% to ')
        }
      }
    }
  })

  it('never writes a transition, in either direction', () => {
    // "-35% miss to hit" is what a negative share used to print: not what a
    // minus means here, and not what the code does. A minus is the same
    // ladder downwards -- 35% of the hits become misses -- and "to Hit" with
    // a sign says that without a second phrasing.
    for (const style of STYLES) {
      for (const { line, where } of everyDescription(style)) {
        expect(line, where).not.toMatch(/miss to hit|hit to crit|hit to miss|crit to hit/i)
      }
    }
  })
})

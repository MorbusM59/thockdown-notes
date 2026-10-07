// EVERY CHOICE FITS THE BAR, at the tightest layout a reader plays at.
//
// The chapter bar's strip holds what just happened (narration) and then a
// dashed pill previewing the cell the ring sits on. Wider than the bar, it
// scrolls sideways -- and a choice whose preview is off to the right is a
// choice made blind, because nobody scrolls a status bar to read an option.
// So the rule is a property:
//
//   a choice's preview, beside the line its screen opens with, fits the strip
//   at the reference layout (escapeMenu/chapterBarMetrics.json: a 1920px
//   window in double size, one slot, the sidebar out -- 492 CSS px).
//
// CHECKED OVER THE CONTENT, NOT OVER PLAYED RUNS. A preview is a function of
// a piece of content and the describer, so every piece is checked directly:
// every build, playable species and playable class, every region, and every
// item and trait template as rolled under a fixed set of run seeds (a
// template rolls its slots per run, model/modifierSlots.ts, so one seed would
// check one roll of each). An earlier version played runs and counted the
// share of previews that overflowed; any change to which monsters or rewards
// appear shifted that sample and moved its ceilings with no text changed.
// Here a result changes only when content or wording does.
//
// WHAT DOES NOT FIT is named, not tolerated:
// - a class or species that overflows is listed by id below. Both are asked
//   once per run, and a class is three moves, one line each, which is wider
//   than the strip by itself -- accepted for those screens by the author's
//   director. A listed id that has come to fit fails the test, so the lists
//   only shrink.
// - an item or trait roll may overflow beside an in-run lead-in in at most
//   `MODIFIER_RESIDUAL` of rolls, a ceiling that may only come down; alone,
//   every roll must fit.
//
// Classes behind a permanent unlock (Berserker) are checked too: the stage
// offers them once earned, and a once-earned class is still a preview.
//
// NOT CHECKED HERE: a fight's previews (a fully stacked Prepare is the known
// wide one) and a monster's offer preview, which
// are built from the moment of a fight rather than from one piece of content.
// A fight's accumulating pills are exempt by design anyway (the newest is the
// leftmost and the one that matters).
//
// Played in CONCISE style. Verbose explains every effect in words, and a
// reader who asked for the explanation has asked for the scroll. Anything a
// preview cannot fit goes in its tooltip (`ChoiceDetail.more`).
//
// The widths come from chapterBarWidth.ts, an estimate checked against the
// real DOM by scripts/adventure/calibrateChapterBar.ts (run with vite-node
// from apps/notes). Re-run that after changing the bar's CSS or
// EscapeMenuStatus.tsx's structure; this test cannot see either.

import { describe, expect, it } from 'vitest'
import { CHAPTER_BAR_METRICS, stripWidth } from '../escapeMenu/chapterBarWidth'
import { THOCKQUEST, catalogFor } from './content'
import { describeModifier } from './model/modifiers'
import { describeBuild, MONSTER_TYPE_WORD } from './model/vectors'
import { CREATION_NARRATION, moveLines } from './stages/characterCreation'
import { REGION_SELECT_NARRATION } from './stages/regionSelect'
import { omenLeadIn, restLines } from './stages/encounterSelect'
import { moreToSearch } from './stages/loot'
import { omenHealAmount } from './model/specialEvents'

const STYLE = 'concise' as const
const STRIP = CHAPTER_BAR_METRICS.stripPx

/** Run seeds the item and trait templates are rolled under. Fixed, so the result is too. */
const CATALOG_SEEDS = Array.from({ length: 24 }, (_, index) => index + 1)

/** Classes whose moves overflow beside their screen's lead-in. Once per run; accepted. */
const CLASSES_OVER: readonly string[] = [
  'alchemist',
  'assassin',
  'bard',
  'berserker',
  'brawler',
  'corsair',
  'duelist',
  'falconer',
  'juggler',
  'monk',
  'pyromancer',
  'revenantKnight',
  'shieldbreaker',
  'skirmisher',
  'templar',
  'trickster',
  'warden',
]
/** Species whose effects overflow beside their screen's lead-in. Once per run; accepted. */
const SPECIES_OVER: readonly string[] = ['brannoch', 'velkar']
/**
 * The share of item and trait rolls allowed past the edge: on their own,
 * beside the creation question, and beside the widest in-run lead-in. A roll
 * is one line per effect, and three effects with a condition each come to
 * about the whole strip.
 */
const MODIFIER_RESIDUAL = { alone: 0, creation: 0.01, inRun: 0.28 } as const

/**
 * WHAT AN IN-RUN OFFER STANDS BESIDE, per kind, because the two kinds are
 * offered on different screens. A TRAIT is offered by the omen, which opens
 * with its rank's line -- the widest rank word is taken. An ITEM is offered
 * by the spoils, which after the first pick says `moreToSearch(<that pick>)`;
 * the item's own name stands in for the pick, which is the same length class
 * and keeps the check a function of the content alone. The first spoils
 * screen opens with the kill pill instead, which names a monster and is built
 * from a fight, so it is not checked here.
 */
const OMEN_LEAD_IN = Object.values(MONSTER_TYPE_WORD)
  .map((word) => omenLeadIn(word))
  .reduce((widest, line) => (stripWidth([line], []) > stripWidth([widest], []) ? line : widest))

function inRunLeadIn(modifier: { kind: string; name: string }): string {
  return modifier.kind === 'trait' ? OMEN_LEAD_IN : moreToSearch(modifier.name)
}

const playableClasses = THOCKQUEST.combatClasses.filter((entry) => entry.playable !== false)
const playableSpecies = THOCKQUEST.species.filter((entry) => entry.playable === true)

function speciesLines(species: (typeof playableSpecies)[number]): string[] {
  return describeModifier({ id: species.id, kind: 'trait', name: species.name, icon: species.icon, effects: species.effects }, STYLE)
}

interface Preview { id: string; lines: string[]; inRun: string }

function fits(narration: string | null, lines: readonly string[]): boolean {
  return stripWidth(narration === null ? [] : [narration], lines) <= STRIP
}

/** Every item and trait, rolled under every seed, deduplicated by what it says. */
function modifierPreviews(): Preview[] {
  const seen = new Map<string, Preview>()
  for (const seed of CATALOG_SEEDS) {
    for (const modifier of catalogFor(THOCKQUEST, seed).values()) {
      const lines = describeModifier(modifier, STYLE)
      seen.set(`${modifier.id}|${lines.join('\n')}`, { id: modifier.id, lines, inRun: inRunLeadIn(modifier) })
    }
  }
  return [...seen.values()]
}

describe('choice previews fit the chapter bar at the reference layout', () => {
  it('fits every build beside its question', () => {
    const over = THOCKQUEST.builds.filter((build) => !fits(CREATION_NARRATION.build, describeBuild(build))).map((build) => build.id)
    expect(over).toEqual([])
  })

  it('fits the omen\'s rest beside the omen\'s line, at any Might a run reaches', () => {
    for (let might = 0; might <= 20; might += 1) expect(fits(OMEN_LEAD_IN, restLines(omenHealAmount(might))), `Might ${might}`).toBe(true)
  })

  it('fits every region beside the road\'s line', () => {
    const over = THOCKQUEST.regions.filter((region) => !fits(REGION_SELECT_NARRATION, [...region.borders])).map((region) => region.id)
    expect(over).toEqual([])
  })

  it('overflows only with the classes it names, and names none that fit', () => {
    const over = playableClasses.filter((entry) => !fits(CREATION_NARRATION.class, moveLines(entry, STYLE))).map((entry) => entry.id)
    expect(over.sort()).toEqual([...CLASSES_OVER].sort())
  })

  it('overflows only with the species it names, and names none that fit', () => {
    const over = playableSpecies.filter((entry) => !fits(CREATION_NARRATION.species, speciesLines(entry))).map((entry) => entry.id)
    expect(over.sort()).toEqual([...SPECIES_OVER].sort())
  })

  const modifiers = modifierPreviews()

  /**
   * The share of rolls past the edge beside a lead-in, against its ceiling:
   * over it is a regression, and more than two points under it is slack a
   * regression could arrive in unnoticed.
   */
  function checkResidual(leadIn: ((preview: Preview) => string) | null, allowed: number): void {
    const over = modifiers.filter((preview) => !fits(leadIn ? leadIn(preview) : null, preview.lines))
    const share = over.length / modifiers.length
    const widest = over.reduce<Preview | null>(
      (best, entry) => (!best || stripWidth([], entry.lines) > stripWidth([], best.lines) ? entry : best),
      null,
    )
    const report = `${Math.round(share * 1000) / 10}% of ${modifiers.length} rolls; widest ${widest?.id}: ${widest?.lines.join(' | ')}`
    expect(share, report).toBeLessThanOrEqual(allowed)
    expect(allowed - share, `slack: ${report}`).toBeLessThanOrEqual(0.02)
  }

  it('rolls every item and trait template under enough seeds to mean something', () => {
    expect(modifiers.length).toBeGreaterThan(60)
  })

  it('pushes an item or trait past the edge on its own no more often than the residual', () => {
    checkResidual(null, MODIFIER_RESIDUAL.alone)
  })

  it('pushes an item or trait past the edge at creation no more often than the residual', () => {
    const widerQuestion = stripWidth([CREATION_NARRATION.item], []) > stripWidth([CREATION_NARRATION.trait], [])
      ? CREATION_NARRATION.item
      : CREATION_NARRATION.trait
    checkResidual(() => widerQuestion, MODIFIER_RESIDUAL.creation)
  })

  it('pushes an item or trait past the edge in a run no more often than the residual', () => {
    checkResidual((preview) => preview.inRun, MODIFIER_RESIDUAL.inRun)
  })
})

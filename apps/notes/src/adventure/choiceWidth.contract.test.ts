// EVERY CHOICE FITS THE BAR, at the tightest layout a reader plays at.
//
// The chapter bar's strip holds what just happened (narration) and then a
// dashed pill previewing the cell the ring sits on. Wider than the bar, it
// scrolls sideways -- and a choice whose preview is off to the right is a
// choice made blind, because nobody scrolls a status bar to read an option.
// So the rule is a property, checked over every screen a played run reaches:
//
//   the screen's narration AND the preview of every choice on it fit the
//   strip at the reference layout (escapeMenu/chapterBarMetrics.json: a
//   1920px window in double size, one slot, the sidebar out -- 492 CSS px).
//
// ONE EXCEPTION, by design rather than by tolerance: in a FIGHT the round's
// pills accumulate, newest first, and the leftmost -- the newest -- is the one
// that matters, so a fight's history is allowed to run off the edge. What
// still has to hold there is that each preview fits the strip on its own.
//
// WHAT DOES NOT FIT YET is a named, measured RESIDUAL per screen (below),
// not a tolerance. A preview of an item or trait is one line per effect, and
// three effects come to about 400px of a 492px strip -- so beside any pill at
// all, the screens that offer modifiers still overflow some of the time, and
// a class's three moves overflow on their own. Each ceiling is what the game
// does today, rounded up by a point; it may only come DOWN. A screen not
// listed may not overflow at all.
//
// Played in CONCISE style. Verbose explains every effect in words, and an
// explanation of three moves is not sixty characters long; a reader who asked
// for the explanation has asked for the scroll. Anything a preview cannot fit
// goes in its tooltip (`ChoiceDetail.more`), not past the edge.
//
// The widths come from chapterBarWidth.ts, an estimate checked against the
// real DOM by scripts/adventure/calibrateChapterBar.ts (run with vite-node
// from apps/notes). Re-run that after changing the bar's CSS or
// EscapeMenuStatus.tsx's structure; this test cannot see either.

import { describe, expect, it } from 'vitest'
import { currentScreen, enterEntryScreen } from './core/director'
import { emptySave, type GameSave } from './model/gameState'
import { CHAPTER_BAR_METRICS, stripWidth } from '../escapeMenu/chapterBarWidth'
import { clockFor, DEPS, harnessRandom, POLICIES, step, type StepMemory } from '../../scripts/adventure/runner'
import { THOCKQUEST } from './content'

/** Seeds and players: enough runs that every class and species is dealt at creation. */
const SEEDS = 9
const PLAYERS = [POLICIES.random, POLICIES.careful, POLICIES.first] as const
const MAX_STEPS = 2_500

/**
 * THE RESIDUAL, as the share of a screen's previews allowed past the edge.
 * Keyed by stage, and by step for character creation, whose three questions
 * are different kinds of preview.
 */
const RESIDUAL: Readonly<Record<string, number>> = {
  // A class IS its moves, one line each, and three moves are wider than the
  // strip by themselves. Asked once per run.
  'characterCreation:class': 0.73,
  // Up to five effects, the species' whole identity. Asked once per run.
  'characterCreation:species': 0.23,
  // The omen's traits beside its line, and the pill saying what was taken.
  encounterSelect: 0.19,
  // Market and spoils: a modifier beside the pill saying what was just bought or taken.
  market: 0.03,
  loot: 0.02,
  // A fully stacked Prepare names every term it buys; checked on its own,
  // since a fight's history may run off the edge by design. Raised from 2%
  // when regions began weighting which monsters appear: the same content,
  // but the sampled runs reach a different mix of fights.
  combat: 0.03,
}

interface Overflow { screen: string; width: number; narration: readonly string[]; choice: string; lines: readonly string[] }

/** The residual's key for a screen: the stage, or the stage and the question it is asking. */
function screenKeyOf(stageId: string, choiceIds: readonly string[]): string {
  if (stageId !== 'characterCreation') return stageId
  const step = choiceIds[0]?.split(':')[0] ?? ''
  return step === 'class' || step === 'species' ? `${stageId}:${step}` : step === 'build' ? `${stageId}:build` : `${stageId}:offer`
}

function playAndMeasure(): { overflows: Overflow[]; checked: Map<string, number>; previewed: Set<string> } {
  const overflows: Overflow[] = []
  const previewed = new Set<string>()
  const checked = new Map<string, number>()
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const nowMs = clockFor(seed)
    const random = harnessRandom(seed)
    const memory: StepMemory = { fameSeen: null }
    const start = emptySave(seed)
    let save: GameSave = enterEntryScreen({ ...start, settings: { ...start.settings, verboseDescriptions: false } }, DEPS, nowMs)
    for (let index = 0; index < MAX_STEPS; index += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      const key = screenKeyOf(screen.stageId, screen.choices.map((choice) => choice.id))
      const narration = screen.stageId === 'combat' ? [] : screen.narration
      for (const choice of screen.choices) {
        const lines = choice.detail?.lines ?? []
        previewed.add(choice.id)
        checked.set(key, (checked.get(key) ?? 0) + 1)
        const width = stripWidth(narration, lines)
        if (width > CHAPTER_BAR_METRICS.stripPx) {
          overflows.push({ screen: key, width: Math.round(width), narration, choice: choice.label, lines })
        }
      }
      const next = step(save, PLAYERS[seed % PLAYERS.length], [], random, memory, nowMs)
      if (!next) break
      save = next.save
    }
  }
  return { overflows, checked, previewed }
}

describe('choice previews fit the chapter bar at the reference layout', () => {
  const { overflows, checked, previewed } = playAndMeasure()

  it('reaches enough of the game to mean something', () => {
    expect([...checked.values()].reduce((sum, count) => sum + count, 0)).toBeGreaterThan(20_000)
    // Every class and species was on a creation screen at least once, so a
    // long description cannot hide in content the runs never dealt. The two
    // flags default opposite ways: a species is a monster unless marked
    // playable, a class is playable unless marked otherwise.
    const missing = [
      ...THOCKQUEST.combatClasses.filter((entry) => entry.playable !== false && !entry.requiresUnlock).map((entry) => `class:${entry.id}`),
      ...THOCKQUEST.species.filter((entry) => entry.playable === true).map((entry) => `species:${entry.id}`),
    ].filter((id) => !previewed.has(id))
    expect(missing).toEqual([])
  })

  it('pushes a preview past the edge no more often than the named residual allows', () => {
    // Over its ceiling, a screen is reported with its widest case, so a
    // failure names where to look rather than printing ten thousand rows.
    const over = [...checked].flatMap(([screen, count]) => {
      const mine = overflows.filter((overflow) => overflow.screen === screen)
      const share = mine.length / count
      if (share <= (RESIDUAL[screen] ?? 0)) return []
      const widest = mine.reduce((best, overflow) => (overflow.width > best.width ? overflow : best))
      return [`${screen}: ${Math.round(share * 100)}% of ${count} previews overflow, allowed ${Math.round((RESIDUAL[screen] ?? 0) * 100)}%. `
        + `Widest ${widest.width}px > ${CHAPTER_BAR_METRICS.stripPx}px: ${JSON.stringify(widest.narration)} then "${widest.choice}" ${JSON.stringify(widest.lines)}`]
    })
    expect(over).toEqual([])
  })

  it('names no residual a screen has already got under', () => {
    // The ratchet: a ceiling more than a few points above what the game does
    // is room for a regression to arrive unnoticed.
    const slack = Object.entries(RESIDUAL).flatMap(([screen, allowed]) => {
      const count = checked.get(screen) ?? 0
      const share = count === 0 ? 0 : overflows.filter((overflow) => overflow.screen === screen).length / count
      return allowed - share > 0.05 ? [`${screen}: allowed ${Math.round(allowed * 100)}%, does ${Math.round(share * 100)}%`] : []
    })
    expect(slack).toEqual([])
  })
})

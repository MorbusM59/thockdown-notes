import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { parseNarration } from '../../escapeMenu/narrationMarkup'
import { SPELLS } from '../model/spells'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

/**
 * A run standing in a fight with a mind sharp enough that the table is
 * reliably in reach.
 *
 * Intellect is raised by EFFECT rather than by choosing the mage origin,
 * because the origin gives two points and the point of these is to see the
 * whole table: a hand that is empty nine rounds in ten is a slow way to
 * assert that spells are wired at all.
 */
function inAFightWithMagic(seed: number, intellect = 12): GameSave {
  let save = enterEntryScreen(emptySave(seed), DEPS, NOW)
  for (let step = 0; step < 200; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) throw new Error('no screen')
    if (screen.stageId === 'combat') return save
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) throw new Error('nothing to press')
    save = choose(save, choice.id, DEPS, NOW).save
    // Raised the moment there is a character to raise, so the fight's very
    // first round is already dealt from the full table.
    if (activeGame(save) && (activeGame(save)?.baseStats.intellect ?? 0) < intellect) {
      save = applyEffects(save, [{ kind: 'adjustBaseStat', stat: 'intellect', amount: intellect }], DEPS.catalog, NOW)
    }
  }
  throw new Error('never reached a fight')
}

const cellIds = (save: GameSave) => currentScreen(save, DEPS)?.choices.map((choice) => choice.id) ?? []

/** Every glyph in a narration entry, in order. */
const glyphs = (entry: string) => parseNarration(entry)
  .filter((span): span is Extract<typeof span, { kind: 'icon' }> => span.kind === 'icon')
  .map((span) => span.icon)

describe('magic, as the ring offers it', () => {
  it('puts the strongest spell first and the plain attack last', () => {
    const ids = cellIds(inAFightWithMagic(4242))
    expect(ids[ids.length - 1]).toBe('combat:attack')
    const spells = ids.filter((id) => id.startsWith('spell:'))
    expect(spells.length).toBeGreaterThan(0)
    // Descending by level, which is the order SPELLS is written in.
    const levels = spells.map((id) => SPELLS.find((spell) => `spell:${spell.id}` === id)!.level)
    expect([...levels]).toEqual([...levels].sort((left, right) => right - left))
  })

  it('offers nothing but the attack to a character with no mind for it', () => {
    // Intellect 0 is (0 - 0) / 12 -- no spell ever comes within reach, so the
    // fight is exactly the fight it was before any of this existed.
    const ids = cellIds(inAFightWithMagic(4242, 0))
    expect(ids).toEqual(['combat:attack'])
  })

  it('casts, and says so on the bar in the same shape every other action uses', () => {
    const save = inAFightWithMagic(4242)
    const spellCell = cellIds(save).find((id) => id.startsWith('spell:'))!
    const spell = SPELLS.find((candidate) => `spell:${candidate.id}` === spellCell)!

    const cast = choose(save, spellCell, DEPS, NOW).save
    const head = currentScreen(cast, DEPS)!.narration[0]
    // you -- the spell -- (a number, if it dealt any) -- it
    expect(glyphs(head)[0]).toBe('fa-solid fa-user-shield')
    expect(glyphs(head)[1]).toBe(spell.icon)
  })

  it('spends the action it was cast with, exactly as an attack does', () => {
    const save = inAFightWithMagic(4242)
    const before = currentScreen(save, DEPS)!.choices.length
    expect(before).toBeGreaterThan(1)
    const spellCell = cellIds(save).find((id) => id.startsWith('spell:'))!
    const after = choose(save, spellCell, DEPS, NOW).save
    // The fight moved on: either it is somebody's turn again or the round
    // turned over. What it did NOT do is stay on the same question.
    expect(currentScreen(after, DEPS)!.screenKey).not.toBe(currentScreen(save, DEPS)!.screenKey)
  })

  it('kills with magic and pays out, rather than stalling on a dead monster', () => {
    // A mind of thirty reaches Meteor every round; the fight should end.
    let save = inAFightWithMagic(4242, 30)
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
    expect(currentScreen(save, DEPS)?.stageId).not.toBe('combat')
  })

  it('carries a lingering spell across the round boundary that spends the log', () => {
    // A Plague or a Storm pays out when the round CLOSES, and the log is cut
    // when the next one opens -- so the tick's pill has to be carried into
    // the new round or the reader never sees it happen.
    let save = inAFightWithMagic(31337, 30)
    let sawTick = false
    for (let action = 0; action < 80 && !sawTick; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
      const after = currentScreen(save, DEPS)
      if (!after || after.stageId !== 'combat') break
      // A freshly opened round: the status pill at the head. Anything behind
      // it is a tick carried over from the round that just closed.
      const opened = after.narration.length > 1 && after.narration[0].includes('fa-explosion')
      if (opened && after.narration.slice(1).some((entry) => glyphs(entry).some(
        (glyph) => glyph === 'fa-solid fa-disease' || glyph === 'fa-solid fa-cloud-bolt',
      ))) sawTick = true
    }
    expect(sawTick).toBe(true)
  })
})

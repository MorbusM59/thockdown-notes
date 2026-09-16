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
  for (let step = 0; step < 300; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) throw new Error('no screen')
    // Stop on the PLAYER's own action, not merely inside a fight: whose
    // action opens a round is a roll, so "in combat" lands on a defence
    // screen about half the time and the ring there is answering, not
    // attacking.
    if (screen.stageId === 'combat' && screen.choices.some((choice) => choice.id === 'combat:attack')) return save
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) throw new Error('nothing to press')
    // On a defence screen, the answer that changes least: Defend costs
    // nothing but the monster's action.
    const answer = screen.choices.find((candidate) => candidate.id === 'defence:defend') ?? choice
    save = choose(save, answer.id, DEPS, NOW).save
    // Raised the moment there is a character to raise, so the fight's very
    // first round is already dealt from the full table.
    if (activeGame(save) && (activeGame(save)?.baseStats.intellect ?? 0) < intellect) {
      save = applyEffects(save, [{ kind: 'adjustBaseStat', stat: 'intellect', amount: intellect }], DEPS.catalog, NOW)
    }
  }
  throw new Error('never reached the player\'s own action')
}

const cellIds = (save: GameSave) => currentScreen(save, DEPS)?.choices.map((choice) => choice.id) ?? []

/** Every glyph in a narration entry, in order. */
const glyphs = (entry: string) => parseNarration(entry)
  .filter((span): span is Extract<typeof span, { kind: 'icon' }> => span.kind === 'icon')
  .map((span) => span.icon)

describe('magic, as the ring offers it', () => {
  it('puts the strongest spell first, then the attack, then Prepare', () => {
    const ids = cellIds(inAFightWithMagic(4242))
    expect(ids.slice(-2)).toEqual(['combat:attack', 'combat:prepare'])
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
    expect(ids).toEqual(['combat:attack', 'combat:prepare'])
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
    // A Plague pays out when the round CLOSES, and the log is cut when the
    // next one opens -- so the tick's pill has to be carried into the new
    // round or the reader never sees it happen.
    let save = inAFightWithMagic(31337, 20)
    // The hand is dealt per ACTION now, so Plague is not necessarily in the
    // first one. Take the plain attack until it is.
    let plague: string | undefined
    for (let action = 0; action < 40; action += 1) {
      plague = cellIds(save).find((id) => id === 'spell:plague')
      if (plague) break
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      save = choose(save, screen.choices.find((choice) => !choice.id.startsWith('spell:'))!.id, DEPS, NOW).save
    }
    expect(plague).toBeDefined()
    save = choose(save, plague!, DEPS, NOW).save

    let sawTick = false
    for (let action = 0; action < 80 && !sawTick; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      // Never cast again -- the plain attack, so the only thing that can put
      // a Plague glyph on the bar is the tick itself.
      const plain = screen.choices.find((choice) => !choice.id.startsWith('spell:')) ?? screen.choices[0]
      save = choose(save, plain.id, DEPS, NOW).save
      const after = currentScreen(save, DEPS)
      if (!after || after.stageId !== 'combat') break
      // A freshly opened round: the status pill at the head. Anything behind
      // it is carried over from the round that just closed.
      const opened = after.narration.length > 1 && after.narration[0].includes('fa-explosion')
      if (opened && after.narration.slice(1).some(
        (entry) => glyphs(entry).includes('fa-solid fa-disease'),
      )) sawTick = true
    }
    expect(sawTick).toBe(true)
  })
})

describe('the fire answers the monster, not the round', () => {
  /**
   * "After every action it takes" is ONE rule, and it was written at one of
   * its two call sites: the blow the monster swung burned, and the action a
   * charm took away from it did not. A stack that only bites when the monster
   * gets to use its action is a different spell against a talkative
   * character.
   */
  it('burns for an action a charm took away, exactly as for one it swung', () => {
    let save = inAFightWithMagic(4242, 20)
    // Both stats up: the charm has to be able to fire, and Ignite has to be
    // in reach to be laid on in the first place.
    save = applyEffects(save, [{ kind: 'adjustBaseStat', stat: 'charisma', amount: 6 }], DEPS.catalog, NOW)

    const ignite = cellIds(save).find((id) => id === 'spell:ignite')
    expect(ignite).toBeDefined()
    save = choose(save, ignite!, DEPS, NOW).save

    let burnedAfterCharm = false
    for (let action = 0; action < 120 && !burnedAfterCharm; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const plain = screen.choices.find((choice) => !choice.id.startsWith('spell:')) ?? screen.choices[0]
      save = choose(save, plain.id, DEPS, NOW).save
      const after = currentScreen(save, DEPS)
      if (!after) break
      // The fire's pill sits directly on top of the charm's, because the
      // charm spent the action and the fire answered it.
      const head = after.narration[0] ?? ''
      const behind = after.narration[1] ?? ''
      if (glyphs(head).includes('fa-solid fa-fire-flame-curved')
        && glyphs(behind).includes('fa-solid fa-masks-theater')) burnedAfterCharm = true
    }
    expect(burnedAfterCharm).toBe(true)
  })
})

describe('the hand is dealt per action', () => {
  /**
   * PER ACTION, not per round -- which was the first version, on the argument
   * that the ring's first cell should not move under a fast player. That was
   * the wrong trade: a round that reached Meteor reached it for every action
   * in the round, and a Meteor STREAK is not what one chance in twelve buys.
   */
  it('does not hand the same top spell to every action of a round', () => {
    // The property: across the actions of one fight, the offered set changes.
    // Per-round dealing would hold it fixed for every action between two
    // status pills.
    const hands = new Set<string>()
    let save = inAFightWithMagic(4242, 20)
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const spells = screen.choices.filter((choice) => choice.id.startsWith('spell:'))
      if (spells.length > 0) hands.add(spells.map((choice) => choice.id).join(','))
      // Never cast: casting can remove a cell on its own, which would make
      // the set change for a reason that is not the deal.
      save = choose(save, screen.choices.find((choice) => !choice.id.startsWith('spell:'))!.id, DEPS, NOW).save
    }
    expect(hands.size).toBeGreaterThan(1)
  })

  it('offers nothing while the question belongs to the monster, so the field never claims a hand nobody was dealt', () => {
    let save = inAFightWithMagic(4242, 20)
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const defending = screen.choices.some((choice) => choice.id.startsWith('defence:'))
      if (defending) expect(screen.choices.some((choice) => choice.id.startsWith('spell:'))).toBe(false)
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
  })
})

describe('a hand belongs to the action it was dealt for', () => {
  /**
   * `spellReach` says what is in reach for the action ABOUT to be taken. On a
   * monster's action nothing is, and the field must say so rather than keep
   * the player's last hand -- it was left standing at first, which made the
   * round claim a hand nobody had been dealt.
   */
  it('reads as nothing while the monster is the one acting', () => {
    let save = inAFightWithMagic(4242, 20)
    let checked = 0
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const frame = save.director.stack[save.director.stack.length - 1].state as Record<string, unknown>
      const round = frame.round as Record<string, unknown>
      if (screen.choices.some((choice) => choice.id.startsWith('defence:'))) {
        expect(round.spellReach).toBe(-1)
        checked += 1
      }
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
    expect(checked).toBeGreaterThan(0)
  })
})

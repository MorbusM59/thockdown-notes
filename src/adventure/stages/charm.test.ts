import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { parseNarration } from '../../escapeMenu/narrationMarkup'
import { CHARM_ICON } from '../model/charm'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

const glyphs = (entry: string) => parseNarration(entry)
  .filter((span): span is Extract<typeof span, { kind: 'icon' }> => span.kind === 'icon')
  .map((span) => span.icon)

const words = (entry: string) => parseNarration(entry)
  .filter((span): span is Extract<typeof span, { kind: 'icon' }> => span.kind === 'icon')
  .map((span) => span.label)

/** A run standing in a fight, with a tongue of the given power. */
function inAFight(seed: number, charisma: number): GameSave {
  let save = enterEntryScreen(emptySave(seed), DEPS, NOW)
  for (let step = 0; step < 300; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) throw new Error('no screen')
    if (screen.stageId === 'combat') return save
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) throw new Error('nothing to press')
    save = choose(save, choice.id, DEPS, NOW).save
    if (activeGame(save) && (activeGame(save)?.baseStats.charisma ?? 0) < charisma) {
      save = applyEffects(save, [{ kind: 'adjustBaseStat', stat: 'charisma', amount: charisma }], DEPS.catalog, NOW)
    }
  }
  throw new Error('never reached a fight')
}

/**
 * The ROUND'S pill -- the mask and a count, and nothing else. A charm FIRING
 * carries the same glyph in a four-part pill, so "has a mask in it" is not
 * the question.
 */
const isCharmStatus = (entry: string) => glyphs(entry).length === 1 && glyphs(entry)[0] === CHARM_ICON

describe('charm, as the bar tells it', () => {
  it('says what a round is under, once, however many effects came up', () => {
    // ONE pill for all of them: they are not three things that happened, they
    // are one thing that is true of this round -- and a bar that spent three
    // pills saying so would have no room left for the fight.
    //
    // Base stats are capped at six, so this is the most a character can be
    // and two of the three is a good round for it.
    const screen = currentScreen(inAFight(4242, 6), DEPS)!
    const charmPills = screen.narration.filter(isCharmStatus)
    expect(charmPills).toHaveLength(1)
    // The names ride on the glyph's own word, STRONGEST FIRST, which is what
    // the pill's tooltip reads out -- and the count beside it is how many.
    expect(words(charmPills[0])[0]).toBe('Confusion, Distraction')
    expect(charmPills[0]).toContain('**2**')
  })

  it('says nothing at all for a character with no tongue for it', () => {
    const screen = currentScreen(inAFight(4242, 0), DEPS)!
    expect(screen.narration.some((entry) => glyphs(entry).includes(CHARM_ICON))).toBe(false)
  })

  it('is never a blow the player is asked to answer and then told never came', () => {
    // THE PROPERTY, not the step. The interception is rolled when the action
    // is ARMED rather than when a defence is answered, so a charmed action
    // costs no press at all -- which means a talkative character is asked to
    // defend FEWER times over the same fight than a silent one. A charm rolled
    // at answer-time would cost exactly as many presses either way.
    const pressesToDefend = (charisma: number) => {
      let asked = 0
      for (const seed of [4242, 31337, 7, 99, 1234]) {
        let save = inAFight(seed, charisma)
        for (let action = 0; action < 50; action += 1) {
          const screen = currentScreen(save, DEPS)
          if (!screen || screen.stageId !== 'combat') break
          if (screen.choices.some((choice) => choice.id.startsWith('defence:'))) asked += 1
          save = choose(save, screen.choices[0].id, DEPS, NOW).save
        }
      }
      return asked
    }
    expect(pressesToDefend(6)).toBeLessThan(pressesToDefend(0))
  })

  it('shows a charm that fired in the four-part shape, with the mask where the action goes', () => {
    let save = inAFight(4242, 6)
    let fired: string | null = null
    for (let action = 0; action < 60 && !fired; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
      const after = currentScreen(save, DEPS)
      fired = after?.narration.find((entry) => glyphs(entry).includes(CHARM_ICON) && !isCharmStatus(entry)) ?? null
    }
    expect(fired).not.toBeNull()
    // The MONSTER leads -- its own action was the thing that went wrong for
    // it -- and the mask stands where the action glyph would.
    expect(glyphs(fired!)[0]).toMatch(/fa-skull|fa-dragon/)
    expect(glyphs(fired!)[1]).toBe(CHARM_ICON)
  })

  it('finishes the fight on a Doom, and pays out for it', () => {
    // A charm kill is still a kill: the spoils screen opens and its kill line
    // reads what the monster had left.
    let save = inAFight(4242, 6)
    let landed: string | null = null
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      if (screen.stageId === 'loot') { landed = 'loot'; break }
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
    expect(landed).toBe('loot')
    const spoils = currentScreen(save, DEPS)!
    expect(spoils.narration.some((entry) => glyphs(entry).includes('fa-solid fa-cross'))).toBe(true)
  })

  it('leaves a fight with no charm in it exactly as it was', () => {
    // Charisma 0 is the whole feature costing nothing: the monster swings and
    // the player answers, which is the fight that existed before any of this.
    let save = inAFight(4242, 0)
    let sawDefence = false
    for (let action = 0; action < 40 && !sawDefence; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      if (screen.choices.some((choice) => choice.id.startsWith('defence:'))) sawDefence = true
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
    expect(sawDefence).toBe(true)
  })
})

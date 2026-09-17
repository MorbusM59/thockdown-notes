import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, profileOf, type GameSave } from '../model/gameState'
import { SPREAD_PIVOT } from '../model/damageRoll'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { splitNarration } from '../../escapeMenu/narrationMarkup'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

/** A run in a fight, with whatever stats are needed to reach the thing under test. */
function inAFight(seed: number, stats: Partial<Record<'intellect' | 'charisma' | 'perception', number>> = {}): GameSave {
  let save = enterEntryScreen(emptySave(seed), DEPS, NOW)
  for (let step = 0; step < 300; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) throw new Error('no screen')
    if (screen.stageId === 'combat') return save
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) throw new Error('nothing to press')
    save = choose(save, choice.id, DEPS, NOW).save
    const game = activeGame(save)
    if (!game) continue
    for (const [stat, amount] of Object.entries(stats)) {
      if (game.baseStats[stat as 'intellect'] < amount) {
        save = applyEffects(save, [{ kind: 'adjustBaseStat', stat: stat as 'intellect', amount }], DEPS.content, NOW)
      }
    }
  }
  throw new Error('never reached a fight')
}

const detailOf = (entry: string) => splitNarration(entry).detail

/**
 * The same run, with EFFECTIVE Perception sitting exactly on the damage
 * band's pivot -- null where what the run is already carrying has taken it
 * past, which is a run this particular question cannot be asked of.
 */
function atPivot(save: GameSave): GameSave | null {
  const game = activeGame(save)
  if (!game) return null
  const fromGear = profileOf(save, game, DEPS.content).stats.perception - game.baseStats.perception
  const target = SPREAD_PIVOT - fromGear
  if (target < 0) return null
  return applyEffects(save, [
    { kind: 'adjustBaseStat', stat: 'perception', amount: target - game.baseStats.perception },
  ], DEPS.content, NOW)
}
const headDetail = (save: GameSave) => detailOf(currentScreen(save, DEPS)!.narration[0])

/** A roll, as every tooltip in the game writes one. */
const ROLL_SHAPE = /^[A-Z][a-z]+: \d+\|\d+$/

/**
 * EVERY PILL DOCUMENTS ITS OWN ARITHMETIC. The fight is told in glyphs to
 * keep it short, so the tooltip is where each one says what it actually did
 * -- and the numbers in it are the ones the fight USED, never recomputed,
 * because a tooltip that derives its own answer can disagree with the blow it
 * is explaining.
 */
describe('what a pill says when you hover it', () => {
  it('shows an attack’s rolls in `rolled|needed` and its damage as a sum', () => {
    let save = inAFight(4242)
    for (let action = 0; action < 40; action += 1) {
      const screen = currentScreen(save, DEPS)!
      if (screen.stageId !== 'combat') break
      const attack = screen.choices.find((choice) => choice.id === 'combat:attack')
      if (!attack) { save = choose(save, screen.choices[0].id, DEPS, NOW).save; continue }
      save = choose(save, attack.id, DEPS, NOW).save
      const detail = headDetail(save)
      expect(detail.length).toBeGreaterThan(0)
      // Line one is the rolls, each in the one shape.
      for (const roll of detail[0].split('  ')) expect(roll).toMatch(ROLL_SHAPE)
      // A landed blow says what the number came out of; a miss has no sum to
      // show, and says nothing rather than showing a zero.
      const damage = detail.find((row) => row.startsWith('Damage:'))
      if (damage) expect(damage).toMatch(/^Damage: \d+/)
      return
    }
    throw new Error('never got to attack')
  })

  it('shows a lasting spell TWICE: once with no number when it lands, and again every time it bites', () => {
    // The application pill carries no damage figure -- nothing has happened
    // to the monster yet -- and its tooltip says what the condition now comes
    // to. The tick pill carries the figure and shows the sum behind it.
    let save = inAFight(31337, { intellect: 6 })
    let applied: string[] | null = null
    let bit: string[] | null = null
    for (let action = 0; action < 120 && !bit; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const plague = screen.choices.find((choice) => choice.id === 'spell:plague')
      const pressed = applied ? screen.choices.find((choice) => !choice.id.startsWith('spell:'))! : (plague ?? screen.choices[0])
      save = choose(save, pressed.id, DEPS, NOW).save
      const head = currentScreen(save, DEPS)?.narration[0] ?? ''
      if (plague && pressed.id === 'spell:plague') {
        applied = detailOf(head)
        // No number on the pill itself.
        expect(splitNarration(head).line).not.toMatch(/\*\*\d+\*\*/)
        expect(applied.some((row) => row.includes('stack(s)'))).toBe(true)
        continue
      }
      const tick = currentScreen(save, DEPS)?.narration.find((entry) => entry.includes('fa-disease') && /\*\*\d+\*\*/.test(entry))
      if (applied && tick) bit = detailOf(tick)
    }
    expect(applied).not.toBeNull()
    expect(bit).not.toBeNull()
    expect(bit!.some((row) => /^Damage: \d+ = \d+ left x \d+% x \d+ stack\(s\)$/.test(row))).toBe(true)
  })

  it('shows the charm check behind an effect that fired, and the chance on the round’s own pill', () => {
    for (const seed of [4242, 31337, 7, 99, 1234]) {
      let save = inAFight(seed, { charisma: 6 })
      const status = currentScreen(save, DEPS)!.narration.find((entry) => entry.includes('fa-masks-theater'))
      if (status) {
        expect(detailOf(status).some((row) => /^Each of its actions: \d+% to be taken$/.test(row))).toBe(true)
      }
      for (let action = 0; action < 60; action += 1) {
        const screen = currentScreen(save, DEPS)
        if (!screen || screen.stageId !== 'combat') break
        save = choose(save, screen.choices[0].id, DEPS, NOW).save
        const fired = currentScreen(save, DEPS)?.narration
          .find((entry) => entry.includes('fa-masks-theater') && entry.includes('fa-skull'))
        if (!fired) continue
        expect(detailOf(fired)[0]).toMatch(/^Charm: \d+\|\d+$/)
        return
      }
    }
    throw new Error('no charm ever fired')
  })

  it('never leaves a pill with nothing to say for itself', () => {
    // A pill whose tooltip is only its own words is a pill that did not
    // explain itself. The status pill is the one exception: its words ARE
    // its numbers.
    let checked = 0
    for (const seed of [4242, 31337, 7, 99, 1234]) {
      let save = inAFight(seed, { intellect: 6, charisma: 6 })
      for (let action = 0; action < 80; action += 1) {
        const screen = currentScreen(save, DEPS)
        if (!screen) break
        for (const entry of screen.narration) {
          // The status pill's words ARE its numbers, and a line of prose is
          // not a pill of glyphs at all.
          if (entry.includes('fa-explosion') || !entry.includes('[')) continue
          expect(detailOf(entry).length).toBeGreaterThan(0)
          checked += 1
        }
        save = choose(save, screen.choices[0].id, DEPS, NOW).save
      }
    }
    expect(checked).toBeGreaterThan(20)
  })
})

describe('the damage line shows the band it was drawn from', () => {
  /**
   * `Damage: 13 = 8 (5-8, best of 3) x 2 crit` -- the shape the spec asked
   * for. The band is in DAMAGE rather than in shares, because that is the
   * unit the rest of the line is in.
   */
  it('writes the roll, its band and the draws that bought it', () => {
    let save = inAFight(4242)
    for (let action = 0; action < 60; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
      const damage = headDetail(save).find((row) => row.startsWith('Damage:'))
      if (!damage || !damage.includes('=')) continue
      expect(damage).toMatch(/^Damage: \d+ = \d+ \(\d+-\d+, best of \d+\)/)
      return
    }
    throw new Error('no blow landed with a band to show')
  })

  it('says only the number where there was no band to draw from', () => {
    // A character whose Perception has reached the pivot rolls nothing --
    // and `8-8, best of 1` would be arithmetic theatre for a fixed value.
    //
    // EFFECTIVE Perception, set after the fight is reached rather than before
    // it: items are rolled per run now and can carry stat points of their own
    // (model/itemSlots.ts), so a base of six is no longer a total of six --
    // and PAST the pivot the band reopens on purpose (model/damageRoll.ts),
    // which made this read as a regression when it was the rule working.
    for (const seed of [4242, 31337, 7, 99, 1234]) {
      let save = inAFight(seed)
      const pinned = atPivot(save)
      if (!pinned) continue
      save = pinned
      for (let action = 0; action < 60; action += 1) {
        const screen = currentScreen(save, DEPS)
        if (!screen || screen.stageId !== 'combat') break
        const attack = screen.choices.find((choice) => choice.id === 'combat:attack')
        save = choose(save, (attack ?? screen.choices[0]).id, DEPS, NOW).save
        const head = currentScreen(save, DEPS)?.narration[0] ?? ''
        // The PLAYER's own blow: the monster has its own Perception and its
        // own band, so only a pill the player is the subject of says anything
        // about theirs.
        if (!head.startsWith('[fa-solid fa-user-shield')) continue
        const damage = detailOf(head).find((row) => row.startsWith('Damage:'))
        if (!damage) continue
        expect(damage).not.toContain('best of')
        return
      }
    }
    throw new Error('no blow of the player’s landed')
  })
})

import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { emptySave, type GameSave } from '../model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { narrationText, parseNarration } from '../../escapeMenu/narrationMarkup'
import { buildMonster } from '../model/monsters'
import { addStats, createStatBlock } from '../model/stats'
import { killPill, monsterAttackPill, playerAttackPill, statusPill } from './combatLog'
import { lootStage } from './loot'
import { beginRound } from '../model/combat'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}

const NOW = 1_700_000_000_000

const HIT = { hit: true, crit: false, dodged: false, damage: 8, armorDecayed: false }
const MISS = { hit: false, crit: false, dodged: false, damage: 0, armorDecayed: false }

const WARRIOR = addStats(createStatBlock(0), { might: 2, agility: 1 })

function monsterOf(type: 'regular' | 'boss') {
  return buildMonster({
    classId: 'warrior',
    classBaseStats: WARRIOR,
    type,
    level: 1,
    against: WARRIOR,
  })
}

/** The glyphs in an entry, in order -- which is the pill's whole grammar. */
function glyphs(entry: string): string[] {
  return parseNarration(entry).flatMap((span) => (span.kind === 'icon' ? [span.icon] : []))
}

/** The figures in an entry. Empty where the pill carries no number at all. */
function figures(entry: string): string[] {
  return parseNarration(entry).flatMap((span) => (span.kind === 'text' && /\d/.test(span.text) ? [span.text] : []))
}

describe('a combat pill', () => {
  it('reads [who] [what] [how much] [to whom], in that order', () => {
    const pill = playerAttackPill(monsterOf('regular'), HIT)
    expect(glyphs(pill)).toEqual(['fa-solid fa-user-shield', 'fa-solid fa-burst', 'fa-solid fa-skull'])
    expect(figures(pill)).toEqual(['8'])
    expect(narrationText(parseNarration(pill))).toBe('you hit 8 it')
  })

  it('carries NO number on a miss, so nothing reads as a quantity', () => {
    const pill = playerAttackPill(monsterOf('regular'), MISS)
    expect(figures(pill)).toEqual([])
    expect(glyphs(pill)).toEqual(['fa-solid fa-user-shield', 'fa-solid fa-wind', 'fa-solid fa-skull'])
  })

  it('turns the arrow round when the monster is the one swinging', () => {
    const pill = monsterAttackPill(monsterOf('regular'), 'defend', HIT, false)
    expect(glyphs(pill)).toEqual(['fa-solid fa-skull', 'fa-solid fa-shield', 'fa-solid fa-user-shield'])
    expect(narrationText(parseNarration(pill))).toBe('it got through 8 you')
  })

  it('reads from whoever is SWINGING -- a blow that beat a block is not a block', () => {
    // "it blocked 8 you" said the opposite of what happened: the player
    // blocked, the monster got through it.
    expect(narrationText(parseNarration(monsterAttackPill(monsterOf('regular'), 'dodge', { ...MISS, dodged: true }, false))))
      .toBe('it was dodged by you')
    expect(narrationText(parseNarration(monsterAttackPill(monsterOf('regular'), 'flee', null, true))))
      .toBe('it lost you')
  })

  it('says a dodge with the glyph for "nothing arrived", and no figure', () => {
    const pill = monsterAttackPill(monsterOf('regular'), 'dodge', { ...MISS, dodged: true }, false)
    expect(glyphs(pill)[1]).toBe('fa-solid fa-wind')
    expect(figures(pill)).toEqual([])
  })

  it('shows a boss as something other than a bigger skull', () => {
    expect(glyphs(playerAttackPill(monsterOf('boss'), HIT))[2]).toBe('fa-solid fa-dragon')
  })

  it('opens a round mirrored around the clash, each side outward from it', () => {
    const monster = monsterOf('regular')
    const round = beginRound({
      playerHitPoints: 80,
      playerArmor: { fromItems: 0, natural: 0 },
      monsterDamageTaken: 0,
      monsterFleeing: false,
      playerFled: false,
    })
    const pill = statusPill(round, monster, { ...monster.derived, actionsPerRound: 2 })
    expect(glyphs(pill)).toEqual([
      'fa-solid fa-bolt', 'fa-solid fa-user-shield', 'fa-solid fa-heart',
      'fa-solid fa-right-long', 'fa-solid fa-left-long',
      'fa-solid fa-heart', 'fa-solid fa-skull', 'fa-solid fa-bolt',
    ])
    expect(figures(pill)).toEqual(['2', '80', String(monster.maxHitPoints), String(monster.maxActions)])
  })
})

/** The status pill is the only entry carrying the clash arrows. */
const isRoundHead = (entry: string) => entry.includes('fa-right-long')

function intoCombat(seed: number): GameSave {
  let save = enterEntryScreen(emptySave(seed), DEPS, NOW)
  for (let step = 0; step < 200; step += 1) {
    const screen = currentScreen(save, DEPS)
    if (!screen) throw new Error('no screen')
    if (screen.stageId === 'combat') return save
    const choice = screen.choices.find((candidate) => !candidate.id.endsWith(':leave'))
    if (!choice) throw new Error('nothing to press')
    save = choose(save, choice.id, DEPS, NOW).save
  }
  throw new Error('never reached a fight')
}

function step(save: GameSave): GameSave {
  const screen = currentScreen(save, DEPS)
  if (!screen) throw new Error('no screen')
  return choose(save, screen.choices[0].id, DEPS, NOW).save
}

describe('a round, as the bar tells it', () => {
  it('opens on the status pill, with the enemy named behind it', () => {
    const screen = currentScreen(intoCombat(4242), DEPS)!
    expect(screen.narration).toHaveLength(2)
    expect(isRoundHead(screen.narration[0])).toBe(true)
    expect(screen.narration[1]).toMatch(/It has seen you/)
  })

  it('asks for an action immediately -- there is no round to begin', () => {
    // "Begin combat" was a one-cell screen that could not be answered any
    // other way, so it asked nothing and cost a press per round.
    const screen = currentScreen(intoCombat(4242), DEPS)!
    expect(screen.choices.map((choice) => choice.id)).not.toContain('combat:begin')
    expect(screen.choices.length).toBeGreaterThan(0)
  })

  it('adds each action at the HEAD and leaves the ones behind it alone', () => {
    const before = currentScreen(intoCombat(4242), DEPS)!.narration
    const after = currentScreen(step(intoCombat(4242)), DEPS)!.narration
    expect(after).toHaveLength(before.length + 1)
    expect(after.slice(1)).toEqual([...before])
    expect(isRoundHead(after[0])).toBe(false)
  })

  it('cuts the round back to its status pill when the next one opens', () => {
    // The property, not the step: however many actions a round runs to, the
    // strip is one status pill again the moment it turns over -- so what is
    // on the bar is always exactly the round being fought.
    let save = intoCombat(4242)
    let longest = 0
    let sawTurnover = false
    for (let action = 0; action < 40 && !sawTurnover; action += 1) {
      const before = currentScreen(save, DEPS)!.narration.length
      save = step(save)
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      longest = Math.max(longest, before)
      if (screen.narration.length < before) {
        expect(screen.narration).toHaveLength(1)
        expect(isRoundHead(screen.narration[0])).toBe(true)
        sawTurnover = true
      }
    }
    expect(sawTurnover).toBe(true)
    // And it really had accumulated before it was cut -- otherwise the check
    // above passes on a log that never grew.
    expect(longest).toBeGreaterThan(2)
  })
})

describe('what the ring opens on', () => {
  it('offers the answer that usually makes sense FIRST, because that is the default', () => {
    // The ring dials back to its first cell on every step (EscapeHoldPanel's
    // reset), so the order IS the default and a reordering would silently
    // change what a fast player presses.
    let save = intoCombat(4242)
    let sawDefence = false
    let sawAttack = false
    for (let action = 0; action < 40; action += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen || screen.stageId !== 'combat') break
      const ids = screen.choices.map((choice) => choice.id)
      if (ids[0] === 'combat:attack') sawAttack = true
      if (ids.some((id) => id.startsWith('defence:'))) {
        sawDefence = true
        expect(ids[0]).toBe(ids.includes('defence:dodge') ? 'defence:dodge' : 'defence:defend')
      }
      save = step(save)
    }
    expect(sawAttack && sawDefence).toBe(true)
  })
})

describe('the blow that ended it', () => {
  it('reads in the same four parts every other pill does', () => {
    const pill = killPill(monsterOf('regular'), 12)
    expect(glyphs(pill)).toEqual(['fa-solid fa-user-shield', 'fa-solid fa-cross', 'fa-solid fa-skull'])
    expect(figures(pill)).toEqual(['12'])
    expect(narrationText(parseNarration(pill))).toBe('you killed 12 it')
  })

  it('names a boss as a boss, like every other pill', () => {
    expect(glyphs(killPill(monsterOf('boss'), 9))[2]).toBe('fa-solid fa-dragon')
  })

  it('lands on the SPOILS screen, behind its own line', () => {
    // The round's log is spent at the boundary; the one thing worth carrying
    // across it is how the thing died, and it belongs behind the screen the
    // reader is now looking at rather than in front of it.
    const context = {
      save: emptySave(1), game: null, content: THOCKQUEST, catalog: DEPS.catalog, profile: null, held: [],
    }
    const entered = lootStage.enter(
      { encounterIndex: 2, screensLeft: 1, motes: 1, offersLoot: true, killPill: '[fa-solid fa-user-shield|you] x' },
      context,
      7,
    )
    expect(entered.narration).toEqual(['You go through what is left behind.', '[fa-solid fa-user-shield|you] x'])
  })

  it('is absent when nothing was killed', () => {
    const context = {
      save: emptySave(1), game: null, content: THOCKQUEST, catalog: DEPS.catalog, profile: null, held: [],
    }
    const fled = lootStage.enter(
      { encounterIndex: 2, screensLeft: 1, motes: 1, offersLoot: false, killPill: null },
      context,
      7,
    )
    expect(fled.narration).toBe('It is gone, and it left little.')
  })
})

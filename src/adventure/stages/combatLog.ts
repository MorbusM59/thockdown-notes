// What a fight SAYS, as pills: four glyphs and a number, in one shape that
// never varies.
//
//     [who acted] [what they did] [how much it cost] [who it happened to]
//
// A round is read at a glance or it is not read at all. Prose ("Your blow
// lands home for 8") is one line the reader parses word by word, every
// action, and by the third one they have stopped. The same fact in glyphs is
// a shape they recognise without reading, and the number -- the only part
// that actually varies in a way they must take in -- is the one thing set in
// figures.
//
// THE NUMBER APPEARS ONLY ON A HIT. A miss carries no damage, and printing a
// `0` for it makes the eye stop on a quantity where there is none: the
// difference between something and nothing should be the presence of the
// figure, not its value.
//
// A ROUND'S PILLS ACCUMULATE and are cut back to the status pill when the
// next round opens (see combat.ts). The strip is therefore exactly one
// round's worth of history, oldest at the right -- the fight so far, not the
// fight ever, which no bar could hold.
//
// Every icon here is a `'fa-solid fa-...'` string LITERAL because
// content/icons.contract.test.ts parses these sources for that shape: a Pro
// icon renders as an empty box rather than failing, and two have shipped that
// way already.

import type { Blow, Defence, RoundState } from '../model/combat'
import { monsterActionsLeft, playerActionsLeft } from '../model/combat'
import type { Monster } from '../model/monsters'
import type { Spell } from '../model/spells'
import type { DerivedStats } from '../model/stats'

const PLAYER = 'fa-solid fa-user-shield'
const MONSTER = 'fa-solid fa-skull'
/** A boss is not a bigger skull. It is a different thing arriving. */
const BOSS = 'fa-solid fa-dragon'
const LANDED = 'fa-solid fa-burst'
/** Nothing arrived: a miss, a dodge, a blow turned aside. */
const NOTHING = 'fa-solid fa-wind'
const DEFENDED = 'fa-solid fa-shield'
const FLED = 'fa-solid fa-person-running'
/** The blow that ended it. Not a hit -- hits have their own glyph. */
const KILLED = 'fa-solid fa-cross'
const ACTIONS = 'fa-solid fa-bolt'
const HEALTH = 'fa-solid fa-heart'
/** The clash the round's two sides are mirrored around. */
const VERSUS = 'fa-solid fa-explosion'

/** One glyph, and the word it stands in for. See escapeMenu/narrationMarkup.ts. */
function icon(classes: string, word: string): string {
  return `[${classes}|${word}]`
}

/** A figure, in the bold every number in narration is set in. */
function figure(value: number): string {
  return `**${Math.round(value)}**`
}

export function monsterIcon(monster: Monster): string {
  return monster.type === 'miniBoss' || monster.type === 'boss' ? BOSS : MONSTER
}

/**
 * WHAT THE PLAYER DID, as one glyph -- which is a fact about the action AND
 * its outcome together, because "attacked" and "attacked and missed" are the
 * same decision and different news.
 *
 * The player's own choice names the glyph even when the monster is the one
 * attacking: on their action the reader wants to know what their answer was
 * worth, not that they were hit at (which the pill's direction already says).
 *
 * The WORD, though, is read from whoever is swinging, because the pill's
 * subject is the attacker: a blow that beat a block is "it got through you",
 * never "it blocked you".
 */
function playerActionIcon(action: 'attack' | Defence, blow: Blow | null, escaped: boolean): { icon: string; word: string } {
  const landed = blow?.hit === true
  switch (action) {
    case 'attack':
      return landed ? { icon: LANDED, word: 'hit' } : { icon: NOTHING, word: 'missed' }
    case 'defend':
      // The words read from the ATTACKER, because the pill does: the monster
      // is the subject on every one of these and the player's choice is the
      // verb's shape. "it blocked you" said the opposite of what happened.
      return landed ? { icon: DEFENDED, word: 'got through' } : { icon: NOTHING, word: 'missed' }
    case 'dodge':
      return { icon: NOTHING, word: 'was dodged by' }
    case 'takeTheHit':
      return { icon: LANDED, word: 'hit' }
    case 'flee':
      if (escaped) return { icon: FLED, word: 'lost' }
      return landed ? { icon: LANDED, word: 'caught' } : { icon: NOTHING, word: 'missed' }
  }
}

/** The one shape, assembled once so nothing can quietly build a different one. */
function pill(attacker: string, attackerWord: string, action: { icon: string; word: string }, damage: number | null, defender: string, defenderWord: string): string {
  const parts = [icon(attacker, attackerWord), icon(action.icon, action.word)]
  if (damage !== null) parts.push(figure(damage))
  parts.push(icon(defender, defenderWord))
  return parts.join(' ')
}

/** The player swings. Attacker is the player, defender is whatever is in front of them. */
export function playerAttackPill(monster: Monster, blow: Blow): string {
  const action = playerActionIcon('attack', blow, false)
  return pill(PLAYER, 'you', action, blow.hit ? blow.damage : null, monsterIcon(monster), 'it')
}

/**
 * The monster swings and the player answers. The attacker is the MONSTER --
 * the arrow of the pill is who the damage flowed to -- while the middle glyph
 * is still the player's own choice.
 */
export function monsterAttackPill(monster: Monster, defence: Defence, blow: Blow | null, escaped: boolean): string {
  const action = playerActionIcon(defence, blow, escaped)
  const damage = blow?.hit === true ? blow.damage : null
  return pill(monsterIcon(monster), 'it', action, damage, PLAYER, 'you')
}

/**
 * THE BLOW THAT ENDED IT, in the same four-part shape every other pill uses
 * -- who, what, how much, to whom -- so the kill reads as the last line of
 * the fight rather than as an announcement in a different voice.
 *
 * It is shown on the SPOILS screen, behind that screen's own line, because
 * that is where the reader is by the time the fight is over: the round's log
 * is spent at the boundary, and the one thing worth carrying across it is how
 * the thing died.
 */
export function killPill(monster: Monster, damage: number): string {
  return pill(PLAYER, 'you', { icon: KILLED, word: 'killed' }, damage, monsterIcon(monster), 'it')
}

/**
 * WHERE THE ROUND STARTS, mirrored around the clash: each side's actions at
 * the outer edge and its hit points against the middle, so the two are read
 * as a pair rather than as a row of numbers to be assigned to owners.
 *
 * The counts are the ones LEFT at the moment it is built, which at the head
 * of a round is each side's full pool -- and stays true if it is ever built
 * anywhere else.
 */
export function statusPill(round: RoundState, monster: Monster, playerDerived: DerivedStats): string {
  const monsterHealth = Math.max(0, monster.maxHitPoints - round.monsterDamageTaken)
  return [
    icon(ACTIONS, 'actions'),
    figure(playerActionsLeft(round, playerDerived)),
    icon(PLAYER, 'you'),
    figure(round.playerHitPoints),
    icon(HEALTH, 'hit points'),
    icon(VERSUS, 'versus'),
    icon(HEALTH, 'hit points'),
    figure(monsterHealth),
    icon(monsterIcon(monster), 'it'),
    figure(monsterActionsLeft(round, monster)),
    icon(ACTIONS, 'actions'),
  ].join(' ')
}

/**
 * A SPELL, in the same four-part shape every other pill has -- who, what, how
 * much, to whom -- with the spell's own glyph in the action slot.
 *
 * ONE function for a cast and for a tick, because they are the same sentence:
 * the player is the source either way, and a Plague biting at the end of a
 * round is no less the player's doing for having been set up three rounds
 * ago. A spell that only laid a condition on passes `null` and shows no
 * number, exactly as a missed attack does.
 */
export function spellPill(spell: Spell, monster: Monster, damage: number | null): string {
  return pill(PLAYER, 'you', { icon: spell.icon, word: spell.name }, damage, monsterIcon(monster), 'it')
}

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

import type { Blow, BlowMath, Defence, RoundState } from '../model/combat'
import { monsterActionsLeft, playerActionsLeft } from '../model/combat'
import type { Monster } from '../model/monsters'
import type { Roll } from '../core/rng'
import { withDetail } from '../../escapeMenu/narrationMarkup'
import type { Spell } from '../model/spells'
import { CHARM_ICON, type CharmEffect } from '../model/charm'
import { PREPARE_ICON } from '../model/prepare'
import type { DerivedStats } from '../model/stats'

const PLAYER = 'fa-solid fa-user-shield'
const MONSTER = 'fa-solid fa-skull'
/** A boss is not a bigger skull. It is a different thing arriving. */
const BOSS = 'fa-solid fa-dragon'
/**
 * A BLOW THAT ARRIVED, and a blow that arrived HARD. Two marks rather than
 * one: a crit is the thing a whole build can be about, and a reader scanning
 * the log for how a fight went should be able to see them without reading the
 * figures. The burst is the rarer of the two and so keeps the louder glyph.
 */
const LANDED = 'fa-solid fa-gavel'
const CRIT = 'fa-solid fa-burst'

/** Which of the two a blow earned. A blow that is not a crit is an ordinary hit. */
function landedIcon(blow: Blow | null): string {
  return blow?.crit === true ? CRIT : LANDED
}
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
      return landed ? { icon: landedIcon(blow), word: 'hit' } : { icon: NOTHING, word: 'missed' }
    case 'defend':
      // The words read from the ATTACKER, because the pill does: the monster
      // is the subject on every one of these and the player's choice is the
      // verb's shape. "it blocked you" said the opposite of what happened.
      return landed ? { icon: DEFENDED, word: 'got through' } : { icon: NOTHING, word: 'missed' }
    case 'dodge':
      return { icon: NOTHING, word: 'was dodged by' }
    case 'takeTheHit':
      return { icon: landedIcon(blow), word: 'hit' }
    case 'flee':
      if (escaped) return { icon: FLED, word: 'lost' }
      return landed ? { icon: landedIcon(blow), word: 'caught' } : { icon: NOTHING, word: 'missed' }
  }
}

/**
 * THE WORKING, as a tooltip reads it.
 *
 * Every pill documents the arithmetic behind itself, and the shape is one
 * shape: a roll is `rolled|needed` as whole percentages -- "42|65" is "rolled
 * 42, needed under 65" -- and a sum is written out with its terms. The
 * numbers are the ones the fight ACTUALLY used (`Blow.math`), never recomputed
 * from the stats here: a tooltip that derives its own answer is a tooltip
 * that can disagree with the blow it is explaining, which is the one thing it
 * must not do.
 */
function rollLine(label: string, roll: Roll | null): string | null {
  return roll === null ? null : `${label}: ${Math.round(roll.rolled * 100)}|${Math.round(roll.needed * 100)}`
}

/** Every roll a blow took, on one line, in the order they were taken. */
function rollsOf(math: BlowMath): string | null {
  const rolls = [
    rollLine('Dodge', math.dodge),
    rollLine('Hit', math.hit),
    rollLine('Crit', math.crit),
  ].filter((row): row is string => row !== null)
  return rolls.length > 0 ? rolls.join('  ') : null
}

/**
 * What the damage came to, and out of what: the roll, the band it came from,
 * how many draws bought it, then the crit and the armour.
 *
 * `Damage: 13 = 8 (4-8, best of 3) x 2 crit - 3 armour` -- which is the shape
 * the spec asked for, with the band in DAMAGE rather than in shares, because
 * that is the unit the rest of the line is in. A band with no width (a
 * character whose Perception has reached the pivot, model/damageRoll.ts) is
 * left out rather than written as `8-8`: there was nothing to draw.
 */
function damageOf(blow: Blow): string | null {
  if (!blow.hit) return null
  const math = blow.math
  const low = Math.round(math.low)
  const high = Math.round(math.high)
  const rolled = Math.round(math.rolled)
  const banded = low !== high
  const band = banded ? ` (${low}-${high}, best of ${math.rolls})` : ''
  const terms = [`${rolled}${band}`]
  if (math.critMultiplier !== 1) terms.push(`x ${math.critMultiplier} crit`)
  if (math.absorbed > 0) terms.push(`- ${Math.round(math.absorbed)} armour`)
  // The short form only where there is genuinely nothing to show: no band to
  // have been drawn from, no crit, no armour. Testing the TERMS rather than
  // the band threw away the band it had just written, which is how a live
  // run came back reading "Damage: 6" for a blow drawn from five to eight.
  return !banded && terms.length === 1 && rolled === blow.damage
    ? `Damage: ${blow.damage}`
    : `Damage: ${blow.damage} = ${terms.join(' ')}`
}

/**
 * A blow's whole working: what was rolled, and what it came to.
 *
 * A DODGED blow's only number is the roll that put Dodge on the table, taken
 * when the action was armed -- picking Dodge cannot fail, because Dodge being
 * there IS the success, so there is nothing else to show and the pill would
 * otherwise have nothing to say for itself.
 */
export function blowDetail(blow: Blow | null): string[] {
  if (!blow) return []
  return [
    rollsOf(blow.math),
    // A DODGE AND A MISS WEAR THE SAME GLYPH -- both are "nothing arrived",
    // which is the right thing for the pill to say and the wrong thing for
    // the tooltip to leave at that. The rolls alone distinguish them (a
    // dodged blow never took a hit roll), but only for a reader who already
    // knows that, so it is said in words.
    blow.dodged ? 'Dodged, so nothing was rolled to hit' : null,
    damageOf(blow),
  ].filter((row): row is string => row !== null)
}

/** The one shape, assembled once so nothing can quietly build a different one. */
function pill(
  attacker: string,
  attackerWord: string,
  action: { icon: string; word: string },
  damage: number | null,
  defender: string,
  defenderWord: string,
  detail: readonly string[] = [],
): string {
  const parts = [icon(attacker, attackerWord), icon(action.icon, action.word)]
  if (damage !== null) parts.push(figure(damage))
  parts.push(icon(defender, defenderWord))
  return withDetail(parts.join(' '), detail)
}

/**
 * The player swings. Attacker is the player, defender is whatever is in front
 * of them.
 *
 * A CLASS MOVE'S NAME goes on the DETAIL, not the glyph. The middle icon is
 * the vocabulary the reader has already learned -- a hit, a crit, a miss --
 * and a move that swapped it for a mark of its own would make every class a
 * new alphabet. The name rides in the tooltip's first line, where "Haymaker"
 * explains the number without competing with it.
 */
export function playerAttackPill(monster: Monster, blow: Blow, moveName?: string): string {
  const action = playerActionIcon('attack', blow, false)
  const detail = moveName ? [moveName, ...blowDetail(blow)] : blowDetail(blow)
  return pill(PLAYER, 'you', action, blow.hit ? blow.damage : null, monsterIcon(monster), 'it', detail)
}

/**
 * A DEFENSIVE MOVE STRUCK BACK. The arrow runs from the player, because the
 * damage did -- it is the player's blow, taken as part of answering one.
 */
export function ripostePill(monster: Monster, blow: Blow, moveName: string): string {
  const action = playerActionIcon('attack', blow, false)
  return pill(PLAYER, 'you', action, blow.hit ? blow.damage : null, monsterIcon(monster), 'it', [moveName, ...blowDetail(blow)])
}

/**
 * The monster swings and the player answers. The attacker is the MONSTER --
 * the arrow of the pill is who the damage flowed to -- while the middle glyph
 * is still the player's own choice.
 */
export function monsterAttackPill(
  monster: Monster,
  defence: Defence,
  blow: Blow | null,
  escaped: boolean,
  /** The monster's roll to chase a fleeing player, where one was taken. */
  pursuit: Roll | null = null,
): string {
  const action = playerActionIcon(defence, blow, escaped)
  const damage = blow?.hit === true ? blow.damage : null
  return pill(monsterIcon(monster), 'it', action, damage, PLAYER, 'you', [
    ...(rollLine('Pursuit', pursuit) ? [rollLine('Pursuit', pursuit)!] : []),
    ...blowDetail(blow),
  ])
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
  return pill(PLAYER, 'you', { icon: KILLED, word: 'killed' }, damage, monsterIcon(monster), 'it', [
    `The blow that finished it: ${damage}`,
  ])
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
export function spellPill(
  spell: Spell,
  monster: Monster,
  damage: number | null,
  detail: readonly string[] = [],
): string {
  return pill(PLAYER, 'you', { icon: spell.icon, word: spell.name }, damage, monsterIcon(monster), 'it', [
    ...spell.lines,
    ...detail,
  ])
}

/** Poison's own mark. One glyph for both directions; the pill says which. */
const POISON = 'fa-solid fa-skull-crossbones'

/**
 * POISON BITING when the round turns over, in the same four-part shape every
 * other pill has. `source` is who LAID it, so the arrow points the way the
 * damage travels and a poisonous monster reads as the subject of its own
 * sentence.
 */
export function poisonPill(monster: Monster, damage: number, source: 'player' | 'monster'): string {
  const detail = ['Poison, paid at the end of every round', 'Armor does not see it']
  return source === 'player'
    ? pill(PLAYER, 'you', { icon: POISON, word: 'poisoned' }, damage, monsterIcon(monster), 'it', detail)
    : pill(monsterIcon(monster), 'it', { icon: POISON, word: 'poisoned' }, damage, PLAYER, 'you', detail)
}

/**
 * WHAT THE ROUND IS UNDER: one pill for however many charm effects came up,
 * with the count beside the mask.
 *
 * One pill rather than one each, because they are not three things that
 * happened -- they are one thing that is true of this round, and a bar that
 * spent three of its pills saying so would have no room left for the fight.
 * The NAMES ride on the glyph's own word, strongest first, which is what the
 * pill's tooltip reads out (escapeMenu/narrationMarkup.ts: an icon carries
 * its own word, and that word is the only place a glyph can say what it
 * means).
 */
export function charmStatusPill(effects: readonly CharmEffect[], checkChance: number): string {
  return withDetail(
    `${icon(CHARM_ICON, effects.map((effect) => effect.name).join(', '))} ${figure(effects.length)}`,
    [
      `Each of its actions: ${Math.round(checkChance * 100)}% to be taken`,
      ...effects.map((effect) => `${effect.name} - ${effect.line}`),
    ],
  )
}

/**
 * A CHARM FIRING, in the four-part shape, with the mask where the action
 * glyph goes -- because that is exactly what happened: the monster's action
 * was the thing that went wrong for it.
 *
 * The three read differently in the last two slots, and each says what it is:
 * a lost action arrives at the player with nothing in hand, a confusion
 * carries a number back to the monster itself, and a doom ends at the cross.
 */
export function charmPill(effect: CharmEffect, monster: Monster, damage: number, roll: Roll): string {
  const mask = { icon: CHARM_ICON, word: effect.name }
  const it = monsterIcon(monster)
  const detail = [rollLine('Charm', roll)!, effect.line]
  switch (effect.outcome) {
    case 'lostAction':
      return pill(it, 'it', mask, null, PLAYER, 'you', detail)
    case 'turnedOnItself':
      return pill(it, 'it', mask, damage, it, 'itself', [...detail, `Damage: ${damage}, its own blow, and it cannot miss itself`])
    case 'died':
      return pill(it, 'it', mask, null, KILLED, 'died', [...detail, `It had ${damage} left`])
  }
}

/**
 * TAKING AIM: the one action that does nothing now, said in the same shape as
 * everything that does.
 */
export function preparePill(monster: Monster, detail: readonly string[] = []): string {
  return pill(PLAYER, 'you', { icon: PREPARE_ICON, word: 'take aim at' }, null, monsterIcon(monster), 'it', detail)
}

/**
 * ITS ROUND, TAKEN AWAY -- by a Meteor or by a prepared blow that staggered
 * it. ONE glyph for both, because they are one thing happening: an effect the
 * reader cannot see is an effect that is not there, and two marks for it
 * would be two things to learn.
 */
export const STUN_ICON = 'fa-solid fa-ban'

export function stunPill(monster: Monster): string {
  return pill(PLAYER, 'you', { icon: STUN_ICON, word: 'ended the round of' }, null, monsterIcon(monster), 'it', [
    'Every action it had left is spent',
  ])
}

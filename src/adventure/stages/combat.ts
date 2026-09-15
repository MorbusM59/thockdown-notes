// A fight, one action at a time.
//
// The round engine (`model/combat.ts`) decides everything; this stage's whole
// job is to turn each of its steps into ONE ring question and to carry the
// answer back. That is why nothing here loops: every action in a round is a
// choice the player makes, their own offensively and the monster's
// reactively, so the stage must come to rest between each of them.
//
// THE ROUND'S LOG IS THIS STAGE'S OWN. Every action prepends a pill to it
// (combatLog.ts) and the next round opens by cutting it back to a single
// status pill, so the bar carries exactly one round of history, newest at the
// head. It lives in stage state rather than in the director because WHEN a
// log is spent is a rule about rounds, and the director holds no rules --
// see core/stage.ts on why narration is handed back whole instead of appended.
//
// TWO THINGS ARE ROLLED AND STORED, never rolled while presenting: whose
// action it is, and whether Dodge is on the table. `present` gets no random
// state (see core/stage.ts), and a choice that appeared because a roll had
// already succeeded is the platform's own rule -- picking Dodge cannot fail,
// because Dodge being there IS the success.

import type { JsonObject } from '../core/json'
import type { StageModule, Transition } from '../core/stage'
import type { RngState } from '../core/rng'
import type { StageContext } from '../core/stage'
import type { Effect } from '../model/effects'
import { NO_ARMOR } from '../model/armor'
import {
  beginRound, combatStatus, DEFENCES, defencesOffered, resolveMonsterAttack,
  resolvePlayerAttack, rollActor, rollDodgeOffered, roundFromJson, roundToJson,
  UNTOUCHED_FIGHT, type Defence, type RoundState,
} from '../model/combat'
import {
  castSpell, endOfRoundTicks, igniteTick, rollSpellReach, SPELLS, spellsOffered, type Spell,
} from '../model/spells'
import { rewardFor } from '../model/rewards'
import { killPill, monsterAttackPill, playerAttackPill, spellPill, statusPill } from './combatLog'
import type { Monster } from '../model/monsters'
import { monsterFor, offerFromJson, offerToJson } from './encounter'
import { COMBAT_STAGE_ID, ENCOUNTER_SELECT_STAGE_ID, LOOT_STAGE_ID, WELCOME_STAGE_ID } from './ids'


/**
 * The four answers, with the SAME glyphs the round's pills use for them: the
 * cell you pressed and the pill it produced are the one vocabulary, so a
 * reader learns each mark once. `fa-wind` on Dodge is the clearest case -- it
 * is "nothing arrives", both as the thing you chose and as the thing that
 * happened.
 */
const DEFENCE_LABELS: Readonly<Record<Defence, { label: string; icon: string }>> = {
  dodge: { label: 'Dodge', icon: 'fa-solid fa-wind' },
  defend: { label: 'Defend', icon: 'fa-solid fa-shield' },
  flee: { label: 'Flee', icon: 'fa-solid fa-person-running' },
  takeTheHit: { label: 'Take the hit', icon: 'fa-solid fa-user' },
}

const ATTACK_ICON = 'fa-solid fa-burst'

/** One id shape for every spell cell, so `present` and `resolve` cannot disagree. */
function spellChoiceId(spell: Spell): string {
  return `spell:${spell.id}`
}

interface CombatState extends JsonObject {
  offer: JsonObject
  round: JsonObject
  /** Whose action this is. Null only where there is no profile to roll one for. */
  actor: 'player' | 'monster' | null
  dodgeOffered: boolean
  /** This round's pills, newest first. Cut back to the status pill each round. */
  log: string[]
}

function readState(state: JsonObject): CombatState {
  return {
    offer: (typeof state.offer === 'object' && state.offer !== null && !Array.isArray(state.offer) ? state.offer : {}) as JsonObject,
    round: (typeof state.round === 'object' && state.round !== null && !Array.isArray(state.round) ? state.round : {}) as JsonObject,
    actor: state.actor === 'player' || state.actor === 'monster' ? state.actor : null,
    dodgeOffered: state.dodgeOffered === true,
    log: Array.isArray(state.log) ? state.log.filter((entry): entry is string => typeof entry === 'string') : [],
  }
}

/** Rolls whose action is next, and Dodge's availability when it turns out to be the monster's. */
function armNextAction(
  round: RoundState,
  monster: Monster,
  context: StageContext,
  rng: RngState,
): { actor: 'player' | 'monster' | null; dodgeOffered: boolean; rng: RngState } {
  const derived = context.profile?.derived
  if (!derived) return { actor: null, dodgeOffered: false, rng }
  const picked = rollActor(round, monster, derived, rng)
  if (picked.actor !== 'monster') return { actor: picked.actor, dodgeOffered: false, rng: picked.rng }
  // The player's own dodge, with their own adjustment: an item that says
  // "+10% dodge" has to move the roll that decides whether Dodge is on the
  // table, or it moves nothing at all (model/chance.ts).
  const dodge = rollDodgeOffered({
    defenderStats: context.profile?.stats ?? monster.stats,
    attackerStats: monster.stats,
    adjustment: context.profile?.chances.dodgeChance,
    defender: 'player',
    successAdjust: context.game?.successAdjust,
    rng: picked.rng,
  })
  return { actor: 'monster', dodgeOffered: dodge.offered, rng: dodge.rng }
}

/**
 * What the RECORD has to be told about an action, on top of what the round
 * state already knows.
 *
 * The round is the fight's working copy -- it has to be, because a fight is
 * resolved a step at a time and the engine takes the whole state as one
 * value. But the game record is what survives the fight, so damage and armor
 * decay are mirrored onto it as they happen. Without this the round would
 * end and every blow taken would evaporate with it.
 */
function recordChanges(before: RoundState, after: RoundState): Effect[] {
  const effects: Effect[] = []
  const damage = before.playerHitPoints - after.playerHitPoints
  if (damage !== 0) effects.push({ kind: 'adjustHitPoints', amount: -damage })
  if (
    after.playerArmor.fromItems !== before.playerArmor.fromItems
    || after.playerArmor.natural !== before.playerArmor.natural
  ) {
    effects.push({ kind: 'setArmor', fromItems: after.playerArmor.fromItems, natural: after.playerArmor.natural })
  }
  return effects
}

/** Where the fight goes once an action has landed. */
function afterAction(options: {
  state: CombatState
  round: RoundState
  monster: Monster
  context: StageContext
  /**
   * What just happened, NEWEST FIRST, because one action can be several
   * things to say: a monster's blow and the fire it walked into, a bolt and
   * the four times it leapt. They go to the head of the round's log in this
   * order.
   */
  entries: readonly string[]
  effects: readonly Effect[]
  rng: RngState
  /** What this action took off the monster, for the kill pill if it was the last. */
  struck?: number
}): Transition {
  const { state, monster, context } = options
  let round = options.round
  let rng = options.rng
  let struck = options.struck ?? 0
  const derived = context.profile?.derived
  let log = [...options.entries, ...state.log]
  let status = derived ? combatStatus(round, monster, derived) : 'roundOver'

  // THE END OF A ROUND IS AN EVENT, not merely a boundary: the lingering
  // spells pay out here, and either of them can finish the fight. So they are
  // applied BEFORE the fight is asked where it stands again -- a monster that
  // burned to death between rounds is dead, not the opening of another round.
  //
  // Their pills are carried INTO the next round's log rather than left in the
  // one being discarded (see `openRound`), which is also how the reader sees
  // them at all.
  let carried: string[] = []
  if (status === 'roundOver' && derived && context.profile) {
    const ticked = endOfRoundTicks({
      state: round,
      monster,
      playerStats: context.profile.stats,
      playerDerived: derived,
      playerChances: context.profile.chances,
      successAdjust: context.game?.successAdjust,
      rng,
    })
    round = ticked.state
    rng = ticked.rng
    // Newest first, so the last thing that happened reads first.
    carried = ticked.ticks.map((tick) => spellPill(tick.spell, monster, tick.damage)).reverse()
    log = [...carried, ...log]
    if (ticked.ticks.length > 0) struck = ticked.ticks[ticked.ticks.length - 1].damage
    status = combatStatus(round, monster, derived)
  }

  if (status === 'playerDefeated') {
    return {
      kind: 'reset',
      stageId: WELCOME_STAGE_ID,
      narration: log,
      effects: [...options.effects, { kind: 'endGame', reason: 'defeat' }],
      rng,
    }
  }

  if (status === 'playerFled') {
    // Pays nothing and still spends the encounter -- running is a decision,
    // not a free reroll.
    return {
      kind: 'replace',
      stageId: ENCOUNTER_SELECT_STAGE_ID,
      narration: log,
      effects: [...options.effects, { kind: 'advanceEncounter' }],
      rng,
    }
  }

  if (status === 'monstersDefeated' || status === 'monsterFled') {
    const stats = context.profile?.stats
    const reward = stats
      ? rewardFor(stats, monster.type, rng)
      : { reward: { lootScreens: 1, motes: 1 }, rng }
    return {
      kind: 'replace',
      stageId: LOOT_STAGE_ID,
      input: {
        screensLeft: reward.reward.lootScreens,
        motes: reward.reward.motes,
        // A monster that ran is beaten but not searched: the gold branch and
        // no choice at all (see the design plan's payout table).
        offersLoot: status === 'monstersDefeated',
        // The last blow, carried across the boundary that spends the round's
        // log -- the spoils screen shows it behind its own line.
        killPill: status === 'monstersDefeated' ? killPill(monster, struck) : null,
      },
      narration: log,
      effects: options.effects,
      rng: reward.rng,
    }
  }

  // THE ROUND TURNS OVER WITHOUT ASKING. There was a screen here -- one cell,
  // "Begin combat" -- and it asked nothing: the round's actions are restored
  // whatever the player answers, so the only thing it could report was that
  // time had passed, which the status pill now says without spending a press.
  if (status === 'roundOver') {
    return openRound(state, beginRound(round), monster, context, options.effects, rng, carried)
  }

  const next = armNextAction(round, monster, context, rng)
  return {
    kind: 'stay',
    state: { ...state, round: roundToJson(round), actor: next.actor, dodgeOffered: next.dodgeOffered, log },
    effects: options.effects,
    narration: log,
    rng: next.rng,
  }
}

/**
 * A ROUND OPENS: the log is cut back to the status pill and the first action
 * is armed.
 *
 * The one place a round's history is discarded, and the one place the status
 * pill is written -- entering the fight and turning a round over are the same
 * event as far as the reader is concerned, so they are the same code.
 */
function openRound(
  state: CombatState,
  round: RoundState,
  monster: Monster,
  context: StageContext,
  effects: readonly Effect[],
  rng: RngState,
  /** Pills from the moment the last round CLOSED, kept behind the new status pill. */
  carried: readonly string[] = [],
): Transition {
  const opened = beginningOf(state, round, monster, context, rng, carried)
  return { kind: 'stay', state: opened.state, narration: opened.state.log, effects, rng: opened.rng }
}

/**
 * The state a round starts in: what this round HAPPENS TO BE is rolled, the
 * log is cut back to the status pill, and the first action is armed. Shared
 * by `enter` and `openRound`, because entering a fight and turning a round
 * over are the same event.
 *
 * THE ROUND'S HAND IS DEALT HERE and nowhere else -- which spells are in
 * reach (model/spells.ts) and which charms came up (model/charm.ts). Once a
 * round, because the ring's first cell is what a fast player presses and a
 * hand that changed under them mid-round would make that cell a moving
 * target. It is also the only moment a roll of this kind can happen at all:
 * `present` is handed no rng, deliberately (core/stage.ts).
 */
function beginningOf(
  state: CombatState,
  round: RoundState,
  monster: Monster,
  context: StageContext,
  rng: RngState,
  carried: readonly string[] = [],
): { state: CombatState; rng: RngState } {
  const derived = context.profile?.derived
  const dealt = rollSpellReach(context.profile?.stats.intellect ?? 0, rng)
  const opened: RoundState = { ...round, spellReach: dealt.reach }
  const next = armNextAction(opened, monster, context, dealt.rng)
  return {
    state: {
      ...state,
      round: roundToJson(opened),
      actor: next.actor,
      dodgeOffered: next.dodgeOffered,
      log: derived ? [statusPill(opened, monster, derived), ...carried] : [...carried],
    },
    rng: next.rng,
  }
}

export const combatStage: StageModule = {
  id: COMBAT_STAGE_ID,
  title: 'Combat',

  enter: (input, context, rng) => {
    const offer = offerFromJson(input.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = beginRound({
    ...UNTOUCHED_FIGHT,
      playerHitPoints: context.game?.hitPoints ?? 0,
      playerArmor: context.game?.armor ?? NO_ARMOR,
      monsterDamageTaken: 0,
      monsterFleeing: false,
      playerFled: false,
    })
    const base: CombatState = {
      offer: offer ? offerToJson(offer) : {},
      round: roundToJson(round),
      actor: null,
      dodgeOffered: false,
      log: [],
    }
    if (!monster) {
      return { state: base, narration: 'Something is here, and the game cannot say what.', rng }
    }

    // The first round opens exactly as every later one does, with the enemy's
    // NAME behind the status pill -- the one thing in the fight that is worth
    // words, and the only entry that is not a pill of glyphs. It is dropped
    // with the rest of the round's log when the second round opens, by which
    // point the reader knows what they are fighting.
    const opened = beginningOf(base, round, monster, context, rng)
    const log = [...opened.state.log, `**${offer?.name}.** *It has seen you.*`]
    return { state: { ...opened.state, log }, narration: log, rng: opened.rng }
  },

  present: (raw, context) => {
    const state = readState(raw)
    const offer = offerFromJson(state.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = roundFromJson(state.round)

    // No monster, or nobody to roll an action for: the fight cannot proceed
    // and says so with the one cell that gets the player out of it.
    if (!monster || state.actor === null) {
      return { screenKey: 'combat:void', choices: [{ id: 'combat:flee', label: 'Withdraw', icon: 'fa-solid fa-rotate-left' }] }
    }

    if (state.actor === 'player') {
      // STRONGEST FIRST, then the plain attack. The ring opens on its first
      // cell, so the order IS the recommendation -- and a player who presses
      // it every time is playing well, which is the whole point of a fight
      // with this many actions in it. See model/spells.ts on why a spell
      // already in effect is absent rather than offered and wasted.
      const spells = spellsOffered(round.spellReach, round)
      return {
        // The offered set is part of the question, so it is part of the key:
        // the dial has to treat a round that dealt Meteor as a new screen.
        screenKey: `combat:mine:${round.playerActionsSpent}:${round.monsterActionsSpent}:${spells.map((spell) => spell.id).join(',')}`,
        choices: [
          ...spells.map((spell) => ({
            id: spellChoiceId(spell),
            label: spell.name,
            icon: spell.icon,
            detail: { title: spell.name, lines: [...spell.lines] },
          })),
          { id: 'combat:attack', label: 'Attack', icon: ATTACK_ICON },
        ],
      }
    }

    return {
      screenKey: `combat:theirs:${round.playerActionsSpent}:${round.monsterActionsSpent}`,
      // ORDER IS THE DEFAULT. The ring opens on its first cell, so the answer
      // that usually makes sense has to BE first -- Dodge, which costs
      // nothing and takes nothing, then Defend, then the two that give
      // something up. `DEFENCES` is already in that order and
      // `defencesOffered` preserves it; the test says so, because a
      // reordering there would silently change what a fast player presses.
      choices: defencesOffered(state.dodgeOffered).map((defence) => ({
        id: `defence:${defence}`,
        label: DEFENCE_LABELS[defence].label,
        icon: DEFENCE_LABELS[defence].icon,
      })),
    }
  },

  resolve: (raw, choiceId, context, rng) => {
    const state = readState(raw)
    const offer = offerFromJson(state.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = roundFromJson(state.round)

    if (!monster || choiceId === 'combat:flee') {
      return {
        kind: 'replace',
        stageId: ENCOUNTER_SELECT_STAGE_ID,
        effects: [{ kind: 'advanceEncounter' }],
        rng,
      }
    }

    if (choiceId === 'combat:attack' && context.profile) {
      const attack = resolvePlayerAttack({
        state: round,
        monster,
        playerStats: context.profile.stats,
        playerDerived: context.profile.derived,
        playerChances: context.profile.chances,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      // Nothing on the PLAYER changes when they attack, so no record change.
      return afterAction({
        state,
        round: attack.state,
        monster,
        context,
        entries: [playerAttackPill(monster, attack.blow)],
        effects: [],
        rng: attack.rng,
        struck: attack.blow.hit ? attack.blow.damage : 0,
      })
    }

    const spell = SPELLS.find((candidate) => spellChoiceId(candidate) === choiceId)
    if (spell && context.profile) {
      const cast = castSpell({
        spell,
        state: round,
        monster,
        playerStats: context.profile.stats,
        playerDerived: context.profile.derived,
        playerChances: context.profile.chances,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      const dealt = cast.blows.reduce((sum, blow) => sum + blow.damage, 0)
      return afterAction({
        state,
        round: cast.state,
        monster,
        context,
        // ONE PILL however many times a bolt leapt: the reader wants what the
        // cast was worth, and four pills of the same glyph would bury the
        // round's other news under one action's bookkeeping.
        entries: [spellPill(spell, monster, cast.blows.length > 0 ? dealt : null)],
        effects: [],
        rng: cast.rng,
        struck: dealt,
      })
    }

    const defence = DEFENCES.find((candidate) => `defence:${candidate}` === choiceId)
    if (defence && context.profile) {
      const answer = resolveMonsterAttack({
        state: round,
        monster,
        playerStats: context.profile.stats,
        armorDecayFloor: context.profile.armorDecayFloor,
        defence,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      // THE FIRE BITES AFTER IT MOVES, once per stack. It answers the
      // monster's clock rather than the round's, which is what makes Ignite
      // worth more against something fast and worth nothing against
      // something a Meteor has just stunned (model/spells.ts).
      const burned = context.profile
        ? igniteTick(answer.state, context.profile.derived)
        : { state: answer.state, tick: null }
      const entries = [
        ...(burned.tick ? [spellPill(burned.tick.spell, monster, burned.tick.damage)] : []),
        monsterAttackPill(monster, defence, answer.blow, answer.escaped),
      ]
      return afterAction({
        state,
        round: burned.state,
        monster,
        context,
        entries,
        effects: recordChanges(round, answer.state),
        rng: answer.rng,
        struck: burned.tick?.damage ?? 0,
      })
    }

    return { kind: 'stay', state: raw, rng }
  },
}

export { COMBAT_STAGE_ID }

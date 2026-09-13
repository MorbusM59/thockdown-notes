// A fight, one action at a time.
//
// The round engine (`model/combat.ts`) decides everything; this stage's whole
// job is to turn each of its steps into ONE ring question and to carry the
// answer back. That is why nothing here loops: every action in a round is a
// choice the player makes, their own offensively and the monster's
// reactively, so the stage must come to rest between each of them.
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
import { NO_ARMOR, totalArmor } from '../model/armor'
import {
  beginRound, combatStatus, DEFENCES, defencesOffered, resolveMonsterAttack,
  resolvePlayerAttack, rollActor, rollDodgeOffered, type Defence, type RoundState,
} from '../model/combat'
import { rewardFor } from '../model/rewards'
import type { Monster } from '../model/monsters'
import { encounterIndexOf } from './levelProgress'
import { monsterFor, offerFromJson, offerToJson } from './encounter'
import { COMBAT_STAGE_ID, ENCOUNTER_SELECT_STAGE_ID, LOOT_STAGE_ID, WELCOME_STAGE_ID } from './ids'


const DEFENCE_LABELS: Readonly<Record<Defence, { label: string; icon: string }>> = {
  dodge: { label: 'Dodge', icon: 'fa-solid fa-person-running' },
  defend: { label: 'Defend', icon: 'fa-solid fa-shield-halved' },
  flee: { label: 'Flee', icon: 'fa-solid fa-person-walking-arrow-right' },
  takeTheHit: { label: 'Take the hit', icon: 'fa-solid fa-hand-fist' },
}

interface CombatState extends JsonObject {
  encounterIndex: number
  offer: JsonObject
  round: JsonObject
  /** Null between rounds, when the tactical menu is up instead. */
  actor: 'player' | 'monster' | null
  dodgeOffered: boolean
}

function roundToJson(round: RoundState): JsonObject {
  return {
    playerActionsSpent: round.playerActionsSpent,
    monsterActionsSpent: round.monsterActionsSpent,
    playerHitPoints: round.playerHitPoints,
    playerArmorFromItems: round.playerArmor.fromItems,
    playerArmorNatural: round.playerArmor.natural,
    monsterDamageTaken: round.monsterDamageTaken,
    monsterFleeing: round.monsterFleeing,
    playerFled: round.playerFled,
  }
}

function roundFromJson(value: JsonObject['']): RoundState {
  const row = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const num = (key: string) => (typeof row[key] === 'number' ? (row[key] as number) : 0)
  return {
    playerActionsSpent: num('playerActionsSpent'),
    monsterActionsSpent: num('monsterActionsSpent'),
    playerHitPoints: num('playerHitPoints'),
    playerArmor: { fromItems: num('playerArmorFromItems'), natural: num('playerArmorNatural') },
    monsterDamageTaken: num('monsterDamageTaken'),
    monsterFleeing: row.monsterFleeing === true,
    playerFled: row.playerFled === true,
  }
}

function readState(state: JsonObject): CombatState {
  return {
    encounterIndex: encounterIndexOf(state.encounterIndex),
    offer: (typeof state.offer === 'object' && state.offer !== null && !Array.isArray(state.offer) ? state.offer : {}) as JsonObject,
    round: (typeof state.round === 'object' && state.round !== null && !Array.isArray(state.round) ? state.round : {}) as JsonObject,
    actor: state.actor === 'player' || state.actor === 'monster' ? state.actor : null,
    dodgeOffered: state.dodgeOffered === true,
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
  const dodge = rollDodgeOffered(context.profile?.stats ?? monster.stats, monster.stats, picked.rng)
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
function afterAction(
  state: CombatState,
  round: RoundState,
  monster: Monster,
  context: StageContext,
  narration: string,
  effects: readonly Effect[],
  rng: RngState,
): Transition {
  const derived = context.profile?.derived
  const status = derived ? combatStatus(round, monster, derived) : 'roundOver'

  if (status === 'playerDefeated') {
    return {
      kind: 'reset',
      stageId: WELCOME_STAGE_ID,
      narration: `${narration} You do not get up.`,
      effects: [...effects, { kind: 'endGame', reason: 'defeat' }],
      rng,
    }
  }

  if (status === 'playerFled') {
    // Pays nothing and still spends the encounter -- running is a decision,
    // not a free reroll.
    return {
      kind: 'replace',
      stageId: ENCOUNTER_SELECT_STAGE_ID,
      input: { encounterIndex: state.encounterIndex + 1 },
      narration: `${narration} You do not look back.`,
      effects,
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
        encounterIndex: state.encounterIndex,
        screensLeft: reward.reward.lootScreens,
        motes: reward.reward.motes,
        // A monster that ran is beaten but not searched: the gold branch and
        // no choice at all (see the design plan's payout table).
        offersLoot: status === 'monstersDefeated',
      },
      narration,
      effects,
      rng: reward.rng,
    }
  }

  if (status === 'roundOver') {
    return {
      kind: 'stay',
      state: { ...state, round: roundToJson(round), actor: null, dodgeOffered: false },
      narration: `${narration} You both draw breath.`,
      effects,
      rng,
    }
  }

  const next = armNextAction(round, monster, context, rng)
  return {
    kind: 'stay',
    state: { ...state, round: roundToJson(round), actor: next.actor, dodgeOffered: next.dodgeOffered },
    narration,
    effects,
    rng: next.rng,
  }
}

function blowNarration(subject: string, blow: { hit: boolean; crit: boolean; dodged: boolean; damage: number }): string {
  if (blow.dodged) return `${subject} nothing but air.`
  if (!blow.hit) return `${subject} wide.`
  const amount = Math.max(0, Math.round(blow.damage))
  return blow.crit
    ? `${subject} clean through for **${amount}**.`
    : `${subject} home for **${amount}**.`
}

export const combatStage: StageModule = {
  id: COMBAT_STAGE_ID,
  title: 'Combat',

  enter: (input, context, rng) => {
    const encounterIndex = encounterIndexOf(input.encounterIndex)
    const offer = offerFromJson(input.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = beginRound({
      playerHitPoints: context.game?.hitPoints ?? 0,
      playerArmor: context.game?.armor ?? NO_ARMOR,
      monsterDamageTaken: 0,
      monsterFleeing: false,
      playerFled: false,
    })
    return {
      state: {
        encounterIndex,
        offer: offer ? offerToJson(offer) : {},
        round: roundToJson(round),
        // The tactical menu opens the fight: actions are set to maximum when
        // it is answered, not before.
        actor: null,
        dodgeOffered: false,
      } satisfies CombatState,
      narration: monster
        ? `**${offer?.name}.** *It has seen you. ${monster.maxHitPoints} hit points, ${Math.round(monster.damage)} a blow.*`
        : 'Something is here, and the game cannot say what.',
      rng,
    }
  },

  present: (raw, context) => {
    const state = readState(raw)
    const offer = offerFromJson(state.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = roundFromJson(state.round)

    if (!monster) {
      return { screenKey: 'combat:void', choices: [{ id: 'combat:flee', label: 'Withdraw', icon: 'fa-solid fa-rotate-left' }] }
    }

    if (state.actor === null) {
      return {
        screenKey: `combat:tactical:${round.monsterDamageTaken}`,
        choices: [{
          id: 'combat:begin',
          label: 'Begin combat',
          icon: 'fa-solid fa-khanda',
          detail: {
            title: offer?.name ?? 'The enemy',
            lines: [
              `${Math.max(0, monster.maxHitPoints - round.monsterDamageTaken)} hit points left`,
              `${monster.maxActions} action${monster.maxActions === 1 ? '' : 's'} a round`,
              `You: ${round.playerHitPoints} hit points, ${totalArmor(round.playerArmor)} armor`,
            ],
          },
        }],
      }
    }

    if (state.actor === 'player') {
      return {
        screenKey: `combat:mine:${round.playerActionsSpent}:${round.monsterActionsSpent}`,
        choices: [{ id: 'combat:attack', label: 'Attack', icon: 'fa-solid fa-hand-fist' }],
      }
    }

    return {
      screenKey: `combat:theirs:${round.playerActionsSpent}:${round.monsterActionsSpent}`,
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
        input: { encounterIndex: state.encounterIndex + 1 },
        rng,
      }
    }

    if (choiceId === 'combat:begin') {
      const fresh = beginRound(round)
      const next = armNextAction(fresh, monster, context, rng)
      return {
        kind: 'stay',
        state: { ...state, round: roundToJson(fresh), actor: next.actor, dodgeOffered: next.dodgeOffered },
        narration: '**Begin combat:** *Blades up.*',
        rng: next.rng,
      }
    }

    if (choiceId === 'combat:attack' && context.profile) {
      const attack = resolvePlayerAttack({
        state: round,
        monster,
        playerStats: context.profile.stats,
        playerDerived: context.profile.derived,
        rng,
      })
      const narration = `**Attack:** *${blowNarration('Your blow lands', attack.blow)}*`
      // Nothing on the PLAYER changes when they attack, so no record change.
      return afterAction(state, attack.state, monster, context, narration, [], attack.rng)
    }

    const defence = DEFENCES.find((candidate) => `defence:${candidate}` === choiceId)
    if (defence && context.profile) {
      const answer = resolveMonsterAttack({
        state: round,
        monster,
        playerStats: context.profile.stats,
        armorDecayFloor: context.profile.armorDecayFloor,
        defence,
        rng,
      })
      const label = DEFENCE_LABELS[defence].label
      const narration = answer.escaped
        ? `**${label}:** *You break away and it does not follow.*`
        : `**${label}:** *${blowNarration(`${offer?.name ?? 'It'} strikes`, answer.blow ?? { hit: false, crit: false, dodged: true, damage: 0 })}*`
      return afterAction(state, answer.state, monster, context, narration, recordChanges(round, answer.state), answer.rng)
    }

    return { kind: 'stay', state: raw, rng }
  },
}

export { COMBAT_STAGE_ID }

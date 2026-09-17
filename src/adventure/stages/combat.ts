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
import type { RngState, Roll } from '../core/rng'
import type { StageContext } from '../core/stage'
import type { Effect } from '../model/effects'

import { NO_SPELLS } from '../model/spellReach'
import {
  beginRound, combatStatus, DEFENCES, defencesOffered, resolveMonsterAttack,
  resolvePlayerAttack, rollActor, rollDodgeOffered, roundActionPosition, roundFromJson, roundToJson,
  UNTOUCHED_FIGHT, type Defence, type RoundState,
} from '../model/combat'
import { resolveProfile, type EffectiveProfile } from '../model/modifiers'
import { holdingCounts } from '../model/gameState'
import {
  castSpell, endOfRoundTicks, igniteTick, rollSpellReach, SPELLS, spellsOffered, strongestOffered,
  type Spell,
} from '../model/spells'
import { charmCheckChance, charmsOf, interceptMonsterAction, rollCharms } from '../model/charm'
import { rewardFor } from '../model/rewards'
import { PREPARE_ICON, prepareLines, resolvePreparedAttack } from '../model/prepare'
import {
  blowDetail, charmPill, charmStatusPill, killPill, monsterAttackPill, playerAttackPill, preparePill,
  spellPill, statusPill, stunPill,
} from './combatLog'
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

const PREPARE_CHOICE = 'combat:prepare'

/** A stored dodge roll, back as itself. Written by `resting`, read here. */
function readRoll(value: JsonObject | null): Roll | null {
  if (!value) return null
  const { rolled, needed, passed } = value as Record<string, unknown>
  if (typeof rolled !== 'number' || typeof needed !== 'number') return null
  return { rolled, needed, passed: passed === true }
}

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
  /** The roll that put Dodge on the table, so a dodged blow can show its working. */
  dodgeRoll: JsonObject | null
  /** This round's pills, newest first. Cut back to the status pill each round. */
  log: string[]
}

function readState(state: JsonObject): CombatState {
  return {
    offer: (typeof state.offer === 'object' && state.offer !== null && !Array.isArray(state.offer) ? state.offer : {}) as JsonObject,
    round: (typeof state.round === 'object' && state.round !== null && !Array.isArray(state.round) ? state.round : {}) as JsonObject,
    actor: state.actor === 'player' || state.actor === 'monster' ? state.actor : null,
    dodgeOffered: state.dodgeOffered === true,
    dodgeRoll: (typeof state.dodgeRoll === 'object' && state.dodgeRoll !== null && !Array.isArray(state.dodgeRoll)
      ? state.dodgeRoll
      : null) as JsonObject | null,
    log: Array.isArray(state.log) ? state.log.filter((entry): entry is string => typeof entry === 'string') : [],
  }
}

/**
 * What happened when the next action was armed: either there is a question to
 * ask, or a charm already answered it.
 */
type Armed =
  | {
      kind: 'armed'
      actor: 'player' | 'monster' | null
      dodgeOffered: boolean
      dodgeRoll?: Roll | null
      /**
       * The round with this action's own hand in it. `spellReach` is a fact
       * about the ACTION about to be taken, not about the round -- it is
       * NO_SPELLS whenever the question is not the player's, so the field can
       * never claim a hand nobody was dealt.
       */
      round?: RoundState
      rng: RngState
    }
  /** A charm fired: the action is SPENT, the round moved, and nobody was asked. */
  | { kind: 'charmed'; round: RoundState; entry: string; damage: number; rng: RngState }

/**
 * Rolls whose action is next, Dodge's availability when it turns out to be
 * the monster's -- and, before either, whether a charm takes that action away
 * from it (model/charm.ts).
 *
 * THE CHARM IS ROLLED HERE rather than when a defence is answered, and that
 * is the whole reason this function can come back having already advanced the
 * fight. Asking the player to pick a defence and then telling them the blow
 * never came costs a press to learn that nothing happened.
 */
function armNextAction(
  round: RoundState,
  monster: Monster,
  context: StageContext,
  rng: RngState,
): Armed {
  const derived = context.profile?.derived
  if (!derived) return { kind: 'armed', actor: null, dodgeOffered: false, rng }
  const picked = rollActor(round, monster, derived, rng)
  if (picked.actor !== 'monster') {
    // THE HAND IS DEALT PER ACTION. It was dealt per ROUND at first, on the
    // argument that the ring's first cell should not move under a fast
    // player -- which turned out to be the wrong trade: a round that reached
    // Meteor reached it for every action in that round, and a Meteor STREAK
    // is not what a one-in-twelve chance is meant to buy. Rolled here, the
    // table is re-asked every time the player is about to act, which is what
    // `(intellect - level) / 12` reads as a chance OF.
    const dealt = rollSpellReach(context.profile?.stats.intellect ?? 0, picked.rng)
    return {
      kind: 'armed',
      actor: picked.actor,
      dodgeOffered: false,
      round: { ...round, spellReach: picked.actor === 'player' ? dealt.reach : NO_SPELLS },
      rng: picked.actor === 'player' ? dealt.rng : picked.rng,
    }
  }

  if (context.profile) {
    const charmed = interceptMonsterAction({
      state: round,
      monster,
      playerStats: context.profile.stats,
      successAdjust: context.game?.successAdjust,
      rng: picked.rng,
    })
    if (charmed.interception) {
      const { effect, damage, roll, state } = charmed.interception
      return {
        kind: 'charmed',
        round: state,
        entry: charmPill(effect, monster, damage, roll),
        damage,
        rng: charmed.rng,
      }
    }
    // The player's own dodge, with their own adjustment: an item that says
    // "+20% dodge" has to move the roll that decides whether Dodge is on the
    // table, or it moves nothing at all (model/chance.ts).
    //
    // Resolved FOR THIS ACTION (`actingProfile`), because the action about to
    // be armed is a monster's and an item that promises something on the
    // round's first or last action can only reach a defence here -- the
    // defence itself rolls nothing.
    const defending = actingProfile(context, round, monster) ?? context.profile
    const dodge = rollDodgeOffered({
      defenderStats: defending.stats,
      attackerStats: monster.stats,
      adjustment: defending.chances.dodgeChance,
      defender: 'player',
      successAdjust: context.game?.successAdjust,
      rng: charmed.rng,
    })
    return {
      kind: 'armed',
      actor: 'monster',
      dodgeOffered: dodge.offered,
      // The roll that PUT Dodge on the table travels with the action, because
      // it is the only number a dodged blow has to show for itself: picking
      // Dodge cannot fail, so nothing is rolled when the player answers.
      dodgeRoll: dodge.roll,
      round: { ...round, spellReach: NO_SPELLS },
      rng: dodge.rng,
    }
  }

  return {
    kind: 'armed',
    actor: 'monster',
    dodgeOffered: false,
    round: { ...round, spellReach: NO_SPELLS },
    rng: picked.rng,
  }
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
  // PER PIECE, and only the ones that moved: armor belongs to the item now
  // (model/armor.ts), so the fight mirrors back points rather than a pool. The
  // natural pool is not here at all -- nothing can wear it, so there is
  // nothing about it for a fight to report.
  const wasPoints = new Map(before.playerArmor.pieces.map((piece) => [piece.itemId, piece.points]))
  const worn = after.playerArmor.pieces
    .filter((piece) => wasPoints.get(piece.itemId) !== piece.points)
    .map((piece) => ({ itemId: piece.itemId, points: piece.points }))
  if (worn.length > 0) effects.push({ kind: 'setArmor', pieces: worn })
  return effects
}

/**
 * THE PLAYER AS THEY ARE FOR *THIS ACTION*, which is not always the same thing
 * as the player.
 *
 * `context.profile` is resolved once per director tick, in the situation the
 * run is in -- hit points and nothing else. An item that promises something on
 * the round's FIRST or LAST action (model/modifiers.ts's
 * `derivedPercentOnAction`) needs the profile resolved in a situation that
 * knows which action is about to be taken, and only the fight knows that.
 *
 * Resolved HERE and handed to the exchange, rather than the exchange being
 * taught about rounds: the conditional mechanism is `resolveProfile`'s, exactly
 * as the below-hit-points one is, so there is one place where a condition can
 * be got wrong instead of two.
 *
 * The action COUNT it reads is the plain profile's, deliberately: an effect
 * that adds actions on the last action of a round would otherwise be deciding
 * when the last action is.
 */
function actingProfile(context: StageContext, round: RoundState, monster: Monster): EffectiveProfile | null {
  const base = context.profile
  const game = context.game
  if (!base || !game) return base
  const actionPosition = roundActionPosition(round, base.derived, monster)
  if (!actionPosition.first && !actionPosition.last) return base
  return resolveProfile(game.baseStats, context.held, holdingCounts(context.held), {
    hitPoints: game.hitPoints,
    actionPosition,
  })
}

/**
 * HOW MANY TIMES THE FIGHT MAY STEP FORWARD WITHOUT ASKING ANYTHING.
 *
 * A terminator, not a rule, in the same spirit as the bolt's strike cap. Every
 * pass of the loop below either ends the fight, spends one of the monster's
 * actions to a charm, or opens a round -- the first two are bounded by the
 * pools, and opening a round is bounded only while the player has actions to
 * be asked about. A character whose `actionsPerRound` some modifier drove to
 * zero has none, and would open rounds forever. Reaching the bound lands on
 * the same "this fight cannot proceed" screen an absent monster does, which
 * is the honest thing for it to be.
 */
const MAX_AUTOMATIC_STEPS = 64

/**
 * A ROUND OPENS: its hand is dealt, and the log is cut back to what is true
 * of the new round.
 *
 * THE ROUND'S CHARMS ARE ROLLED HERE (model/charm.ts), because being under a
 * charm is a property of the ROUND -- it is what the pill says, and it is
 * what "lasts until the end of the round" means. The SPELL hand is not: it is
 * dealt per action, in `armNextAction`, so that reaching Meteor once is not
 * reaching it for every action of that round.
 *
 * Either way this is the only kind of moment such a roll can happen at all:
 * `present` is handed no rng, deliberately (core/stage.ts).
 *
 * The log becomes the status pill, then the charm pill if the round is under
 * anything, then whatever the last round's closing carried over. Newest
 * first: what is true of this round leads, and what happened at the end of
 * the last one reads behind it.
 */
function openedRound(
  previous: RoundState,
  monster: Monster,
  context: StageContext,
  rng: RngState,
  carried: readonly string[] = [],
): { round: RoundState; log: string[]; rng: RngState } {
  const charmed = rollCharms(context.profile?.stats.charisma ?? 0, rng)
  const round = beginRound({ ...previous, spellReach: NO_SPELLS, charms: charmed.charms })
  const derived = context.profile?.derived
  const effects = charmsOf(round)
  const checkChance = context.profile
    ? charmCheckChance(context.profile.stats, monster, context.game?.successAdjust)
    : 0
  return {
    round,
    log: [
      ...(derived ? [statusPill(round, monster, derived)] : []),
      ...(effects.length > 0 ? [charmStatusPill(effects, checkChance)] : []),
      ...carried,
    ],
    rng: charmed.rng,
  }
}

/**
 * THE FIGHT, STEPPED FORWARD UNTIL SOMETHING HAS TO BE ANSWERED.
 *
 * The stage's whole job in one function: take the round as it now stands and
 * advance it -- through the end of a round, through a new round opening,
 * through any number of actions a charm takes away from the monster -- until
 * it reaches a question for the ring, or an ending.
 *
 * It is a LOOP and it did not used to be, because until charms existed every
 * action either asked something or ended something. A charmed action does
 * neither: it happens, it is worth a pill, and the fight is in exactly the
 * same position afterwards as a fight that has to keep going. Handling that
 * by recursing through `afterAction` would have made "how many things can
 * happen between two presses" a property of the call stack.
 */
function stepFight(options: {
  state: CombatState
  round: RoundState
  monster: Monster
  context: StageContext
  /**
   * What just happened, NEWEST FIRST, because one action can be several
   * things to say: a monster's blow and the fire it walked into, a bolt and
   * the four times it leapt. They go to the head of the round's log.
   */
  entries: readonly string[]
  effects: readonly Effect[]
  rng: RngState
  /** What this action took off the monster, for the kill pill if it was the last. */
  struck?: number
  /**
   * Whether the action that got us here was the MONSTER's. Ignite answers the
   * monster's clock, and this is what tells the one place that applies it.
   */
  monsterActed?: boolean
}): Transition {
  const { state, monster, context } = options
  const derived = context.profile?.derived
  let round = options.round
  let rng = options.rng
  let struck = options.struck ?? 0
  let log = [...options.entries, ...state.log]

  /**
   * THE FIRE BITES AFTER THE MONSTER MOVES, once per stack, and this is the
   * ONE place that says so -- for the blow it swung and for the action a
   * charm took away from it alike. It was applied where a defence was
   * resolved at first, which was the same rule at one of its two call sites:
   * a charmed action is an action the monster took, and a stack that only
   * burned for the ones it got to use would be a different spell against a
   * talkative character.
   *
   * It answers the MONSTER's clock rather than the round's, which is what
   * makes Ignite worth more against something fast and worth nothing at all
   * against something a Meteor has just stunned (model/spells.ts).
   */
  const burn = () => {
    if (!derived) return
    const burned = igniteTick(round, derived)
    if (!burned.tick) return
    round = burned.state
    log = [spellPill(burned.tick.spell, monster, burned.tick.damage, burned.tick.detail), ...log]
    struck = burned.tick.damage
  }

  if (options.monsterActed) burn()
  /** Pills from the moment a round CLOSED, kept behind the next status pill. */
  let carried: string[] = []

  const resting = (
    actor: 'player' | 'monster' | null,
    dodgeOffered: boolean,
    next: RngState,
    dodgeRoll: Roll | null = null,
  ): Transition => ({
    kind: 'stay',
    state: {
      ...state,
      round: roundToJson(round),
      actor,
      dodgeOffered,
      dodgeRoll: dodgeRoll ? { ...dodgeRoll } : null,
      log,
    },
    effects: options.effects,
    narration: log,
    rng: next,
  })

  for (let step = 0; step < MAX_AUTOMATIC_STEPS; step += 1) {
    const status = derived ? combatStatus(round, monster, derived) : 'roundOver'

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

    if (status === 'roundOver') {
      // THE END OF A ROUND IS AN EVENT, not merely a boundary: the lingering
      // spells pay out here (model/spells.ts) and either of them can finish
      // the fight -- so they land before anything asks where the fight stands
      // again, and the loop's next pass is what asks. A monster that burned
      // to death between rounds is dead, not the opening of another round.
      if (derived && context.profile) {
        const ticked = endOfRoundTicks({
          state: round,
          monster,
          playerStats: context.profile.stats,
          playerDerived: derived,
          playerChances: context.profile.chances,
          successAdjust: context.game?.successAdjust,
          rng,
        })
        rng = ticked.rng
        if (ticked.ticks.length > 0) {
          round = ticked.state
          // Newest first, so the last thing that happened reads first. They
          // are CARRIED into the next round's log rather than left in the one
          // about to be discarded, which is the only way the reader sees them.
          const pills = ticked.ticks
            .map((tick) => spellPill(tick.spell, monster, tick.damage, tick.detail))
            .reverse()
          carried = [...pills, ...carried]
          log = [...pills, ...log]
          struck = ticked.ticks[ticked.ticks.length - 1].damage
          continue
        }
      }

      // THE ROUND TURNS OVER WITHOUT ASKING. There was a screen here -- one
      // cell, "Begin combat" -- and it asked nothing: the round's actions are
      // restored whatever the player answers, so the only thing it could
      // report was that time had passed, which the status pill now says
      // without spending a press.
      const opened = openedRound(round, monster, context, rng, carried)
      round = opened.round
      log = opened.log
      rng = opened.rng
      carried = []
      continue
    }

    const armed = armNextAction(round, monster, context, rng)
    rng = armed.rng
    if (armed.kind === 'armed') {
      if (armed.round) round = armed.round
      return resting(armed.actor, armed.dodgeOffered, rng, armed.dodgeRoll ?? null)
    }

    // A charm took the action away from it. Nothing was asked and nothing
    // ended; the fight simply moved, so the loop goes round again -- and the
    // action it lost is still an action it took, so the fire bites for it.
    round = armed.round
    log = [armed.entry, ...log]
    struck = armed.damage
    burn()
  }

  // The bound above, reached. The one screen that gets the player out.
  return resting(null, false, rng)
}

/**
 * The round a transition is carrying, where it has one. A `stay` stores it;
 * everything else already spent it, and the round we opened with is the
 * closest true thing left to store.
 */
function steppedRound(transition: Transition, fallback: RoundState): RoundState {
  return transition.kind === 'stay' ? roundFromJson((transition.state as CombatState).round) : fallback
}

/**
 * THE FIGHT IS OVER AND THE STAGE IS STILL HERE -- reachable only through
 * `enter`, which cannot hand back a transition (see there).
 *
 * One cell, which steps the fight and lets it go where it was already going.
 * Its WORDS are read from the status rather than fixed, because "Withdraw"
 * over a corpse is the one thing this screen must not say.
 */
const SETTLED_CELL: Readonly<Record<string, { label: string; icon: string }>> = {
  monstersDefeated: { label: 'Look it over', icon: 'fa-solid fa-magnifying-glass' },
  monsterFled: { label: 'Let it go', icon: 'fa-solid fa-person-running' },
  playerDefeated: { label: 'Darkness', icon: 'fa-solid fa-skull' },
  playerFled: { label: 'Keep running', icon: 'fa-solid fa-person-running' },
}

const SETTLE_CHOICE = 'combat:settle'

export const combatStage: StageModule = {
  id: COMBAT_STAGE_ID,
  title: 'Combat',

  enter: (input, context, rng) => {
    const offer = offerFromJson(input.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = beginRound({
    ...UNTOUCHED_FIGHT,
      playerHitPoints: context.game?.hitPoints ?? 0,
      playerArmor: context.armor,
      monsterDamageTaken: 0,
      monsterFleeing: false,
      playerFled: false,
    })
    const base: CombatState = {
      offer: offer ? offerToJson(offer) : {},
      round: roundToJson(round),
      actor: null,
      dodgeOffered: false,
      dodgeRoll: null,
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
    const opened = openedRound(round, monster, context, rng, [`**${offer?.name}.** *It has seen you.*`])
    // Stepped, not merely armed: a charm can take the very first action of
    // the fight, and something has to resolve it.
    const stepped = stepFight({
      state: { ...base, log: opened.log },
      round: opened.round,
      monster,
      context,
      entries: [],
      effects: [],
      rng: opened.rng,
    })
    if (stepped.kind !== 'stay') {
      // A FIGHT THAT WAS OVER BEFORE IT BEGAN. A Doom on the opening action is
      // the one way there is, and `enter` cannot hand back a transition -- the
      // platform's own shape, since entering a stage is not answering one. So
      // the round is stored where it stopped and the fight comes to rest on a
      // finished state, which `present` and `resolve` both know how to read
      // (see `SETTLED_CELL`). Nothing is lost: the monster is dead on the
      // round's terms and the very next press pays out for it.
      return {
        state: { ...base, round: roundToJson(steppedRound(stepped, opened.round)), log: opened.log },
        narration: opened.log,
        rng: opened.rng,
      }
    }
    return { state: stepped.state as CombatState, narration: stepped.narration ?? opened.log, rng: stepped.rng }
  },

  present: (raw, context) => {
    const state = readState(raw)
    const offer = offerFromJson(state.offer)
    const monster = offer ? monsterFor(offer, context) : null
    const round = roundFromJson(state.round)

    // No monster, or nobody to roll an action for: the fight cannot proceed
    // and says so with the one cell that gets the player out of it.
    if (!monster) {
      return { screenKey: 'combat:void', choices: [{ id: 'combat:flee', label: 'Withdraw', icon: 'fa-solid fa-rotate-left' }] }
    }

    const settled = context.profile ? SETTLED_CELL[combatStatus(round, monster, context.profile.derived)] : undefined
    if (settled) {
      return { screenKey: 'combat:settled', choices: [{ id: SETTLE_CHOICE, label: settled.label, icon: settled.icon }] }
    }

    if (state.actor === null) {
      return { screenKey: 'combat:void', choices: [{ id: 'combat:flee', label: 'Withdraw', icon: 'fa-solid fa-rotate-left' }] }
    }

    if (state.actor === 'player') {
      // STRONGEST FIRST, then the plain attack. The ring opens on its first
      // cell, so the order IS the recommendation -- and a player who presses
      // it every time is playing well, which is the whole point of a fight
      // with this many actions in it. See model/spells.ts on why a spell
      // already in effect is absent rather than offered and wasted.
      const spells = spellsOffered(round.spellReach, round)
      const stats = context.profile?.stats
      const rider = strongestOffered(round.spellReach)
      const aimed = round.prepared > 0 && stats
        ? { title: 'Attack', lines: prepareLines(stats, rider, round.prepared) }
        : undefined
      return {
        // The offered set is part of the question, so it is part of the key:
        // the dial has to treat a round that dealt Meteor as a new screen --
        // and an attack that is loaded as a different question from one that
        // is not.
        screenKey: `combat:mine:${round.playerActionsSpent}:${round.monsterActionsSpent}:${spells.map((spell) => spell.id).join(',')}:aimed${round.prepared}`,
        choices: [
          ...spells.map((spell) => ({
            id: spellChoiceId(spell),
            label: spell.name,
            icon: spell.icon,
            detail: { title: spell.name, lines: [...spell.lines] },
          })),
          // LOADED says so on the cell, and says HOW loaded: a banked
          // preparation is worth nothing the player cannot see, and with them
          // stacking the count is the whole of what pressing this is worth.
          {
            id: 'combat:attack',
            label: round.prepared > 1
              ? `Attack, aimed ×${round.prepared}`
              : (round.prepared === 1 ? 'Attack, aimed' : 'Attack'),
            icon: ATTACK_ICON,
            detail: aimed,
          },
          // LAST, and always there: preparations stack, so a second one is
          // never a wasted action. Its detail promises what the NEXT one
          // would make the attack worth, not what one of them is.
          ...(stats
            ? [{
                id: PREPARE_CHOICE,
                label: 'Prepare',
                icon: PREPARE_ICON,
                detail: { title: 'Prepare', lines: prepareLines(stats, rider, round.prepared + 1) },
              }]
            : []),
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

    if (monster && choiceId === SETTLE_CHOICE) {
      // Nothing new happened; the fight is simply asked again where it stands,
      // and the loop takes it where it was already going.
      return stepFight({ state, round, monster, context, entries: [], effects: [], rng })
    }

    if (!monster || choiceId === 'combat:flee') {
      return {
        kind: 'replace',
        stageId: ENCOUNTER_SELECT_STAGE_ID,
        effects: [{ kind: 'advanceEncounter' }],
        rng,
      }
    }

    if (monster && choiceId === PREPARE_CHOICE && context.profile) {
      // The action is spent here and nothing else happens -- which is the
      // whole of what Prepare is.
      return stepFight({
        state,
        round: { ...round, prepared: round.prepared + 1, playerActionsSpent: round.playerActionsSpent + 1 },
        monster,
        context,
        entries: [preparePill(monster, context.profile
          ? prepareLines(context.profile.stats, strongestOffered(round.spellReach), round.prepared + 1)
          : [])],
        effects: [],
        rng,
      })
    }

    const acting = monster ? actingProfile(context, round, monster) : context.profile

    if (choiceId === 'combat:attack' && round.prepared > 0 && acting) {
      const aimed = resolvePreparedAttack({
        state: round,
        monster,
        playerStats: acting.stats,
        playerDerived: acting.derived,
        playerChances: acting.chances,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      const dealt = [...aimed.blows, ...(aimed.rider?.blows ?? [])]
        .reduce((sum, blow) => sum + blow.damage, 0)
      return stepFight({
        state,
        round: aimed.state,
        monster,
        context,
        // NEWEST FIRST, and in the order they happened: the swings, then the
        // stagger, then the spell that rode along.
        entries: [
          ...(aimed.rider
            ? [spellPill(
                aimed.rider.spell,
                monster,
                aimed.rider.blows.reduce((sum, blow) => sum + blow.damage, 0),
                aimed.rider.blows.flatMap((blow) => blowDetail(blow)),
              )]
            : []),
          ...(aimed.stunned ? [stunPill(monster)] : []),
          ...aimed.blows.map((blow) => playerAttackPill(monster, blow)).reverse(),
        ],
        effects: [],
        rng: aimed.rng,
        struck: dealt,
      })
    }

    if (choiceId === 'combat:attack' && acting) {
      const attack = resolvePlayerAttack({
        state: round,
        monster,
        playerStats: acting.stats,
        playerDerived: acting.derived,
        playerChances: acting.chances,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      // Nothing on the PLAYER changes when they attack, so no record change.
      return stepFight({
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
    if (spell && acting) {
      const cast = castSpell({
        spell,
        state: round,
        monster,
        playerStats: acting.stats,
        playerDerived: acting.derived,
        playerChances: acting.chances,
        successAdjust: context.game?.successAdjust,
        rng,
      })
      const dealt = cast.blows.reduce((sum, blow) => sum + blow.damage, 0)
      return stepFight({
        state,
        round: cast.state,
        monster,
        context,
        // ONE PILL however many times a bolt leapt: the reader wants what the
        // cast was worth, and four pills of the same glyph would bury the
        // round's other news under one action's bookkeeping.
        entries: [
          ...(cast.stunned ? [stunPill(monster)] : []),
          spellPill(
            spell,
            monster,
            cast.blows.length > 0 ? dealt : null,
            // The spell's own working, then each blow's. A cast that only
            // laid a condition on has no blow to explain and says what the
            // condition now comes to instead.
            [...cast.detail, ...cast.blows.flatMap((blow) => blowDetail(blow))],
          ),
        ],
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
        defence,
        dodgeRoll: readRoll(state.dodgeRoll),
        successAdjust: context.game?.successAdjust,
        rng,
      })
      return stepFight({
        state,
        round: answer.state,
        monster,
        context,
        entries: [monsterAttackPill(monster, defence, answer.blow, answer.escaped, answer.pursuit)],
        effects: recordChanges(round, answer.state),
        rng: answer.rng,
        // The fire bites after it moves, and `stepFight` is the one place
        // that knows -- see `burn` there.
        monsterActed: true,
      })
    }

    return { kind: 'stay', state: raw, rng }
  },
}

export { COMBAT_STAGE_ID }

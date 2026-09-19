// The only React in the adventure module, and the only file that knows the
// game is played through the escape-hold ring.
//
// Everything above it (core/, model/, content/, stages/) is pure data and
// pure functions; everything below it (EscapeHoldPanel.tsx and the two
// bars) knows about modes, cells and status but nothing about adventures.
// This file is the hinge, and it is deliberately the only file that would
// have to change to play the same game somewhere else.
//
// It owns no state. The save lives in App.tsx alongside every other
// persisted value, because it must reach disk the moment it changes
// (CLAUDE.md, on the two halves of state persistence) and a hook keeping
// its own copy would be a second source of truth for it. Whether the game
// is on screen is not this hook's either: that is App's `adventureView`, a
// slot-level view exactly like the User Guide's, which is what makes the
// game appear over an EMPTY editor rather than on top of somebody's note.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  EMPTY_ESCAPE_MENU_CONTRIBUTION,
  type EscapeMenuCell,
  type EscapeMenuContribution,
  type EscapeMenuMode,
} from '../escapeMenu/escapeMenuContract'
import { catalogFor, THOCKQUEST } from './content'
import { choose, currentScreen, enterEntryScreen, enterInterlude, type DirectorDeps } from './core/director'
import { activeGame, emptySave, withKeepMark, type GameSave } from './model/gameState'
import { boundaryKeyFor } from './model/autoAdvance'
import { COMBAT_STAGE_ID } from './stages/ids'
import { roundFromJson } from './model/combat'
import type { Modifier, ModifierKind } from './model/modifiers'
import { createSeed } from './core/rng'
import { ROOT_STAGE_ID, STAGES } from './stages'
import { FAME_STAGE_ID, STAT_POINT_STAGE_ID } from './stages/ids'
import { chromeAction, chromeBarToggle, chromeGauges, chromeIdentity, chromeMeters, chromeStrip, chromeToggle, statusReadouts } from './chrome'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  rootStageId: ROOT_STAGE_ID,
}

/**
 * The catalog of the run currently open. NOT a module constant, which is what
 * it was: items are rolled from the run's own seed (content/index.ts's
 * `catalogFor`), so one built at import time would describe whichever game
 * happened to be open first and go on describing it forever. `catalogFor`
 * memoizes per seed, so asking every render costs a map lookup.
 */
function catalogOf(save: GameSave): ReadonlyMap<string, Modifier> {
  const game = save.games.find((candidate) => candidate.id === save.activeGameId)
  return catalogFor(THOCKQUEST, game?.seed ?? 0)
}

export interface AdventureEscapeMenuOptions {
  /**
   * Whether the game currently owns an editor slot (App's `adventureView`).
   * Everything this hook produces is gated on it: the ring's takeover, and
   * the status the tab and chapter bars show around the empty editor.
   */
  isAdventureViewActive: boolean
  /** The persisted save, or null before anything has ever been played. */
  save: GameSave | null
  /**
   * Commits a save. Called after every choice, and the caller persists
   * immediately -- a choice the player made and the app then forgot is the
   * one failure this module cannot recover from.
   */
  onCommitSave: (save: GameSave) => void
  /**
   * Closes the whole adventure view, giving the slot back whatever it held.
   * Leaving is a slot-level act, not a menu-level one: dismissing the ring
   * alone just lowers it over a game still in progress. The save is
   * untouched -- the same right-click drops straight back into the same
   * screen, which is the whole promise the persisted stack exists to keep.
   */
  onLeave: () => void
}

/**
 * WHICH ROUND THE FIGHT IS ON, or null when there is no fight.
 *
 * Read out of the combat frame's own state rather than tracked beside it:
 * the round belongs to the fight, and a copy kept here would be a second
 * answer that goes stale the moment a round turns over without this hook
 * re-rendering. Null is the honest answer everywhere else and is what makes
 * a combat-scoped hold decline to start outside one.
 */
function roundNumberOf(save: GameSave, stageId: string): number | null {
  if (stageId !== COMBAT_STAGE_ID) return null
  const frame = save.director.stack[save.director.stack.length - 1]
  if (!frame || frame.stageId !== COMBAT_STAGE_ID) return null
  return roundFromJson(frame.state.round as never).roundNumber
}

export function useAdventureEscapeMenu(options: AdventureEscapeMenuOptions): EscapeMenuContribution {
  const { isAdventureViewActive, save, onCommitSave, onLeave } = options

  // Read through refs by the opening effect below, so that effect can depend
  // on the OPENING alone. Depending on the save would re-run it after every
  // choice -- which is the whole failure `enterEntryScreen` documents --
  // and depending on the callback would make correctness hinge on how well
  // the caller memoizes it.
  const saveRef = useRef(save)
  saveRef.current = save
  const commitRef = useRef(onCommitSave)
  commitRef.current = onCommitSave

  /**
   * OPENING the view puts the entry screen on top of whatever was there.
   *
   * Once per opening, which is why this effect depends on nothing but the
   * opening: it is an event, not a condition to be maintained. Entering a
   * stage may roll, and a roll during render would make the draw order
   * depend on how many times React re-rendered -- the one thing a replayable
   * game cannot survive (core/rng.ts) -- so it happens here rather than in
   * the render below.
   */
  useEffect(() => {
    if (!isAdventureViewActive) return
    const now = Date.now()
    const current = saveRef.current ?? emptySave(createSeed(now))
    const opened = enterEntryScreen(current, DEPS, now)
    if (opened !== current || saveRef.current === null) commitRef.current(opened)
  }, [isAdventureViewActive])

  const handleChoice = useCallback(
    (choiceId: string) => {
      if (!save) return
      const result = choose(save, choiceId, DEPS, Date.now())
      if (result.save !== save) onCommitSave(result.save)
      if (result.hostAction === 'leave') onLeave()
    },
    [save, onCommitSave, onLeave],
  )

  /**
   * Marking what to carry into the next level. A host action rather than a
   * stage choice -- the strip's pills are pressed directly, and nothing about
   * the game's sequence changes when one is (see escapeMenuContract.ts's
   * `onActivate`).
   */
  const handleKeep = useCallback(
    (kind: ModifierKind, modifierId: string) => {
      if (!save) return
      const next = withKeepMark(save, kind, modifierId)
      if (next !== save) onCommitSave(next)
    },
    [save, onCommitSave],
  )

  /**
   * Pressing one of the rail's two gauges: open the screen where that gauge's
   * points are spent, on top of whatever is on screen.
   *
   * A host action rather than a stage choice, like `handleKeep` beside it --
   * but for a different reason, and the difference is the whole of why the
   * contract admits it (escapeMenuContract.ts's `EscapeMenuChromeGaugeAction`).
   * A keep mark changes nothing about the game's sequence; this does put a
   * screen up. What keeps it out of the ring is that it is not a decision: it
   * is a way IN to where the decision is taken, from the place the quantity
   * is already reported.
   *
   * Which stage each gauge opens is decided HERE rather than in chrome.ts,
   * which assembles numbers and has no business naming stages.
   */
  const handleGaugeOpen = useCallback(
    (gauge: 'fame' | 'statPoint') => {
      if (!save) return
      const next = enterInterlude(save, gauge === 'fame' ? FAME_STAGE_ID : STAT_POINT_STAGE_ID, DEPS, Date.now())
      if (next !== save) onCommitSave(next)
    },
    [save, onCommitSave],
  )

  const activeMode = useMemo<EscapeMenuMode | null>(() => {
    if (!isAdventureViewActive || !save) return null
    const screen = currentScreen(save, DEPS)
    if (!screen) return null

    const cells: EscapeMenuCell[] = screen.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      icon: choice.icon,
      // The stage already computed this, against the state the player is
      // actually in (model/modifiers.ts renders "+10% damage" as "+10% damage
      // (3 held)"). It used to be dropped here for want of anywhere to put
      // it -- see EscapeMenuCellDetail.
      detail: choice.detail,
      // A way back sounds like a backspace rather than an Enter. Carried
      // through from the stage that authored the choice -- the ring never
      // guesses which cells mean back (escapeMenu/menuSounds.ts).
      isBack: choice.isBack,
      // Every cell keeps the menu up: the ring IS the game, and a choice
      // that closed it would end the session rather than advance it. The
      // one exception is leaving, which the director reports as a host
      // action instead -- so even that is not the cell's own decision.
      keepsMenuOpen: true,
      onSelect: () => handleChoice(choice.id),
    }))

    /**
     * HOW FAR HOLDING SPACE CARRIES, as a key that changes when it should
     * stop (model/autoAdvance.ts). Null where the reader asked for nothing,
     * or where the scope is a combat one and this is not a fight.
     *
     * The ROUND NUMBER is read out of the combat stage's own frame rather
     * than tracked here: it is the fight's state and the fight is the only
     * thing that can say what round it is on.
     */
    const game = activeGame(save)
    const boundaryKey = game
      ? boundaryKeyFor(save.settings.autoAdvanceScope, {
        stageId: screen.stageId,
        level: game.level,
        encounter: game.encounterIndex,
        roundNumber: roundNumberOf(save, screen.stageId),
      })
      : null

    return {
      id: 'adventure',
      stepKey: screen.screenKey,
      cells,
      ...(boundaryKey === null
        ? {}
        : { autoAdvance: { intervalMs: save.settings.autoAdvanceMs, boundaryKey } }),
      // The ring IS the game, so lowering it leaves the game. Anything else
      // leaves the slot occupied by an empty editor with the toggle lit --
      // a view the player can see the effects of but not reach.
      onDismiss: onLeave,
      status: {
        // THE GAME'S NAME, capital Q. This pill says what the slot is
        // holding, and its neighbour in that role is "User Guide" -- a proper
        // name there too, rather than a category. "Adventure" was the kind of
        // thing rather than the thing, which is only the right answer while
        // there is more than one game to be playing. It clips at 120px;
        // "ThockQuest" is ten characters.
        title: 'ThockQuest',
        narration: screen.narration,
        readouts: statusReadouts(save, THOCKQUEST),
        // The stage names itself; the identity line does not keep a table
        // of names that could fall out of step with the registry.
        identity: chromeIdentity(save, STAGES.get(screen.stageId)?.title ?? ''),
        barToggle: chromeBarToggle(),
        meters: chromeMeters(save),
        strip: chromeStrip(save, catalogOf(save), handleKeep),
        gauges: chromeGauges(save, handleGaugeOpen),
        // RESERVED, not omitted. The game has claimed neither button, and
        // the editor's own must not show through -- but an omitted position
        // closes the gap it holds and moves its neighbours. See chrome.ts.
        toggle: chromeToggle(),
        action: chromeAction(),
      },
    }
  }, [isAdventureViewActive, save, handleChoice, handleKeep, handleGaugeOpen, onLeave])

  return useMemo<EscapeMenuContribution>(
    () => (activeMode ? { entryCells: [], activeMode } : EMPTY_ESCAPE_MENU_CONTRIBUTION),
    [activeMode],
  )
}

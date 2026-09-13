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
import { buildCatalog, THOCKQUEST } from './content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from './core/director'
import { emptySave, type GameSave } from './model/gameState'
import { createSeed } from './core/rng'
import { ROOT_STAGE_ID, STAGES } from './stages'
import { chromeAction, chromeGauges, chromeIdentity, chromeMeters, chromeStrip, chromeToggle, statusReadouts } from './chrome'

const CATALOG = buildCatalog(THOCKQUEST)

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  catalog: CATALOG,
  rootStageId: ROOT_STAGE_ID,
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

  const activeMode = useMemo<EscapeMenuMode | null>(() => {
    if (!isAdventureViewActive || !save) return null
    const screen = currentScreen(save, DEPS)
    if (!screen) return null

    const cells: EscapeMenuCell[] = screen.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      icon: choice.icon,
      // Every cell keeps the menu up: the ring IS the game, and a choice
      // that closed it would end the session rather than advance it. The
      // one exception is leaving, which the director reports as a host
      // action instead -- so even that is not the cell's own decision.
      keepsMenuOpen: true,
      onSelect: () => handleChoice(choice.id),
    }))

    return {
      id: 'adventure',
      stepKey: screen.screenKey,
      cells,
      // The ring IS the game, so lowering it leaves the game. Anything else
      // leaves the slot occupied by an empty editor with the toggle lit --
      // a view the player can see the effects of but not reach.
      onDismiss: onLeave,
      status: {
        // "Adventure" rather than the game's name: this pill says what KIND
        // of thing the slot is holding (its neighbour in that role is "User
        // Guide"), and it clips at 120px.
        title: 'Adventure',
        headline: screen.narration,
        readouts: statusReadouts(save, CATALOG),
        // The stage names itself; the identity line does not keep a table
        // of names that could fall out of step with the registry.
        identity: chromeIdentity(save, STAGES.get(screen.stageId)?.title ?? ''),
        meters: chromeMeters(save),
        strip: chromeStrip(save, CATALOG),
        gauges: chromeGauges(save),
        // RESERVED, not omitted. The game has claimed neither button, and
        // the editor's own must not show through -- but an omitted position
        // closes the gap it holds and moves its neighbours. See chrome.ts.
        toggle: chromeToggle(),
        action: chromeAction(),
      },
    }
  }, [isAdventureViewActive, save, handleChoice, onLeave])

  return useMemo<EscapeMenuContribution>(
    () => (activeMode ? { entryCells: [], activeMode } : EMPTY_ESCAPE_MENU_CONTRIBUTION),
    [activeMode],
  )
}

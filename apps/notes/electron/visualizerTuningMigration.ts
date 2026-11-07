import type { DatabaseService } from './databaseService'
import type { StateService } from './stateService'
import { sanitizeVisualizer } from '@thockdown/look/visualizer'

/**
 * Until 2026-11-07 the visualizer's tuning was part of each layout; it is
 * global now (`PersistedMenuState.visualizer`). A save from before that has
 * none, so the tuning of the layout that was active then, in the light/dark
 * mode the app was in, becomes the global one: what the reader saw last is
 * what they keep. Runs at startup, before the window loads the app state,
 * and writes once; every later launch finds the field and does nothing. A
 * layout with no visualizer (or a factory preset, whose row is rewritten
 * without one on every launch) gives the defaults, which are the factory
 * tuning.
 */
export async function migrateVisualizerTuning(state: StateService, database: DatabaseService): Promise<void> {
  const appState = await state.loadAppState()
  const menu = appState.menu
  if (!menu || menu.visualizer !== undefined) return
  const visualizer = sanitizeVisualizer(database.readActiveLegacyVisualizer(menu.uiMode === 'dark' ? 'dark' : 'light'))
  await state.saveAppState({ ...appState, menu: { ...menu, visualizer } })
}

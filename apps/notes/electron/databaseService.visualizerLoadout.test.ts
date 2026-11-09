// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NEUTRAL_BASE } from '@thockdown/look/presets'
import type { UiLayoutLoadout } from '@thockdown/look/loadouts'
import type { VisualizerColors } from '@thockdown/look/visualizer'
import { DEFAULT_VISUALIZER } from '@thockdown/look/visualizer'
import { StateService } from './stateService'
import { migrateVisualizerTuning } from './visualizerTuningMigration'

/**
 * The visualizer's colours and the caret's follow-the-music switch are
 * layout-scoped, so they ride the UiLayoutLoadout payload through the same
 * two hand-maintained halves the caret's fields do (the normalizer, and the
 * .tdl key list): see databaseService.caretLoadout.test.ts for why both are
 * tested. Its tuning is global (stateService), read out of an older layout
 * once by visualizerTuningMigration.ts.
 */
describe('DatabaseService visualizer loadout', () => {
  let dataRoot: string
  let db: DatabaseService

  // Every field different from NEUTRAL_BASE's, so a dropped one shows.
  const visualizerColors: VisualizerColors = {
    edge: 'rgba(12, 34, 56, 0.5)', pane: 'rgba(200, 100, 50, 0.25)', wave: 'rgba(10, 200, 90, 0.3)',
    pulse: 'rgba(1, 2, 3, 0.4)', accent: 'rgba(250, 20, 120, 1)', letterbox: 'rgba(5, 6, 7, 1)',
  }
  const layout = { ...NEUTRAL_BASE, visualizerColors }

  const activeLight = (service: DatabaseService): UiLayoutLoadout => {
    const entry = service.listUiLoadouts().entries.find((row) => row.id > 0 && row.isActive)
    if (!entry) throw new Error('no active light loadout')
    return entry.payload
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-visualizer-loadout-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('round-trips the visualizer through a real restart', async () => {
    db.updatePendingUiLoadout('light', layout)
    db.saveCustomUiLoadout('light')
    db.close()
    const reopened = new DatabaseService(dataRoot)
    await reopened.initialize()
    try {
      expect(activeLight(reopened)).toMatchObject({ visualizerColors })
    } finally {
      reopened.close()
      db = reopened
    }
  })

  it('carries the visualizer through a .tdl export/import cycle', async () => {
    db.updatePendingUiLoadout('light', layout)
    db.saveCustomUiLoadout('light')
    const tdl = db.buildTdlContent()
    const freshRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-visualizer-tdl-test-'))
    const fresh = new DatabaseService(freshRoot)
    await fresh.initialize()
    try {
      fresh.importTdlLoadouts(tdl)
      const imported = fresh.listUiLoadouts().entries.filter((row) => row.id > 0).map((row) => ({ visualizerColors: row.payload.visualizerColors }))
      expect(imported).toContainEqual({ visualizerColors })
    } finally {
      fresh.close()
      rmSync(freshRoot, { recursive: true, force: true })
    }
  })

  it('makes the active layout\'s visualizer the global one, once, and keeps its colours and switch on the layout', async () => {
    // A layout saved while the visualizer was part of it.
    const legacy = {
      trackers: { thump: { contrast: 0.4, pattern: 0.3 }, pierce: { contrast: 0.2, pattern: 0.5 }, tick: { contrast: 0.6, pattern: 0.9 } },
      caret: { followsMusic: false, effect: -0.3, shape: 0.4, fallSec: 0.6 },
      edge: { effect: -0.7, mix: { thump: 0.4, pierce: 0.6, tick: 0.2 }, shape: -0.8, fallSec: 0.15, color: 'rgba(12, 34, 56, 0.5)', spreadPx: 14, blurPx: 70 },
      pane: { effect: 0.5, mix: { thump: 0, pierce: 0.3, tick: 1 }, shape: 0.7, fallSec: 1.2, color: 'rgba(200, 100, 50, 0.25)' },
      immersive: { glazeStrength: 0.15, waveColor: 'rgba(10, 200, 90, 0.3)', waveBoxes: 40, pulseColor: 'rgba(1, 2, 3, 0.4)', accentColor: '', letterboxColor: 'rgba(5, 6, 7, 1)' },
    }
    db.updatePendingUiLoadout('light', layout)
    db.saveCustomUiLoadout('light')
    // Written raw, as such a row sits in an existing database: the normalizer would drop the legacy field on any write.
    const { visualizerColors: _colors, ...withoutNew } = NEUTRAL_BASE
    const activeId = db.listUiLoadouts().entries.find((row) => row.id > 0 && row.isActive)!.id
    ;(db as unknown as { requireDb(): import('better-sqlite3').Database }).requireDb()
      .prepare('UPDATE ui_loadout_entries SET payloadJson = ? WHERE id = ?')
      .run(JSON.stringify({ ...withoutNew, visualizer: legacy }), activeId)

    // Reopened, as on the first launch after the change.
    db.close()
    db = new DatabaseService(dataRoot)
    await db.initialize()
    expect(activeLight(db)).toMatchObject({
      visualizerColors: { edge: 'rgba(12, 34, 56, 0.5)', pane: 'rgba(200, 100, 50, 0.25)', wave: 'rgba(10, 200, 90, 0.3)', pulse: 'rgba(1, 2, 3, 0.4)', accent: '', letterbox: 'rgba(5, 6, 7, 1)' },
    })

    const state = new StateService(dataRoot)
    await migrateVisualizerTuning(state, db)
    const migrated = (await new StateService(dataRoot).loadAppState()).menu?.visualizer
    expect(migrated?.edge).toEqual({ effect: -0.7, mix: { thump: 0.4, pierce: 0.6, tick: 0.2 }, shape: -0.8, fallSec: 0.15, spreadPx: 14, blurPx: 70 })
    expect(migrated?.trackers).toEqual(legacy.trackers)
    expect(migrated?.immersive).toMatchObject({ glazeStrength: 0.15, waveBoxes: 40 })

    // Once: a later tuning is not overwritten by the layout's.
    const tuned = { ...DEFAULT_VISUALIZER, edge: { ...DEFAULT_VISUALIZER.edge, fallSec: 0.9 } }
    const appState = await state.loadAppState()
    await state.saveAppState({ ...appState, menu: { ...appState.menu!, visualizer: tuned } })
    await migrateVisualizerTuning(state, db)
    expect((await new StateService(dataRoot).loadAppState()).menu?.visualizer).toEqual(tuned)
  })
})

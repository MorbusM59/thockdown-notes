import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NEUTRAL_BASE } from '@thockdown/look/presets'
import type { UiLayoutLoadout } from '@thockdown/look/loadouts'
import type { VisualizerSettings } from '@thockdown/look/visualizer'

/**
 * The visualizer's blocks are layout-scoped, so they ride the UiLayoutLoadout
 * payload through the same two hand-maintained halves the caret's fields do
 * (the normalizer, and the .tdl key list): see
 * databaseService.caretLoadout.test.ts for why both are tested.
 */
describe('DatabaseService visualizer loadout', () => {
  let dataRoot: string
  let db: DatabaseService

  // Every field different from NEUTRAL_BASE's, so a dropped one shows.
  const visualizer: VisualizerSettings = {
    caret: { effect: -0.3, mass: 0.7 },
    shade: { effect: -0.7, source: 'snare', frequencyHz: 90, octaves: 2, contrast: 0.2, mass: 0.3, color: 'rgba(12, 34, 56, 0.5)' },
    outline: { effect: 0.5, source: 'hat', frequencyHz: 8000, octaves: 0.5, contrast: 0.6, mass: 0.9, color: 'rgba(200, 100, 50, 0.25)' },
  }

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
    db.updatePendingUiLoadout('light', { ...NEUTRAL_BASE, visualizer })
    db.saveCustomUiLoadout('light')
    db.close()
    const reopened = new DatabaseService(dataRoot)
    await reopened.initialize()
    try {
      expect(activeLight(reopened).visualizer).toEqual(visualizer)
    } finally {
      reopened.close()
      db = reopened
    }
  })

  it('carries the visualizer through a .tdl export/import cycle', async () => {
    db.updatePendingUiLoadout('light', { ...NEUTRAL_BASE, visualizer })
    db.saveCustomUiLoadout('light')
    const tdl = db.buildTdlContent()
    const freshRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-visualizer-tdl-test-'))
    const fresh = new DatabaseService(freshRoot)
    await fresh.initialize()
    try {
      fresh.importTdlLoadouts(tdl)
      const imported = fresh.listUiLoadouts().entries.filter((row) => row.id > 0).map((row) => row.payload.visualizer)
      expect(imported).toContainEqual(visualizer)
    } finally {
      fresh.close()
      rmSync(freshRoot, { recursive: true, force: true })
    }
  })
})

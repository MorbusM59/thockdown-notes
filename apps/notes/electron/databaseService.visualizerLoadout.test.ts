// verify: reads-temp (scripts/verify.mjs, "what a test reads from disk")
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
    trackers: { kicks: { groove: 0.3, contrast: 0.4 }, hits: { groove: 0.7, contrast: 0.2 }, band: { frequencyHz: 90, octaves: 2, contrast: 0.6 } },
    caret: { followsMusic: true, effect: -0.3, shape: 0.4, fallSec: 0.6 },
    edge: { effect: -0.7, mix: { kicks: 0.4, hits: 0.6, band: 0.2 }, shape: -0.8, fallSec: 0.15, color: 'rgba(12, 34, 56, 0.5)', spreadPx: 14, blurPx: 70 },
    pane: { effect: 0.5, mix: { kicks: 0, hits: 0.3, band: 1 }, shape: 0.7, fallSec: 1.2, color: 'rgba(200, 100, 50, 0.25)' },
    immersive: { glazeStrength: 0.15, glazeSpread: -0.4, swayRangePx: 120, swaySpread: 0.8, swayPush: 4.5, swayReturn: 0.6, swayDrift: -30, waveColor: 'rgba(10, 200, 90, 0.3)', waveBoxes: 40, waveSec: 3.5, waveMix: { kicks: 0.2, hits: 0.9, band: 0.1 }, glazeMix: { kicks: 0.6, hits: 0, band: 0.4 }, pulseMix: { kicks: 0.8, hits: 0.5, band: 0 }, waveTurn: -2, waveShape: -0.4, waveFallSec: 0.5, pulseColor: 'rgba(1, 2, 3, 0.4)', pulseSpeed: 30, pulseHalfLifeSec: 1.2, pulseFadeSec: 0.7, pulseSoftness: 0.3, pulseBoost: 0.4, cutoutRound: 0, accentColor: 'rgba(250, 20, 120, 1)', letterboxColor: 'rgba(5, 6, 7, 1)' },
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

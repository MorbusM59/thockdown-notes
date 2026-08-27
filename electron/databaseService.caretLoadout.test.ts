import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NEUTRAL_BASE } from '../src/shared/presets'
import { DEFAULT_CARET_SETTINGS } from '../src/shared/caretSettings'
import type { UiLayoutLoadout } from '../src/shared/loadouts'

/**
 * The caret's appearance (Options > Caret) is layout-scoped, so it rides the
 * UiLayoutLoadout payload. Two halves of that trip are hand-maintained and can
 * silently drop a field without anything failing loudly:
 *
 *  - `normalizeUiLoadout`'s clamping, which every read and write routes
 *    through -- a field missing there reverts to its default on reload;
 *  - `TDL_SCALAR_KEYS`, the ordered list the .tdl exporter diffs against
 *    NEUTRAL_BASE -- a field missing there exports as if it were never
 *    changed, and re-imports as the default.
 *
 * These cover both, on a real on-disk database read back through a SECOND
 * DatabaseService instance so nothing is being served out of the first one's
 * own cache -- the same "simulate a real restart" shape stateService.test.ts
 * uses for the menu-state side of the same class of bug.
 */
describe('DatabaseService caret loadout fields', () => {
  let dataRoot: string
  let db: DatabaseService

  // Deliberately every caret field, and every one different from NEUTRAL_BASE,
  // so a field dropped anywhere along the way shows up as a mismatch.
  const caretOverrides = {
    caretSizeDeviationPx: -3,
    caretOutlineWidthPx: 4,
    caretOutlineColor: 'rgba(12, 34, 56, 0.78)',
    caretHaloSpreadPx: 17,
    caretHaloBlurPx: 11,
    caretHaloColor: 'rgba(210, 120, 30, 0.4)',
    caretAnimationPreset: 'bounce',
    caretAnimationDurationMs: 2600,
    caretFrameDurationMs: 85,
  } as const satisfies Partial<UiLayoutLoadout>

  const pendingLightPayload = (): UiLayoutLoadout => ({ ...NEUTRAL_BASE, ...caretOverrides })

  const activeLightLoadout = (service: DatabaseService): UiLayoutLoadout => {
    const entry = service.listUiLoadouts().entries.find((row) => row.id > 0 && row.isActive)
    if (!entry) throw new Error('no active light loadout')
    return entry.payload
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-caret-loadout-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('round-trips every caret field through a real restart', async () => {
    db.updatePendingUiLoadout('light', pendingLightPayload())
    db.saveCustomUiLoadout('light')
    db.close()

    const reopened = new DatabaseService(dataRoot)
    await reopened.initialize()
    try {
      expect(activeLightLoadout(reopened)).toMatchObject(caretOverrides)
    } finally {
      reopened.close()
      // afterEach closes `db`; closing twice is not this test's business.
      db = reopened
    }
  })

  it('clamps out-of-range caret values instead of storing them verbatim', async () => {
    db.updatePendingUiLoadout('light', {
      ...NEUTRAL_BASE,
      caretSizeDeviationPx: 99,
      caretOutlineWidthPx: -12,
      caretHaloSpreadPx: 5000,
      caretHaloBlurPx: -4,
      caretAnimationDurationMs: 1,
      caretFrameDurationMs: 100000,
      // A value that is not a known preset key must not reach the stylesheet
      // as an animation name.
      caretAnimationPreset: 'heartbeat; } body { display: none } @keyframes x {',
    })
    db.saveCustomUiLoadout('light')

    const stored = activeLightLoadout(db)
    expect(stored.caretSizeDeviationPx).toBe(5)
    expect(stored.caretOutlineWidthPx).toBe(0)
    expect(stored.caretHaloSpreadPx).toBe(20)
    expect(stored.caretHaloBlurPx).toBe(0)
    expect(stored.caretAnimationDurationMs).toBe(100)
    expect(stored.caretFrameDurationMs).toBe(500)
    expect(stored.caretAnimationPreset).toBe(DEFAULT_CARET_SETTINGS.animationPreset)
  })

  it('carries every caret field through a .tdl export/import cycle', async () => {
    db.updatePendingUiLoadout('light', pendingLightPayload())
    db.saveCustomUiLoadout('light')

    const tdl = db.buildTdlContent()
    // Each caret field differs from NEUTRAL_BASE, so each must appear as a
    // diff line -- this is what catches a key missing from TDL_SCALAR_KEYS.
    for (const key of Object.keys(caretOverrides)) {
      expect(tdl).toContain(`${key}:`)
    }

    const freshRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-caret-tdl-test-'))
    const fresh = new DatabaseService(freshRoot)
    await fresh.initialize()
    try {
      fresh.importTdlLoadouts(tdl)
      const imported = fresh.listUiLoadouts().entries
        .filter((row) => row.id > 0)
        .map((row) => row.payload)
      expect(imported.some((payload) => {
        return Object.entries(caretOverrides)
          .every(([key, value]) => payload[key as keyof UiLayoutLoadout] === value)
      })).toBe(true)
    } finally {
      fresh.close()
      rmSync(freshRoot, { recursive: true, force: true })
    }
  })
})

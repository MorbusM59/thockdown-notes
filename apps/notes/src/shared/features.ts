/**
 * The features a reader can switch off entirely from the toggle bar at the
 * top of Options (`sidebar/FeatureToggleBar.tsx`). A feature that is off is
 * not merely hidden: its options leave the panel, and whatever it runs --
 * listeners, an audio graph, an analysis, an overlay, an animation -- is not
 * started, so it costs nothing. Each feature's consumer reads its flag here
 * and is responsible for that teardown; this module only says which are on.
 *
 * These are app-wide, not part of a layout: a layout decides how a feature
 * looks or sounds (a layout may still choose silent keys, or a glaze at zero
 * opacity), the toggle decides whether the feature exists at all. Persisted
 * as one record on `PersistedMenuState.features`, so a new feature is one id
 * here and touches no schema. Kept free of the DOM so the main process's
 * `sanitizeMenu` can use it.
 */

export const FEATURE_IDS = ['spellCheck', 'customCursor', 'keySounds', 'visualizer', 'glaze', 'caretBlink'] as const

export type FeatureId = typeof FEATURE_IDS[number]

export type FeatureToggles = Record<FeatureId, boolean>

export const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  spellCheck: false,
  customCursor: true,
  keySounds: true,
  visualizer: false,
  glaze: true,
  caretBlink: true,
}

/**
 * Reads the persisted record, falling back for a save written before it
 * existed to the separate fields that held four of these flags then
 * (`spellCheckEnabled`, `customCursorEnabled`, `beat.enabled`, and
 * `reducedCaretAnimation`, which is the inverse of `caretBlink`), so an
 * upgrade keeps what the reader had chosen.
 */
export function sanitizeFeatureToggles(menu: unknown): FeatureToggles {
  const source = (menu && typeof menu === 'object' ? menu : {}) as Record<string, unknown>
  const stored = (source.features && typeof source.features === 'object' ? source.features : null) as Record<string, unknown> | null
  const beat = (source.beat && typeof source.beat === 'object' ? source.beat : {}) as Record<string, unknown>
  const legacy: Partial<Record<FeatureId, unknown>> = {
    spellCheck: source.spellCheckEnabled,
    customCursor: source.customCursorEnabled,
    visualizer: beat.enabled,
    caretBlink: typeof source.reducedCaretAnimation === 'boolean' ? !source.reducedCaretAnimation : undefined,
  }
  const result = { ...DEFAULT_FEATURE_TOGGLES }
  for (const id of FEATURE_IDS) {
    const value = stored ? stored[id] : legacy[id]
    if (typeof value === 'boolean') result[id] = value
  }
  return result
}

/**
 * Beat pulse: the caret and the active editor's inner shade pulsing with the
 * bass of the playing music (Options > Tools). The model is
 * `sound/musicBeat.ts` and the channels `flow/useBeatFeedback.ts`; this file
 * is only the persisted shape, its defaults and its sanitizer, kept free of
 * the DOM so the main process's `sanitizeMenu` can use it too.
 */

export interface BeatSettings {
  enabled: boolean
  /** Strength of the caret's pulse at a full beat, 0..1. */
  caret: number
  /** Strength of the inner shade's pulse at a full beat, 0..1. */
  shade: number
}

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  enabled: false,
  caret: 0.6,
  shade: 0.6,
}

function ratio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

export function sanitizeBeatSettings(input: unknown): BeatSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BeatSettings, unknown>>
  const d = DEFAULT_BEAT_SETTINGS
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : d.enabled,
    caret: ratio(source.caret, d.caret),
    shade: ratio(source.shade, d.shade),
  }
}

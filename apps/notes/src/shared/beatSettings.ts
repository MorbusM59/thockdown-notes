/**
 * The visualizer's settings that are NOT part of a layout (the rest is
 * `@thockdown/look/visualizer`, saved with the layout): the visual delay,
 * which belongs to the output device rather than to a look. Whether the
 * visualizer is on at all is a feature toggle (shared/features.ts). Kept free of the DOM so the main process's `sanitizeMenu` can use it.
 */

export interface BeatSettings {
  /**
   * Milliseconds the visualizer is drawn later than the music is heard, per
   * output device (`sound/outputDevice.ts` names it), on top of the latency
   * the audio stack reports: a wireless headset's delay is often not
   * reported at all. A device with no entry is at 0. Negative draws earlier.
   */
  delayMsByDevice: Record<string, number>
}

export const BEAT_DELAY_MIN_MS = -200
export const BEAT_DELAY_MAX_MS = 500

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  delayMsByDevice: {},
}

export function sanitizeBeatSettings(input: unknown): BeatSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BeatSettings, unknown>>
  return {
    delayMsByDevice: sanitizeDelays(source.delayMsByDevice),
  }
}

function sanitizeDelays(input: unknown): Record<string, number> {
  const delays: Record<string, number> = {}
  if (!input || typeof input !== 'object') return delays
  for (const [device, ms] of Object.entries(input)) {
    if (typeof ms === 'number' && Number.isFinite(ms)) delays[device] = Math.round(Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, ms)))
  }
  return delays
}

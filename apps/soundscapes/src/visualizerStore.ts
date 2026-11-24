/**
 * The phone's visualizer settings (`VisualizerSettings`, the desktop's
 * shape, sanitized by the same rule) and its beat settings, kept in the
 * WebView's localStorage like its other preferences. The phone has one
 * output as far as the page can tell, so the beat delay is kept under ''.
 */
import { sanitizeVisualizer, type VisualizerSettings } from '@thockdown/look/visualizer'
import { sanitizeBeatSettings, type BeatSettings } from '@thockdown/visualizer/shared/beatSettings'

const VISUALIZER_KEY = 'thockdown:visualizer'
const BEAT_KEY = 'thockdown:beat'

/** The output device the phone keeps its beat delay under. */
export const PHONE_OUTPUT_DEVICE = ''

/** The visualizer's font on the phone (VisualizerPage.tsx), and the calibration strip's letters with it. */
export const PHONE_VISUALIZER_FONT = { family: "'Kode Mono', monospace", sizePx: 14, boxPx: 18 } as const

function load<T>(key: string, sanitize: (input: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    return sanitize(raw ? JSON.parse(raw) : undefined)
  } catch {
    return sanitize(undefined)
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage refused: the settings last until the app closes.
  }
}

export const loadVisualizerSettings = (): VisualizerSettings => load(VISUALIZER_KEY, sanitizeVisualizer)
export const saveVisualizerSettings = (settings: VisualizerSettings): void => save(VISUALIZER_KEY, settings)
export const loadBeatSettings = (): BeatSettings => load(BEAT_KEY, sanitizeBeatSettings)
export const saveBeatSettings = (settings: BeatSettings): void => save(BEAT_KEY, settings)

/**
 * The phone's visualizer state (`VisualizerState`, the desktop's shape: the
 * settings outside a preset and the visualizer presets, sanitized by the same
 * rules) and its beat settings, kept in the
 * WebView's localStorage like its other preferences. The phone has one
 * output as far as the page can tell, so the beat delay is kept under ''.
 */
import { sanitizeVisualizer } from '@thockdown/look/visualizer'
import { sanitizeVisualizerPresetPreferences, type VisualizerState } from '@thockdown/visualizer/shared/visualizerPresets'
import { sanitizeBeatSettings, type BeatSettings } from '@thockdown/visualizer/shared/beatSettings'
import { DEFAULT_VISUALIZER_BOX_SIZE, visualizerBoxPx } from '@thockdown/visualizer/shared/visualizerBox'

const VISUALIZER_KEY = 'thockdown:visualizer'
const VISUALIZER_PRESETS_KEY = 'thockdown:visualizer-presets'
const BEAT_KEY = 'thockdown:beat'
const VISUALIZER_FONT_SIZE_KEY = 'thockdown:visualizer-font-size'

/** The output device the phone keeps its beat delay under. */
export const PHONE_OUTPUT_DEVICE = ''

/**
 * The visualizer's font on the phone (VisualizerPage.tsx), and the
 * calibration strip's letters with it: Kode Mono, as the desktop's default,
 * at the size the reader sets (Visualizer tab > Font), in DEVICE pixels (the
 * page is drawn at the screen's full resolution), the box the desktop's
 * default multiple of it.
 */
export const VISUALIZER_FONT_SIZE = { min: 8, max: 28, step: 0.5, default: 15 } as const
export interface PhoneVisualizerFont {
  family: string
  sizePx: number
  boxPx: number
}
export function phoneVisualizerFont(sizePx: number): PhoneVisualizerFont {
  return { family: "'Kode Mono', monospace", sizePx, boxPx: visualizerBoxPx(sizePx, DEFAULT_VISUALIZER_BOX_SIZE) }
}
export function sanitizeVisualizerFontSize(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return VISUALIZER_FONT_SIZE.default
  const stepped = Math.round(input / VISUALIZER_FONT_SIZE.step) * VISUALIZER_FONT_SIZE.step
  return Math.min(VISUALIZER_FONT_SIZE.max, Math.max(VISUALIZER_FONT_SIZE.min, stepped))
}

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

export const loadVisualizerState = (): VisualizerState => ({
  base: load(VISUALIZER_KEY, sanitizeVisualizer),
  presets: load(VISUALIZER_PRESETS_KEY, sanitizeVisualizerPresetPreferences),
})
export function saveVisualizerState(state: VisualizerState): void {
  save(VISUALIZER_KEY, state.base)
  save(VISUALIZER_PRESETS_KEY, state.presets)
}
export const loadBeatSettings = (): BeatSettings => load(BEAT_KEY, sanitizeBeatSettings)
export const saveBeatSettings = (settings: BeatSettings): void => save(BEAT_KEY, settings)
export const loadVisualizerFontSize = (): number => load(VISUALIZER_FONT_SIZE_KEY, sanitizeVisualizerFontSize)
export const saveVisualizerFontSize = (sizePx: number): void => save(VISUALIZER_FONT_SIZE_KEY, sizePx)

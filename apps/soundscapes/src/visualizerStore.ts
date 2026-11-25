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
import { DEFAULT_VISUALIZER_FONT, sanitizeVisualizerFont, type VisualizerFont } from '@thockdown/visualizer/shared/visualizerFont'

const VISUALIZER_KEY = 'thockdown:visualizer'
const VISUALIZER_PRESETS_KEY = 'thockdown:visualizer-presets'
const BEAT_KEY = 'thockdown:beat'
const VISUALIZER_FONT_KEY = 'thockdown:visualizer-font'
const VISUALIZER_DOUBLE_KEY = 'thockdown:visualizer-double'

/** The output device the phone keeps its beat delay under. */
export const PHONE_OUTPUT_DEVICE = ''

/** The visualizer's font (Visualizer tab > Font), the desktop's setting and ranges; the phone has one size mode, the desktop's regular one. */
function sanitizePhoneVisualizerFont(input: unknown): VisualizerFont {
  return sanitizeVisualizerFont(input) ?? DEFAULT_VISUALIZER_FONT
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
export const loadVisualizerFont = (): VisualizerFont => load(VISUALIZER_FONT_KEY, sanitizePhoneVisualizerFont)
export const saveVisualizerFont = (font: VisualizerFont): void => save(VISUALIZER_FONT_KEY, font)
/**
 * The visualizer's double size (the dashboard's button beside the
 * orientation): the scene's boxes and letters twice the font setting's, the
 * cutout unchanged, as the desktop's double size mode doubles its scene.
 */
export const loadVisualizerDouble = (): boolean => load(VISUALIZER_DOUBLE_KEY, (input) => input === true)
export const saveVisualizerDouble = (double: boolean): void => save(VISUALIZER_DOUBLE_KEY, double)

import { activePreset, editActivePreset, emptyPresetList, sanitizePresetList, type Preset, type PresetKind, type PresetList } from '@thockdown/interaction/presetList'
import { DEFAULT_VISUALIZER, sanitizeVisualizer, type VisualizerSettings } from '@thockdown/look/visualizer'

/**
 * VISUALIZER PRESETS: named sets of how the visualizer mode looks and moves
 * and what it answers to: its edge, its pane, the glaze, wave and pulse in
 * `immersive`, and the SIGNAL it reads (the full-response level and the
 * three trackers). App-wide, never part of a layout; the layout keeps only
 * the visualizer's colours. Pure, shared by the desktop (Options > Glitz >
 * Visualizer and Beat Detection) and the phone (the Visualizer tab), and
 * with the desktop's main-process state sanitizer.
 *
 * A PRESET LIST (`packages/interaction/presetList.ts`) with ONE factory
 * preset, every setting at its default; the reader's own sit beside it. The
 * live settings ARE the active preset's. Persisted as the menu's
 * `visualizerPresets`.
 *
 * What is NOT in a preset, and why: the beat DELAY (`BeatSettings`), which
 * belongs to the output device rather than to a look; the grid beat
 * (Options > Grid Beat), the editor's own blocks, which live in
 * `VisualizerSettings` too but are tuned for the page rather than the scene;
 * and the visualizer's font, remembered per size mode like every other font.
 * The trackers are read by the grid beat as well, so a preset's signal
 * reaches the editor's blocks too.
 */
export type VisualizerPresetSettings = Pick<VisualizerSettings, 'edge' | 'pane' | 'immersive' | 'trackers' | 'responseDb'>

export const VISUALIZER_PRESET_KEYS = ['edge', 'pane', 'immersive', 'trackers', 'responseDb'] as const satisfies readonly (keyof VisualizerPresetSettings)[]

export function visualizerPresetPart(settings: VisualizerSettings): VisualizerPresetSettings {
  return { edge: settings.edge, pane: settings.pane, immersive: settings.immersive, trackers: settings.trackers, responseDb: settings.responseDb }
}

/** Every setting at its default: the one factory preset, and what the dock's reset writes. */
export const NEUTRAL_VISUALIZER_PRESET: Readonly<VisualizerPresetSettings> = visualizerPresetPart(DEFAULT_VISUALIZER)

export const FACTORY_VISUALIZER_PRESETS: readonly Preset<VisualizerPresetSettings>[] = [
  { id: 'default', name: 'Default', icon: 'fa-circle', settings: NEUTRAL_VISUALIZER_PRESET },
]

export function sanitizeVisualizerPresetSettings(value: unknown): VisualizerPresetSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  // Read through the whole sanitizer with the default trackers present, so
  // its reading of a layout saved before the trackers existed never applies.
  return visualizerPresetPart(sanitizeVisualizer({ ...DEFAULT_VISUALIZER, ...Object.fromEntries(VISUALIZER_PRESET_KEYS.filter((key) => key in input).map((key) => [key, input[key]])) }))
}

export const VISUALIZER_PRESET_KIND: PresetKind<VisualizerPresetSettings> = {
  factory: FACTORY_VISUALIZER_PRESETS,
  defaultId: 'default',
  noun: 'Visualizer',
  maxCustom: 100,
  clone: (settings) => structuredClone(settings),
  sanitizeSettings: sanitizeVisualizerPresetSettings,
}

export type VisualizerPresetPreferences = PresetList<VisualizerPresetSettings>

export const DEFAULT_VISUALIZER_PRESET_PREFERENCES: VisualizerPresetPreferences = emptyPresetList(VISUALIZER_PRESET_KIND)

export function sanitizeVisualizerPresetPreferences(value: unknown): VisualizerPresetPreferences {
  return sanitizePresetList(VISUALIZER_PRESET_KIND, value)
}

/**
 * The visualizer's whole state as an app keeps it: the settings outside a
 * preset (`base`, whose preset fields are only a stale copy) and the presets.
 * One value, so an edit through the merged settings lands in both halves in
 * one update.
 */
export interface VisualizerState {
  base: VisualizerSettings
  presets: VisualizerPresetPreferences
}

export const DEFAULT_VISUALIZER_STATE: VisualizerState = { base: DEFAULT_VISUALIZER, presets: DEFAULT_VISUALIZER_PRESET_PREFERENCES }

/** The settings in force: the base with the active preset's part over it. */
export function shownVisualizer(state: VisualizerState): VisualizerSettings {
  return { ...state.base, ...activePreset(VISUALIZER_PRESET_KIND, state.presets).settings }
}

/**
 * An edit to the settings in force. Only a change to the preset's part is
 * written into the active preset: an edit outside it, or a commit that lands
 * on the value already there, must not mark a factory preset as edited.
 * Compared by value (a few small plain objects, once per commit).
 */
export function editVisualizerState(state: VisualizerState, updater: (previous: VisualizerSettings) => VisualizerSettings): VisualizerState {
  const shown = activePreset(VISUALIZER_PRESET_KIND, state.presets).settings
  const next = updater({ ...state.base, ...shown })
  const presetChanged = VISUALIZER_PRESET_KEYS.some((key) => next[key] !== shown[key] && JSON.stringify(next[key]) !== JSON.stringify(shown[key]))
  return {
    base: next,
    presets: presetChanged ? editActivePreset(VISUALIZER_PRESET_KIND, state.presets, visualizerPresetPart(next)) : state.presets,
  }
}

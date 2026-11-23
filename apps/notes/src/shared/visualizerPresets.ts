import { emptyPresetList, sanitizePresetList, type Preset, type PresetKind, type PresetList } from '@thockdown/interaction/presetList'
import { DEFAULT_VISUALIZER, sanitizeVisualizer, type VisualizerSettings } from '@thockdown/look/visualizer'

/**
 * VISUALIZER PRESETS: named sets of how the visualizer mode looks and moves
 * (Options > Glitz > Visualizer: its edge, its pane, and the glaze, wave and
 * pulse in `immersive`). App-wide, never part of a layout; the layout keeps
 * only the visualizer's colours. Pure, and shared with the main process's
 * state sanitizer.
 *
 * A PRESET LIST (`packages/interaction/presetList.ts`) with ONE factory
 * preset, every setting at its default; the reader's own sit beside it. The
 * live settings ARE the active preset's. Persisted as the menu's
 * `visualizerPresets`.
 *
 * What is NOT in a preset, and why: the trackers (Options > Beat detection)
 * and the grid beat (Options > Grid Beat) live in `VisualizerSettings` too,
 * but are their own subsections and are read outside the visualizer mode;
 * the visualizer's font is remembered per size mode like every other font.
 */
export type VisualizerPresetSettings = Pick<VisualizerSettings, 'edge' | 'pane' | 'immersive'>

export const VISUALIZER_PRESET_KEYS = ['edge', 'pane', 'immersive'] as const satisfies readonly (keyof VisualizerPresetSettings)[]

export function visualizerPresetPart(settings: VisualizerSettings): VisualizerPresetSettings {
  return { edge: settings.edge, pane: settings.pane, immersive: settings.immersive }
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

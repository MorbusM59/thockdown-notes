import { describe, expect, it } from 'vitest'
import { activePreset, createPreset } from '@thockdown/interaction/presetList'
import { DEFAULT_VISUALIZER } from '@thockdown/look/visualizer'
import { DEFAULT_VISUALIZER_PRESET_PREFERENCES, DEFAULT_VISUALIZER_STATE, NEUTRAL_VISUALIZER_PRESET, editVisualizerState, shownVisualizer, VISUALIZER_PRESET_KIND, sanitizeVisualizerPresetPreferences, sanitizeVisualizerPresetSettings } from './visualizerPresets'

describe('visualizer presets', () => {
  it('ships one factory preset holding every default', () => {
    expect(VISUALIZER_PRESET_KIND.factory).toHaveLength(1)
    expect(activePreset(VISUALIZER_PRESET_KIND, DEFAULT_VISUALIZER_PRESET_PREFERENCES).settings).toEqual(NEUTRAL_VISUALIZER_PRESET)
    expect(sanitizeVisualizerPresetSettings(undefined)).toEqual({ edge: DEFAULT_VISUALIZER.edge, pane: DEFAULT_VISUALIZER.pane, immersive: DEFAULT_VISUALIZER.immersive, trackers: DEFAULT_VISUALIZER.trackers, responseDb: DEFAULT_VISUALIZER.responseDb })
  })

  it('survives a save and a load', () => {
    const list = createPreset(VISUALIZER_PRESET_KIND, DEFAULT_VISUALIZER_PRESET_PREFERENCES, 'visualizer-test')!
    const read = sanitizeVisualizerPresetPreferences(JSON.parse(JSON.stringify(list)))
    expect(read).toEqual(list)
    expect(activePreset(VISUALIZER_PRESET_KIND, read).name).toBe('Visualizer A')
  })

  it('writes an edit into the active preset only when it changes the preset part', () => {
    const response = editVisualizerState(DEFAULT_VISUALIZER_STATE, (prev) => ({ ...prev, responseDb: prev.responseDb + 3 }))
    expect(activePreset(VISUALIZER_PRESET_KIND, response.presets).settings.responseDb).toBe(DEFAULT_VISUALIZER.responseDb + 3)
    expect(shownVisualizer(response).responseDb).toBe(DEFAULT_VISUALIZER.responseDb + 3)
    const grid = editVisualizerState(DEFAULT_VISUALIZER_STATE, (prev) => ({ ...prev, grid: { ...prev.grid, dark: { ...prev.grid.dark, edge: { ...prev.grid.dark.edge, effect: 0.5 } } } }))
    expect(grid.presets).toBe(DEFAULT_VISUALIZER_STATE.presets)
    expect(shownVisualizer(grid).grid.dark.edge.effect).toBe(0.5)
  })
})

import { describe, expect, it } from 'vitest'
import { activePreset, createPreset } from '@thockdown/interaction/presetList'
import { DEFAULT_VISUALIZER } from '@thockdown/look/visualizer'
import { DEFAULT_VISUALIZER_PRESET_PREFERENCES, NEUTRAL_VISUALIZER_PRESET, VISUALIZER_PRESET_KIND, sanitizeVisualizerPresetPreferences, sanitizeVisualizerPresetSettings } from './visualizerPresets'

describe('visualizer presets', () => {
  it('ships one factory preset holding every default', () => {
    expect(VISUALIZER_PRESET_KIND.factory).toHaveLength(1)
    expect(activePreset(VISUALIZER_PRESET_KIND, DEFAULT_VISUALIZER_PRESET_PREFERENCES).settings).toEqual(NEUTRAL_VISUALIZER_PRESET)
    expect(sanitizeVisualizerPresetSettings(undefined)).toEqual({ edge: DEFAULT_VISUALIZER.edge, pane: DEFAULT_VISUALIZER.pane, immersive: DEFAULT_VISUALIZER.immersive })
  })

  it('survives a save and a load', () => {
    const list = createPreset(VISUALIZER_PRESET_KIND, DEFAULT_VISUALIZER_PRESET_PREFERENCES, 'visualizer-test')!
    const read = sanitizeVisualizerPresetPreferences(JSON.parse(JSON.stringify(list)))
    expect(read).toEqual(list)
    expect(activePreset(VISUALIZER_PRESET_KIND, read).name).toBe('Visualizer A')
  })
})

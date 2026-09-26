import { describe, expect, it } from 'vitest'
import {
  AMBIENT_FACTORY_PRESETS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  sanitizeAmbientPreferences,
  type AmbientPreset,
} from './ambientSound'
import {
  buildSoundscapeFile,
  mergeImportedSoundscapes,
  neutralSoundscape,
  parseSoundscapeFile,
} from './ambientSoundscapeFile'
import { parsePresetLines } from './presetFile'

const asCustom = (preset: AmbientPreset, index: number): AmbientPreset => ({ ...preset, id: `custom-${index}`, name: `${preset.name} ${index}` })

describe('soundscape files', () => {
  it('bring every soundscape back exactly as it was exported, names included', () => {
    const presets = AMBIENT_FACTORY_PRESETS.map(asCustom)
    const read = parseSoundscapeFile(buildSoundscapeFile(presets))
    expect(read.map((soundscape) => soundscape.name)).toEqual(presets.map((preset) => preset.name))
    read.forEach((soundscape, index) => {
      expect(ambientSettingsSignature(soundscape.settings)).toBe(ambientSettingsSignature(presets[index].settings))
    })
  })

  it('write only what differs from the neutral soundscape', () => {
    const file = buildSoundscapeFile([{ id: 'x', name: 'Silence', settings: neutralSoundscape() }])
    const [line] = parsePresetLines(file, 'NEUTRAL_SOUNDSCAPE')
    expect(line.overrides).toEqual({ name: 'Silence' })
    const rain = buildSoundscapeFile([AMBIENT_FACTORY_PRESETS.find((preset) => preset.id === 'parking')!])
    // Disabled channels at their defaults are not written at all.
    expect(rain).not.toContain('"thunder-1"')
    expect(rain).toContain('"rain-1"')
  })

  it('leave solo out, keep names the format can carry, and read garbage as nothing', () => {
    const soloed = structuredClone(AMBIENT_FACTORY_PRESETS[1])
    soloed.settings.channels[6].solo = true
    const [read] = parseSoundscapeFile(buildSoundscapeFile([{ ...soloed, name: `It's "rain"` }]))
    expect(read.settings.channels.every((channel) => !channel.solo)).toBe(true)
    expect(read.name).toBe('Its rain')
    expect(parseSoundscapeFile('not a soundscape\n1: { ...NEUTRAL_BASE, filterInvert: 1 },')).toEqual([])
  })

  it('clamp what a file says to what the settings allow, and ignore what they do not know', () => {
    const [read] = parseSoundscapeFile(`1: { ...NEUTRAL_SOUNDSCAPE, name: 'Loud', channels: {"rain-1":{"enabled":true,"volume":9,"surface":-3},"ghost-1":{"enabled":true}}, space: {"size":7} },`)
    const rain = read.settings.channels.find((channel) => channel.id === 'rain-1')!
    expect(rain).toMatchObject({ enabled: true, volume: 1, surface: 0 })
    expect(read.settings.channels.some((channel) => channel.id === 'ghost-1')).toBe(false)
    expect(read.settings.space.size).toBe(1)
  })

  it('import as new custom soundscapes, skipping ones already held and stopping at the limit', () => {
    const preferences = sanitizeAmbientPreferences({})
    const existing = { ...preferences, customPresets: [asCustom(AMBIENT_FACTORY_PRESETS[0], 0)] }
    let counter = 0
    const makeId = () => `new-${counter++}`
    const imported = parseSoundscapeFile(buildSoundscapeFile(AMBIENT_FACTORY_PRESETS.map(asCustom)))
    const merged = mergeImportedSoundscapes(existing, imported, makeId)
    // The first is already held (same sound, different name): skipped.
    expect(merged.customPresets.length).toBe(Math.min(MAX_AMBIENT_CUSTOM_PRESETS, AMBIENT_FACTORY_PRESETS.length))
    expect(merged.customPresets[1].id).toBe('new-0')
    expect(merged.activePresetId).toBe(existing.activePresetId)
    const again = mergeImportedSoundscapes(merged, imported, makeId)
    expect(again.customPresets.length).toBe(merged.customPresets.length)
  })
})

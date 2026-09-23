import { useState } from 'react'
import { AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import {
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_LAYER_IDS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  type AmbientLayerId,
  type AmbientPreferences,
  type AmbientPreset,
} from '../shared/ambientSound'

const LAYER_LABELS: Record<AmbientLayerId, string> = {
  wind: 'Wind',
  ocean: 'Ocean',
  rain: 'Rain',
}

const PRESET_ICONS: Record<string, string> = {
  rain: 'fa-cloud-rain',
  ocean: 'fa-water',
  wind: 'fa-wind',
  storm: 'fa-cloud-bolt',
  shore: 'fa-house-flood-water',
  drone: 'fa-cloud',
}

interface AmbientSoundOptionsProps {
  preferences: AmbientPreferences
  onChange: (preferences: AmbientPreferences) => void
}

function copySettings(preset: AmbientPreset) {
  return Object.fromEntries(AMBIENT_LAYER_IDS.map((layerId) => [
    layerId,
    { ...preset.settings[layerId] },
  ])) as AmbientPreset['settings']
}

export function AmbientSoundOptions({ preferences, onChange }: AmbientSoundOptionsProps) {
  const [pendingDeletePresetId, setPendingDeletePresetId] = useState<string | null>(null)
  const allPresets = [...AMBIENT_FACTORY_PRESETS, ...preferences.customPresets]
  const currentSignature = ambientSettingsSignature(preferences.settings)
  const matchingPresets = allPresets.filter((preset) => (
    ambientSettingsSignature(preset.settings) === currentSignature
  ))
  const selectedPresetId = matchingPresets.find((preset) => preset.id === preferences.activePresetId)?.id
    ?? matchingPresets[0]?.id
    ?? null
  const hasPendingChanges = matchingPresets.length === 0
  const canSave = hasPendingChanges && preferences.customPresets.length < MAX_AMBIENT_CUSTOM_PRESETS

  const selectPreset = (preset: AmbientPreset) => {
    onChange({
      ...preferences,
      enabled: true,
      settings: copySettings(preset),
      activePresetId: preset.id,
    })
  }

  const updateLayer = (layerId: AmbientLayerId, key: 'volume' | 'texture', value: number) => {
    const settings = {
      ...preferences.settings,
      [layerId]: { ...preferences.settings[layerId], [key]: value },
    }
    const matchingPreset = allPresets.find((preset) => (
      ambientSettingsSignature(preset.settings) === ambientSettingsSignature(settings)
    ))
    onChange({
      ...preferences,
      settings,
      activePresetId: matchingPreset?.id ?? null,
    })
  }

  const savePreset = () => {
    if (!canSave) return
    const id = `ambient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const saved: AmbientPreset = {
      id,
      name: `Soundscape ${preferences.customPresets.length + 1}`,
      settings: Object.fromEntries(AMBIENT_LAYER_IDS.map((layerId) => [
        layerId,
        { ...preferences.settings[layerId] },
      ])) as AmbientPreset['settings'],
    }
    onChange({
      ...preferences,
      activePresetId: id,
      customPresets: [...preferences.customPresets, saved],
    })
  }

  const deletePreset = (presetId: string) => {
    onChange({
      ...preferences,
      activePresetId: preferences.activePresetId === presetId ? null : preferences.activePresetId,
      customPresets: preferences.customPresets.filter((preset) => preset.id !== presetId),
    })
    setPendingDeletePresetId(null)
  }

  const activatePreset = (preset: AmbientPreset) => {
    if (pendingDeletePresetId === preset.id) {
      deletePreset(preset.id)
      return
    }
    setPendingDeletePresetId(null)
    selectPreset(preset)
  }

  return (
    <AccordionSection
      className="sidebar-options-section-ambient"
      ariaLabel="Ambient Sound"
      heading="Ambient Sound"
      iconClass="fa-water"
      iconTooltip="Procedural ambient layers can play alongside music."
    >
      <div className="utility-setting-slider-stack" aria-label="Ambient sound controls">
        <div className="options-loadout-grid ambient-preset-grid" role="group" aria-label="Factory ambient soundscapes">
          {AMBIENT_FACTORY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn ambient-preset-btn${selectedPresetId === preset.id ? ' is-active' : ''}`}
              aria-label={preset.name}
              aria-pressed={selectedPresetId === preset.id}
              data-tooltip={preset.name}
              onClick={() => activatePreset(preset)}
            >
              <span className={`fa-solid ${PRESET_ICONS[preset.id]}`} aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="options-loadout-grid ambient-custom-presets-grid" role="group" aria-label="Custom ambient soundscapes">
          {preferences.customPresets.map((preset, index) => {
            const number = index + 1
            const isPrimed = pendingDeletePresetId === preset.id
            const label = `Custom soundscape ${number}`
            return (
              <button
                key={preset.id}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn ambient-custom-preset-btn${selectedPresetId === preset.id ? ' is-active' : ''}${isPrimed ? ' primed' : ''}`}
                aria-label={isPrimed ? `Delete ${label}` : label}
                aria-pressed={selectedPresetId === preset.id}
                data-tooltip={isPrimed ? `Click to delete ${label}` : `${label}\nRight-click to mark for deletion, then click.`}
                data-secondary-press="action"
                onClick={() => activatePreset(preset)}
                onMouseLeave={() => setPendingDeletePresetId(null)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setPendingDeletePresetId(preset.id)
                }}
              >
                <span className="options-loadout-index">{number}</span>
              </button>
            )
          })}
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus ambient-custom-preset-plus${hasPendingChanges ? ' is-active' : ''}`}
            aria-label="Save current soundscape as a custom preset"
            data-tooltip={preferences.customPresets.length >= MAX_AMBIENT_CUSTOM_PRESETS
              ? 'Custom soundscape limit reached'
              : hasPendingChanges ? 'Save current soundscape as a custom preset' : 'No unsaved soundscape changes'}
            disabled={!canSave}
            onClick={savePreset}
          >
            <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
          </button>
        </div>

        {AMBIENT_LAYER_IDS.map((layerId) => (
          <div className="ambient-layer-controls" key={layerId}>
            <CompactScrollbarSlider
              id={`ambient-${layerId}-volume`}
              min={0}
              max={1}
              step={0.01}
              value={preferences.settings[layerId].volume}
              trackLabel={`${LAYER_LABELS[layerId].toLowerCase()} level`}
              ariaLabel={`${LAYER_LABELS[layerId]} layer volume`}
              defaultValue={0}
              onCommit={(value) => updateLayer(layerId, 'volume', value)}
            />
            <CompactScrollbarSlider
              id={`ambient-${layerId}-texture`}
              min={0}
              max={1}
              step={0.01}
              value={preferences.settings[layerId].texture}
              trackLabel={`${LAYER_LABELS[layerId].toLowerCase()} texture`}
              ariaLabel={`${LAYER_LABELS[layerId]} layer texture`}
              defaultValue={0.25}
              onCommit={(value) => updateLayer(layerId, 'texture', value)}
            />
          </div>
        ))}

      </div>
    </AccordionSection>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import {
  AMBIENT_DENSITY_MAX,
  AMBIENT_DENSITY_MIN,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_MODULATION_PERIOD_MAX_SEC,
  AMBIENT_NOISE_TYPES,
  AMBIENT_RAIN_DENSITY_MAX,
  AMBIENT_RAIN_DENSITY_MIN,
  AMBIENT_RAIN_DEFAULT_PANS,
  AMBIENT_RAIN_FIRST_INDEX,
  AMBIENT_RAMP_MAX,
  AMBIENT_RAMP_MIN,
  AMBIENT_SHAPE_MAX,
  AMBIENT_SHAPE_MIN,
  AMBIENT_SPEED_MAX_SEC,
  AMBIENT_SPEED_MIN_SEC,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  type AmbientChannelBaseSettings,
  type AmbientChannelSettings,
  type AmbientNoiseChannelSettings,
  type AmbientNoiseType,
  type AmbientPreferences,
  type AmbientPreset,
  type AmbientRainChannelSettings,
  type AmbientSettings,
} from '../shared/ambientSound'
import { armHold, HOLD_CONFIRM_MS } from '../shared/holdTiming'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'

const PRESET_ICONS: Record<string, string> = {
  rain: 'fa-cloud-rain',
  ocean: 'fa-water',
  wind: 'fa-wind',
  storm: 'fa-cloud-bolt',
  shore: 'fa-house-flood-water',
  drone: 'fa-cloud',
}

const RAIN_LAYER_POSITION_NAMES = ['left', 'center', 'right'] as const

interface AmbientSoundOptionsProps {
  preferences: AmbientPreferences
  onChange: (preferences: AmbientPreferences) => void
}

function copySettings(settings: AmbientSettings): AmbientSettings {
  return settings.map((channel) => ({ ...channel, solo: false }))
}

function typeIndex(type: AmbientNoiseType): number {
  return AMBIENT_NOISE_TYPES.indexOf(type)
}

export function AmbientSoundOptions({ preferences, onChange }: AmbientSoundOptionsProps) {
  const [pendingDeletePresetId, setPendingDeletePresetId] = useState<string | null>(null)
  const channelSelectorRef = useRef<HTMLDivElement | null>(null)
  const channelHoldRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const suppressNextContextMenuRef = useRef(false)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    () => preferences.settings[0]?.id ?? null,
  )
  useEffect(() => () => channelHoldRef.current?.cancel(), [])
  const selectedChannel = preferences.settings.find((channel) => channel.id === selectedChannelId)
    ?? preferences.settings[0]
    ?? null
  const selectedChannelIndex = selectedChannel ? preferences.settings.indexOf(selectedChannel) : -1
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
    const soloIndex = preferences.settings.findIndex((channel) => channel.solo)
    const settings = copySettings(preset.settings).map((channel, index) => ({
      ...channel,
      solo: index === soloIndex,
    }))
    onChange({
      ...preferences,
      enabled: true,
      settings,
      activePresetId: preset.id,
    })
  }

  const commitSettings = (settings: AmbientSettings) => {
    const matchingPreset = allPresets.find((preset) => (
      ambientSettingsSignature(preset.settings) === ambientSettingsSignature(settings)
    ))
    onChange({
      ...preferences,
      settings,
      activePresetId: matchingPreset?.id ?? null,
    })
  }

  const updateChannel = (
    channelId: string,
    changes: Partial<Pick<AmbientChannelBaseSettings, 'enabled' | 'volume'>>,
  ) => {
    commitSettings(preferences.settings.map((channel) => (
      channel.id === channelId ? { ...channel, ...changes } : channel
    )))
  }

  const updateNoiseChannel = (
    channelId: string,
    changes: Partial<Omit<AmbientNoiseChannelSettings, keyof AmbientChannelBaseSettings | 'kind'>>,
  ) => {
    commitSettings(preferences.settings.map((channel) => (
      channel.id === channelId && channel.kind === 'noise' ? { ...channel, ...changes } : channel
    )));
  }

  const updateRainChannel = (
    channelId: string,
    changes: Partial<Omit<AmbientRainChannelSettings, keyof AmbientChannelBaseSettings | 'kind'>>,
  ) => {
    commitSettings(preferences.settings.map((channel) => (
      channel.id === channelId && channel.kind === 'rain' ? { ...channel, ...changes } : channel
    )));
  }

  const toggleChannelSolo = (channelId: string) => {
    const channel = preferences.settings.find((item) => item.id === channelId)
    if (!channel) return
    const shouldSolo = !channel.solo
    commitSettings(preferences.settings.map((item) => ({
      ...item,
      solo: item.id === channelId && shouldSolo,
    })))
  }

  const startChannelHold = (channel: AmbientChannelSettings, button: number, pointerId: number) => {
    if ((button === 0 && channel.enabled) || (button === 2 && !channel.enabled)) return
    if (button !== 0 && button !== 2) return
    channelHoldRef.current?.cancel()
    const enabled = button === 0
    const cancel = armHold(() => {
      channelHoldRef.current = null
      if (button === 2) suppressNextContextMenuRef.current = true
      else setSelectedChannelId(channel.id)
      updateChannel(channel.id, { enabled })
    }, HOLD_CONFIRM_MS)
    channelHoldRef.current = { pointerId, cancel }
  }

  const endChannelHold = (pointerId: number) => {
    const hold = channelHoldRef.current
    if (!hold || hold.pointerId !== pointerId) return
    hold.cancel()
    channelHoldRef.current = null
  }

  const handleChannelWheel = useCallback((event: WheelEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLButtonElement>('[data-ambient-channel-id]')
    const channelId = button?.dataset.ambientChannelId
    const channel = preferences.settings.find((item) => item.id === channelId)
    if (!channel?.enabled) return

    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()

    const volume = Math.max(0, Math.min(1, Math.round((channel.volume + (delta < 0 ? 0.05 : -0.05)) * 100) / 100))
    if (volume === channel.volume) return
    const settings = preferences.settings.map((item) => (
      item.id === channel.id ? { ...item, volume } : item
    ))
    const matchingPreset = [...AMBIENT_FACTORY_PRESETS, ...preferences.customPresets].find((preset) => (
      ambientSettingsSignature(preset.settings) === ambientSettingsSignature(settings)
    ))
    onChange({ ...preferences, settings, activePresetId: matchingPreset?.id ?? null })
  }, [onChange, preferences])
  useNonPassiveWheel(channelSelectorRef, handleChannelWheel)

  const savePreset = () => {
    if (!canSave) return
    const id = `ambient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const saved: AmbientPreset = {
      id,
      name: `Soundscape ${preferences.customPresets.length + 1}`,
      settings: copySettings(preferences.settings),
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

  const channel = selectedChannel
  const layerNumber = selectedChannelIndex + 1
  const typeValue = channel?.kind === 'noise' ? typeIndex(channel.type) : 0

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

        <div className="options-loadout-grid ambient-channel-selector" role="group" aria-label="Ambient channels" ref={channelSelectorRef}>
          {Array.from({ length: MAX_AMBIENT_CHANNELS }, (_, index) => {
            const channel = preferences.settings[index]
            const number = index + 1
            const rainLayerPosition = channel?.kind === 'rain'
              ? RAIN_LAYER_POSITION_NAMES[number - AMBIENT_RAIN_FIRST_INDEX - 1]
              : null
            const isSelected = channel?.id === selectedChannel?.id
            return (
              <button
                key={number}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn ambient-channel-selector-btn${isSelected ? ' is-active' : ''}${channel?.enabled ? ' is-enabled' : ' is-disabled'}${channel?.solo ? ' is-solo' : ''}`}
                aria-label={`Ambient channel ${number}${rainLayerPosition ? `, rain ${rainLayerPosition}` : ''}, ${channel?.enabled ? 'enabled' : 'disabled'}${channel?.solo ? ', solo' : ''}`}
                aria-pressed={isSelected}
                data-tooltip={channel
                  ? `${channel.kind === 'rain' ? `Rain layer ${number - AMBIENT_RAIN_FIRST_INDEX} (${rainLayerPosition})` : `Noise layer ${number}`} is ${channel.enabled ? 'enabled' : 'disabled'}${channel.solo ? ', solo' : ''}\n${channel.solo ? 'Right-click to clear solo' : 'Right-click to solo'}; ${channel.enabled
                    ? 'hold right-click to disable; scroll to adjust volume'
                    : 'hold left-click to enable; settings are locked'}`
                  : `Channel ${number} is disabled`}
                data-ambient-channel-id={channel?.id}
                data-secondary-press={channel ? 'action' : 'none'}
                onClick={() => channel && setSelectedChannelId(channel.id)}
                onPointerDown={(event) => channel && startChannelHold(channel, event.button, event.pointerId)}
                onPointerUp={(event) => endChannelHold(event.pointerId)}
                onPointerCancel={(event) => endChannelHold(event.pointerId)}
                onPointerLeave={(event) => endChannelHold(event.pointerId)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (suppressNextContextMenuRef.current) {
                    suppressNextContextMenuRef.current = false
                    return
                  }
                  if (channel) toggleChannelSolo(channel.id)
                }}
              >
                <span className="options-loadout-index">{number}</span>
              </button>
            )
          })}
        </div>

        {channel && (
          <div
            className="ambient-layer-controls"
            key={channel.id}
            role="group"
            aria-label={`${channel.kind === 'rain' ? 'Rain layer' : 'Ambient sound layer'} ${channel.kind === 'rain' ? layerNumber - AMBIENT_RAIN_FIRST_INDEX : layerNumber}${channel.enabled ? '' : ', disabled'}`}
          >
            {channel.kind === 'rain' ? (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-density`}
                  min={AMBIENT_RAIN_DENSITY_MIN}
                  max={AMBIENT_RAIN_DENSITY_MAX}
                  step={1}
                  value={channel.dropsPerSecond}
                  trackLabel="density"
                  tooltipLabel="Rain drops per second"
                  ariaLabel={`Rain layer ${layerNumber - AMBIENT_RAIN_FIRST_INDEX} density`}
                  disabled={!channel.enabled}
                  defaultValue={24}
                  formatValue={(value) => `${Math.round(value)} / s`}
                  onCommit={(value) => updateRainChannel(channel.id, { dropsPerSecond: Math.round(value) })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-distance`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.distance}
                  trackLabel="distance"
                  tooltipLabel="Distance: near and distinct to far and diffuse"
                  ariaLabel={`Rain layer ${layerNumber - AMBIENT_RAIN_FIRST_INDEX} distance`}
                  disabled={!channel.enabled}
                  defaultValue={0.5}
                  formatValue={(value) => value < 0.01 ? 'Near' : value > 0.99 ? 'Far' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateRainChannel(channel.id, { distance: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-pan`}
                  min={-100}
                  max={100}
                  step={1}
                  value={channel.pan * 100}
                  trackLabel="pan"
                  tooltipLabel="Stereo pan from left to right"
                  ariaLabel={`Rain layer ${layerNumber - AMBIENT_RAIN_FIRST_INDEX} pan`}
                  disabled={!channel.enabled}
                  defaultValue={AMBIENT_RAIN_DEFAULT_PANS[layerNumber - AMBIENT_RAIN_FIRST_INDEX - 1] * 100}
                  formatValue={(value) => Math.abs(value) < 1
                    ? 'Center'
                    : `${Math.abs(Math.round(value))}% ${value < 0 ? 'L' : 'R'}`}
                  onCommit={(value) => updateRainChannel(channel.id, { pan: value / 100 })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-bass`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.bassGain}
                  trackLabel="bass"
                  tooltipLabel="Bass impact component level"
                  ariaLabel={`Rain layer ${layerNumber - AMBIENT_RAIN_FIRST_INDEX} bass impact level`}
                  disabled={!channel.enabled}
                  defaultValue={0.55}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateRainChannel(channel.id, { bassGain: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-treble`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.trebleGain}
                  trackLabel="treble"
                  tooltipLabel="Treble splash component level"
                  ariaLabel={`Rain layer ${layerNumber - AMBIENT_RAIN_FIRST_INDEX} treble splash level`}
                  disabled={!channel.enabled}
                  defaultValue={0.45}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateRainChannel(channel.id, { trebleGain: value })}
                />
              </>
            ) : (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-volume`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.volume}
                  trackLabel="vol"
                  tooltipLabel="Volume; scroll the channel button to adjust"
                  ariaLabel={`Ambient layer ${layerNumber} volume`}
                  disabled={!channel.enabled}
                  defaultValue={0}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateChannel(channel.id, { volume: value })}
                />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-mod-amp`}
              min={0}
              max={1}
              step={0.01}
              value={channel.modulationAmplitude}
              trackLabel="mod amp"
              tooltipLabel="Modulation amplitude"
              ariaLabel={`Ambient layer ${layerNumber} modulation amplitude`}
              disabled={!channel.enabled}
              defaultValue={0.25}
              formatValue={(value) => value.toFixed(2)}
              onCommit={(value) => updateNoiseChannel(channel.id, { modulationAmplitude: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-mod-period`}
              min={0}
              max={AMBIENT_MODULATION_PERIOD_MAX_SEC}
              step={0.5}
              value={channel.modulationPeriodSec}
              trackLabel="mod freq"
              tooltipLabel="Modulation period; 0 selects burst mode"
              ariaLabel={`Ambient layer ${layerNumber} modulation period`}
              disabled={!channel.enabled}
              defaultValue={30}
              formatValue={(value) => value === 0 ? 'Burst' : `${value.toFixed(1)} s`}
              onCommit={(value) => updateNoiseChannel(channel.id, { modulationPeriodSec: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-ramp`}
              min={AMBIENT_RAMP_MIN}
              max={AMBIENT_RAMP_MAX}
              step={0.05}
              value={channel.ramp}
              trackLabel="ramp"
              ariaLabel={`Ambient layer ${layerNumber} burst ramp`}
              disabled={!channel.enabled}
              defaultValue={1.5}
              formatValue={(value) => value.toFixed(2)}
              onCommit={(value) => updateNoiseChannel(channel.id, { ramp: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-shape`}
              min={AMBIENT_SHAPE_MIN}
              max={AMBIENT_SHAPE_MAX}
              step={0.01}
              value={channel.shape}
              trackLabel="shape"
              ariaLabel={`Ambient layer ${layerNumber} burst shape`}
              disabled={!channel.enabled}
              defaultValue={0.5}
              formatValue={(value) => value.toFixed(2)}
              onCommit={(value) => updateNoiseChannel(channel.id, { shape: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-speed`}
              min={AMBIENT_SPEED_MIN_SEC}
              max={AMBIENT_SPEED_MAX_SEC}
              step={0.05}
              value={channel.speedSec}
              trackLabel="speed"
              tooltipLabel="Burst duration in seconds"
              ariaLabel={`Ambient layer ${layerNumber} burst duration`}
              disabled={!channel.enabled}
              reverseScale
              defaultValue={0.4}
              formatValue={(value) => `${value.toFixed(2)} s`}
              onCommit={(value) => updateNoiseChannel(channel.id, { speedSec: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-type`}
              min={0}
              max={AMBIENT_NOISE_TYPES.length - 1}
              step={1}
              value={typeValue}
              trackLabel="type"
              tooltipLabel="Noise type"
              ariaLabel={`Ambient layer ${layerNumber} noise type`}
              disabled={!channel.enabled}
              defaultValue={typeIndex('pink')}
              formatValue={(value) => AMBIENT_NOISE_TYPES[Math.round(value)]}
              onCommit={(value) => updateNoiseChannel(channel.id, { type: AMBIENT_NOISE_TYPES[Math.round(value)] })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-density`}
              min={AMBIENT_DENSITY_MIN}
              max={AMBIENT_DENSITY_MAX}
              step={1}
              value={channel.densityPer10Sec}
              trackLabel="density"
              tooltipLabel="Average burst events per 10 seconds"
              ariaLabel={`Ambient layer ${layerNumber} burst density`}
              disabled={!channel.enabled}
              defaultValue={8}
              formatValue={(value) => `${Math.round(value)} / 10 s`}
              onCommit={(value) => updateNoiseChannel(channel.id, { densityPer10Sec: value })}
            />
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-filter`}
              min={0}
              max={1}
              step={0.01}
              value={channel.filter}
              trackLabel="filter"
              tooltipLabel="Low-pass / none / high-pass"
              ariaLabel={`Ambient layer ${layerNumber} filter`}
              disabled={!channel.enabled}
              defaultValue={0.5}
              formatValue={(value) => value === 0.5
                ? 'None'
                : value < 0.5
                  ? `Low-pass ${Math.round((0.5 - value) * 200)}%`
                  : `High-pass ${Math.round((value - 0.5) * 200)}%`}
              onCommit={(value) => updateNoiseChannel(channel.id, { filter: value })}
            />
              </>
            )}
          </div>
        )}

      </div>
    </AccordionSection>
  )
}

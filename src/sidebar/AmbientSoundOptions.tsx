import { useCallback, useEffect, useRef, useState } from 'react'
import { AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import {
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_PERIOD_MAX_SEC,
  AMBIENT_PERIOD_MIN_SEC,
  AMBIENT_NOISE_TYPES,
  AMBIENT_RAIN_DENSITY_MAX,
  AMBIENT_RAIN_DENSITY_MIN,
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_RAIN_FIRST_INDEX,
  AMBIENT_RAIN_SURFACES,
  AMBIENT_SHAPE_MAX,
  AMBIENT_SHAPE_MIN,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  DEFAULT_NOISE_CHANNEL,
  DEFAULT_RAIN_CHANNEL,
  ambientSettingsSignature,
  defaultRainPan,
  type AmbientChannelBaseSettings,
  type AmbientChannelSettings,
  type AmbientNoiseChannelSettings,
  type AmbientNoiseType,
  type AmbientPreferences,
  type AmbientPreset,
  type AmbientRainChannelSettings,
  type AmbientRainSurface,
  type AmbientSettings,
} from '../shared/ambientSound'
import { armHold, HOLD_CONFIRM_MS } from '../shared/holdTiming'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'

const PRESET_ICONS: Record<string, string> = {
  rain: 'fa-cloud-rain',
  street: 'fa-road',
  forest: 'fa-tree',
  storm: 'fa-cloud-bolt',
  ocean: 'fa-water',
  wind: 'fa-wind',
}

const RAIN_LAYER_POSITION_NAMES = ['left', 'center', 'right'] as const

const RAIN_SURFACE_LABELS: Record<AmbientRainSurface, string> = {
  glass: 'Glass',
  street: 'Street',
  forest: 'Forest',
}

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

/**
 * The noise ramp as read on its slider: how far into the sine-to-bell blend
 * the left half is, and how steep the bell is on the right.
 */
function formatNoiseRamp(value: number): string {
  if (value < 0.005) return 'Sine'
  if (value < 0.5) return `Sine → bell ${Math.round((value / 0.5) * 100)}%`
  return `Bell ${Math.round(((value - 0.5) / 0.5) * 100)}%`
}

function surfaceIndex(surface: AmbientRainSurface): number {
  return AMBIENT_RAIN_SURFACES.indexOf(surface)
}

/**
 * New settings, with the active preset re-derived from them: the preset stays
 * selected exactly while the settings still match it. Every edit goes
 * through here, the channel-button wheel included.
 */
function withSettings(
  preferences: AmbientPreferences,
  settings: AmbientSettings,
): AmbientPreferences {
  const signature = ambientSettingsSignature(settings)
  const matchingPreset = [...AMBIENT_FACTORY_PRESETS, ...preferences.customPresets].find((preset) => (
    ambientSettingsSignature(preset.settings) === signature
  ))
  return { ...preferences, settings, activePresetId: matchingPreset?.id ?? null }
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
    onChange(withSettings(preferences, settings))
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
    onChange(withSettings(preferences, preferences.settings.map((item) => (
      item.id === channel.id ? { ...item, volume } : item
    ))))
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
  // 0-based position among the rain slots; meaningful only for a rain layer.
  const rainIndex = selectedChannelIndex - AMBIENT_RAIN_FIRST_INDEX
  const layerName = channel?.kind === 'rain'
    ? `Rain layer ${rainIndex + 1}`
    : `Ambient layer ${layerNumber}`

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
            aria-label={`${layerName}${channel.enabled ? '' : ', disabled'}`}
          >
            <CompactScrollbarSlider
              id={`ambient-${channel.id}-volume`}
              min={0}
              max={1}
              step={0.01}
              value={channel.volume}
              trackLabel="vol"
              tooltipLabel="Volume; scroll the channel button to adjust"
              ariaLabel={`${layerName} volume`}
              disabled={!channel.enabled}
              defaultValue={channel.kind === 'rain' ? DEFAULT_RAIN_CHANNEL.volume : DEFAULT_NOISE_CHANNEL.volume}
              formatValue={(value) => value.toFixed(2)}
              onCommit={(value) => updateChannel(channel.id, { volume: value })}
            />
            {channel.kind === 'rain' ? (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-surface`}
                  min={0}
                  max={AMBIENT_RAIN_SURFACES.length - 1}
                  step={1}
                  value={surfaceIndex(channel.surface)}
                  trackLabel="surface"
                  tooltipLabel="What the rain falls on: glass rings, the street splashes, the forest patters"
                  ariaLabel={`${layerName} surface`}
                  disabled={!channel.enabled}
                  defaultValue={surfaceIndex(DEFAULT_RAIN_CHANNEL.surface)}
                  formatValue={(value) => RAIN_SURFACE_LABELS[AMBIENT_RAIN_SURFACES[Math.round(value)]]}
                  onCommit={(value) => updateRainChannel(channel.id, { surface: AMBIENT_RAIN_SURFACES[Math.round(value)] })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-density`}
                  min={AMBIENT_RAIN_DENSITY_MIN}
                  max={AMBIENT_RAIN_DENSITY_MAX}
                  step={1}
                  value={channel.dropsPerSecond}
                  trackLabel="drops"
                  tooltipLabel="Nearby drops heard one by one, per second"
                  ariaLabel={`${layerName} drops per second`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.dropsPerSecond}
                  formatValue={(value) => `${Math.round(value)} / s`}
                  onCommit={(value) => updateRainChannel(channel.id, { dropsPerSecond: Math.round(value) })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-wash`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.wash}
                  trackLabel="wash"
                  tooltipLabel="The steady hiss of rain too dense to hear drop by drop"
                  ariaLabel={`${layerName} wash`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.wash}
                  formatValue={(value) => value < 0.01 ? 'Off' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateRainChannel(channel.id, { wash: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-drips`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.drips}
                  trackLabel="drips"
                  tooltipLabel="Large, heavy drops from gutters, eaves and branches"
                  ariaLabel={`${layerName} drips`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.drips}
                  formatValue={(value) => value < 0.01
                    ? 'Off'
                    : `${(value * AMBIENT_RAIN_DRIPS_MAX_PER_SEC).toFixed(1)} / s`}
                  onCommit={(value) => updateRainChannel(channel.id, { drips: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-distance`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.distance}
                  trackLabel="distance"
                  tooltipLabel="Distance: near and distinct to far and diffuse"
                  ariaLabel={`${layerName} distance`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.distance}
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
                  ariaLabel={`${layerName} pan`}
                  disabled={!channel.enabled}
                  defaultValue={defaultRainPan(rainIndex) * 100}
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
                  tooltipLabel="Low part of each drop: the ring of glass, the thud on the ground"
                  ariaLabel={`${layerName} bass level`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.bassGain}
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
                  tooltipLabel="High part of each drop: the click, the splash, the plip of a puddle"
                  ariaLabel={`${layerName} treble level`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.trebleGain}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateRainChannel(channel.id, { trebleGain: value })}
                />
              </>
            ) : (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-mod-amp`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.modulationAmplitude}
                  trackLabel="mod amp"
                  tooltipLabel="Modulation amplitude"
                  ariaLabel={`${layerName} modulation amplitude`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.modulationAmplitude}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateNoiseChannel(channel.id, { modulationAmplitude: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-period`}
                  min={AMBIENT_PERIOD_MIN_SEC}
                  max={AMBIENT_PERIOD_MAX_SEC}
                  step={0.5}
                  value={channel.periodSec}
                  trackLabel="period"
                  tooltipLabel="Seconds for one full rise and fall"
                  ariaLabel={`${layerName} period`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.periodSec}
                  formatValue={(value) => `${value.toFixed(1)} s`}
                  onCommit={(value) => updateNoiseChannel(channel.id, { periodSec: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-ramp`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.ramp}
                  trackLabel="ramp"
                  tooltipLabel="Curve of the rise and fall: a sine on the left, blending into a bell at the middle, the bell growing steeper to the right"
                  ariaLabel={`${layerName} ramp`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.ramp}
                  formatValue={formatNoiseRamp}
                  onCommit={(value) => updateNoiseChannel(channel.id, { ramp: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-shape`}
                  min={AMBIENT_SHAPE_MIN}
                  max={AMBIENT_SHAPE_MAX}
                  step={0.01}
                  value={channel.shape}
                  trackLabel="shape"
                  tooltipLabel="Where in the cycle the peak falls"
                  ariaLabel={`${layerName} shape`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.shape}
                  formatValue={(value) => value.toFixed(2)}
                  onCommit={(value) => updateNoiseChannel(channel.id, { shape: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-type`}
                  min={0}
                  max={AMBIENT_NOISE_TYPES.length - 1}
                  step={1}
                  value={typeIndex(channel.type)}
                  trackLabel="type"
                  tooltipLabel="Noise type"
                  ariaLabel={`${layerName} noise type`}
                  disabled={!channel.enabled}
                  defaultValue={typeIndex(DEFAULT_NOISE_CHANNEL.type)}
                  formatValue={(value) => AMBIENT_NOISE_TYPES[Math.round(value)]}
                  onCommit={(value) => updateNoiseChannel(channel.id, { type: AMBIENT_NOISE_TYPES[Math.round(value)] })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-filter`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.filter}
                  trackLabel="filter"
                  tooltipLabel="Low-pass / none / high-pass"
                  ariaLabel={`${layerName} filter`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.filter}
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

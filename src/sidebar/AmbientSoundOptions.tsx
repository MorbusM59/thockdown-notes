import { useCallback, useEffect, useRef, useState } from 'react'
import { AccordionSection } from '../components/AccordionSection'
import { CompactScrollbarSlider } from '../components/CompactScrollbarSlider'
import {
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_PERIOD_MAX_SEC,
  AMBIENT_PERIOD_MIN_SEC,
  AMBIENT_RAIN_DENSITY_MAX,
  AMBIENT_RAIN_DENSITY_MIN,
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_RAIN_FIRST_INDEX,
  AMBIENT_RAIN_SURFACE_ANCHORS,
  AMBIENT_THUNDER_FIRST_INDEX,
  AMBIENT_THUNDER_LENGTH_MAX_SEC,
  AMBIENT_THUNDER_LENGTH_MIN_SEC,
  AMBIENT_THUNDER_PEALS_MAX,
  AMBIENT_THUNDER_PEALS_MIN,
  AMBIENT_SHAPE_MAX,
  AMBIENT_SHAPE_MIN,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  DEFAULT_NOISE_CHANNEL,
  DEFAULT_RAIN_CHANNEL,
  DEFAULT_THUNDER_CHANNEL,
  defaultThunderPan,
  ambientSettingsSignature,
  applyAmbientPreset,
  noiseTypeForSlot,
  AMBIENT_NOISE_SLOT_TYPES,
  defaultRainPan,
  type AmbientChannelBaseSettings,
  type AmbientChannelSettings,
  type AmbientNoiseChannelSettings,
  type AmbientNoiseType,
  type AmbientPreferences,
  type AmbientPreset,
  type AmbientRainChannelSettings,
  type AmbientSettings,
  type AmbientThunderChannelSettings,
} from '../shared/ambientSound'
import { resolveNoiseTone } from '../shared/ambientSoundDsp'
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

/**
 * How a noise group is shown: its buttons share one icon, chosen for the
 * role the type plays -- brown's deep, slow rumble is surf; pink's balanced
 * spread is wind; white's bright hiss is moving air.
 */
const NOISE_GROUP_LOOK: Record<AmbientNoiseType, { icon: string; label: string }> = {
  brown: { icon: 'fa-water', label: 'Brown noise' },
  pink: { icon: 'fa-wind', label: 'Pink noise' },
  white: { icon: 'fa-fan', label: 'White noise' },
}
const RAIN_GROUP_LOOK = { icon: 'fa-cloud-rain', label: 'Rain' }
const THUNDER_GROUP_LOOK = { icon: 'fa-bolt-lightning', label: 'Thunder' }

/**
 * A slot's group (its icon and name) and its number within the group; the
 * icon says which group, so the number counts 1-3 inside it.
 */
function slotLook(index: number): { icon: string; label: string; number: number } {
  if (index >= AMBIENT_THUNDER_FIRST_INDEX) {
    return { ...THUNDER_GROUP_LOOK, number: index - AMBIENT_THUNDER_FIRST_INDEX + 1 }
  }
  if (index >= AMBIENT_RAIN_FIRST_INDEX) {
    return { ...RAIN_GROUP_LOOK, number: index - AMBIENT_RAIN_FIRST_INDEX + 1 }
  }
  const type = noiseTypeForSlot(index)
  return { ...NOISE_GROUP_LOOK[type], number: index - AMBIENT_NOISE_SLOT_TYPES.indexOf(type) + 1 }
}

const RAIN_SURFACE_LABELS: Record<(typeof AMBIENT_RAIN_SURFACE_ANCHORS)[number]['name'], string> = {
  forest: 'Forest',
  street: 'Street',
  glass: 'Glass',
}

/**
 * The surface as read on its slider: an anchor's name at an anchor, and
 * between two, how far it is from the softer toward the harder.
 */
function formatRainSurface(value: number): string {
  const anchors = AMBIENT_RAIN_SURFACE_ANCHORS
  const exact = anchors.find((anchor) => Math.abs(anchor.at - value) < 0.005)
  if (exact) return RAIN_SURFACE_LABELS[exact.name]
  const upperIndex = anchors.findIndex((anchor) => anchor.at > value)
  const lower = anchors[upperIndex - 1]
  const upper = anchors[upperIndex]
  const share = Math.round(((value - lower.at) / (upper.at - lower.at)) * 100)
  return `${RAIN_SURFACE_LABELS[lower.name]} → ${RAIN_SURFACE_LABELS[upper.name].toLowerCase()} ${share}%`
}

interface AmbientSoundOptionsProps {
  preferences: AmbientPreferences
  onChange: (preferences: AmbientPreferences) => void
}

function copySettings(settings: AmbientSettings): AmbientSettings {
  return settings.map((channel) => ({ ...channel, solo: false }))
}

/**
 * The noise ramp as read on its slider: a sine at the middle, a broader
 * plateau to the left and a narrower swell to the right.
 */
function formatNoiseRamp(value: number): string {
  if (Math.abs(value - 0.5) < 0.005) return 'Sine'
  return value < 0.5
    ? `Plateau ${Math.round(((0.5 - value) / 0.5) * 100)}%`
    : `Swell ${Math.round(((value - 0.5) / 0.5) * 100)}%`
}

/** The tone slider as read on it: the filter it has become, and its cutoff. */
function formatNoiseTone(value: number, type: AmbientNoiseType): string {
  const tone = resolveNoiseTone(value, type)
  if (tone.mode === 'none') return 'Neutral'
  const hz = tone.cutoffHz >= 1000 ? `${(tone.cutoffHz / 1000).toFixed(1)} kHz` : `${Math.round(tone.cutoffHz)} Hz`
  return `${tone.mode === 'lowpass' ? 'Dark' : 'Bright'} · ${hz}`
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
    onChange(applyAmbientPreset(preferences, preset))
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

  const updateThunderChannel = (
    channelId: string,
    changes: Partial<Omit<AmbientThunderChannelSettings, keyof AmbientChannelBaseSettings | 'kind'>>,
  ) => {
    commitSettings(preferences.settings.map((channel) => (
      channel.id === channelId && channel.kind === 'thunder' ? { ...channel, ...changes } : channel
    )));
  }

  const toggleChannelSolo = (channelId: string) => {
    const channel = preferences.settings.find((item) => item.id === channelId)
    if (!channel) return
    const shouldSolo = !channel.solo
    // Soloing a channel is listening to it on its own, which is when its
    // controls are wanted, so it is shown too. Clearing solo leaves the view.
    if (shouldSolo) setSelectedChannelId(channel.id)
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
  // 0-based position among the rain slots; meaningful only for a rain layer.
  const rainIndex = selectedChannelIndex - AMBIENT_RAIN_FIRST_INDEX
  // 0-based position among the thunder slots; meaningful only for a thunder layer.
  const thunderIndex = selectedChannelIndex - AMBIENT_THUNDER_FIRST_INDEX
  const layerName = selectedChannelIndex >= 0
    ? `${slotLook(selectedChannelIndex).label} layer ${slotLook(selectedChannelIndex).number}`
    : ''

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
            const look = slotLook(index)
            const rainLayerPosition = channel?.kind === 'rain'
              ? RAIN_LAYER_POSITION_NAMES[number - AMBIENT_RAIN_FIRST_INDEX - 1]
              : null
            const layerTitle = `${look.label} layer ${look.number}${rainLayerPosition ? ` (${rainLayerPosition})` : ''}`
            const isSelected = channel?.id === selectedChannel?.id
            return (
              <button
                key={number}
                type="button"
                className={`btn-icon options-color-swatch options-loadout-btn ambient-channel-selector-btn${isSelected ? ' is-active' : ''}${channel?.enabled ? ' is-enabled' : ' is-disabled'}${channel?.solo ? ' is-solo' : ''}`}
                aria-label={`${layerTitle}, ${channel?.enabled ? 'enabled' : 'disabled'}${channel?.solo ? ', solo' : ''}`}
                aria-pressed={isSelected}
                data-tooltip={channel
                  ? `${layerTitle} is ${channel.enabled ? 'enabled' : 'disabled'}${channel.solo ? ', solo' : ''}\n${channel.solo ? 'Right-click to clear solo' : 'Right-click to solo'}; ${channel.enabled
                    ? 'hold right-click to disable; scroll to adjust volume'
                    : 'hold left-click to enable; settings are locked'}`
                  : `${layerTitle} is disabled`}
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
                <span className={`fa-solid ${look.icon}`} aria-hidden="true" />
                <span className="ambient-channel-number" aria-hidden="true">{look.number}</span>
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
              defaultValue={channel.kind === 'rain' ? DEFAULT_RAIN_CHANNEL.volume : channel.kind === 'thunder' ? DEFAULT_THUNDER_CHANNEL.volume : DEFAULT_NOISE_CHANNEL.volume}
              formatValue={(value) => value.toFixed(2)}
              onCommit={(value) => updateChannel(channel.id, { volume: value })}
            />
            {channel.kind === 'rain' ? (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-surface`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.surface}
                  trackLabel="surface"
                  tooltipLabel="What the rain falls on, soft to hard: leaves patter, the street splashes, glass rings -- and everything in between"
                  ariaLabel={`${layerName} surface`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.surface}
                  formatValue={formatRainSurface}
                  onCommit={(value) => updateRainChannel(channel.id, { surface: value })}
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
                  id={`ambient-${channel.id}-wetness`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.wetness}
                  trackLabel="wetness"
                  tooltipLabel="Standing water: drops land in it with a bright splash and the plip of a bubble, and it deadens the surface's ring"
                  ariaLabel={`${layerName} wetness`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.wetness}
                  formatValue={(value) => value < 0.01 ? 'Dry' : value > 0.99 ? 'Soaked' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateRainChannel(channel.id, { wetness: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-resonance`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.resonance}
                  trackLabel="resonance"
                  tooltipLabel="How much the surface rings: dead to the left, as it is in the middle, ringing long to the right"
                  ariaLabel={`${layerName} resonance`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_RAIN_CHANNEL.resonance}
                  formatValue={(value) => value < 0.01 ? 'Dead' : Math.abs(value - 0.5) < 0.005 ? 'As is' : value > 0.99 ? 'Ringing' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateRainChannel(channel.id, { resonance: value })}
                />
              </>
            ) : channel.kind === 'thunder' ? (
              <>
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-peals`}
                  min={AMBIENT_THUNDER_PEALS_MIN}
                  max={AMBIENT_THUNDER_PEALS_MAX}
                  step={0.5}
                  value={channel.pealsPer10Min}
                  trackLabel="often"
                  tooltipLabel="How often it thunders, on average: peals per ten minutes, at random"
                  ariaLabel={`${layerName} peals per ten minutes`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_THUNDER_CHANNEL.pealsPer10Min}
                  formatValue={(value) => `${value.toFixed(1)} / 10 min`}
                  onCommit={(value) => updateThunderChannel(channel.id, { pealsPer10Min: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-character`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.character}
                  trackLabel="character"
                  tooltipLabel="Character: a smooth, low roll to the left, a cracking cascade of strikes to the right"
                  ariaLabel={`${layerName} character`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_THUNDER_CHANNEL.character}
                  formatValue={(value) => value < 0.01 ? 'Rolling' : value > 0.99 ? 'Cracking' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateThunderChannel(channel.id, { character: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-distance`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.distance}
                  trackLabel="distance"
                  tooltipLabel="Distance: near is bright and sharp, far is a dark, smeared, distant roll"
                  ariaLabel={`${layerName} distance`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_THUNDER_CHANNEL.distance}
                  formatValue={(value) => value < 0.01 ? 'Near' : value > 0.99 ? 'Far' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateThunderChannel(channel.id, { distance: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-pan`}
                  min={-100}
                  max={100}
                  step={1}
                  value={channel.pan * 100}
                  trackLabel="pan"
                  tooltipLabel="Where in the stereo field the storm is, left to right"
                  ariaLabel={`${layerName} pan`}
                  disabled={!channel.enabled}
                  defaultValue={defaultThunderPan(thunderIndex) * 100}
                  formatValue={(value) => Math.abs(value) < 1 ? 'Center' : `${Math.abs(Math.round(value))}% ${value < 0 ? 'L' : 'R'}`}
                  onCommit={(value) => updateThunderChannel(channel.id, { pan: value / 100 })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-spread`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.spread}
                  trackLabel="spread"
                  tooltipLabel="How far a peal wanders across the sky around its pan as it rolls"
                  ariaLabel={`${layerName} spread`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_THUNDER_CHANNEL.spread}
                  formatValue={(value) => value < 0.01 ? 'Point' : value > 0.99 ? 'Wide' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateThunderChannel(channel.id, { spread: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-length`}
                  min={AMBIENT_THUNDER_LENGTH_MIN_SEC}
                  max={AMBIENT_THUNDER_LENGTH_MAX_SEC}
                  step={1}
                  value={channel.lengthSec}
                  trackLabel="length"
                  tooltipLabel="How long a peal rolls on before it dies away"
                  ariaLabel={`${layerName} peal length`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_THUNDER_CHANNEL.lengthSec}
                  formatValue={(value) => `${Math.round(value)} s`}
                  onCommit={(value) => updateThunderChannel(channel.id, { lengthSec: Math.round(value) })}
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
                  tooltipLabel="Curve of the rise and fall: a sine in the middle; to the left it lingers loud and dips briefly, to the right it stays quiet and swells briefly"
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
                  id={`ambient-${channel.id}-movement`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.movement}
                  trackLabel="movement"
                  tooltipLabel="How much each cycle varies in length and strength, and how far it sways between left and right"
                  ariaLabel={`${layerName} movement`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.movement}
                  formatValue={(value) => value < 0.005 ? 'Still' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateNoiseChannel(channel.id, { movement: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-noise-distance`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.distance}
                  trackLabel="distance"
                  tooltipLabel="Distance: near and dry to far, dark and reverberant"
                  ariaLabel={`${layerName} distance`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.distance}
                  formatValue={(value) => value < 0.01 ? 'Near' : value > 0.99 ? 'Far' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateNoiseChannel(channel.id, { distance: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-width`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.width}
                  trackLabel="width"
                  tooltipLabel="Stereo width: a single point (which movement sways across the field) to all around you"
                  ariaLabel={`${layerName} stereo width`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.width}
                  formatValue={(value) => value < 0.01 ? 'Point' : value > 0.99 ? 'Wide' : `${Math.round(value * 100)}%`}
                  onCommit={(value) => updateNoiseChannel(channel.id, { width: value })}
                />
                <CompactScrollbarSlider
                  id={`ambient-${channel.id}-filter`}
                  min={0}
                  max={1}
                  step={0.01}
                  value={channel.filter}
                  trackLabel="tone"
                  tooltipLabel="Tone: darker to the left, brighter to the right. Near the ends it starts to resonate: a whistle on the left, an airy hiss on the right"
                  ariaLabel={`${layerName} tone`}
                  disabled={!channel.enabled}
                  defaultValue={DEFAULT_NOISE_CHANNEL.filter}
                  formatValue={(value) => formatNoiseTone(value, noiseTypeForSlot(selectedChannelIndex))}
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

import { useCallback, useEffect, useRef, useState } from 'react'

import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { HOLD_CONFIRM_MS, armHold } from '@thockdown/interaction/holdTiming'
import { useGracedWheel } from '@thockdown/interaction/useGracedWheel'

import {
  DEFAULT_KEYSTROKE_CHANNEL,
  KEYSTROKE_CHANNEL_IDS,
  KEYSTROKE_CHANNEL_LOOK,
  KEYSTROKE_CHANNEL_RANGES,
  type KeystrokeChannelId,
  type KeystrokeChannelSettings,
  type KeystrokeSoundSettings,
} from '../shared/keystrokeSounds'

interface KeystrokeChannelOptionsProps {
  settings: KeystrokeSoundSettings
  /** An edit: the channels after the change. */
  onChange: (channels: KeystrokeSoundSettings['channels']) => void
}

const clampTo = (value: number, [low, high]: readonly [number, number]) => Math.max(low, Math.min(high, value))

/**
 * Keystroke Sounds' channels, with the soundscape's channel gestures: a click
 * shows a channel's sliders below, a held left press turns an off channel on
 * and a held right press turns an on channel off, and the wheel over an on
 * channel changes its volume in 5% steps. A touch long press turns a channel
 * on or off.
 */
export function KeystrokeChannelOptions({ settings, onChange }: KeystrokeChannelOptionsProps) {
  const [selectedId, setSelectedId] = useState<KeystrokeChannelId>(
    () => KEYSTROKE_CHANNEL_IDS.find((id) => settings.channels[id].on) ?? KEYSTROKE_CHANNEL_IDS[0],
  )
  const selectorRef = useRef<HTMLDivElement | null>(null)
  const holdRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  // A completed touch hold is followed by a click, which must select nothing new.
  const swallowClickRef = useRef(false)
  useEffect(() => () => holdRef.current?.cancel(), [])

  const update = (id: KeystrokeChannelId, changes: Partial<KeystrokeChannelSettings>) => {
    onChange({ ...settings.channels, [id]: { ...settings.channels[id], ...changes } })
  }

  const endHold = (pointerId: number) => {
    const hold = holdRef.current
    if (!hold || hold.pointerId !== pointerId) return
    hold.cancel()
    holdRef.current = null
  }

  const handleWheel = useCallback((event: WheelEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const id = target.closest<HTMLElement>('[data-keystroke-channel-id]')?.dataset.keystrokeChannelId as KeystrokeChannelId | undefined
    const channel = id ? settings.channels[id] : undefined
    if (!id || !channel?.on) return
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()
    const volume = clampTo(Math.round((channel.volume + (delta < 0 ? 0.05 : -0.05)) * 100) / 100, KEYSTROKE_CHANNEL_RANGES.volume)
    if (volume !== channel.volume) onChange({ ...settings.channels, [id]: { ...channel, volume } })
  }, [onChange, settings.channels])
  useGracedWheel(selectorRef, handleWheel)

  const selected = settings.channels[selectedId]
  const selectedName = KEYSTROKE_CHANNEL_LOOK[selectedId].name

  return (<>
    <div className="options-loadout-grid soundscape-channel-selector" role="group" aria-label="Keystroke sound channels" ref={selectorRef}>
      {KEYSTROKE_CHANNEL_IDS.map((id) => {
        const channel = settings.channels[id]
        const look = KEYSTROKE_CHANNEL_LOOK[id]
        return (
          <button
            key={id}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn soundscape-channel-selector-btn${id === selectedId ? ' is-active' : ''}${channel.on ? ' is-enabled' : ' is-disabled'}`}
            aria-label={`${look.name}, ${channel.on ? 'on' : 'off'}`}
            aria-pressed={id === selectedId}
            data-tooltip={channel.on
              ? `${look.name}: ${Math.round(channel.volume * 100)}\nScroll to change its volume. Hold right-click to turn it off.`
              : `${look.name}: off\nHold to turn it on.`}
            data-keystroke-channel-id={id}
            data-secondary-press="action"
            onClick={() => {
              if (swallowClickRef.current) {
                swallowClickRef.current = false
                return
              }
              setSelectedId(id)
            }}
            onPointerDown={(event) => {
              const touch = event.pointerType === 'touch'
              // Only the hold that would CHANGE the channel is armed: left turns on, right turns off; a finger toggles.
              const on = touch ? !channel.on : event.button === 0 ? true : event.button === 2 ? false : null
              if (on === null || on === channel.on) return
              holdRef.current?.cancel()
              swallowClickRef.current = false
              const cancel = armHold(() => {
                holdRef.current = null
                swallowClickRef.current = touch
                if (on) setSelectedId(id)
                update(id, { on })
              }, HOLD_CONFIRM_MS)
              holdRef.current = { pointerId: event.pointerId, cancel }
            }}
            onPointerUp={(event) => endHold(event.pointerId)}
            onPointerCancel={(event) => endHold(event.pointerId)}
            onMouseLeave={() => {
              holdRef.current?.cancel()
              holdRef.current = null
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <span className={look.icon} aria-hidden="true" />
          </button>
        )
      })}
    </div>
    <OptionsSliderRows rows={[2]}>
      <CompactScrollbarSlider
        id="keystroke-channel-volume"
        min={KEYSTROKE_CHANNEL_RANGES.volume[0]}
        max={KEYSTROKE_CHANNEL_RANGES.volume[1]}
        step={0.01}
        value={selected.volume}
        trackLabel="volume"
        tooltipLabel={`${selectedName} volume`}
        ariaLabel={`${selectedName} volume`}
        defaultValue={DEFAULT_KEYSTROKE_CHANNEL.volume}
        disabled={!selected.on}
        onCommit={(value) => update(selectedId, { volume: clampTo(value, KEYSTROKE_CHANNEL_RANGES.volume) })}
      />
      <CompactScrollbarSlider
        id="keystroke-channel-jitter"
        min={KEYSTROKE_CHANNEL_RANGES.jitter[0]}
        max={KEYSTROKE_CHANNEL_RANGES.jitter[1]}
        step={0.01}
        value={selected.jitter}
        trackLabel="jitter"
        tooltipLabel={`${selectedName} jitter: how far each press is pitched up or down at random`}
        ariaLabel={`${selectedName} pitch jitter`}
        defaultValue={DEFAULT_KEYSTROKE_CHANNEL.jitter}
        disabled={!selected.on}
        onCommit={(value) => update(selectedId, { jitter: clampTo(value, KEYSTROKE_CHANNEL_RANGES.jitter) })}
      />
    </OptionsSliderRows>
  </>)
}

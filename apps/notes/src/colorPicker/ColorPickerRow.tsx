/**
 * The colour picker row: one row of the options panel's six-column grid that
 * edits the shared staged colour and channel mask (colorStaging.ts).
 *
 *   1    the staged colour; pressed, it selects all four channels
 *   2    the four channel toggles, H V over S A, each level with its slider
 *   3-4  hue over saturation
 *   5-6  value over alpha
 *
 * Every section with colour targets draws this row at its top, and all of
 * them show the one staging, so the reader never scrolls to reach it.
 *
 * A slider edits its channel whether or not the channel is in the mask; a
 * channel outside the mask is only dimmed, because editing a value must not
 * change what the next press applies. A toggle press selects its channel
 * alone; Shift (or any finger tap, where there is no Shift) adds or removes
 * it instead.
 */
import { useRef } from 'react'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { hsvaToRgba, rgbaToCssColor, rgbaToHex, type HsvaColor } from '@thockdown/look/colorMath'
import {
  ALL_CHANNELS,
  isAllChannels,
  selectChannel,
  setChannelMask,
  setStagedColor,
  useColorStaging,
  type ColorChannel,
} from './colorStaging'

const CHANNEL_NAMES: Record<ColorChannel, string> = { h: 'Hue', s: 'Saturation', v: 'Value', a: 'Alpha' }
// The toggles' grid order: H V / S A, so each letter sits level with its slider.
const TOGGLE_ORDER: readonly ColorChannel[] = ['h', 'v', 's', 'a']
const SLIDER_ORDER: readonly ColorChannel[] = ['h', 's', 'v', 'a']

function css(color: HsvaColor): string {
  return rgbaToCssColor(hsvaToRgba(color))
}

/** A slider's position in its own units: degrees for hue, 0-255 for the rest. */
function channelValue(color: HsvaColor, channel: ColorChannel): number {
  return channel === 'h' ? color.h : Math.round(color[channel] * 255)
}

function withChannelValue(color: HsvaColor, channel: ColorChannel, value: number): HsvaColor {
  return channel === 'h'
    ? { ...color, h: Math.max(0, Math.min(360, value)) }
    : { ...color, [channel]: Math.max(0, Math.min(255, value)) / 255 }
}

export function ColorPickerRow() {
  const { color, mask } = useColorStaging()
  const allActive = isAllChannels(mask)
  /** The kind of pointer behind the press a click finishes: a click does not reliably carry it. */
  const pointerTypeRef = useRef('mouse')

  return (
    <div className="options-color-picker-row" role="group" aria-label="Staged colour">
      <button
        type="button"
        className={`btn-icon options-color-swatch options-color-picker-current${allActive ? ' is-active' : ''}`}
        style={{ '--options-swatch-color': css(color) } as React.CSSProperties}
        data-live-tooltip={`All channels\n${rgbaToHex(hsvaToRgba(color))}`}
        aria-pressed={allActive}
        onClick={() => setChannelMask(ALL_CHANNELS)}
      />
      <div className="options-color-picker-toggles">
        {TOGGLE_ORDER.map((channel) => (
          <button
            key={channel}
            type="button"
            className={`btn-icon options-color-picker-toggle${mask[channel] && !allActive ? ' is-active' : ''}`}
            data-tooltip={`${CHANNEL_NAMES[channel]} only. Shift: add or remove`}
            aria-pressed={mask[channel]}
            onPointerDown={(event) => {
              pointerTypeRef.current = event.pointerType
            }}
            onClick={(event) => {
              const additive = event.shiftKey || pointerTypeRef.current === 'touch'
              setChannelMask(selectChannel(mask, channel, additive))
            }}
          >{channel.toUpperCase()}</button>
        ))}
      </div>
      {[SLIDER_ORDER.slice(0, 2), SLIDER_ORDER.slice(2)].map((pair) => (
        <div key={pair.join('')} className="options-color-picker-sliders">
          {pair.map((channel) => (
            <CompactScrollbarSlider
              key={channel}
              id={`color-picker-${channel}`}
              min={0}
              max={channel === 'h' ? 360 : 255}
              step={1}
              value={channelValue(color, channel)}
              trackLabel={CHANNEL_NAMES[channel]}
              ariaLabel={`Staged colour ${CHANNEL_NAMES[channel].toLowerCase()}`}
              secondaryPress="type"
              dimmed={!mask[channel]}
              onCommit={(value) => setStagedColor((previous) => withChannelValue(previous, channel, value))}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

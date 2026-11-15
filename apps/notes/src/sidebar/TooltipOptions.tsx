import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import type { TooltipElement } from '@thockdown/interaction/tooltipContent'
import {
  DEFAULT_TOOLTIP_SETTINGS,
  TOOLTIP_DELAY_MAX_SEC,
  TOOLTIP_DELAY_NEVER_SLIDER,
  TOOLTIP_DELAY_STEP_SEC,
  type TooltipSettings,
} from '../shared/tooltipSettings'

// Options > Advanced > Tooltips: the delay, then one toggle per tooltip
// element. Each toggle says what its element is and shows an example of it,
// because the element is the thing being chosen and an icon could not show it.

const ELEMENTS: readonly { key: TooltipElement; name: string; meaning: string; example: string }[] = [
  { key: 'intention', name: 'Intention', meaning: 'What a click does.', example: 'Next track' },
  { key: 'shortcut', name: 'Shortcut', meaning: 'The key that does it.', example: '[F9]' },
  { key: 'gestures', name: 'Gestures', meaning: 'What other presses do.', example: '[Right] Reset' },
  { key: 'value', name: 'Value', meaning: 'The current setting.', example: '0.6' },
]

const toSlider = (delaySec: TooltipSettings['delaySec']) => (delaySec === 'never' ? TOOLTIP_DELAY_NEVER_SLIDER : delaySec)

export function TooltipOptions({ settings, onChange }: { settings: TooltipSettings; onChange: (settings: TooltipSettings) => void }) {
  return (
    <>
      <div className="utility-setting-slider-stack" aria-label="Tooltip delay">
        <OptionsSliderRows rows={[1]}>
          <CompactScrollbarSlider
            id="tooltip-delay"
            min={0}
            max={TOOLTIP_DELAY_NEVER_SLIDER}
            step={TOOLTIP_DELAY_STEP_SEC}
            value={toSlider(settings.delaySec)}
            trackLabel="delay"
            tooltipLabel="Tooltip delay (s)"
            ariaLabel="Seconds before a tooltip shows"
            defaultValue={toSlider(DEFAULT_TOOLTIP_SETTINGS.delaySec)}
            formatValue={(value) => (value > TOOLTIP_DELAY_MAX_SEC + TOOLTIP_DELAY_STEP_SEC / 2 ? 'never' : value.toFixed(1))}
            onCommit={(value) => {
              const tenths = Math.round(value / TOOLTIP_DELAY_STEP_SEC)
              const delaySec = tenths * TOOLTIP_DELAY_STEP_SEC > TOOLTIP_DELAY_MAX_SEC + TOOLTIP_DELAY_STEP_SEC / 2
                ? 'never'
                : Number((Math.max(0, tenths) * TOOLTIP_DELAY_STEP_SEC).toFixed(1))
              onChange({ ...settings, delaySec })
            }}
          />
        </OptionsSliderRows>
      </div>
      <div className="options-loadout-grid tooltip-element-grid" role="group" aria-label="Tooltip elements">
        {ELEMENTS.map(({ key, name, meaning, example }) => (
          <button
            key={key}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn tooltip-element-toggle${settings.show[key] ? ' is-active' : ''}`}
            aria-pressed={settings.show[key]}
            aria-label={`Show ${name.toLowerCase()} in tooltips`}
            onClick={() => onChange({ ...settings, show: { ...settings.show, [key]: !settings.show[key] } })}
          >
            <span className="tooltip-element-line"><strong>{name}:</strong> {meaning}</span>
            <span className="tooltip-element-line"><em>Example: {example}</em></span>
          </button>
        ))}
      </div>
    </>
  )
}

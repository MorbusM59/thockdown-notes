import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { encodeTooltip, type TooltipElement, type TooltipFixed } from '@thockdown/interaction/tooltipContent'
import {
  DEFAULT_TOOLTIP_SETTINGS,
  TOOLTIP_DELAY_MAX_SEC,
  TOOLTIP_DELAY_NEVER_SLIDER,
  TOOLTIP_DELAY_STEP_SEC,
  type TooltipSettings,
} from '../shared/tooltipSettings'

// Options > Advanced > Tooltips: the delay, then one icon toggle per tooltip
// element. Each explains its element in a fixed tooltip after a fixed 300ms,
// whatever the setting: they are what sets it.

const EXPLANATION_DELAY_MS = 300

const ELEMENTS: readonly { key: TooltipElement; icon: string; fixed: TooltipFixed }[] = [
  { key: 'intention', icon: 'fa-person-walking-arrow-right', fixed: { title: 'Intention', detail: '(what a click does or opens)', example: 'Insert image / Soundscapes', delayMs: EXPLANATION_DELAY_MS } },
  { key: 'shortcut', icon: 'fa-keyboard', fixed: { title: 'Shortcut', detail: '(which key does the same)', example: '[F5] / [Ctrl + L]', delayMs: EXPLANATION_DELAY_MS } },
  { key: 'gestures', icon: 'fa-hands', fixed: { title: 'Gesture', detail: '(alternative input)', example: '[Drag] Reorder / [Hold right] Delete', delayMs: EXPLANATION_DELAY_MS } },
  { key: 'value', icon: 'fa-ruler-horizontal', fixed: { title: 'Value', detail: '(current setting)', example: 'Filter: dnb / Volume: 0.15', delayMs: EXPLANATION_DELAY_MS } },
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
      <div className="options-loadout-grid" role="group" aria-label="Tooltip elements">
        {ELEMENTS.map(({ key, icon, fixed }) => (
          <button
            key={key}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${settings.show[key] ? ' is-active' : ''}`}
            aria-pressed={settings.show[key]}
            aria-label={`Show ${fixed.title.toLowerCase()} in tooltips`}
            data-tooltip={encodeTooltip({ fixed })}
            onClick={() => onChange({ ...settings, show: { ...settings.show, [key]: !settings.show[key] } })}
          >
            <span className={`fa-solid ${icon}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  )
}

import { CompactScrollbarSlider } from './CompactScrollbarSlider'

/** One slider of a font setting: what `CompactScrollbarSlider` needs, the value already rounded and clamped by `onCommit`'s caller. */
export type FontSlider = {
  id: string
  min: number
  max: number
  step: number
  value: number
  trackLabel: string
  ariaLabel: string
  defaultValue: number
  onCommit: (value: number) => void
}

export type FontControlsProps<Key extends string> = {
  /** The accessible name of the font picker's button group. */
  pickerLabel: string
  options: ReadonlyArray<{ key: Key; label: string; family: string }>
  activeKey: Key
  onSelect: (key: Key) => void
  sliders: ReadonlyArray<FontSlider>
}

/**
 * A picker of fonts, each shown as "Aa" in itself, above a row of sliders:
 * the body of every font setting: the desktop's font sections
 * (FontSection.tsx), and the visualizer's font on both apps
 * (VisualizerFontControls.tsx).
 */
export function FontControls<Key extends string>({
  pickerLabel,
  options,
  activeKey,
  onSelect,
  sliders,
}: FontControlsProps<Key>) {
  return (
    <>
      <div className="typography-grid" role="group" aria-label={pickerLabel}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`btn-icon typography-font-btn${activeKey === option.key ? ' is-active' : ''}`}
            data-tooltip={option.label}
            aria-label={option.label}
            aria-pressed={activeKey === option.key}
            onClick={() => onSelect(option.key)}
          >
            <span className="typography-font-glyph" style={{ fontFamily: option.family }} aria-hidden="true">Aa</span>
          </button>
        ))}
      </div>
      <div className="typography-sliders">
        {sliders.map((slider) => (
          <div key={slider.id} className="typography-slider">
            <CompactScrollbarSlider {...slider} />
          </div>
        ))}
      </div>
    </>
  )
}

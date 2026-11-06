import { AccordionSection } from '@thockdown/interaction/AccordionSection'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'

/** One slider of a font section: what `CompactScrollbarSlider` needs, the value already rounded and clamped by `onCommit`'s caller. */
export type FontSectionSlider = {
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

export type FontSectionProps<Key extends string> = {
  /** The section's heading, also its accessible name and the options search's text. */
  heading: string
  className: string
  /** The accessible name of the font picker's button group. */
  pickerLabel: string
  options: ReadonlyArray<{ key: Key; label: string; family: string }>
  activeKey: Key
  onSelect: (key: Key) => void
  sliders: ReadonlyArray<FontSectionSlider>
}

/**
 * The options panel's font section: a picker of fonts, each shown as "Aa" in
 * itself, above a row of sliders. Every font setting (editor, reader, UI,
 * visualizer) is this one layout, differing only in its fonts and sliders.
 */
export function FontSection<Key extends string>({
  heading,
  className,
  pickerLabel,
  options,
  activeKey,
  onSelect,
  sliders,
}: FontSectionProps<Key>) {
  return (
    <AccordionSection className={className} ariaLabel={heading} heading={heading}>
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
    </AccordionSection>
  )
}

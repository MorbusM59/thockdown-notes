import { OPTIONS_SECTIONS, type OptionsSectionId } from '../shared/optionsSections'

/**
 * The section selector under the feature bar at the top of Options: six
 * buttons, exactly one of them active, choosing which section's subsections
 * the panel shows (shared/optionsSections.ts). Icons only, the section's name
 * in the tooltip, like the two bars above it.
 */
export function OptionsSectionBar({
  selected,
  onSelect,
}: {
  selected: OptionsSectionId
  onSelect: (section: OptionsSectionId) => void
}) {
  return (
    <div className="options-loadout-grid options-section-selector-grid" role="radiogroup" aria-label="Options sections">
      {OPTIONS_SECTIONS.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          className={`btn-icon options-color-swatch options-loadout-btn${selected === id ? ' is-active' : ''}`}
          data-tooltip={label}
          aria-label={label}
          aria-checked={selected === id}
          onClick={() => onSelect(id)}
        >
          <span className={icon} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

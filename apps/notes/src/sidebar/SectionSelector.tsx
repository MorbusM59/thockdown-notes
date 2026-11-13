import type { ButtonHTMLAttributes } from 'react'

export type SectionSelectorEntry<Id extends string> = { id: Id; label: string; icon: string; disabled?: boolean }

/** A cell kept empty and invisible in the middle of a row, so the sections after it keep their place. */
export const SECTION_SELECTOR_GAP = null

/** How many cells a selector row has, whatever number of sections it holds. */
const SECTION_SELECTOR_CELLS = 6

/**
 * A SECTION SELECTOR: one row of six cells at the top of a sidebar view,
 * exactly one section of it active, choosing what the view shows below. Icons
 * only, the section's name in the tooltip. A view with fewer than six
 * sections leaves its remaining cells blank (drawn, and not pressable), so
 * every view's selector is the same row. A `SECTION_SELECTOR_GAP` in
 * `sections` is a cell drawn with `visibility: hidden`, holding its place in
 * the row. A `disabled` section is drawn greyed out and cannot be pressed.
 *
 * `buttonProps` adds to one section's button what only that section has (the
 * Notes view's Trash section is also emptied from its button).
 */
export function SectionSelector<Id extends string>({
  sections,
  selected,
  onSelect,
  ariaLabel,
  buttonProps,
}: {
  sections: ReadonlyArray<SectionSelectorEntry<Id> | typeof SECTION_SELECTOR_GAP>
  selected: Id | null
  onSelect: (section: Id) => void
  ariaLabel: string
  buttonProps?: (section: Id) => ButtonHTMLAttributes<HTMLButtonElement> & { 'data-secondary-press'?: 'action' | 'none' } | undefined
}) {
  const blanks = Math.max(0, SECTION_SELECTOR_CELLS - sections.length)
  return (
    <div className="options-loadout-grid options-section-selector-grid" role="radiogroup" aria-label={ariaLabel}>
      {sections.map((entry, index) => {
        if (entry === SECTION_SELECTOR_GAP) {
          return (
            <button
              key={`gap-${index}`}
              type="button"
              className="btn-icon options-color-swatch options-loadout-btn"
              style={{ visibility: 'hidden' }}
              disabled
              aria-hidden="true"
              tabIndex={-1}
            />
          )
        }
        const { id, label, icon, disabled } = entry
        const { className: extraClassName, ...extra } = buttonProps?.(id) ?? {}
        return (
          <button
            key={id}
            type="button"
            role="radio"
            className={`btn-icon options-color-swatch options-loadout-btn${selected === id ? ' is-active' : ''}${extraClassName ? ` ${extraClassName}` : ''}`}
            data-tooltip={label}
            aria-label={label}
            aria-checked={selected === id}
            disabled={disabled}
            onClick={() => onSelect(id)}
            {...extra}
          >
            <span className={icon} aria-hidden="true" />
          </button>
        )
      })}
      {Array.from({ length: blanks }, (_, index) => (
        <button
          key={`blank-${index}`}
          type="button"
          className="btn-icon options-color-swatch options-loadout-btn is-blank"
          disabled
          aria-hidden="true"
          tabIndex={-1}
        />
      ))}
    </div>
  )
}

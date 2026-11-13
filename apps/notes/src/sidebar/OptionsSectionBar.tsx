import { OPTIONS_SECTIONS, type OptionsSectionId } from '../shared/optionsSections'
import { SectionSelector } from './SectionSelector'

/**
 * The section selector under the feature bar at the top of Options: five
 * buttons, exactly one of them active, choosing which section's subsections
 * the panel shows (shared/optionsSections.ts).
 */
export function OptionsSectionBar({
  selected,
  onSelect,
}: {
  selected: OptionsSectionId
  onSelect: (section: OptionsSectionId) => void
}) {
  return <SectionSelector sections={OPTIONS_SECTIONS} selected={selected} onSelect={onSelect} ariaLabel="Options sections" />
}

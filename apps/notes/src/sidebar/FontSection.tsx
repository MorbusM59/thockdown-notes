import { AccordionSection } from '@thockdown/interaction/AccordionSection'
import { FontControls, type FontControlsProps } from '@thockdown/interaction/FontControls'

export type FontSectionProps<Key extends string> = FontControlsProps<Key> & {
  /** The section's heading, also its accessible name and the options search's text. */
  heading: string
  /** The heading's icon (AccordionSection's `iconClass`). */
  icon: string
  className: string
}

/**
 * The options panel's font section: its `FontControls` under a heading of its
 * own. Every font setting (editor, reader, UI, visualizer) is this one layout,
 * differing only in its fonts and sliders.
 */
export function FontSection<Key extends string>({ heading, icon, className, ...controls }: FontSectionProps<Key>) {
  return (
    <AccordionSection className={className} ariaLabel={heading} heading={heading} iconClass={icon}>
      <FontControls {...controls} />
    </AccordionSection>
  )
}

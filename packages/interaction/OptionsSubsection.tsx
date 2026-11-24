import type { ReactNode } from 'react'
import { AccordionSection } from './AccordionSection'
import { OptionsSubsectionLabel } from './OptionsSubsectionLabel'

/**
 * One named group of controls inside an options section, drawn either way a
 * host lays such groups out: as a DIVIDER (`OptionsSubsectionLabel`) with the
 * controls below it, where the groups share a section (the desktop's
 * Options), or as an ACCORDION section of its own (`folds`), where they were
 * PROMOTED and the host's page is the section (the phone's tabs). Shared
 * controls write their groups through this, so the two layouts are one list
 * of groups rather than two copies of it. A folding group must sit in an
 * `AccordionGroup`; `iconClass` is its heading's icon and is unused as a
 * divider, which has none.
 */
export function OptionsSubsection({ label, iconClass, tooltip, folds = false, children }: {
  label: string
  iconClass: string
  tooltip?: string
  folds?: boolean
  children: ReactNode
}) {
  if (folds) {
    return <AccordionSection ariaLabel={label} heading={label} iconClass={iconClass}>{children}</AccordionSection>
  }
  return (
    <>
      <div className="utility-setting-button-row" role="group" aria-label={`${label} controls`}>
        <OptionsSubsectionLabel tooltip={tooltip}>{label}</OptionsSubsectionLabel>
      </div>
      {children}
    </>
  )
}

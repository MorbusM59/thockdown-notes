import { createContext, useContext } from 'react'

/**
 * Whether the section a control sits in is open. A section's content stays
 * mounted while it is folded, so a control holding state that should not
 * outlive the reader leaving the section (a linked colour target) reads this
 * rather than its own mount. Outside any section it is always open.
 */
export const AccordionSectionOpenContext = createContext(true)

export function useAccordionSectionOpen(): boolean {
  return useContext(AccordionSectionOpenContext)
}

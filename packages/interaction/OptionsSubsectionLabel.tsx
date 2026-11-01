import type { ReactNode } from 'react'

/**
 * The name of one group of controls inside an options section, drawn with the
 * divider that separates it from the group above (`.options-subsection-label`
 * in controls.css). A section with a single group has no label. `tooltip`
 * says what the group is about where its name alone does not.
 */
export function OptionsSubsectionLabel({ children, tooltip }: { children: ReactNode; tooltip?: string }) {
  return <div className="options-subsection-label" data-tooltip={tooltip}>{children}</div>
}

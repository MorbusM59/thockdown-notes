import type { ReactNode } from 'react'

/**
 * The name of one group of controls inside an options section, drawn with the
 * divider that separates it from the group above (`.options-subsection-label`
 * in controls.css). A section with a single group has no label.
 */
export function OptionsSubsectionLabel({ children }: { children: ReactNode }) {
  return <div className="options-subsection-label">{children}</div>
}

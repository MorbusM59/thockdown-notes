import type { ReactNode } from 'react'

/**
 * An options subsection that is always open: the same heading and body as an
 * `AccordionSection`, with no fold arrow and nothing to click. For the bars a
 * section leads with (the factory presets, the quick toggles), which are
 * reached for too often to sit behind a fold. Not part of the options search,
 * so it steps aside while one is in force (`hiddenWhileSearching`).
 */
export function OptionsFixedSection({
  heading,
  iconClass,
  className,
  hiddenWhileSearching,
  children,
}: {
  heading: string
  iconClass: string
  className?: string
  hiddenWhileSearching: boolean
  children: ReactNode
}) {
  return (
    <section
      className={`options-section sidebar-options-section${className ? ` ${className}` : ''}`}
      aria-label={heading}
      data-options-search-hidden={hiddenWhileSearching ? '' : undefined}
    >
      <div className="sidebar-options-accordion">
        <div className="sidebar-options-section-heading is-fixed">
          <span className={`fa-solid ${iconClass}`} aria-hidden="true" />
          {heading}
        </div>
        <div className="sidebar-options-accordion-body">{children}</div>
      </div>
    </section>
  )
}

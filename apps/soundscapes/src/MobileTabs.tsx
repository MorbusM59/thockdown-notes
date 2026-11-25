/**
 * THE PHONE'S TABS, in the desktop sidebar's language: the view selector
 * above the sidebar frame (the desktop's `.view-toggle`, sidebarFrame.css),
 * one tab per view. Songs and Soundscapes are the desktop's views; the others
 * are the desktop's options subsections promoted to tabs.
 *
 * The tabs not built yet are placeholders that say so, so the shell's shape
 * can be judged on a device before their content is.
 */
import { useEffect, useState } from 'react'
import { readDisplay, setLandscape } from './display'
import { MusicDiagnostics } from './MusicDiagnostics'
import { AboutPanel } from '@thockdown/interaction/AboutPanel'
import { AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { ABOUT_LINKS, APP_VERSION, CREDITS, openAboutLink } from './about'
import { MOBILE_TABS, type MobileTab } from './mobileTabList'


export function MobileTabSelector({ tab, onChange }: { tab: MobileTab; onChange: (tab: MobileTab) => void }) {
  return (
    <div className="view-toggle mobile-tab-selector" role="tablist" aria-label="Views">
      {MOBILE_TABS.map((entry) => (
        <button
          key={entry.tab}
          type="button"
          role="tab"
          aria-selected={tab === entry.tab}
          aria-label={entry.label}
          className={`toggle-btn notes-mode-button icon-btn btn-glyph${tab === entry.tab ? ' is-active' : ''}`}
          onClick={() => onChange(entry.tab)}
        >
          <span className={`view-toggle-glyph ${entry.icon}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** The visualizer's orientation (display.ts), applied only while it is open: read once, and set through here. */
export function useVisualizerLandscape(): [boolean, (landscape: boolean) => void] {
  const [landscape, setLandscapeState] = useState(false)
  useEffect(() => {
    void readDisplay().then((display) => setLandscapeState(display.landscape))
  }, [])
  return [landscape, (next) => {
    setLandscapeState(next)
    void setLandscape(next)
  }]
}

/** The Dashboard's foot: Debugging and About, the desktop's Options > Advanced sections, folded. */
export function DashboardAppSections() {
  return (
    <AccordionGroup>
      <AccordionSection ariaLabel="Debugging" heading="Debugging" iconClass="fa-bug">
        <MusicDiagnostics />
      </AccordionSection>
      <AccordionSection ariaLabel="About" heading="About" iconClass="fa-circle-info">
        <AboutPanel appName="Thockdown Soundscapes" version={APP_VERSION} links={ABOUT_LINKS} credits={CREDITS} openLink={openAboutLink} />
      </AccordionSection>
    </AccordionGroup>
  )
}

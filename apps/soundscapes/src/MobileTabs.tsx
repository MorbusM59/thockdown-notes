/**
 * THE PHONE'S TABS, in the desktop sidebar's language: the view selector
 * above the sidebar frame (the desktop's `.view-toggle`, sidebarFrame.css),
 * one tab per view. Songs and Soundscapes are the desktop's views; the others
 * are the desktop's options subsections promoted to tabs.
 *
 * The tabs not built yet are placeholders that say so, so the shell's shape
 * can be judged on a device before their content is.
 */
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
import { useEffect, useState, type ReactNode } from 'react'
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

/** A tab whose content is not built yet. */
export function TabPlaceholder({ name }: { name: string }) {
  return (
    <div className="utility-setting-slider-stack">
      <OptionsSubsectionLabel>{name}</OptionsSubsectionLabel>
      <p className="mobile-tab-placeholder">Coming soon.</p>
    </div>
  )
}

/** The way into the full-screen visualizer and its orientation, on the dashboard. */
export function VisualizerButtons({ onOpen }: { onOpen: () => void }) {
  const [landscape, setLandscapeState] = useState(false)
  useEffect(() => {
    void readDisplay().then((display) => setLandscapeState(display.landscape))
  }, [])
  return (
    <div className="utility-setting-slider-stack">
      <OptionsSubsectionLabel>Visualizer</OptionsSubsectionLabel>
      <div className="options-loadout-grid">
        <button type="button" className="btn-icon options-color-swatch options-loadout-btn" aria-label="Open the visualizer" onClick={onOpen}>
          <span className="fa-solid fa-eye" aria-hidden="true" />
        </button>
        {/* The visualizer's orientation, applied only while it is open (display.ts). */}
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${landscape ? ' is-active' : ''}`}
          aria-label={landscape ? 'Show the visualizer upright' : 'Show the visualizer sideways'}
          aria-pressed={landscape}
          onClick={() => {
            setLandscapeState(!landscape)
            void setLandscape(!landscape)
          }}
        >
          <span className={`fa-solid fa-mobile-screen-button${landscape ? ' fa-rotate-90' : ''}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * Settings: Soundstages, Debugging and About, the desktop's
 * Options sections as accordions. Soundstages' dock shows while its section
 * is open (`onSoundstagesOpenChange`), as on the desktop.
 */
export function SettingsTab({ soundstages, onSoundstagesOpenChange }: {
  soundstages: ReactNode
  onSoundstagesOpenChange: (open: boolean) => void
}) {
  // Leaving the tab closes every section, so its dock goes with it.
  useEffect(() => () => onSoundstagesOpenChange(false), [onSoundstagesOpenChange])
  return (
    <AccordionGroup>
      <AccordionSection ariaLabel="Soundstages" heading="Soundstages" iconClass="fa-sliders" onOpenChange={onSoundstagesOpenChange}>
        {soundstages}
      </AccordionSection>
      <AccordionSection ariaLabel="Debugging" heading="Debugging" iconClass="fa-bug">
        <MusicDiagnostics />
      </AccordionSection>
      <AccordionSection ariaLabel="About" heading="About" iconClass="fa-circle-info">
        <AboutPanel appName="Thockdown Soundscapes" version={APP_VERSION} links={ABOUT_LINKS} credits={CREDITS} openLink={openAboutLink} />
      </AccordionSection>
    </AccordionGroup>
  )
}

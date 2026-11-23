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

/** The Visualizer tab: for now the way into the full-screen visualizer; its settings follow. */
export function VisualizerTab({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="utility-setting-slider-stack">
      <OptionsSubsectionLabel>Visualizer</OptionsSubsectionLabel>
      <div className="options-loadout-grid">
        <button type="button" className="btn-icon options-color-swatch options-loadout-btn" aria-label="Open the visualizer" onClick={onOpen}>
          <span className="fa-solid fa-eye" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** Settings: Beat detection, Debugging and About, as the desktop's subsections. */
export function SettingsTab() {
  return (
    <>
      <TabPlaceholder name="Beat detection" />
      <TabPlaceholder name="Debugging" />
      <TabPlaceholder name="About" />
    </>
  )
}

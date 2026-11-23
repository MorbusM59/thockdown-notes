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

export const MOBILE_TABS = [
  { tab: 'songs', label: 'Songs', icon: 'fa-solid fa-compact-disc' },
  { tab: 'soundscapes', label: 'Soundscapes', icon: 'fa-solid fa-podcast' },
  { tab: 'schedules', label: 'Schedules', icon: 'fa-solid fa-clock' },
  { tab: 'soundstages', label: 'Soundstages', icon: 'fa-solid fa-sliders' },
  { tab: 'visualizer', label: 'Visualizer', icon: 'fa-solid fa-eye' },
  { tab: 'settings', label: 'Settings', icon: 'fa-solid fa-gear' },
] as const

export type MobileTab = typeof MOBILE_TABS[number]['tab']

const TAB_KEY = 'thockdown:mobile-tab'

/** The tab last shown, or Soundscapes (the app's first purpose) on a first launch. */
export function loadTab(): MobileTab {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    return MOBILE_TABS.find((entry) => entry.tab === stored)?.tab ?? 'soundscapes'
  } catch {
    return 'soundscapes'
  }
}

export function saveTab(tab: MobileTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Storage refused: the tab is simply not remembered.
  }
}

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

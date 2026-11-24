/** The phone's tabs (MobileTabs.tsx draws them) and the one shown, remembered across launches. */

export const MOBILE_TABS = [
  { tab: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-play' },
  { tab: 'songs', label: 'Songs', icon: 'fa-solid fa-compact-disc' },
  { tab: 'soundscapes', label: 'Soundscapes', icon: 'fa-solid fa-podcast' },
  { tab: 'schedules', label: 'Schedules', icon: 'fa-solid fa-clock' },
  { tab: 'visualizer', label: 'Visualizer', icon: 'fa-solid fa-eye' },
  { tab: 'soundstages', label: 'Soundstages', icon: 'fa-solid fa-sliders' },
] as const

export type MobileTab = typeof MOBILE_TABS[number]['tab']

const TAB_KEY = 'thockdown:mobile-tab'

/** The tab last shown, or the Dashboard (where what plays is picked) on a first launch. */
export function loadTab(): MobileTab {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    return MOBILE_TABS.find((entry) => entry.tab === stored)?.tab ?? 'dashboard'
  } catch {
    return 'dashboard'
  }
}

export function saveTab(tab: MobileTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // Storage refused: the tab is simply not remembered.
  }
}

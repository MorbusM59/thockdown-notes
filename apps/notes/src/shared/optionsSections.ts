/**
 * The options panel's SECTIONS: the six groups the section selector bar
 * switches between, one at a time (`sidebar/OptionsSectionBar.tsx`). Each
 * section holds subsections (the collapsible headings), and a subsection may
 * hold dividers (`OptionsSubsectionLabel`). Exactly one section is shown;
 * a search in the options panel looks through all of them.
 *
 * Which one is selected is persisted (`PersistedMenuState.optionsSection`),
 * so Options reopens where the reader left it. Kept free of the DOM so the
 * main process's `sanitizeMenu` can use it.
 */

export const OPTIONS_SECTION_IDS = ['general', 'layouts', 'music', 'glitz', 'tools', 'advanced'] as const

export type OptionsSectionId = typeof OPTIONS_SECTION_IDS[number]

export const DEFAULT_OPTIONS_SECTION: OptionsSectionId = 'general'

export const OPTIONS_SECTIONS: ReadonlyArray<{ id: OptionsSectionId; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'fa-solid fa-house' },
  { id: 'layouts', label: 'Layouts', icon: 'fa-solid fa-rectangle-list' },
  { id: 'music', label: 'Sound', icon: 'fa-solid fa-music' },
  { id: 'glitz', label: 'Glitz', icon: 'fa-solid fa-hand-sparkles' },
  { id: 'tools', label: 'Tools', icon: 'fa-solid fa-toolbox' },
  { id: 'advanced', label: 'Advanced', icon: 'fa-solid fa-screwdriver' },
]

export function sanitizeOptionsSection(value: unknown): OptionsSectionId {
  return (OPTIONS_SECTION_IDS as readonly unknown[]).includes(value) ? value as OptionsSectionId : DEFAULT_OPTIONS_SECTION
}

/**
 * The Options subsections that dock their preset list's active entry below
 * the panel while they are unfolded (App.tsx). At most one is open: the
 * subsections in Sound are strictly one-at-a-time, and Flashing lives in
 * another section, which shows alone.
 */
export type PresetSubsectionId = 'soundstages' | 'keystrokeSounds' | 'flashing'

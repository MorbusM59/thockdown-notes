import type { ShortcutSectionId } from './keyboardShortcuts'

// The mouse gestures the shortcut reference lists under each section's keys.
//
// Unlike `keyboardShortcuts.ts` this is a DESCRIPTION only: every gesture is
// handled where its control lives (a tab's own handlers, the scrollbar's,
// the table selection's), and those handlers do not read this list. It is the
// reference's summary of what the User Guide (`electron/help/helpGuideContent.ts`)
// documents control by control, so a gesture added or changed there is
// changed here too. Gestures the guide keeps to one specialised panel (the
// colour swatches, the music player, the soundscape channels) are left out:
// the reference is for what a reader uses while writing.
//
// Only gestures a reader cannot discover are listed. A control whose tooltip
// already says what a right-click or a hold does (a tab, the identity tab,
// the gutter toggle, the timeline's zoom) is left to its tooltip, which is
// where the reader is looking when they need it.

export type MouseAction = 'click' | 'hold' | 'drag' | 'wheel'
export type MouseButton = 'left' | 'right'

export interface MouseGesture {
  section: ShortcutSectionId
  action: MouseAction
  /** Absent for the wheel, which has no side. */
  button?: MouseButton
  /** Keys held with it, as `keyboardShortcuts.ts` names them for display. */
  modifiers?: readonly ('Ctrl' | 'Shift' | 'Alt')[]
  /** Where, and what it does: `on a tab to edit its $id`. */
  label: string
}

export const MOUSE_GESTURES: readonly MouseGesture[] = [
  // editorSection/typographyWheel.ts: one slider step per notch, for the pane under the pointer.
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl'], label: 'over the text for text size' },
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl', 'Alt'], label: 'over the text for horizontal spacing' },
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl', 'Shift'], label: 'over the text for line height' },

  { section: 'scrollbar', action: 'click', button: 'left', label: 'to travel there' },
  { section: 'scrollbar', action: 'click', button: 'right', label: 'to page up / down' },
  { section: 'scrollbar', action: 'hold', button: 'left', label: 'to snap there' },

  { section: 'tabBar', action: 'drag', button: 'left', label: 'a tab to reorder, a note into a tab bar to open it' },

  { section: 'chapterBar', action: 'drag', button: 'left', label: 'a chapter pill to reorder it' },
  { section: 'chapterBar', action: 'click', button: 'right', label: 'on a chapter tab to give it an id' },
  { section: 'chapterBar', action: 'hold', button: 'right', label: 'on a chapter pill for archive / delete buttons' },

  { section: 'timeline', action: 'hold', button: 'left', label: 'on the present-state circle to merge snapshots' },
  { section: 'timeline', action: 'hold', button: 'right', label: 'on a history mark to branch a new note from it' },

  { section: 'tables', action: 'click', button: 'right', label: 'in a table to select word, cell, row, table' },
  { section: 'tables', action: 'drag', button: 'left', label: 'a selected cell to move its row / column' },
  { section: 'tables', action: 'hold', button: 'left', label: 'on the divider to delete that column' },

  { section: 'gutter', action: 'click', button: 'left', label: 'on a line\'s flag box to mark it ?, again for !' },
  { section: 'gutter', action: 'click', button: 'right', label: 'on a line\'s flag box to clear its mark' },

  { section: 'find', action: 'click', button: 'right', label: "on the sidebar's Find icon to replace all" },

  { section: 'uncategorized', action: 'hold', button: 'right', label: 'on a note in the tree to arm archive / delete' },

  { section: 'menu', action: 'wheel', label: 'over the menu to turn the dial' },
  { section: 'menu', action: 'click', button: 'left', label: 'on a choice to take it' },
]

export function mouseGesturesInSection(section: ShortcutSectionId): MouseGesture[] {
  return MOUSE_GESTURES.filter((gesture) => gesture.section === section)
}

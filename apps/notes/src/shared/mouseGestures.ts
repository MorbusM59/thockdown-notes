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
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl'], label: 'adjust text size' },
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl', 'Alt'], label: 'adjust letter spacing' },
  { section: 'zoom', action: 'wheel', modifiers: ['Ctrl', 'Shift'], label: 'adjust line height' },

  { section: 'scrollbar', action: 'click', button: 'left', label: 'smooth scroll' },
  { section: 'scrollbar', action: 'click', button: 'right', label: 'page scroll' },
  { section: 'scrollbar', action: 'hold', button: 'left', label: 'instant scroll' },

  { section: 'tabBar', action: 'drag', button: 'left', label: 'reorder tabs' },

  { section: 'chapterBar', action: 'drag', button: 'left', label: 'reorder chapters' },
  { section: 'chapterBar', action: 'click', button: 'right', label: 'assign id' },
  { section: 'chapterBar', action: 'hold', button: 'right', label: 'archive/delete' },

  { section: 'timeline', action: 'hold', button: 'right', label: 'on present: merge snapshots' },
  { section: 'timeline', action: 'hold', button: 'right', label: 'on mark: new note from mark' },

  { section: 'tables', action: 'click', button: 'right', label: 'select word, cell, row, table' },
  { section: 'tables', action: 'drag', button: 'left', label: 'move selected cell' },
  { section: 'tables', action: 'hold', button: 'left', label: 'on divider: delete column' },

  { section: 'gutter', action: 'click', button: 'left', label: 'mark ? / !' },
  { section: 'gutter', action: 'click', button: 'right', label: 'clear mark' },

  { section: 'find', action: 'click', button: 'right', label: "on Find icon: replace all" },

  // editorSection/useNoteProtectionActions.ts: a press arms archiving, a hold arms deletion.
  { section: 'category', action: 'click', button: 'right', label: 'prime for archiving' },
  { section: 'category', action: 'hold', button: 'right', label: 'prime for deletion' },

  { section: 'menu', action: 'wheel', label: 'turn dial' },
  { section: 'menu', action: 'click', button: 'left', label: 'select choice' },
]

export function mouseGesturesInSection(section: ShortcutSectionId): MouseGesture[] {
  return MOUSE_GESTURES.filter((gesture) => gesture.section === section)
}

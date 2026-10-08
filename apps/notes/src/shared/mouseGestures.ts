import type { ShortcutGroupId } from './keyboardShortcuts'

// The mouse gestures the shortcut reference lists under each group's keys.
//
// Unlike `keyboardShortcuts.ts` this is a DESCRIPTION only: every gesture is
// handled where its control lives (a tab's own handlers, the scrollbar's,
// the table selection's), and those handlers do not read this list. It is the
// reference's summary of what the User Guide (`electron/help/helpGuideContent.ts`)
// documents control by control, so a gesture added or changed there is
// changed here too. Gestures the guide keeps to one specialised panel (the
// colour swatches, the music player, the soundscape channels) are left out:
// the reference is for what a reader uses while writing.

export type MouseAction = 'click' | 'hold' | 'drag' | 'wheel'
export type MouseButton = 'left' | 'right'

export interface MouseGesture {
  group: ShortcutGroupId
  action: MouseAction
  /** Absent for the wheel, which has no side. */
  button?: MouseButton
  /** Where, and what it does: `on a tab to edit its $id`. */
  label: string
}

export const MOUSE_GESTURES: readonly MouseGesture[] = [
  { group: 'views', action: 'click', button: 'left', label: 'on the scrollbar to travel there' },
  { group: 'views', action: 'click', button: 'right', label: 'on the scrollbar to page up / down' },
  { group: 'views', action: 'click', button: 'left', label: 'on the gutter for line numbers & flags' },
  { group: 'views', action: 'click', button: 'right', label: 'on the gutter for flags only' },

  { group: 'notes', action: 'click', button: 'right', label: 'on a tab to edit its $id' },
  { group: 'notes', action: 'hold', button: 'right', label: 'on a tab to unpin / close it' },
  { group: 'notes', action: 'drag', button: 'left', label: 'a tab to reorder, a note into a tab bar to open it' },
  { group: 'notes', action: 'hold', button: 'right', label: 'on a sidebar note to archive / delete it' },
  { group: 'notes', action: 'click', button: 'right', label: 'on the identity tab to name the collection' },

  { group: 'find', action: 'click', button: 'right', label: "on the sidebar's Find icon to replace all" },

  { group: 'chapters', action: 'drag', button: 'left', label: 'a chapter pill to reorder it' },
  { group: 'chapters', action: 'click', button: 'right', label: 'on a chapter tab to give it an id' },
  { group: 'chapters', action: 'hold', button: 'right', label: 'on a chapter pill to archive / delete it' },

  { group: 'tables', action: 'click', button: 'right', label: 'to select word, then cell, row, table' },
  { group: 'tables', action: 'drag', button: 'left', label: 'a selected cell to move its row / column' },
  { group: 'tables', action: 'hold', button: 'left', label: 'on the divider to delete that column' },

  { group: 'menu', action: 'wheel', label: 'over the menu to turn the dial' },
  { group: 'menu', action: 'click', button: 'left', label: 'on a choice to take it' },
]

export function mouseGesturesInGroup(group: ShortcutGroupId): MouseGesture[] {
  return MOUSE_GESTURES.filter((gesture) => gesture.group === group)
}

// Every keyboard shortcut the app binds, declared once.
//
// The handlers that act on a shortcut (App.tsx's window keydown, CM6Editor's
// highest-precedence keymap) ask `matchShortcut` whether an event is one of
// these declarations; the quick reference (`components/ShortcutReference.tsx`)
// and the User Guide's shortcut table (`electron/help/helpGuideContent.ts`)
// render the same declarations. A binding changed here therefore changes the
// key that does it AND every place that tells the reader about it, and a
// binding that is not declared here cannot be described anywhere.
//
// Before this module the same chords were spelled out three times -- a
// handler's `event.ctrlKey && key === 'b'`, a hand-typed guide table, and the
// markdown shortcuts a second time inside the editor -- with nothing holding
// them together.
//
// A few declarations are DESCRIBED here but matched by something that cannot
// read this table: CodeMirror's own default and history keymaps (undo, redo,
// word delete, Shift+Enter), the escape hold (`shared/escapeHold.ts`, a
// gesture over time rather than a chord), the help key's hold
// (`shared/useHelpKey.ts`, which matches the tap's own declaration and tells
// a hold by its duration), and the quick-actions ring's dial
// (`editorSection/EscapeHoldPanel.tsx`). Those carry `matchedBy`, so the
// claim "this table is what the handlers read" stays checkable entry by entry.
//
// Ctrl, never Cmd, on every platform for the app's own bindings: the app has
// always bound Ctrl (see CM6Editor's markdown keymap), and that is a product
// choice, not an oversight. Smart paste is the one chord that also accepts
// Cmd, which is what `ctrl: 'or-meta'` says. CodeMirror's own keymaps DO
// follow the platform, so those declarations say what a Mac reader presses
// in `macChords`, and `meta` exists only to display them.

/** One physical key combination. Absent modifiers must be UP. */
export interface KeyChord {
  /** `KeyboardEvent.key`; letters compare case-insensitively. */
  key?: string
  /** `KeyboardEvent.code`, for a key whose `key` changes with modifiers (Space). */
  code?: string
  ctrl?: true | 'or-meta'
  /** Cmd. Display only -- see `macChords`. */
  meta?: true
  shift?: true
  alt?: true
}

/** How the chord is pressed, for the reader; a plain press when absent. */
export type ShortcutPress = 'hold'

/**
 * Where a binding is listed: a SECTION of a PANEL. Panels name a region of
 * the app the reader works in, and a section names one part of that region
 * (the tab bar, the scrollbar, tables), so a binding is found where the
 * reader is when they want it. A section lists its keys first, then its
 * mouse gestures (`mouseGestures.ts`).
 */
export type ShortcutSectionId =
  | 'layout'
  | 'content'
  | 'zoom'
  | 'scrollbar'
  | 'tabBar'
  | 'chapterBar'
  | 'timeline'
  | 'native'
  | 'markdown'
  | 'tables'
  | 'gutter'
  | 'find'
  | 'category'
  | 'uncategorized'
  | 'menu'

export interface ShortcutDeclaration {
  section: ShortcutSectionId
  /**
   * Every chord does the same thing: the quick reference shows any beyond the
   * first combination as an "alternative shortcut". Two directions of one
   * motion (Tab, Shift+Tab) are two declarations; alternative KEYS of one
   * combination (`Alt+← / →`) share a row.
   */
  chords: readonly KeyChord[]
  /** What it does, short enough for the quick reference's one line. */
  label: string
  press?: ShortcutPress
  /**
   * What a Mac reader presses instead, for a key bound by CodeMirror's own
   * keymaps, which use Cmd ("Mod") there -- display only, since CodeMirror
   * does the matching. Absent: the same chords on every platform.
   */
  macChords?: readonly KeyChord[]
  /**
   * Set when no handler matches this declaration through `matchShortcut`,
   * naming what binds the key instead -- see the module comment.
   */
  matchedBy?: 'codemirror' | 'escape-hold' | 'help-key' | 'ring'
}

export interface ShortcutSection {
  id: ShortcutSectionId
  /** Absent for a panel's only section, which needs no label of its own. */
  title?: string
}

export interface ShortcutPanel {
  title: string
  /** The Font Awesome icon the panel wears. */
  icon: string
  sections: readonly ShortcutSection[]
  /**
   * `false` keeps a panel out of the F1 quick reference while the User Guide
   * still lists it, for controls a reader finds without a reference (the
   * quick-actions ring turns and takes like any dial).
   */
  inReference?: false
}

/** The reader-facing panels, in reading order. Every section belongs to exactly one. */
export const SHORTCUT_PANELS: readonly ShortcutPanel[] = [
  { title: 'Window layout', icon: 'fa-solid fa-table-columns', sections: [{ id: 'layout' }] },
  {
    title: 'Editor',
    icon: 'fa-solid fa-file-lines',
    sections: [{ id: 'content', title: 'Content' }, { id: 'zoom', title: 'Zoom' }, { id: 'scrollbar', title: 'Scrollbar' }],
  },
  {
    title: 'Note management',
    icon: 'fa-solid fa-note-sticky',
    sections: [{ id: 'tabBar', title: 'Tab bar' }, { id: 'chapterBar', title: 'Chapter bar' }, { id: 'timeline', title: 'Timeline' }],
  },
  {
    title: 'Edit mode',
    icon: 'fa-solid fa-pen',
    sections: [
      { id: 'native', title: 'Editing' },
      { id: 'markdown', title: 'Markdown' },
      { id: 'tables', title: 'Tables' },
      { id: 'gutter', title: 'Gutter' },
    ],
  },
  {
    title: 'Sidebar',
    icon: 'fa-solid fa-bars',
    sections: [{ id: 'find', title: 'Find' }, { id: 'category', title: 'Category view' }],
  },
  { title: 'Uncategorized', icon: 'fa-solid fa-ellipsis', sections: [{ id: 'uncategorized' }] },
  { title: 'Quick actions menu', icon: 'fa-solid fa-circle-notch', sections: [{ id: 'menu' }], inReference: false },
]

const ARROWS_LR: readonly KeyChord[] = [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }]
const ARROWS_UD: readonly KeyChord[] = [{ key: 'ArrowUp' }, { key: 'ArrowDown' }]
const withMods = (chords: readonly KeyChord[], mods: Omit<KeyChord, 'key' | 'code'>): KeyChord[] =>
  chords.map((chord) => ({ ...chord, ...mods }))

export const SHORTCUTS = {
  toggleView: { section: 'content', chords: [{ key: 'Escape' }], label: 'Edit / render view', matchedBy: 'escape-hold' },
  quickActions: { section: 'content', chords: [{ key: 'Escape' }], press: 'hold', label: 'Quick actions menu', matchedBy: 'escape-hold' },
  userGuide: { section: 'content', chords: [{ key: 'F1' }], label: 'Toggle User Guide' },
  shortcutReference: { section: 'content', chords: [{ key: 'F1' }], press: 'hold', label: 'Quick Reference', matchedBy: 'help-key' },
  newNote: { section: 'content', chords: [{ key: 'n', ctrl: true }], label: 'New note' },
  newNoteFromClipboard: { section: 'content', chords: [{ key: 'n', ctrl: true, shift: true }], label: 'with pasted title' },
  toggleSidebar: { section: 'layout', chords: [{ code: 'Space', ctrl: true }], label: 'Show / hide sidebar' },
  immersive: { section: 'layout', chords: [{ code: 'Space', ctrl: true, shift: true }], label: 'Immersive mode' },
  switchSlot: { section: 'layout', chords: withMods(ARROWS_LR, { alt: true }), label: 'Previous / next slot' },
  jumpVertical: {
    section: 'uncategorized',
    chords: withMods(ARROWS_UD, { ctrl: true }),
    label: 'Nearest flagged line, else start / end',
  },

  find: { section: 'find', chords: [{ key: 'f', ctrl: true }], label: 'Find in note' },
  findReplace: { section: 'find', chords: [{ key: 'h', ctrl: true }], label: 'Find & replace' },
  replaceAll: { section: 'find', chords: [{ key: 'Enter', ctrl: true }], label: 'Replace all results' },

  bold: { section: 'markdown', chords: [{ key: 'b', ctrl: true }], label: 'Bold' },
  italic: { section: 'markdown', chords: [{ key: 'i', ctrl: true }], label: 'Italic' },
  strikethrough: { section: 'markdown', chords: [{ key: 'x', ctrl: true, shift: true }], label: 'Strikethrough' },
  heading: { section: 'markdown', chords: [{ key: 't', ctrl: true }], label: 'Cycle heading level' },
  bulletedList: { section: 'markdown', chords: [{ key: 'u', ctrl: true }], label: 'Bulleted list' },
  numberedList: { section: 'markdown', chords: [{ key: 'o', ctrl: true }], label: 'Numbered list' },
  link: { section: 'markdown', chords: [{ key: 'l', ctrl: true }], label: 'Link' },
  anchor: { section: 'markdown', chords: [{ key: 'l', ctrl: true, shift: true }], label: 'Anchor' },

  undo: { section: 'native', chords: [{ key: 'z', ctrl: true }], macChords: [{ key: 'z', meta: true }], label: 'Undo', matchedBy: 'codemirror' },
  redo: { section: 'native', chords: [{ key: 'y', ctrl: true }], macChords: [{ key: 'z', meta: true, shift: true }], label: 'Redo', matchedBy: 'codemirror' },
  smartPaste: { section: 'native', chords: [{ key: 'v', ctrl: 'or-meta', shift: true }], label: 'Smart paste' },
  // CodeMirror deletes the word; CM6Editor only offers this chord to a
  // table first (at the start of a cell it takes the previous cell's word).
  deleteWord: {
    section: 'native',
    chords: [{ key: 'Backspace', ctrl: true }],
    macChords: [{ key: 'Backspace', alt: true }],
    label: 'Delete previous word',
  },


  // One direction per declaration: a declaration's further chords are
  // ALTERNATIVES for the same action, and Shift+Tab is not another Tab.
  tableNextCell: { section: 'tables', chords: [{ key: 'Tab' }], label: 'Next cell', matchedBy: 'codemirror' },
  tablePreviousCell: { section: 'tables', chords: [{ key: 'Tab', shift: true }], label: 'Previous cell', matchedBy: 'codemirror' },
  tableEmptyCell: { section: 'tables', chords: [{ key: 'Backspace', shift: true }], label: 'Empty the cell' },
  tableDeleteColumn: { section: 'tables', chords: [{ key: 'Backspace', ctrl: true, shift: true }], label: 'Delete the column' },
  tableMove: { section: 'tables', chords: withMods([...ARROWS_LR, ...ARROWS_UD], { ctrl: true, shift: true }), label: 'Move row / column' },
  tableLineBreak: { section: 'tables', chords: [{ key: 'Enter', shift: true }], label: 'Line break inside a row', matchedBy: 'codemirror' },

  ringTurn: { section: 'menu', chords: ARROWS_LR, label: 'Turn the dial (or W A S D)', matchedBy: 'ring' },
  ringNext: { section: 'menu', chords: [{ key: 'Tab' }], label: 'Next choice', matchedBy: 'ring' },
  ringPrevious: { section: 'menu', chords: [{ key: 'Tab', shift: true }], label: 'Previous choice', matchedBy: 'ring' },
  ringTake: { section: 'menu', chords: [{ key: 'Enter' }, { code: 'Space' }], label: 'Take the highlighted choice', matchedBy: 'ring' },
  ringClose: { section: 'menu', chords: [{ key: 'Escape' }], label: 'Close the menu', matchedBy: 'escape-hold' },
} as const satisfies Record<string, ShortcutDeclaration>

export type ShortcutId = keyof typeof SHORTCUTS

/** The keyboard facts a chord is matched against -- a `KeyboardEvent` satisfies it. */
export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

function chordMatches(chord: KeyChord, event: KeyEventLike): boolean {
  if (chord.code !== undefined && event.code !== chord.code) return false
  if (chord.key !== undefined && event.key.toLowerCase() !== chord.key.toLowerCase()) return false
  const ctrlOk = chord.ctrl === 'or-meta'
    ? (event.ctrlKey || event.metaKey)
    : event.ctrlKey === Boolean(chord.ctrl) && !event.metaKey
  if (!ctrlOk) return false
  if (event.shiftKey !== Boolean(chord.shift)) return false
  return event.altKey === Boolean(chord.alt)
}

/**
 * Whether `event` is one of the shortcut's chords. Returns the chord that
 * matched, so a declaration with several (Alt+Left and Alt+Right) still
 * tells its handler which one was pressed.
 */
export function matchShortcut(event: KeyEventLike, id: ShortcutId): KeyChord | null {
  for (const chord of SHORTCUTS[id].chords as readonly KeyChord[]) {
    if (chordMatches(chord, event)) return chord
  }
  return null
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Enter: 'Enter',
  Tab: 'Tab',
  F1: 'F1',
}

function keyName(chord: KeyChord): string {
  if (chord.code === 'Space') return 'Space'
  const key = chord.key ?? ''
  return KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

function modifierNames(chord: KeyChord): string[] {
  const names: string[] = []
  if (chord.ctrl) names.push('Ctrl')
  if (chord.meta) names.push('Cmd')
  if (chord.shift === true) names.push('Shift')
  if (chord.alt) names.push('Alt')
  return names
}

/**
 * A declaration's chords as the reader sees them: chords sharing their
 * modifiers collapse into one combination with alternative keys
 * (`Ctrl+Shift + ← / → / ↑ / ↓`), in declaration order.
 */
export interface ChordDisplay {
  modifiers: string[]
  keys: string[]
}

/** Whether this process draws for a Mac, in the renderer and the main process alike. */
export function isMacPlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string } }).navigator
  if (nav?.platform) return nav.platform.toLowerCase().startsWith('mac')
  const proc = (globalThis as { process?: { platform?: string } }).process
  return proc?.platform === 'darwin'
}

export function displayChords(declaration: ShortcutDeclaration, mac: boolean = isMacPlatform()): ChordDisplay[] {
  const groups: ChordDisplay[] = []
  for (const chord of (mac && declaration.macChords) || declaration.chords) {
    const modifiers = modifierNames(chord)
    const name = keyName(chord)
    const existing = groups.find((group) => group.modifiers.join('+') === modifiers.join('+'))
    if (existing) {
      if (!existing.keys.includes(name)) existing.keys.push(name)
    } else {
      groups.push({ modifiers, keys: [name] })
    }
  }
  return groups
}

const PRESS_PREFIX: Record<ShortcutPress, string> = { hold: 'Hold ' }

/** Plain text, for the User Guide's table: `Hold Esc`, `Alt+← / →`. */
export function formatShortcut(declaration: ShortcutDeclaration, mac: boolean = isMacPlatform()): string {
  const text = displayChords(declaration, mac)
    .map(({ modifiers, keys }) => [...modifiers, keys.join(' / ')].join('+'))
    .join(' or ')
  return declaration.press ? `${PRESS_PREFIX[declaration.press]}${text}` : text
}

export function pressPrefix(declaration: ShortcutDeclaration): string | null {
  return declaration.press ? PRESS_PREFIX[declaration.press].trim() : null
}

export function shortcutsInSection(section: ShortcutSectionId): ShortcutDeclaration[] {
  return (Object.values(SHORTCUTS) as ShortcutDeclaration[]).filter((entry) => entry.section === section)
}

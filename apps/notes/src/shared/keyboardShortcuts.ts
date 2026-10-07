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
// gesture over time rather than a chord), and the quick-actions ring's dial
// (`editorSection/EscapeHoldPanel.tsx`). Those carry `matchedBy`, so the
// claim "this table is what the handlers read" stays checkable entry by entry.
//
// Ctrl, never Cmd, on every platform: the app has always bound Ctrl (see
// CM6Editor's markdown keymap), and that is a product choice, not an
// oversight. Smart paste is the one chord that also accepts Cmd, which is
// what `ctrl: 'or-meta'` says.

/** One physical key combination. Absent modifiers must be UP. */
export interface KeyChord {
  /** `KeyboardEvent.key`; letters compare case-insensitively. */
  key?: string
  /** `KeyboardEvent.code`, for a key whose `key` changes with modifiers (Space). */
  code?: string
  ctrl?: true | 'or-meta'
  /** `'any'` for a key that is only reachable WITH shift on some layouts (`#`). */
  shift?: true | 'any'
  alt?: true
}

/** How the chord is pressed, for the reader; a plain press when absent. */
export type ShortcutPress = 'hold' | 'hold-again'

export type ShortcutGroupId =
  | 'notes'
  | 'escape'
  | 'find'
  | 'formatting'
  | 'editing'
  | 'chapters'
  | 'tables'
  | 'menu'

export interface ShortcutDeclaration {
  group: ShortcutGroupId
  chords: readonly KeyChord[]
  /** What it does, short enough for the quick reference's one line. */
  label: string
  press?: ShortcutPress
  /**
   * Set when no handler matches this declaration through `matchShortcut`,
   * naming what binds the key instead -- see the module comment.
   */
  matchedBy?: 'codemirror' | 'escape-hold' | 'ring'
}

export const SHORTCUT_GROUPS: ReadonlyArray<{ id: ShortcutGroupId; title: string }> = [
  { id: 'notes', title: 'Notes & slots' },
  { id: 'escape', title: 'Escape' },
  { id: 'find', title: 'Find' },
  { id: 'formatting', title: 'Formatting' },
  { id: 'editing', title: 'Editing' },
  { id: 'chapters', title: 'Chapters' },
  { id: 'tables', title: 'In a table' },
  { id: 'menu', title: 'Quick actions menu' },
]

const ARROWS_LR: readonly KeyChord[] = [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }]
const ARROWS_UD: readonly KeyChord[] = [{ key: 'ArrowUp' }, { key: 'ArrowDown' }]
const withMods = (chords: readonly KeyChord[], mods: Omit<KeyChord, 'key' | 'code'>): KeyChord[] =>
  chords.map((chord) => ({ ...chord, ...mods }))

export const SHORTCUTS = {
  newNote: { group: 'notes', chords: [{ key: 'n', ctrl: true }], label: 'New note' },
  newNoteFromClipboard: { group: 'notes', chords: [{ key: 'n', ctrl: true, shift: true }], label: 'New note titled from clipboard' },
  toggleSidebar: { group: 'notes', chords: [{ code: 'Space', ctrl: true }], label: 'Show / hide sidebar' },
  immersive: { group: 'notes', chords: [{ key: 'F11' }, { code: 'Space', ctrl: true, shift: true }], label: 'Immersive mode' },
  switchSlot: { group: 'notes', chords: withMods(ARROWS_LR, { alt: true }), label: 'Previous / next slot' },
  jumpVertical: {
    group: 'notes',
    chords: withMods(ARROWS_UD, { ctrl: true }),
    label: 'Nearest flagged line, else start / end',
  },

  toggleView: { group: 'escape', chords: [{ key: 'Escape' }], label: 'Edit / render view', matchedBy: 'escape-hold' },
  quickActions: { group: 'escape', chords: [{ key: 'Escape' }], press: 'hold', label: 'Quick actions menu', matchedBy: 'escape-hold' },
  shortcutReference: { group: 'escape', chords: [{ key: 'Escape' }], press: 'hold-again', label: 'This reference, while held', matchedBy: 'escape-hold' },

  find: { group: 'find', chords: [{ key: 'f', ctrl: true }], label: 'Find in note' },
  findReplace: { group: 'find', chords: [{ key: 'h', ctrl: true }], label: 'Find & replace' },
  replaceAll: { group: 'find', chords: [{ key: 'Enter', ctrl: true }], label: 'Replace all (while finding)' },

  bold: { group: 'formatting', chords: [{ key: 'b', ctrl: true }], label: 'Bold' },
  italic: { group: 'formatting', chords: [{ key: 'i', ctrl: true }], label: 'Italic' },
  strikethrough: { group: 'formatting', chords: [{ key: 'j', ctrl: true }], label: 'Strikethrough' },
  heading: { group: 'formatting', chords: [{ key: 't', ctrl: true }], label: 'Cycle heading level' },
  bulletedList: { group: 'formatting', chords: [{ key: '-', ctrl: true }], label: 'Bulleted list' },
  numberedList: { group: 'formatting', chords: [{ key: '#', ctrl: true, shift: 'any' }, { key: '3', ctrl: true, shift: true }], label: 'Numbered list' },
  link: { group: 'formatting', chords: [{ key: 'l', ctrl: true }], label: 'Link' },
  anchor: { group: 'formatting', chords: [{ key: 'l', ctrl: true, shift: true }], label: 'Anchor' },

  undo: { group: 'editing', chords: [{ key: 'z', ctrl: true }], label: 'Undo', matchedBy: 'codemirror' },
  redo: { group: 'editing', chords: [{ key: 'y', ctrl: true }], label: 'Redo', matchedBy: 'codemirror' },
  smartPaste: { group: 'editing', chords: [{ key: 'v', ctrl: 'or-meta', shift: true }], label: 'Smart paste' },
  deleteWord: { group: 'editing', chords: [{ key: 'Backspace', ctrl: true }], label: 'Delete previous word' },

  newChapter: { group: 'chapters', chords: [{ key: 'n', shift: true, alt: true }], label: 'New chapter' },
  chapterForward: { group: 'chapters', chords: [{ key: 'Delete', shift: true, alt: true }], label: 'Cut rest to new chapter / pull next in' },
  chapterBackward: { group: 'chapters', chords: [{ key: 'Backspace', shift: true, alt: true }], label: 'Cut start to new chapter / pull previous in' },

  tableCell: { group: 'tables', chords: [{ key: 'Tab' }, { key: 'Tab', shift: true }], label: 'Next / previous cell', matchedBy: 'codemirror' },
  tableEmptyCell: { group: 'tables', chords: [{ key: 'Backspace', shift: true }], label: 'Empty the cell' },
  tableDeleteColumn: { group: 'tables', chords: [{ key: 'Backspace', ctrl: true, shift: true }], label: 'Delete the column' },
  tableMove: {
    group: 'tables',
    chords: withMods([...ARROWS_LR, ...ARROWS_UD], { ctrl: true, shift: true }),
    label: 'Move column / row',
  },
  tableLineBreak: { group: 'tables', chords: [{ key: 'Enter', shift: true }], label: 'Line break inside a row', matchedBy: 'codemirror' },

  ringTurn: {
    group: 'menu',
    chords: [...ARROWS_LR, { key: 'Tab' }, { key: 'Tab', shift: true }],
    label: 'Turn the dial (or W A S D, or the wheel)',
    matchedBy: 'ring',
  },
  ringTake: { group: 'menu', chords: [{ key: 'Enter' }, { code: 'Space' }], label: 'Take the highlighted choice', matchedBy: 'ring' },
  ringClose: { group: 'menu', chords: [{ key: 'Escape' }], label: 'Close the menu', matchedBy: 'escape-hold' },
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
  if (chord.shift !== 'any' && event.shiftKey !== Boolean(chord.shift)) return false
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
  F11: 'F11',
}

function keyName(chord: KeyChord): string {
  if (chord.code === 'Space') return 'Space'
  const key = chord.key ?? ''
  return KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

function modifierNames(chord: KeyChord): string[] {
  const names: string[] = []
  if (chord.ctrl) names.push('Ctrl')
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

export function displayChords(declaration: ShortcutDeclaration): ChordDisplay[] {
  const groups: ChordDisplay[] = []
  for (const chord of declaration.chords) {
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

const PRESS_PREFIX: Record<ShortcutPress, string> = { hold: 'Hold ', 'hold-again': 'Hold again ' }

/** Plain text, for the User Guide's table: `Hold Esc`, `F11 or Ctrl+Shift+Space`. */
export function formatShortcut(declaration: ShortcutDeclaration): string {
  const text = displayChords(declaration)
    .map(({ modifiers, keys }) => [...modifiers, keys.join(' / ')].join('+'))
    .join(' or ')
  return declaration.press ? `${PRESS_PREFIX[declaration.press]}${text}` : text
}

export function pressPrefix(declaration: ShortcutDeclaration): string | null {
  return declaration.press ? PRESS_PREFIX[declaration.press].trim() : null
}

export function shortcutsInGroup(group: ShortcutGroupId): ShortcutDeclaration[] {
  return (Object.values(SHORTCUTS) as ShortcutDeclaration[]).filter((entry) => entry.group === group)
}

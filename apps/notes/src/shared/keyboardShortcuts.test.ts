import { describe, expect, it } from 'vitest'
import { SHORTCUTS, formatShortcut, matchShortcut, type KeyChord, type ShortcutDeclaration, type ShortcutId } from './keyboardShortcuts'

const press = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; code: string }> = {}) => ({
  key,
  code: mods.code ?? '',
  ctrlKey: Boolean(mods.ctrl),
  shiftKey: Boolean(mods.shift),
  altKey: Boolean(mods.alt),
  metaKey: Boolean(mods.meta),
})

describe('keyboard shortcut declarations', () => {
  it('matches exact modifiers only', () => {
    expect(matchShortcut(press('n', { ctrl: true }), 'newNote')).not.toBeNull()
    expect(matchShortcut(press('N', { ctrl: true, shift: true }), 'newNote')).toBeNull()
    expect(matchShortcut(press('N', { ctrl: true, shift: true }), 'newNoteFromClipboard')).not.toBeNull()
    expect(matchShortcut(press('b', { ctrl: true, meta: true }), 'bold')).toBeNull()
    expect(matchShortcut(press('v', { meta: true, shift: true }), 'smartPaste')).not.toBeNull()
    expect(matchShortcut(press('#', { ctrl: true, shift: true }), 'numberedList')).not.toBeNull()
    expect(matchShortcut(press(' ', { ctrl: true, code: 'Space' }), 'toggleSidebar')).not.toBeNull()
    expect(matchShortcut(press(' ', { ctrl: true, shift: true, code: 'Space' }), 'toggleSidebar')).toBeNull()
  })

  // A chord two handler-matched declarations both claim would be decided by
  // whichever handler happens to ask first.
  it('never binds one chord to two declarations a handler matches', () => {
    const matched = (Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDeclaration]>)
      .filter(([, entry]) => !entry.matchedBy)
    for (const [id, entry] of matched) {
      for (const chord of entry.chords as readonly KeyChord[]) {
        const event = press(chord.key ?? ' ', {
          ctrl: Boolean(chord.ctrl), shift: chord.shift === true, alt: Boolean(chord.alt), code: chord.code,
        })
        const claimants = matched.filter(([other]) => matchShortcut(event, other)).map(([other]) => other)
        expect(claimants, id).toEqual([id])
      }
    }
  })

  it('formats chords for the reader', () => {
    expect(formatShortcut(SHORTCUTS.immersive)).toBe('F11 or Ctrl+Shift+Space')
    expect(formatShortcut(SHORTCUTS.switchSlot)).toBe('Alt+← / →')
    expect(formatShortcut(SHORTCUTS.quickActions)).toBe('Hold Esc')
  })
})

import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../shared/noteLifecycle'
import { noteRightPressAction } from './useNoteProtectionActions'

/**
 * `noteRightPressAction` is read from two places -- the row, to declare
 * whether a right press does anything at all, and the handler, to decide what
 * it does. That is exactly the shape that drifts once it is stated twice, so
 * it is stated once and pinned here.
 */

function note(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: 'n1', fileName: 'n1.md', title: 'n1', tags: [], createdAtMs: 0, updatedAtMs: 0,
    sizeBytes: 0, chapterOnly: false, isTimeless: false, ...overrides,
  } as NoteSummary
}

const WITH_BUTTONS = true   // the flat lists: Date, Find, Trash
const NO_BUTTONS = false    // the tree cards: Category, Archive

describe('what a right press on a note row means', () => {
  it('does nothing on a live note where the row already offers buttons', () => {
    // The removal: a hidden gesture beside a visible button is a way to file
    // a note away by accident and then wonder where it went.
    expect(noteRightPressAction(note(), WITH_BUTTONS)).toBeNull()
  })

  it('arms removal on a live note where the card has no buttons', () => {
    expect(noteRightPressAction(note(), NO_BUTTONS)).toBe('arm-removal')
  })

  it('restores an archived or deleted note in BOTH layouts', () => {
    // No view renders a restore button, so this is the only way back out --
    // it cannot be traded away with the removal gesture.
    for (const tag of ['archived', 'deleted']) {
      expect(noteRightPressAction(note({ tags: [tag] }), WITH_BUTTONS)).toBe('restore')
      expect(noteRightPressAction(note({ tags: [tag] }), NO_BUTTONS)).toBe('restore')
    }
  })

  it('never acts on an external note', () => {
    expect(noteRightPressAction(note({ tags: ['external'] }), NO_BUTTONS)).toBeNull()
  })

  it('acts on a chapter only once it is detached', () => {
    // A live chapter has no tag life of its own; one already in Trash or the
    // Archive needs the same way back as any other row.
    expect(noteRightPressAction(note({ chapterOnly: true }), NO_BUTTONS)).toBeNull()
    expect(noteRightPressAction(note({ chapterOnly: true, tags: ['deleted'] }), NO_BUTTONS)).toBe('restore')
  })

  it('is null for a row with no note at all', () => {
    expect(noteRightPressAction(undefined, NO_BUTTONS)).toBeNull()
  })
})

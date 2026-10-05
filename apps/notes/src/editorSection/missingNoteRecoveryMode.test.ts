import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../shared/noteLifecycle'
import { missingNoteRecoveryMode } from './missingNoteRecoveryMode'

const acts = { restore: () => {}, specify: () => {}, remove: () => {}, dismiss: () => {} }

function note(hasStoredCopy: boolean): NoteSummary {
  return { id: 'n', title: '# *Odd* [title]', missingFile: { hasStoredCopy } } as NoteSummary
}

describe('missing-note recovery ring', () => {
  it('defaults to restoring from the saved copy, and keeps deleting last', () => {
    expect(missingNoteRecoveryMode(note(true), acts).cells.map((cell) => cell.id)).toEqual(['restore', 'specify', 'delete'])
  })

  it('offers no restore when there is no saved copy to restore from', () => {
    expect(missingNoteRecoveryMode(note(false), acts).cells.map((cell) => cell.id)).toEqual(['specify', 'delete'])
  })

  it('keeps the reader\'s title from being read as narration markup', () => {
    expect(missingNoteRecoveryMode(note(true), acts).status?.narration[0]).toBe('**# Odd title:** *its file is missing from the notes folder*')
  })
})

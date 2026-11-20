import { describe, expect, it } from 'vitest'
import { planMarkdownExport, safeName, type ExportableNote } from './notesMarkdownExport'

const note = (id: string, title: string, tags: string[] = [], extra: Partial<ExportableNote> = {}): ExportableNote => (
  { id, title, tags, isTimeless: false, isGenerated: false, ...extra }
)
const paths = (files: ReturnType<typeof planMarkdownExport>) => files.map((f) => f.segments.join('/'))

describe('planMarkdownExport', () => {
  it('files notes by primary and secondary tag, with the Category view fallbacks', () => {
    expect(paths(planMarkdownExport([
      note('a', 'Alpha', ['work', 'meetings']),
      note('b', 'Beta', ['work']),
      note('c', 'Gamma'),
    ], []))).toEqual(['work/meetings/Alpha.md', 'work/General/Beta.md', 'Uncategorized/General/Gamma.md'])
  })

  it('gives a note with chapters a folder of its own, numbered in chapter order', () => {
    expect(paths(planMarkdownExport([
      note('p', 'Book', ['writing', 'novel']),
      note('c1', 'Second'),
      note('c2', 'First'),
      note('toc', 'Contents', [], { isGenerated: true }),
    ], [
      { parentNoteId: 'p', chapterNoteId: 'c1', position: 2 },
      { parentNoteId: 'p', chapterNoteId: 'c2', position: 1 },
      { parentNoteId: 'p', chapterNoteId: 'toc', position: 0 },
    ]))).toEqual([
      'writing/novel/Book/00 Book.md',
      'writing/novel/Book/01 First.md',
      'writing/novel/Book/02 Second.md',
    ])
  })

  it('puts archived notes under Archive and leaves out trash and the User Guide', () => {
    expect(paths(planMarkdownExport([
      note('a', 'Old', ['archived', 'work']),
      note('t', 'Gone', ['deleted', 'work']),
      note('g', 'Guide', [], { isTimeless: true }),
    ], []))).toEqual(['Archive/work/General/Old.md'])
  })

  it('never writes two notes to one name, case-insensitively', () => {
    expect(paths(planMarkdownExport([note('a', 'Plan'), note('b', 'plan'), note('c', 'Plan')], [])))
      .toEqual(['Uncategorized/General/Plan.md', 'Uncategorized/General/plan (2).md', 'Uncategorized/General/Plan (3).md'])
  })
})

describe('safeName', () => {
  it('makes a title a valid file name on every platform', () => {
    expect(safeName('a/b:c?', 'x')).toBe('a-b-c-')
    expect(safeName('CON', 'x')).toBe('_CON')
    expect(safeName('  dots... ', 'x')).toBe('dots')
    expect(safeName('', 'Untitled')).toBe('Untitled')
  })
})

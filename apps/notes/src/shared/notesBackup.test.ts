import { describe, expect, it } from 'vitest'
import {
  exportNoteText, IMAGE_IDS, importNoteText, NOTE_IDS, parseBackupManifest, planBackup, relativeLink, renameReferences,
  resolveImportIds, safeName, type BackupImageSource, type BackupNoteSource,
} from './notesBackup'

const note = (id: string, assignedId: string | null, tags: string[] = [], extra: Partial<BackupNoteSource> = {}): BackupNoteSource => (
  { id, assignedId, tags, createdAtMs: 0, updatedAtMs: 1000, isTimeless: false, isGenerated: false, ...extra }
)
const image = (id: string, tags: string[] = [], mime = 'image/png'): BackupImageSource => (
  { id, mime, tags, origin: null, createdAt: '2026-01-01T00:00:00.000Z', aliases: [] }
)
const plan = (notes: BackupNoteSource[], chapters: Parameters<typeof planBackup>[0]['chapters'] = [], images: BackupImageSource[] = [], used: string[] = []) => (
  planBackup({ notes, chapters, images, usedImageIds: new Set(used), exportedAt: '2026-11-20T00:00:00.000Z' })
)

describe('planBackup', () => {
  it('files notes by tag under notes/, named by id', () => {
    expect(plan([
      note('a', 'ALPHA', ['work', 'meetings']),
      note('b', '$2', ['work']),
      note('c', '$1'),
      note('d', 'OLD', ['archived', 'work']),
    ]).noteFiles.map((f) => f.file)).toEqual([
      'notes/Uncategorized/General/$1.md',
      'notes/work/General/$2.md',
      'notes/work/meetings/$ALPHA.md',
      'notes/Archive/work/General/$OLD.md',
    ])
  })

  it('gives a family a folder: the note and its chapters by chapter id, generated chapters left out', () => {
    const result = plan([
      note('p', 'BOOK', ['writing']),
      note('c1', null),
      note('c2', null),
      note('toc', null, [], { isGenerated: true }),
    ], [
      { parentNoteId: 'p', chapterNoteId: 'c1', position: 2, chapterId: 'END' },
      { parentNoteId: 'p', chapterNoteId: 'c2', position: 1, chapterId: '§1' },
      { parentNoteId: 'p', chapterNoteId: 'toc', position: 0, chapterId: null },
    ])
    expect(result.noteFiles.map((f) => f.file)).toEqual([
      'notes/writing/General/$BOOK/$BOOK.md',
      'notes/writing/General/$BOOK/§1.md',
      'notes/writing/General/$BOOK/§END.md',
    ])
    expect(result.manifest.notes[0].chapters.map((c) => c.chapterId)).toEqual(['§1', 'END'])
  })

  it('leaves out trashed notes, the guide, and trashed images no note uses', () => {
    const result = plan(
      [note('a', 'A', ['deleted']), note('g', 'G', [], { isTimeless: true })],
      [],
      [image('&1', ['cats']), image('&2', ['deleted']), image('&3', ['deleted'], 'image/jpeg')],
      ['&3'],
    )
    expect(result.noteFiles).toEqual([])
    expect(result.imageFiles.map((f) => f.file)).toEqual(['images/cats/General/&1.png', 'images/Uncategorized/General/&3.jpg'])
  })
})

describe('image links', () => {
  const images = new Map([['&CAT', 'images/pets (old)/General/&CAT.png']])
  const noteFile = 'notes/work/General/$A.md'

  it('are written relative and encoded, and read back to the id', () => {
    expect(relativeLink(noteFile, images.get('&CAT')!)).toBe('../../../images/pets%20%28old%29/General/%26CAT.png')
    const written = exportNoteText('See ![a cat](&cat) and `![x](&CAT)` and ![b](&MISSING)', noteFile, images)
    expect(written).toBe('See ![a cat](../../../images/pets%20%28old%29/General/%26CAT.png) and `![x](&CAT)` and ![b](&MISSING)')
    const back = importNoteText(written, noteFile, new Map([...images].map(([id, file]) => [file, id])))
    expect(back).toBe('See ![a cat](&CAT) and `![x](&CAT)` and ![b](&MISSING)')
  })
})

describe('renameReferences', () => {
  it('rewrites note links and image references in one pass, so chained renames apply once', () => {
    const text = '[a]($FOO§2#x) [b]($12) [c]($BAR) ![i](&1) `[d]($FOO)`'
    expect(renameReferences(text, new Map([['FOO', 'FOO-OLD'], ['$12', '$13'], ['FOO-OLD', 'NOPE']]), new Map([['&1', '&4']])))
      .toBe('[a]($FOO-OLD§2#x) [b]($13) [c]($BAR) ![i](&4) `[d]($FOO)`')
  })
})

describe('resolveImportIds', () => {
  const resolve = (ids: string[], existing: string[], mode: 'rename-incoming' | 'rename-existing', identical: string[] = []) => resolveImportIds({
    incoming: ids.map((id, index) => ({ key: `k${index}`, id })),
    existing: new Set(existing),
    mode,
    namespace: NOTE_IDS,
    isIdentical: (key) => identical.includes(key),
  })

  it('keeps a free id, skips an identical one, renames a conflicting incoming one', () => {
    const result = resolve(['FREE', 'SAME', 'FOO', 'FOO-NEW-X'], ['SAME', 'FOO', 'FOO-NEW'], 'rename-incoming', ['k1'])
    expect([...result.incoming.values()]).toEqual([
      { id: 'FREE', skip: false }, { id: 'SAME', skip: true }, { id: 'FOO-NEW-2', skip: false }, { id: 'FOO-NEW-X', skip: false },
    ])
    expect([...result.incomingRenames]).toEqual([['FOO', 'FOO-NEW-2']])
    expect(result.existingRenames.size).toBe(0)
  })

  it('renames the existing one instead, when asked', () => {
    const result = resolve(['FOO', '$3'], ['FOO', '$3', '$1'], 'rename-existing')
    expect([...result.incoming.values()].map((v) => v.id)).toEqual(['FOO', '$3'])
    expect([...result.existingRenames]).toEqual([['FOO', 'FOO-OLD'], ['$3', '$2']])
  })

  it('numbers every holder of an id the backup holds twice, and gives a provisional id the next free number', () => {
    const result = resolve(['DUP', 'DUP', 'DUP-1', '$5', '$5'], ['DUP-2'], 'rename-incoming')
    expect([...result.incoming.values()].map((v) => v.id)).toEqual(['DUP-2-NEW', 'DUP-3', 'DUP-1', '$1', '$2'])
    expect(result.incomingRenames.size).toBe(0)
  })

  it('treats images by the same rule, with their own provisional ids', () => {
    const result = resolveImportIds({
      incoming: [{ key: 'a', id: '&1' }, { key: 'b', id: '&LOGO' }],
      existing: new Set(['&1', '&LOGO']),
      mode: 'rename-incoming',
      namespace: IMAGE_IDS,
      isIdentical: (key) => key === 'b',
    })
    expect([...result.incoming.values()]).toEqual([{ id: '&2', skip: false }, { id: '&LOGO', skip: true }])
  })
})

describe('parseBackupManifest', () => {
  it('reads what planBackup writes and refuses anything else', () => {
    const { manifest } = plan([note('a', 'A', ['x'])], [], [image('&1')])
    expect(parseBackupManifest(JSON.parse(JSON.stringify(manifest)), 'now')).toEqual(manifest)
    expect(parseBackupManifest({ format: 'other' }, 'now')).toBeNull()
    expect(parseBackupManifest({ ...manifest, version: 99 }, 'now')).toBeNull()
  })
})

describe('safeName', () => {
  it('keeps names legal on every platform', () => {
    expect(safeName('a/b:c?', 'x')).toBe('a-b-c-')
    expect(safeName('CON', 'x')).toBe('_CON')
    expect(safeName('  ', 'x')).toBe('x')
  })
})

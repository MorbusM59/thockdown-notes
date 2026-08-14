import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { parseInternalPreviewHref } from '../src/editor/PreviewMarkdown'

describe('NoteLifecycleService auto-TOC chapter', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-autotoc-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('creates a master index where each chapter\'s own first heading is its entry -- no separate chapter-id line -- and persists a chapterId for each via ensureChapterId', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book\n\nIntro text.\n\n## Setting\n\nWorld-building.' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const ch1Text = '## Chapter One\n\n### Arrival\n\nBody.\n\n### Departure\n\nBody.'
    await lifecycle.saveNote({ id: ch1.id, text: ch1Text })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    const ch2Text = '## Second Chapter\n\n### Climax\n\nBody.'
    await lifecycle.saveNote({ id: ch2.id, text: ch2Text })

    const { chapters, created } = await lifecycle.createAutoTocChapter(parent.id)

    // Pinned first, real chapters keep their relative order after it.
    expect(chapters.map((c) => c.chapterNoteId)).toEqual([created.id, ch1.id, ch2.id])
    expect(chapters[0].position).toBe(0)

    const parentRecord = db.getNoteRecord(parent.id)
    expect(parentRecord?.assignedId).toBeTruthy()
    const parentAssignedId = parentRecord!.assignedId!

    // Neither chapter was ever explicitly assigned a chapterId, but building
    // the TOC persists one for each via ensureChapterId -- mirroring
    // ensureNoteAssignedId -- so the DB now holds a real id, not null.
    const ch1Entry = chapters.find((c) => c.chapterNoteId === ch1.id)!
    const ch2Entry = chapters.find((c) => c.chapterNoteId === ch2.id)!
    expect(ch1Entry.chapterId).toBeTruthy()
    expect(ch2Entry.chapterId).toBeTruthy()
    const ch1LinkId = ch1Entry.chapterId!
    const ch2LinkId = ch2Entry.chapterId!

    // Master index links to the parent's own heading and both chapters'
    // headings, via `heading:`-prefixed fragments (formatHeadingAnchorFragment).
    expect(created.text).toContain(`[The Book]($${parentAssignedId})`)
    expect(created.text).toContain(`[Setting]($${parentAssignedId}#heading:setting)`)

    // Each chapter's own first heading IS its entry -- no separate,
    // redundant chapter-id-labeled line above it.
    expect(created.text).toContain(`- [Chapter One]($${parentAssignedId}§${ch1LinkId})`)
    expect(created.text).toContain(`  - [Arrival]($${parentAssignedId}§${ch1LinkId}#heading:arrival)`)
    expect(created.text).toContain(`  - [Departure]($${parentAssignedId}§${ch1LinkId}#heading:departure)`)
    expect(created.text).toContain(`- [Second Chapter]($${parentAssignedId}§${ch2LinkId})`)
    expect(created.text).toContain(`  - [Climax]($${parentAssignedId}§${ch2LinkId}#heading:climax)`)
    expect(created.text).not.toContain(`[${ch1LinkId}]($${parentAssignedId}§${ch1LinkId})`)
    expect(created.text).not.toContain(`[${ch2LinkId}]($${parentAssignedId}§${ch2LinkId})`)

    // The TOC chapter never lists itself.
    expect(created.text).not.toContain('Table of Contents]($')

    // The parent's and every chapter's own heading source is untouched by
    // regeneration -- no `[Label](#id)` ever gets written into content the
    // user didn't explicitly anchor themselves.
    const parentDoc = await lifecycle.loadNote({ id: parent.id })
    expect(parentDoc.text).toContain('## Setting')
    expect(parentDoc.text).not.toContain('](#')
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe(ch1Text)
    const ch2Doc = await lifecycle.loadNote({ id: ch2.id })
    expect(ch2Doc.text).toBe(ch2Text)
  })

  it('falls back to the (persisted) chapterId as the entry label for a chapter with no heading at all yet', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: 'Just some plain text, no heading yet.' })

    const { created, chapters } = await lifecycle.createAutoTocChapter(parent.id)
    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    const chapterId = chapters.find((c) => c.chapterNoteId === ch1.id)!.chapterId!

    expect(created.text).toContain(`- [${chapterId}]($${parentAssignedId}§${chapterId})`)
  })

  it('dedupes two unassigned sibling chapters whose content snippet derives the same base id, persisting both as distinct ids', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    // Deliberately derives the exact same base id as ch1 above
    // ("Chapter" -> "CHAPTER") -- ensureChapterId's dedup runs against
    // whatever's already PERSISTED, so processing ch1 first and writing its
    // id immediately is what makes ch2's own lookup see it and pick "-2".
    await lifecycle.saveNote({ id: ch2.id, text: '## Chapter Two\n\nBody.' })

    const { created, chapters } = await lifecycle.createAutoTocChapter(parent.id)

    const ch1LinkId = chapters.find((c) => c.chapterNoteId === ch1.id)!.chapterId!
    const ch2LinkId = chapters.find((c) => c.chapterNoteId === ch2.id)!.chapterId!
    expect(ch1LinkId).toBe('CHAPTER')
    expect(ch2LinkId).toBe('CHAPTER-2')
    expect(created.text).toContain(`§${ch1LinkId})`)
    expect(created.text).toContain(`§${ch2LinkId})`)
    // Both got persisted -- the whole point of ensureChapterId.
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBe('CHAPTER')
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch2.id)!.chapterId).toBe('CHAPTER-2')
  })

  it('regenerating twice with nothing changed is a true no-op on the TOC chapter\'s own updatedAtMs', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Solo\n\n## Only Heading\n\nBody.' })
    const { created: first } = await lifecycle.createAutoTocChapter(parent.id)

    await new Promise((resolve) => setTimeout(resolve, 5))
    const { created: second } = await lifecycle.regenerateAutoTocChapter(parent.id)

    expect(second.text).toBe(first.text)
    expect(second.updatedAtMs).toBe(first.updatedAtMs)
  })

  it('regenerating after a new heading is added elsewhere picks it up', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.' })
    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId!
    expect(created.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#heading:second)`)
  })

  it('throws creating a second auto-TOC chapter for the same parent', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    await lifecycle.createAutoTocChapter(parent.id)
    await expect(lifecycle.createAutoTocChapter(parent.id)).rejects.toThrow()
  })

  it('throws regenerating a parent with no auto-TOC chapter', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    await expect(lifecycle.regenerateAutoTocChapter(parent.id)).rejects.toThrow()
  })

  it('never walks the auto-Open-Items chapter as a real chapter (regression: previously produced duplicate, malformed entries for its own group headings)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const bugs = await lifecycle.createChapterNote(parent.id)
    const features = await lifecycle.createChapterNote(parent.id)
    // The auto-Open-Items chapter only ever gets created once an auto-TOC
    // chapter already exists (regenerateOpenItemsGroup's own precondition).
    await lifecycle.createAutoTocChapter(parent.id)

    await lifecycle.saveNote({ id: bugs.id, text: '## Bugs\n\n- [ ] Fix the thing' })
    await lifecycle.saveNote({ id: features.id, text: '## Features\n\n- [ ] Ship the thing' })

    // Saving with unchecked items auto-creates/updates the Open Items
    // chapter, whose own text ends up with "## Bugs" / "## Features" group
    // headings -- the exact shape that used to leak into the TOC below.
    const openItemsChapterNoteId = db.listChaptersForNote(parent.id)
      .find((c) => db.getNoteRecord(c.chapterNoteId)?.isAutoOpenItems)?.chapterNoteId
    expect(openItemsChapterNoteId).toBeTruthy()

    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // Only the parent and the two real chapters are indexed, each labeled
    // with its own first heading.
    expect(created.text).toContain('[Bugs](')
    expect(created.text).toContain('[Features](')
    // The Open Items chapter itself, and its internal group headings, must
    // never appear as TOC entries or link targets.
    expect(created.text).not.toContain('Open Items]($')
    expect(created.text).not.toContain('§OPEN')
    // No nested/duplicated link syntax like "[## [Bugs](#bugs)](...)".
    expect(created.text).not.toMatch(/\[##/)
    expect((created.text.match(/\[Bugs\]/g) ?? []).length).toBe(1)
    expect((created.text.match(/\[Features\]/g) ?? []).length).toBe(1)
  })

  it('regenerates the TOC automatically as a side effect of saving a chapter with an edited heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    // No explicit regenerateAutoTocChapter call -- saveNote itself should
    // pick up the new heading and refresh the TOC chapter on this save.
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.' })

    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId!
    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const tocDoc = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(tocDoc.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#heading:second)`)

    // Not a literal anchor definition -- the chapter's own heading source is
    // exactly what the user typed, untouched by the TOC refresh that just ran.
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe('## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.')
  })

  it('does not regenerate the TOC when a save does not touch any heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const before = await lifecycle.loadNote({ id: tocChapterNoteId })

    await new Promise((resolve) => setTimeout(resolve, 5))
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nDifferent body text, no heading change.' })

    const after = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(after.updatedAtMs).toBe(before.updatedAtMs)
  })

  it('does not recurse or duplicate-regenerate when a save-triggered TOC refresh saves the TOC chapter\'s own text', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    // A new heading triggers headingsChanged's save-time gate, which saves
    // the TOC chapter's own (skipAutoChapterHooks-guarded) text -- exactly
    // the path that could recurse into itself without that guard.
    await expect(
      lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.' }),
    ).resolves.toBeTruthy()

    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const tocDoc = await lifecycle.loadNote({ id: tocChapterNoteId })
    // Exactly one entry for the new heading, not duplicated by a second
    // recursive regeneration pass.
    expect((tocDoc.text.match(/\[Second\]/g) ?? []).length).toBe(1)
  })

  it('never derives a chapter\'s "title" from its level-2 heading -- chapters have no title concept, only a chapterId (titleFromText stays level-1-only)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const saved = await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })

    // titleFromText only recognizes level 1 -- a chapter's own level-2
    // first line falls through to the raw-first-line fallback, hashes and
    // all. That's fine: nothing chapter-facing reads `.title` (see the
    // regression test below), only ensureChapterId's own content-snippet
    // derivation.
    expect(saved.title).toBe('## Chapter One')
  })

  it('regression: a chapter\'s TOC link resolves back to that chapter -- the persisted chapterId in the DB is exactly what the href uses', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### Setting\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    // Deliberately shares ch1's own first-heading text, so this also proves
    // the dedup-then-persist model doesn't let two chapters' hrefs collide.
    await lifecycle.saveNote({ id: ch2.id, text: '## Chapter One\n\n### Elsewhere\n\nBody.' })

    const { created, chapters } = await lifecycle.createAutoTocChapter(parent.id)
    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!

    const hrefMatch = /\[Elsewhere\]\((\$[^)]+)\)/.exec(created.text)
    expect(hrefMatch).toBeTruthy()
    const parsed = parseInternalPreviewHref(hrefMatch![1])
    expect(parsed?.kind).toBe('internal-link')
    if (parsed?.kind !== 'internal-link') throw new Error('unreachable')
    expect(parsed.noteIdRaw).toBe(parentAssignedId)

    const ch2Entry = chapters.find((c) => c.chapterNoteId === ch2.id)!
    expect(ch2Entry.chapterId).toBeTruthy()
    expect(ch2Entry.chapterId).toBe(parsed.chapterIdRaw)
  })

  it('derives a clean link id from a content snippet, never from `.title`, and persists it via ensureChapterId', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })
    const { created, chapters } = await lifecycle.createAutoTocChapter(parent.id)

    // deriveDefaultAssignedIdBase truncates to 8 chars: the word-boundary
    // snippet "Chapter" already fits, so it comes through unchanged.
    const ch1LinkId = chapters.find((c) => c.chapterNoteId === ch1.id)!.chapterId!
    expect(ch1LinkId).toBe('CHAPTER')
    expect(created.text).not.toContain('##')
    // Persisted -- ensureChapterId's whole point, unlike the old live stand-in.
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBe('CHAPTER')
  })
})

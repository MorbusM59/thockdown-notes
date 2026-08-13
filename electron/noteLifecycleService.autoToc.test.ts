import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

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

  it('creates a pinned, anchor-linked master index across the parent and every chapter', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book\n\nIntro text.\n\n## Setting\n\nWorld-building.' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## Arrival\n\nBody.\n\n## Departure\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch2.id, text: '# Chapter Two\n\n## Climax\n\nBody.' })

    const { chapters, created } = await lifecycle.createAutoTocChapter(parent.id)

    // Pinned first, real chapters keep their relative order after it.
    expect(chapters.map((c) => c.chapterNoteId)).toEqual([created.id, ch1.id, ch2.id])
    expect(chapters[0].position).toBe(0)

    const parentRecord = db.getNoteRecord(parent.id)
    expect(parentRecord?.assignedId).toBeTruthy()
    const parentAssignedId = parentRecord!.assignedId!

    const ch1Entry = chapters.find((c) => c.chapterNoteId === ch1.id)!
    const ch2Entry = chapters.find((c) => c.chapterNoteId === ch2.id)!
    expect(ch1Entry.chapterId).toBeTruthy()
    expect(ch2Entry.chapterId).toBeTruthy()

    // Master index links to the parent's own heading and both chapters'
    // headings. The parent has a real title ("The Book"); each chapter has
    // no title concept at all, so its own entry is labeled with its
    // chapterId instead (see ensureChapterId's doc comment).
    expect(created.text).toContain(`[The Book]($${parentAssignedId})`)
    expect(created.text).toContain(`[Setting]($${parentAssignedId}#setting)`)
    expect(created.text).toContain(`[${ch1Entry.chapterId}]($${parentAssignedId}§${ch1Entry.chapterId})`)
    expect(created.text).toContain(`[Arrival]($${parentAssignedId}§${ch1Entry.chapterId}#arrival)`)
    expect(created.text).toContain(`[Departure]($${parentAssignedId}§${ch1Entry.chapterId}#departure)`)
    expect(created.text).toContain(`[${ch2Entry.chapterId}]($${parentAssignedId}§${ch2Entry.chapterId})`)
    expect(created.text).toContain(`[Climax]($${parentAssignedId}§${ch2Entry.chapterId}#climax)`)

    // The TOC chapter never lists itself.
    expect(created.text).not.toContain('Table of Contents]($')

    // The links actually resolve: each target note carries a literal anchor
    // definition for the id the TOC points at (PreviewMarkdown.tsx requires
    // an exact `](#id)` match, not on-the-fly slugification).
    const parentDoc = await lifecycle.loadNote({ id: parent.id })
    expect(parentDoc.text).toContain('## [Setting](#setting)')
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toContain('## [Arrival](#arrival)')
    expect(ch1Doc.text).toContain('## [Departure](#departure)')
    // The chapter's own title heading is left alone, same convention as the
    // single-note TOC button skipping the note's own H1.
    expect(ch1Doc.text).toContain('# Chapter One')
    expect(ch1Doc.text).not.toContain('[Chapter One](#')
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
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.' })
    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId
    expect(created.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#second)`)
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

    await lifecycle.saveNote({ id: bugs.id, text: '# Bugs\n\n- [ ] Fix the thing' })
    await lifecycle.saveNote({ id: features.id, text: '# Features\n\n- [ ] Ship the thing' })

    // Saving with unchecked items auto-creates/updates the Open Items
    // chapter, whose own text ends up with "## Bugs" / "## Features" group
    // headings -- the exact shape that used to leak into the TOC below.
    const openItemsChapterNoteId = db.listChaptersForNote(parent.id)
      .find((c) => {
        const record = db.getNoteRecord(c.chapterNoteId)
        return record?.isAutoOpenItems
      })?.chapterNoteId
    expect(openItemsChapterNoteId).toBeTruthy()

    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // Only the parent and the two real chapters are indexed, each labeled
    // with its own chapterId (chapters have no title concept).
    const bugsChapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === bugs.id)!.chapterId
    const featuresChapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === features.id)!.chapterId
    expect(created.text).toContain(`[${bugsChapterId}]($`)
    expect(created.text).toContain(`[${featuresChapterId}]($`)
    // The Open Items chapter itself, and its internal group headings, must
    // never appear as TOC entries or link targets.
    expect(created.text).not.toContain('Open Items]($')
    expect(created.text).not.toContain('§OPEN')
    // No nested/duplicated link syntax like "[## [Bugs](#bugs)](...)".
    expect(created.text).not.toMatch(/\[##/)
    expect((created.text.match(new RegExp(`\\[${bugsChapterId}\\]`, 'g')) ?? []).length).toBe(1)
    expect((created.text.match(new RegExp(`\\[${featuresChapterId}\\]`, 'g')) ?? []).length).toBe(1)
  })

  it('regenerates the TOC automatically as a side effect of saving a chapter with an edited heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    // No explicit regenerateAutoTocChapter call -- saveNote itself should
    // pick up the new heading and refresh the TOC chapter on this save.
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.' })

    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId
    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const tocDoc = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(tocDoc.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#second)`)
  })

  it('does not regenerate the TOC when a save does not touch any heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const before = await lifecycle.loadNote({ id: tocChapterNoteId })

    await new Promise((resolve) => setTimeout(resolve, 5))
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nDifferent body text, no heading change.' })

    const after = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(after.updatedAtMs).toBe(before.updatedAtMs)
  })

  it('does not recurse or duplicate-regenerate when a save-triggered TOC refresh anchors headings in the same save', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    // Adding a brand-new, not-yet-anchored heading forces regenerateAutoTocChapter's
    // own internal saveNote (to persist the newly-anchored chapter text) --
    // exactly the path that could recurse into itself without the
    // skipAutoChapterHooks guard.
    await expect(
      lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.' }),
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
    // regression tests below), only ensureChapterId's own content-snippet
    // derivation.
    expect(saved.title).toBe('## Chapter One')
  })

  it('derives a clean chapterId default from a content snippet, never from `.title` (regression: a corrupted "##..." title used to leak into ensureChapterId)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId
    expect(chapterId).toBeTruthy()
    expect(chapterId).not.toContain('#')
    // deriveDefaultAssignedIdBase truncates to 8 chars: "Chapter One" -> "CHAPTER-ONE" -> "CHAPTER" (trailing hyphen stripped).
    expect(chapterId).toBe('CHAPTER')
  })

  it('labels a chapter\'s own top-level TOC entry with its chapterId, never `.title` (regression: TOC used to show a chapter\'s corrupted "##..." title as the link label)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })
    const { created } = await lifecycle.createAutoTocChapter(parent.id)

    const chapterId = db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId
    // The chapter's own top-level index line -- not its "## Chapter One"
    // heading's own anchor sub-entry, which legitimately still shows "Chapter
    // One" as a regular anchored heading (a chapter has no level-1 title for
    // anchorizeHeadings to skip, so its only heading is anchored like any
    // other).
    expect(created.text).toContain(`- [${chapterId}]($${db.getNoteRecord(parent.id)!.assignedId}§${chapterId})`)
    expect(created.text).not.toContain('##')
  })
})

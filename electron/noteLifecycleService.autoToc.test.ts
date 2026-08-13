import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService, deriveDefaultAssignedIdBase } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { deriveChapterContentSnippet } from '../src/shared/tabLabels'

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
    const ch1Text = '# Chapter One\n\n## Arrival\n\nBody.\n\n## Departure\n\nBody.'
    await lifecycle.saveNote({ id: ch1.id, text: ch1Text })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    const ch2Text = '# Second Chapter\n\n## Climax\n\nBody.'
    await lifecycle.saveNote({ id: ch2.id, text: ch2Text })

    const { chapters, created } = await lifecycle.createAutoTocChapter(parent.id)

    // Pinned first, real chapters keep their relative order after it.
    expect(chapters.map((c) => c.chapterNoteId)).toEqual([created.id, ch1.id, ch2.id])
    expect(chapters[0].position).toBe(0)

    const parentRecord = db.getNoteRecord(parent.id)
    expect(parentRecord?.assignedId).toBeTruthy()
    const parentAssignedId = parentRecord!.assignedId!

    // Neither chapter was ever explicitly assigned a chapterId -- the TOC's
    // own link ids are live, unpersisted stand-ins derived from content
    // (getChapterLinkId), so `chapters[].chapterId` itself stays null; the
    // DB is never touched just by regenerating the TOC.
    const ch1Entry = chapters.find((c) => c.chapterNoteId === ch1.id)!
    const ch2Entry = chapters.find((c) => c.chapterNoteId === ch2.id)!
    expect(ch1Entry.chapterId).toBeNull()
    expect(ch2Entry.chapterId).toBeNull()
    const ch1LinkId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet(ch1Text))
    const ch2LinkId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet(ch2Text))

    // Master index links to the parent's own heading and both chapters'
    // headings. The parent has a real title ("The Book"); each chapter has
    // no title concept at all, so its own entry is labeled with its
    // (unpersisted) link id instead (see getChapterLinkId's doc comment).
    expect(created.text).toContain(`[The Book]($${parentAssignedId})`)
    expect(created.text).toContain(`[Setting]($${parentAssignedId}#setting)`)
    expect(created.text).toContain(`[${ch1LinkId}]($${parentAssignedId}§${ch1LinkId})`)
    expect(created.text).toContain(`[Arrival]($${parentAssignedId}§${ch1LinkId}#arrival)`)
    expect(created.text).toContain(`[Departure]($${parentAssignedId}§${ch1LinkId}#departure)`)
    expect(created.text).toContain(`[${ch2LinkId}]($${parentAssignedId}§${ch2LinkId})`)
    expect(created.text).toContain(`[Climax]($${parentAssignedId}§${ch2LinkId}#climax)`)

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

  it('dedupes two unassigned sibling chapters that happen to derive the same link id, without persisting either', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    // Deliberately derives the exact same base link id as ch1 above
    // ("Chapter" -> "CHAPTER") -- getChapterLinkId's own dedup only checks
    // PERSISTED ids (there are none here), so without an in-pass dedup this
    // would silently produce two identical `§CHAPTER` link targets.
    await lifecycle.saveNote({ id: ch2.id, text: '# Chapter Two\n\nBody.' })

    const { created } = await lifecycle.createAutoTocChapter(parent.id)

    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!
    expect(created.text).toContain(`[CHAPTER]($${parentAssignedId}§CHAPTER)`)
    expect(created.text).toContain(`[CHAPTER-2]($${parentAssignedId}§CHAPTER-2)`)
    // Neither ever got persisted.
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBeNull()
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch2.id)!.chapterId).toBeNull()
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
    const chapterId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet('# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.'))
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
    // with its own (unpersisted) link id (chapters have no title concept).
    const bugsChapterId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet('# Bugs\n\n- [ ] Fix the thing'))
    const featuresChapterId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet('# Features\n\n- [ ] Ship the thing'))
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
    const chapterId = deriveDefaultAssignedIdBase(deriveChapterContentSnippet('# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.'))
    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const tocDoc = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(tocDoc.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#second)`)

    // Not just a TOC entry -- the heading itself, in the chapter's own
    // body, is a real `[Second](#second)` anchor definition the TOC link
    // can land on (no separate "toggle TOC on this note" step required).
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toContain('## [Second](#second)')
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
    // regression test below), only getChapterLinkId's own content-snippet
    // derivation.
    expect(saved.title).toBe('## Chapter One')
  })

  it('derives a clean link id from a content snippet, never from `.title`, and never persists it (regression: a corrupted "##..." title used to leak into the old ensureChapterId)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })
    const { created } = await lifecycle.createAutoTocChapter(parent.id)

    // deriveDefaultAssignedIdBase truncates to 8 chars: the word-boundary
    // snippet "Chapter" already fits, so it comes through unchanged.
    expect(created.text).toContain(`[CHAPTER]($${db.getNoteRecord(parent.id)!.assignedId}§CHAPTER)`)
    expect(created.text).not.toContain('##')
    // Only ever a live, recomputed stand-in -- never written to the DB.
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBeNull()
  })
})

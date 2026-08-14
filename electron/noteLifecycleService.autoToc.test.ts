import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService, deriveDefaultAssignedIdBase } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { deriveChapterContentSnippet, resolveChapterLinkIds } from '../src/shared/tabLabels'
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
    // headings, via `heading:`-prefixed fragments (formatHeadingAnchorFragment)
    // -- the automatic, on-the-fly anchor mechanism, never a literal
    // definition written into the target note. The parent has a real title
    // ("The Book"); each chapter has no title concept at all, so its own
    // entry is labeled with its (unpersisted) link id instead (see
    // getChapterLinkId's doc comment).
    expect(created.text).toContain(`[The Book]($${parentAssignedId})`)
    expect(created.text).toContain(`[Setting]($${parentAssignedId}#heading:setting)`)
    expect(created.text).toContain(`[${ch1LinkId}]($${parentAssignedId}§${ch1LinkId})`)
    expect(created.text).toContain(`[Arrival]($${parentAssignedId}§${ch1LinkId}#heading:arrival)`)
    expect(created.text).toContain(`[Departure]($${parentAssignedId}§${ch1LinkId}#heading:departure)`)
    expect(created.text).toContain(`[${ch2LinkId}]($${parentAssignedId}§${ch2LinkId})`)
    expect(created.text).toContain(`[Climax]($${parentAssignedId}§${ch2LinkId}#heading:climax)`)

    // The TOC chapter never lists itself.
    expect(created.text).not.toContain('Table of Contents]($')

    // The whole point: the parent's and every chapter's own heading source
    // is untouched by regeneration -- no `[Label](#id)` ever gets written
    // into content the user didn't explicitly anchor themselves.
    const parentDoc = await lifecycle.loadNote({ id: parent.id })
    expect(parentDoc.text).toContain('## Setting')
    expect(parentDoc.text).not.toContain('](#')
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe(ch1Text)
    expect(ch1Doc.text).not.toContain('](#')
    const ch2Doc = await lifecycle.loadNote({ id: ch2.id })
    expect(ch2Doc.text).toBe(ch2Text)
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
    expect(tocDoc.text).toContain(`[Second]($${parentAssignedId}§${chapterId}#heading:second)`)

    // Not a literal anchor definition -- the chapter's own heading source is
    // exactly what the user typed, untouched by the TOC refresh that just ran.
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe('# Chapter One\n\n## First\n\nBody.\n\n## Second\n\nMore.')
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

  it('does not recurse or duplicate-regenerate when a save-triggered TOC refresh saves the TOC chapter\'s own text', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## First\n\nBody.' })
    await lifecycle.createAutoTocChapter(parent.id)

    // A new heading triggers headingsChanged's save-time gate, which saves
    // the TOC chapter's own (skipAutoChapterHooks-guarded) text -- exactly
    // the path that could recurse into itself without that guard.
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

  it('regression: an unassigned chapter\'s TOC link actually resolves back to that chapter (the renderer\'s own resolveChapterLinkIds call must match TOC generation exactly)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## Setting\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    // Deliberately collides with ch1's own derived base id, so dedup has to
    // actually run on both the generation side and the resolution side.
    await lifecycle.saveNote({ id: ch2.id, text: '# Chapter One\n\n## Elsewhere\n\nBody.' })

    const { created } = await lifecycle.createAutoTocChapter(parent.id)
    const parentAssignedId = db.getNoteRecord(parent.id)!.assignedId!

    // Pull the exact href the TOC generated for ch2's own heading link, the
    // same way a click in the real app would see it.
    const hrefMatch = /\[Elsewhere\]\((\$[^)]+)\)/.exec(created.text)
    expect(hrefMatch).toBeTruthy()
    const parsed = parseInternalPreviewHref(hrefMatch![1])
    expect(parsed?.kind).toBe('internal-link')
    if (parsed?.kind !== 'internal-link') throw new Error('unreachable')
    expect(parsed.noteIdRaw).toBe(parentAssignedId)
    expect(parsed.chapterIdRaw).toBeTruthy()

    // Independently resolve that chapter segment exactly the way
    // navigateToInternalPreviewLink does: fetch the real chapter rows and
    // content, run resolveChapterLinkIds, match by id.
    const realChapterRows = db.listChaptersForNote(parent.id).filter((row) => row.chapterNoteId !== created.id)
    const chapterDocs = await Promise.all(realChapterRows.map((row) => lifecycle.loadNote({ id: row.chapterNoteId })))
    const chapterLinkIds = resolveChapterLinkIds(realChapterRows.map((row) => ({
      chapterNoteId: row.chapterNoteId,
      chapterId: row.chapterId,
      contentText: chapterDocs.find((doc) => doc.id === row.chapterNoteId)!.text,
    })))
    const matchedChapterNoteId = Array.from(chapterLinkIds.entries())
      .find(([, id]) => id === parsed.chapterIdRaw)?.[0]

    expect(matchedChapterNoteId).toBe(ch2.id)
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

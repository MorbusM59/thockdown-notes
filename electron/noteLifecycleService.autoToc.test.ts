import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'
import { parseInternalNoteLink } from '../src/shared/internalNoteLinks'

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

  it('creates a master index where each chapter\'s own first heading is its entry -- no separate chapter-id line', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book\n\nIntro text.\n\n## Setting\n\nWorld-building.' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const ch1Text = '## Chapter One\n\n### Arrival\n\nBody.\n\n### Departure\n\nBody.'
    await lifecycle.saveNote({ id: ch1.id, text: ch1Text })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    const ch2Text = '## Second Chapter\n\n### Climax\n\nBody.'
    await lifecycle.saveNote({ id: ch2.id, text: ch2Text })

    // createNote already gave the parent an auto-TOC chapter at birth --
    // regenerate to pick up the chapters/headings added since.
    const { chapters, created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // Pinned first, real chapters keep their relative order after it.
    expect(chapters.map((c) => c.chapterNoteId)).toEqual([created.id, ch1.id, ch2.id])
    expect(chapters[0].position).toBe(0)

    // Master index links to the parent's own heading and both chapters'
    // headings, via the internal-only `@noteId[#fragment]` scheme -- no
    // assigned id required anywhere.
    expect(created.text).toContain(`[The Book](@${parent.id})`)
    expect(created.text).toContain(`[Setting](@${parent.id}#heading:setting)`)

    // The parent's own title is a bold root line, not a bulleted entry --
    // and its own `##` headings (here just "Setting") sit flush with every
    // chapter title at depth 0, not indented under the root line.
    expect(created.text).toContain(`**[The Book](@${parent.id})**`)
    expect(created.text).toContain(`- [Setting](@${parent.id}#heading:setting)`)
    expect(created.text).not.toContain(`- [The Book](@${parent.id})`)
    expect(created.text).not.toContain(`  - [Setting](@${parent.id}#heading:setting)`)

    // Each chapter's own first heading IS its entry -- no separate,
    // redundant chapter-id-labeled line above it.
    expect(created.text).toContain(`- [Chapter One](@${ch1.id})`)
    expect(created.text).toContain(`  - [Arrival](@${ch1.id}#heading:arrival)`)
    expect(created.text).toContain(`  - [Departure](@${ch1.id}#heading:departure)`)
    expect(created.text).toContain(`- [Second Chapter](@${ch2.id})`)
    expect(created.text).toContain(`  - [Climax](@${ch2.id}#heading:climax)`)

    // The TOC chapter never lists itself.
    expect(created.text).not.toContain('Table of Contents](')

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

  it('never assigns any id itself, and the TOC is fully linked regardless -- internal navigation has no dependency on assigned ids at all', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book\n\n## Setting\n\nWorld-building.' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### Arrival\n\nBody.' })

    const { created, chapters } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // Nothing got auto-assigned -- not the parent's assignedId, not the
    // chapter's chapterId. That's the whole point: an id only ever exists
    // because the user explicitly set one, and the TOC never needs one.
    expect(db.getNoteRecord(parent.id)!.assignedId).toBeNull()
    expect(chapters.find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBeNull()

    expect(created.text).toBe([
      '# Table of Contents',
      '',
      `**[The Book](@${parent.id})**`,
      `- [Setting](@${parent.id}#heading:setting)`,
      `- [Chapter One](@${ch1.id})`,
      `  - [Arrival](@${ch1.id}#heading:arrival)`,
    ].join('\n'))
  })

  it('an unassigned parent and chapter both still produce fully working internal links', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### Arrival\n\nBody.' })

    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    expect(created.text).toContain(`[Chapter One](@${ch1.id})`)
    expect(created.text).toContain(`[Arrival](@${ch1.id}#heading:arrival)`)
  })

  it('regression: an unassigned chapter\'s own ## heading is still clickable in the TOC -- routed via the chapter\'s own real internal note id', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### Arrival\n\nBody.' })

    const { created, chapters } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // Still never assigned -- the link works without one.
    expect(chapters.find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBeNull()

    const hrefMatch = /\[Chapter One\]\((@[^)]+)\)/.exec(created.text)
    expect(hrefMatch).toBeTruthy()
    const parsed = parseInternalNoteLink(hrefMatch![1])
    expect(parsed).toBeTruthy()
    // The routing id is the chapter's own raw internal note id -- never a
    // human-friendly string, never shown as the visible label above.
    expect(parsed!.noteId).toBe(ch1.id)
    expect(created.text).toContain(`[Arrival](@${ch1.id}#heading:arrival)`)
  })

  it('falls back to the same derived label its own pill would show for a chapter with no heading at all yet', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: 'Just some plain text, no heading yet.' })

    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    // resolveIdentityLabel's own fallback for content with no matching
    // heading is the literal "Missing title" (see tabLabels.ts's own doc
    // comment and noteListMeta.test.ts's coverage of
    // resolveIdentityLabel(null, 'plain intro', ...)) -- not a snippet
    // derived from the content itself.
    expect(created.text).toContain(`[Missing title](@${ch1.id})`)
  })

  it('regenerating twice with nothing changed is a true no-op on the TOC chapter\'s own updatedAtMs', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Solo\n\n## Only Heading\n\nBody.' })
    // createNote already gave the parent an auto-TOC chapter at birth.
    const { created: first } = await lifecycle.regenerateAutoTocChapter(parent.id)

    await new Promise((resolve) => setTimeout(resolve, 5))
    const { created: second } = await lifecycle.regenerateAutoTocChapter(parent.id)

    expect(second.text).toBe(first.text)
    expect(second.updatedAtMs).toBe(first.updatedAtMs)
  })

  it('regenerating after a new heading is added elsewhere picks it up', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })

    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.' })
    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    expect(created.text).toContain('- [Second]')
  })

  it('throws creating a second auto-TOC chapter for the same parent', async () => {
    // createNote already gave the parent an auto-TOC chapter at birth.
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    await expect(lifecycle.createAutoTocChapter(parent.id)).rejects.toThrow()
  })

  it('throws regenerating a parent with no auto-TOC chapter', async () => {
    // skipAutoToc: true is an internal-only escape hatch (see createNote's
    // own doc comment) -- the only way to get a parent without one at all.
    const parent = await lifecycle.createNote({ initialText: '# Book' }, { skipAutoToc: true })
    await expect(lifecycle.regenerateAutoTocChapter(parent.id)).rejects.toThrow()
  })

  it('never walks the auto-Open-Items chapter as a real chapter (regression: previously produced duplicate, malformed entries for its own group headings)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const bugs = await lifecycle.createChapterNote(parent.id)
    const features = await lifecycle.createChapterNote(parent.id)
    // createNote already gave the parent an auto-TOC chapter at birth --
    // the auto-Open-Items chapter only ever gets created once an auto-TOC
    // chapter already exists (regenerateOpenItemsGroup's own precondition).

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
    expect(created.text).toContain('- [Bugs]')
    expect(created.text).toContain('- [Features]')
    // The Open Items chapter itself, and its internal group headings, must
    // never appear as TOC entries or link targets.
    expect(created.text).not.toContain('Open Items')
    // No nested/duplicated syntax like "- ## Bugs".
    expect(created.text).not.toMatch(/-\s*##/)
    expect((created.text.match(/^- \[Bugs\]/gm) ?? []).length).toBe(1)
    expect((created.text.match(/^- \[Features\]/gm) ?? []).length).toBe(1)
  })

  it('regenerates the TOC automatically as a side effect of saving a chapter with an edited heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })

    // No explicit regenerateAutoTocChapter call -- saveNote itself should
    // pick up the new heading and refresh the TOC chapter on this save.
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.' })

    const tocChapterNoteId = db.getAutoTocChapterNoteId(parent.id)!
    const tocDoc = await lifecycle.loadNote({ id: tocChapterNoteId })
    expect(tocDoc.text).toContain('- [Second]')

    // The chapter's own heading source is exactly what the user typed,
    // untouched by the TOC refresh that just ran.
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe('## Chapter One\n\n### First\n\nBody.\n\n### Second\n\nMore.')
  })

  it('does not regenerate the TOC when a save does not touch any heading', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### First\n\nBody.' })

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
    expect((tocDoc.text.match(/^\s*- \[Second\]/gm) ?? []).length).toBe(1)
  })

  it('never derives a chapter\'s "title" from its level-2 heading -- chapters have no title concept, only a chapterId (titleFromText stays level-1-only)', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const saved = await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\nBody.' })

    // titleFromText only recognizes level 1 -- a chapter's own level-2
    // first line doesn't match, so it falls straight to the literal
    // "Missing title" (see databaseService.ts's own titleFromText). That's
    // fine: nothing chapter-facing reads `.title`, only the chapter's own
    // chapterId (if assigned) or a derived content snippet
    // (resolveIdentityLabel, tabLabels.ts).
    expect(saved.title).toBe('Missing title')
  })

  it('two chapters sharing the same first-heading text still resolve to distinct targets, since links are keyed by real internal note id', async () => {
    const parent = await lifecycle.createNote({ initialText: '# Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '## Chapter One\n\n### Setting\n\nBody.' })
    const ch2 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.saveNote({ id: ch2.id, text: '## Chapter One\n\n### Elsewhere\n\nBody.' })

    const { created } = await lifecycle.regenerateAutoTocChapter(parent.id)

    const hrefMatch = /\[Elsewhere\]\((@[^)]+)\)/.exec(created.text)
    expect(hrefMatch).toBeTruthy()
    const parsed = parseInternalNoteLink(hrefMatch![1])
    expect(parsed).toBeTruthy()
    expect(parsed!.noteId).toBe(ch2.id)
  })
})

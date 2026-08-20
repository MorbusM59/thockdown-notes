import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

describe('NoteLifecycleService auto-Open-Items chapter', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-openitems-test-'))
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(dataRoot, db)
  })

  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('is created lazily, pinned right after auto-TOC, once a checklist item is saved', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    db.setNoteAssignedId(parent.id, 'BOOK')
    const ch1 = await lifecycle.createChapterNote(parent.id)
    db.setChapterId(parent.id, ch1.id, 'CH1')
    const { created: toc } = await lifecycle.createAutoTocChapter(parent.id)

    // No checklist content anywhere yet -- no auto-Open-Items chapter.
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBeNull()

    // H3, not H2: collectUncheckedItemsByHeading always flattens H2
    // headings into the top-level bucket (a deliberate rule, not specific
    // to chapters -- see openItemsText.test.ts's own "ignores H2 section
    // headings" coverage), so a heading needs to be H3+ to get its own
    // nested bucket here.
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n### Setting\n\n- [x] done already\n- [ ] world-building task' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)
    expect(openItemsId).toBeTruthy()

    const chapters = db.listChaptersForNote(parent.id)
    expect(chapters[0].chapterNoteId).toBe(toc.id)
    expect(chapters[1].chapterNoteId).toBe(openItemsId)

    const openItemsDoc = await lifecycle.loadNote({ id: openItemsId! })

    // The group's own label is the chapter's title -- its literal first
    // line -- never its assigned chapterId ("CH1"): a chapter is recognized
    // by what it's titled, not by whatever short id it's linked with.
    expect(openItemsDoc.text).toContain(`[Chapter One](@${ch1.id})`)
    expect(openItemsDoc.text).toContain(`[Setting](@${ch1.id}#heading:setting)`)
    expect(openItemsDoc.text).toContain('- [ ] world-building task')
    // Checked items are never listed.
    expect(openItemsDoc.text).not.toContain('done already')

    // The chapter's own heading source is untouched -- no literal anchor
    // definition was ever written into it just to build this group.
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe('# Chapter One\n\n### Setting\n\n- [x] done already\n- [ ] world-building task')
  })

  it('still produces a fully linked group when the note has no assigned id -- internal navigation never needs one', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)

    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] world-building task' })

    expect(db.getNoteRecord(parent.id)!.assignedId).toBeNull()
    expect(db.listChaptersForNote(parent.id).find((c) => c.chapterNoteId === ch1.id)!.chapterId).toBeNull()

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
    const openItemsDoc = await lifecycle.loadNote({ id: openItemsId })
    // The group's own label is the chapter's title in full ("Chapter One"),
    // not the truncated derived-snippet fallback (deriveContentSnippet) an
    // unassigned chapter's own pill/tab label would show -- the title-based
    // label has no dependency on an assigned id at all. The link itself is
    // still present, addressed by the chapter's own real internal note id.
    expect(openItemsDoc.text).toContain(`[Chapter One](@${ch1.id})`)
    expect(openItemsDoc.text).toContain('- [ ] world-building task')
  })

  it('falls back to the derived-snippet label for a chapter with no heading at all yet', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)

    // No heading anywhere in the chapter's own text -- same plain-text
    // first line as the equivalent auto-TOC fallback test.
    await lifecycle.saveNote({ id: ch1.id, text: 'Just some plain text, no heading yet.\n\n- [ ] a stray task' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
    const openItemsDoc = await lifecycle.loadNote({ id: openItemsId })
    // Same fallback the chapter's own pill would show (resolveIdentityLabel):
    // no assigned chapterId and no heading-prefixed first line, so its own
    // "Missing title" fallback -- resolveIdentityLabel only derives a
    // content snippet from a line that actually starts with the expected
    // heading marker, never from arbitrary body text.
    expect(openItemsDoc.text).toContain(`[Missing title](@${ch1.id})`)
    expect(openItemsDoc.text).toContain('- [ ] a stray task')
  })

  it('groups the parent\'s own headless items directly under its title link', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One' })

    await lifecycle.saveNote({ id: parent.id, text: '# The Book\n\n- [ ] pick a title' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
    const openItemsDoc = await lifecycle.loadNote({ id: openItemsId })
    expect(openItemsDoc.text).toBe(
      [
        '# Open Items',
        '',
        `[open-items-group:${parent.id}]`,
        `- [The Book](@${parent.id})`,
        '  - [ ] pick a title',
        '',
      ].join('\n'),
    )
  })

  it('disappears once the only unchecked item is checked off', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] only task' })
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBeTruthy()

    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [x] only task' })
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBeNull()
  })

  it('does not regenerate on a pure text edit to an existing unchecked item\'s own wording', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] buy milk' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
    const before = await lifecycle.loadNote({ id: openItemsId })

    await new Promise((resolve) => setTimeout(resolve, 5))
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] buy oat milk' })

    const after = await lifecycle.loadNote({ id: openItemsId })
    expect(after.text).toBe(before.text)
    expect(after.text).toContain('buy milk')
    expect(after.text).not.toContain('oat milk')
  })

  it('reorders existing groups to match a new chapter order without rescanning any note', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const ch2 = await lifecycle.createChapterNote(parent.id)
    const { created: toc } = await lifecycle.createAutoTocChapter(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] task one' })
    await lifecycle.saveNote({ id: ch2.id, text: '# Chapter Two\n\n- [ ] task two' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
    const initialDoc = await lifecycle.loadNote({ id: openItemsId })
    expect(initialDoc.text.indexOf('task one')).toBeLessThan(initialDoc.text.indexOf('task two'))

    await lifecycle.reorderChaptersAndSyncOpenItems(parent.id, [toc.id, openItemsId, ch2.id, ch1.id])

    const reorderedDoc = await lifecycle.loadNote({ id: openItemsId })
    expect(reorderedDoc.text.indexOf('task two')).toBeLessThan(reorderedDoc.text.indexOf('task one'))
  })

  it('drops just the removed chapter\'s own group, and removes the whole chapter once none are left', async () => {
    const parent = await lifecycle.createNote({ initialText: '# The Book' })
    const ch1 = await lifecycle.createChapterNote(parent.id)
    const ch2 = await lifecycle.createChapterNote(parent.id)
    await lifecycle.createAutoTocChapter(parent.id)
    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] task one' })
    await lifecycle.saveNote({ id: ch2.id, text: '# Chapter Two\n\n- [ ] task two' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!

    await lifecycle.removeChapterAndSyncOpenItems(parent.id, ch1.id)
    const afterFirstRemoval = await lifecycle.loadNote({ id: openItemsId })
    expect(afterFirstRemoval.text).not.toContain('task one')
    expect(afterFirstRemoval.text).toContain('task two')
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBe(openItemsId)

    await lifecycle.removeChapterAndSyncOpenItems(parent.id, ch2.id)
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBeNull()
  })

  describe('toggleOpenItemCheckedState', () => {
    it("checks the real item off in its own source chapter, without changing the Open Items chapter's own text at all", async () => {
      const parent = await lifecycle.createNote({ initialText: '# The Book' })
      const ch1 = await lifecycle.createChapterNote(parent.id)
      await lifecycle.createAutoTocChapter(parent.id)
      await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] world-building task' })

      const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
      const before = await lifecycle.loadNote({ id: openItemsId })
      const lineIndex = before.text.split('\n').findIndex((line) => line.includes('world-building task'))
      expect(lineIndex).toBeGreaterThanOrEqual(0)

      const toggled = await lifecycle.toggleOpenItemCheckedState(openItemsId, lineIndex)
      expect(toggled).toBe(true)

      const ch1After = await lifecycle.loadNote({ id: ch1.id })
      expect(ch1After.text).toBe('# Chapter One\n\n- [x] world-building task')

      // The whole point: the list on screen doesn't change out from under
      // the click -- skipAutoChapterHooks kept the checklist-diff hook from
      // firing, so the item is still listed even though it's now checked.
      const openItemsAfter = await lifecycle.loadNote({ id: openItemsId })
      expect(openItemsAfter.text).toBe(before.text)
    })

    it('un-checks it again on a second click at the same line, still without touching the Open Items chapter', async () => {
      const parent = await lifecycle.createNote({ initialText: '# The Book' })
      const ch1 = await lifecycle.createChapterNote(parent.id)
      await lifecycle.createAutoTocChapter(parent.id)
      await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] world-building task' })

      const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
      const openItemsDoc = await lifecycle.loadNote({ id: openItemsId })
      const lineIndex = openItemsDoc.text.split('\n').findIndex((line) => line.includes('world-building task'))

      await lifecycle.toggleOpenItemCheckedState(openItemsId, lineIndex)
      await lifecycle.toggleOpenItemCheckedState(openItemsId, lineIndex)

      const ch1After = await lifecycle.loadNote({ id: ch1.id })
      expect(ch1After.text).toBe('# Chapter One\n\n- [ ] world-building task')
      expect((await lifecycle.loadNote({ id: openItemsId })).text).toBe(openItemsDoc.text)
    })

    it('serializes two concurrent toggles on the same line so a rapid double-click does not lose the second click', async () => {
      const parent = await lifecycle.createNote({ initialText: '# The Book' })
      const ch1 = await lifecycle.createChapterNote(parent.id)
      await lifecycle.createAutoTocChapter(parent.id)
      await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] world-building task' })

      const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
      const openItemsDoc = await lifecycle.loadNote({ id: openItemsId })
      const lineIndex = openItemsDoc.text.split('\n').findIndex((line) => line.includes('world-building task'))

      // Fired concurrently, not awaited one at a time -- without
      // per-line serialization, both would read the same pre-toggle text
      // and both would write "checked", losing the second (uncheck) click.
      const [first, second] = await Promise.all([
        lifecycle.toggleOpenItemCheckedState(openItemsId, lineIndex),
        lifecycle.toggleOpenItemCheckedState(openItemsId, lineIndex),
      ])
      expect(first).toBe(true)
      expect(second).toBe(true)

      const ch1After = await lifecycle.loadNote({ id: ch1.id })
      expect(ch1After.text).toBe('# Chapter One\n\n- [ ] world-building task')
    })

    it('returns false and changes nothing for a line that is not a real checklist item', async () => {
      const parent = await lifecycle.createNote({ initialText: '# The Book' })
      const ch1 = await lifecycle.createChapterNote(parent.id)
      await lifecycle.createAutoTocChapter(parent.id)
      await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n- [ ] world-building task' })

      const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)!
      const before = await lifecycle.loadNote({ id: openItemsId })

      // Line 0 is "# Open Items" -- a heading, not a checklist item.
      const toggled = await lifecycle.toggleOpenItemCheckedState(openItemsId, 0)
      expect(toggled).toBe(false)

      const ch1After = await lifecycle.loadNote({ id: ch1.id })
      expect(ch1After.text).toBe('# Chapter One\n\n- [ ] world-building task')
      expect((await lifecycle.loadNote({ id: openItemsId })).text).toBe(before.text)
    })
  })
})

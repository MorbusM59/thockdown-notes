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
    const ch1LinkId = db.setChapterId(parent.id, ch1.id, 'CH1')!
    const { created: toc } = await lifecycle.createAutoTocChapter(parent.id)

    // No checklist content anywhere yet -- no auto-Open-Items chapter.
    expect(db.getAutoOpenItemsChapterNoteId(parent.id)).toBeNull()

    await lifecycle.saveNote({ id: ch1.id, text: '# Chapter One\n\n## Setting\n\n- [x] done already\n- [ ] world-building task' })

    const openItemsId = db.getAutoOpenItemsChapterNoteId(parent.id)
    expect(openItemsId).toBeTruthy()

    const chapters = db.listChaptersForNote(parent.id)
    expect(chapters[0].chapterNoteId).toBe(toc.id)
    expect(chapters[1].chapterNoteId).toBe(openItemsId)

    const openItemsDoc = await lifecycle.loadNote({ id: openItemsId! })

    expect(openItemsDoc.text).toContain(`[${ch1LinkId}](@${ch1.id})`)
    expect(openItemsDoc.text).toContain(`[Setting](@${ch1.id}#heading:setting)`)
    expect(openItemsDoc.text).toContain('- [ ] world-building task')
    // Checked items are never listed.
    expect(openItemsDoc.text).not.toContain('done already')

    // The chapter's own heading source is untouched -- no literal anchor
    // definition was ever written into it just to build this group.
    const ch1Doc = await lifecycle.loadNote({ id: ch1.id })
    expect(ch1Doc.text).toBe('# Chapter One\n\n## Setting\n\n- [x] done already\n- [ ] world-building task')
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
    // The group's own title falls back to the same derived snippet the
    // chapter's own pill would show (resolveIdentityLabel), not "Chapter
    // One" verbatim -- deriveContentSnippet truncates to a word boundary.
    // The link itself is still present, addressed by the chapter's own
    // real internal note id.
    expect(openItemsDoc.text).toContain(`[Chapter](@${ch1.id})`)
    expect(openItemsDoc.text).toContain('- [ ] world-building task')
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
})

import { useCallback, useEffect, useState } from 'react'
import type { ChapterEntry } from '../shared/chapters'
import type { EditorSelectionState } from '../editor/EditorContract'
import { collapseSurgerySite } from './chapterExtraction'

export interface UseNoteChaptersOptions {
  /** The note identity the chapter bar shows chapters *of* -- the chapter-aware "menu identity" (see EditorSection.tsx's `menuIdentityNoteId`), never a chapter's own id (chapters can't have chapters in this UI). */
  menuIdentityNoteId: string | null
  /** The note actually loaded in the editor right now -- used only to tell which chapter pill (if any) is the active one. */
  activeNoteId: string | null
  persistenceReady: boolean
  /**
   * EditorSection.tsx's own `activateNote`, whose 3rd param
   * (`chapterParentContext`) records which parent's chapter bar a chapter
   * was opened through -- see its doc comment there. Both handlers below
   * pass `menuIdentityNoteId` (this bar's own parent) for it, since a
   * chapter can belong to any number of parents (no per-note uniqueness on
   * the chapter side of the `chapters` table) and clicking a pill *in this
   * bar* unambiguously means "via this parent."
   */
  activateNote: (noteId: string, overrideCursorPos?: number, chapterParentContext?: string | null) => Promise<void>
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  /** Whatever's actually loaded in the editor right now (parent or a chapter) -- see EditorSection.tsx's own `currentEditorText` doc comment for why this, not `activeNoteText`, is the canonical live read. */
  currentEditorText: string
  editorSelection: EditorSelectionState
  /** Mutates the currently-displayed note's live text (and optionally its selection) -- see useEditorSectionMount.ts's own doc comment; used here to cut a selection out of whatever's currently open. */
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
  /** Cancels any pending debounced autosave and writes immediately -- awaited after cutting a selection so the cut can't be lost to a crash/reload racing the normal 350ms debounce before the new chapter is created. */
  flushPendingSaveNow: () => Promise<void>
}

export interface UseNoteChaptersResult {
  chapters: ChapterEntry[]
  /** Creates a new empty chapter of `menuIdentityNoteId` and immediately loads it into the editor. */
  handleCreateChapter: () => Promise<void>
  handleChapterClick: (chapterNoteId: string) => void
  /**
   * Attaches an already-existing note (dragged in from the sidebar) as a
   * chapter of `menuIdentityNoteId` -- unlike handleCreateChapter, this
   * never switches the editor's active note; dropping a note onto the
   * chapter bar only files it there; it stays wherever it was being edited.
   * No-ops (rather than throwing) for a self-reference or an already-
   * attached chapter, both of which the DB layer would otherwise reject.
   */
  handleAttachExistingChapter: (chapterNoteId: string) => Promise<void>
  /**
   * The chapter bar's right mini button: cuts the current editor selection
   * out of whatever's actively displayed (the parent or an already-open
   * chapter), creates a brand-new chapter of `menuIdentityNoteId` positioned
   * directly behind the chapter (or parent) being cut from -- pushing every
   * later chapter back by one -- and loads it with the cut text pasted in
   * and the caret collapsed to its end, ready to keep typing. A collapsed
   * selection (just a caret, nothing highlighted) extracts everything from
   * the caret to the end of the document instead of no-op'ing. Any blank-line
   * run left behind at the cut site (e.g. a paragraph that had a blank line
   * on both sides) is collapsed down to a single blank line. A no-op only
   * when there's genuinely nothing to extract (caret already at the end of
   * an empty selection).
   */
  handleExtractSelectionToChapter: () => Promise<void>
  /**
   * The chapter bar's left mini button: cuts the *entire* content of the
   * currently-open chapter, appends it to the previous chapter (or the
   * parent note, if this is the first chapter), soft-deletes (moves to
   * Trash -- reversible, same as the sidebar's Trash icon) the now-empty
   * chapter, and loads the destination note with the caret at its end. A
   * no-op while viewing the parent directly -- there's no "current chapter"
   * to collapse. Collapsing a note's last remaining chapter back into the
   * parent naturally hides the chapter panel again, since its visibility is
   * purely `chapters.length > 0` (see SectionEditorArea.tsx).
   */
  handleCollapseChapterIntoPrevious: () => Promise<void>
  /** Which chapter pill (by chapterNoteId) is mid-inline-edit of its chapterId, if any. */
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  startEditingChapterId: (chapterNoteId: string) => void
  commitChapterIdEdit: () => Promise<void>
  cancelChapterIdEdit: () => void
}

/**
 * Owns the chapter bar's data: this note's chapters (fetched fresh whenever
 * the note it's showing chapters of changes), the create/pill/drag-in/
 * extract/collapse handlers, and the right-click-to-assign chapterId inline
 * edit. Deliberately thin, mirroring useSectionTabs.ts's own scope --
 * loading/activating a chapter is just `activateNote`, already handled
 * identically to activating any other note (a chapter is a full note).
 */
export function useNoteChapters(options: UseNoteChaptersOptions): UseNoteChaptersResult {
  const {
    menuIdentityNoteId,
    activeNoteId,
    persistenceReady,
    activateNote,
    refreshNotes,
    currentEditorText,
    editorSelection,
    applyProgrammaticEditorText,
    flushPendingSaveNow,
  } = options

  const [chapters, setChapters] = useState<ChapterEntry[]>([])

  useEffect(() => {
    if (!persistenceReady || !window.thockdownChapters || !menuIdentityNoteId) {
      setChapters([])
      return
    }
    let cancelled = false
    void window.thockdownChapters.listChapters(menuIdentityNoteId).then((entries) => {
      if (!cancelled) setChapters(entries)
    })
    return () => {
      cancelled = true
    }
  }, [persistenceReady, menuIdentityNoteId])

  const handleCreateChapter = useCallback(async () => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    const { chapters: updatedChapters, created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
    setChapters(updatedChapters)
    await refreshNotes(created.id)
    await activateNote(created.id, undefined, menuIdentityNoteId)
  }, [menuIdentityNoteId, refreshNotes, activateNote])

  const handleChapterClick = useCallback((chapterNoteId: string) => {
    if (chapterNoteId === activeNoteId) return
    void activateNote(chapterNoteId, undefined, menuIdentityNoteId)
  }, [activeNoteId, activateNote, menuIdentityNoteId])

  const handleAttachExistingChapter = useCallback(async (chapterNoteId: string) => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    if (chapterNoteId === menuIdentityNoteId) return
    if (chapters.some((chapter) => chapter.chapterNoteId === chapterNoteId)) return
    const updatedChapters = await window.thockdownChapters.addExistingChapter(menuIdentityNoteId, chapterNoteId)
    setChapters(updatedChapters)
  }, [menuIdentityNoteId, chapters])

  const handleExtractSelectionToChapter = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return

    const start = Math.max(0, Math.min(editorSelection.start, currentEditorText.length))
    // A collapsed selection is just a caret -- there's nothing to highlight,
    // so it extracts from the caret to the end of the document instead of
    // no-op'ing. An expanded selection extracts exactly what's highlighted.
    const end = editorSelection.isCollapsed
      ? currentEditorText.length
      : Math.max(start, Math.min(editorSelection.end, currentEditorText.length))
    if (start >= end) return

    const extractedText = currentEditorText.slice(start, end)
    const before = currentEditorText.slice(0, start)
    const after = currentEditorText.slice(end)
    // Tidy up the surgery site: a paragraph cut from between two blank lines
    // would otherwise leave both stacked behind it.
    const { text: remainingText, seamPos } = collapseSurgerySite(before, after)

    // Cut from whatever's currently displayed first, and flush it to disk
    // before creating/populating the new chapter -- so a crash between the
    // two steps can't leave the text duplicated in both notes (or lost from
    // both) instead of cleanly moved.
    applyProgrammaticEditorText(remainingText, seamPos, seamPos)
    await flushPendingSaveNow()

    const { chapters: createdChapters, created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
    await window.thockdownNotes.saveNote({ id: created.id, text: extractedText })

    // createChapter appends the new chapter as the last one -- move it to
    // sit directly behind whichever chapter (or the parent, if there's no
    // "current chapter") we just cut from, pushing every later chapter in
    // the list back by one.
    const currentIndex = createdChapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
    const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0
    const orderedChapterNoteIds = createdChapters
      .filter((chapter) => chapter.chapterNoteId !== created.id)
      .map((chapter) => chapter.chapterNoteId)
    orderedChapterNoteIds.splice(insertAt, 0, created.id)
    const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)

    setChapters(updatedChapters)
    await refreshNotes(created.id)
    // Caret at the end of the pasted text -- "waiting for input behind" it.
    await activateNote(created.id, extractedText.length, menuIdentityNoteId)
  }, [menuIdentityNoteId, activeNoteId, editorSelection, currentEditorText, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, activateNote])

  const handleCollapseChapterIntoPrevious = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return
    // Viewing the parent directly -- there's no "current chapter" to collapse.
    if (!activeNoteId || activeNoteId === menuIdentityNoteId) return

    const currentIndex = chapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
    if (currentIndex < 0) return

    const currentChapterNoteId = activeNoteId
    const currentContent = currentEditorText
    // The first chapter's "previous" is the parent note itself; every other
    // chapter's previous is whichever one sits immediately before it.
    const previousId = currentIndex > 0 ? chapters[currentIndex - 1].chapterNoteId : menuIdentityNoteId

    const previousDoc = await window.thockdownNotes.loadNote({ id: previousId })
    const trimmedPrevious = previousDoc.text.replace(/\n+$/, '')
    const mergedText = trimmedPrevious.length > 0 ? `${trimmedPrevious}\n\n${currentContent}` : currentContent
    await window.thockdownNotes.saveNote({ id: previousId, text: mergedText })

    const updatedChapters = await window.thockdownChapters.removeChapter(menuIdentityNoteId, currentChapterNoteId)
    // Soft delete (Trash), same as the sidebar's Trash icon -- reversible,
    // unlike a permanent unlink -- since its content has already been moved
    // out, not destroyed.
    await window.thockdownNotes.addTagToNote({ id: currentChapterNoteId, tagName: 'deleted', position: 0 })

    setChapters(updatedChapters)
    await refreshNotes(previousId)
    // Caret at the end of the merged note. previousId === menuIdentityNoteId
    // means we collapsed the first chapter back into the parent itself, so
    // there's no parent context to record for it.
    await activateNote(previousId, mergedText.length, previousId === menuIdentityNoteId ? undefined : menuIdentityNoteId)
  }, [menuIdentityNoteId, activeNoteId, chapters, currentEditorText, refreshNotes, activateNote])

  const [editingChapterNoteId, setEditingChapterNoteId] = useState<string | null>(null)
  const [chapterIdDraft, setChapterIdDraft] = useState('')

  const startEditingChapterId = useCallback((chapterNoteId: string) => {
    const current = chapters.find((chapter) => chapter.chapterNoteId === chapterNoteId)
    setChapterIdDraft(current?.chapterId ?? '')
    setEditingChapterNoteId(chapterNoteId)
  }, [chapters])

  const cancelChapterIdEdit = useCallback(() => {
    setEditingChapterNoteId(null)
  }, [])

  const commitChapterIdEdit = useCallback(async () => {
    const chapterNoteId = editingChapterNoteId
    setEditingChapterNoteId(null)
    if (!chapterNoteId || !menuIdentityNoteId || !window.thockdownChapters) return

    const current = chapters.find((chapter) => chapter.chapterNoteId === chapterNoteId)
    const trimmed = chapterIdDraft.trim()
    if (trimmed === (current?.chapterId ?? '')) return

    const resolved = await window.thockdownChapters.setChapterId(menuIdentityNoteId, chapterNoteId, trimmed)
    setChapters((previous) => previous.map((chapter) => (
      chapter.chapterNoteId === chapterNoteId ? { ...chapter, chapterId: resolved } : chapter
    )))
  }, [editingChapterNoteId, menuIdentityNoteId, chapters, chapterIdDraft])

  return {
    chapters,
    handleCreateChapter,
    handleChapterClick,
    handleAttachExistingChapter,
    handleExtractSelectionToChapter,
    handleCollapseChapterIntoPrevious,
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { ChapterEntry } from '../shared/chapters'

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
 * the note it's showing chapters of changes), the "+" / pill / drag-in
 * handlers, and the right-click-to-assign chapterId inline edit. Deliberately
 * thin, mirroring useSectionTabs.ts's own scope -- loading/activating a
 * chapter is just `activateNote`, already handled identically to activating
 * any other note (a chapter is a full note).
 */
export function useNoteChapters(options: UseNoteChaptersOptions): UseNoteChaptersResult {
  const { menuIdentityNoteId, activeNoteId, persistenceReady, activateNote, refreshNotes } = options

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
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
  }
}

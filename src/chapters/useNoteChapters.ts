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
}

/**
 * Owns the chapter bar's data: this note's chapters (fetched fresh whenever
 * the note it's showing chapters of changes) and the "+" / pill click
 * handlers. Deliberately thin, mirroring useSectionTabs.ts's own scope --
 * loading/activating a chapter is just `activateNote`, already handled
 * identically to activating any other note (a chapter is a full note).
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

  return { chapters, handleCreateChapter, handleChapterClick }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { ChapterEntry } from '../shared/chapters'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'
import { collapseSurgerySite, trimBlankLines } from './chapterExtraction'

export interface UseNoteChaptersOptions {
  /** The note identity the chapter bar shows chapters *of* -- the chapter-aware "menu identity" (see EditorSection.tsx's `menuIdentityNoteId`), never a chapter's own id (chapters can't have chapters in this UI). */
  menuIdentityNoteId: string | null
  /** The note actually loaded in the editor right now -- used only to tell which chapter pill (if any) is the active one. */
  activeNoteId: string | null
  /** The full shared notes list -- read to tell which chapter (if any) is the auto-generated Table of Contents (NoteSummary.isAutoToc), so it can be pinned/excluded from drag-reorder without ChapterEntry itself needing that field. */
  notes: NoteSummary[]
  persistenceReady: boolean
  /** EditorSection.tsx's own `activateNote`. Which parent a chapter belongs to is a DB fact now (a chapter has exactly one parent, ever), not navigation state, so this no longer takes a parent-context param. */
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  /** Whatever's actually loaded in the editor right now (parent or a chapter) -- see EditorSection.tsx's own `currentEditorText` doc comment for why this, not `activeNoteText`, is the canonical live read. */
  currentEditorText: string
  editorSelection: EditorSelectionState
  /** Mutates the currently-displayed note's live text (and optionally its selection) -- see useEditorSectionMount.ts's own doc comment; used here to cut a selection out of whatever's currently open. */
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
  /** Cancels any pending debounced autosave and writes immediately -- awaited after cutting a selection so the cut can't be lost to a crash/reload racing the normal 350ms debounce before the new chapter is created. */
  flushPendingSaveNow: () => Promise<void>
  /** Called once a chapter note is permanently deleted (collapse/merge always deletes outright -- chapters have no independent trash state) -- lets EditorSection.tsx evict any per-note-id caches that would otherwise hold onto that id forever. */
  onNotePermanentlyDeleted?: (noteId: string) => void
}

export interface UseNoteChaptersResult {
  chapters: ChapterEntry[]
  /** Creates a new empty chapter of `menuIdentityNoteId` and immediately loads it into the editor. */
  handleCreateChapter: () => Promise<void>
  handleChapterClick: (chapterNoteId: string) => void
  /**
   * Clones a dragged-in note's content into a brand-new chapter of
   * `menuIdentityNoteId` -- the dragged note itself is never touched or
   * linked, only copied (see cloneNoteAsChapter's doc comment) -- and
   * immediately switches the editor to it, same as every other way a
   * chapter gets created (handleCreateChapter, handleExtractSelectionToChapter).
   * The dragged note itself is left wherever it was, untouched. No-ops for a
   * self-drop (dragging the parent onto its own bar).
   * `insertBeforeChapterNoteId`, when given (dropped directly on an existing
   * chapter pill rather than the bar's background or the "+" button), moves
   * the new chapter in front of that one instead of leaving it last.
   */
  handleCloneNoteAsChapter: (sourceNoteId: string, insertBeforeChapterNoteId?: string) => Promise<void>
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
   * on both sides) is collapsed down to a single blank line, and the
   * extracted content itself has its own leading/trailing blank lines
   * trimmed before landing in the new chapter. A no-op only when there's
   * genuinely nothing to extract (caret already at the end of an empty
   * selection).
   */
  handleExtractSelectionToChapter: () => Promise<void>
  /**
   * The chapter bar's left mini button: cuts the *entire* content of the
   * currently-open chapter, appends it to the previous chapter (or the
   * parent note, if this is the first chapter), permanently deletes the
   * now-empty chapter (chapters have no independent trash state -- its
   * content has already been moved out, not destroyed), and loads the
   * destination note with the caret at its end. A
   * no-op while viewing the parent directly -- there's no "current chapter"
   * to collapse. Collapsing a note's last remaining chapter back into the
   * parent naturally hides the chapter panel again, since its visibility is
   * purely `chapters.length > 0` (see SectionEditorArea.tsx).
   */
  handleCollapseChapterIntoPrevious: () => Promise<void>
  /**
   * Shift+Alt+Delete. Operates on whatever's *after* the selection (start
   * ignored -- only the end matters, so an expanded selection's own
   * highlighted text is left untouched, only what comes after it moves):
   * - Non-whitespace text after the selection end: cuts everything from
   *   there to the document's end into a brand-new chapter placed directly
   *   after the current one (or first, from the parent). Stays on the
   *   current chapter, caret collapsed to the end of what's left.
   * - Otherwise (nothing but whitespace after -- effectively "at the end"):
   *   pulls the *next* chapter in instead, appending its content to the
   *   current chapter and permanently deleting it. No note switch or reload
   *   at all, so the viewport can't jump -- caret lands exactly at the seam
   *   between the old and newly-appended text. A no-op with no next chapter
   *   to pull in.
   */
  handleChapterForwardSplitOrMerge: () => Promise<void>
  /**
   * Shift+Alt+Backspace -- the mirror of handleChapterForwardSplitOrMerge,
   * operating on whatever's *before* the selection instead:
   * - Non-whitespace text before the selection start, viewing a chapter:
   *   cuts everything from the document's start to there into a brand-new
   *   chapter placed directly before the current one. Stays on the current
   *   chapter, caret collapsed to the very beginning of what's left.
   * - Non-whitespace text before the selection start, viewing the *parent*:
   *   there's no chapter-list slot before it to insert into (the parent tab
   *   is always first), so this flips which side moves instead -- the
   *   parent's own identity is untouched, it just keeps the text before the
   *   selection as its new content; everything from the selection onward is
   *   cut into a brand-new chapter placed right after it (the new first
   *   chapter), which is switched to -- same as every other freshly-created
   *   chapter.
   * - Otherwise (nothing but whitespace before -- effectively "at the
   *   start"): pulls the *previous* chapter in instead, prepending its
   *   content to the current chapter and permanently deleting it. No note
   *   switch or reload at all, so the viewport can't jump -- caret lands
   *   exactly at the seam between the newly-prepended and old text. A no-op
   *   while viewing the parent (nothing precedes it) or the first chapter
   *   (its "previous" is the parent, which can never be merged away).
   */
  handleChapterBackwardSplitOrMerge: () => Promise<void>
  /**
   * Chapter-pill drag-to-reorder, matching useSectionTabs.ts's own
   * tab/tag-pill pattern exactly: the dragged item is tracked by *index*
   * (`onChapterDragStart`), not by id -- reading the dragged chapter's id
   * back off the drop target (as an earlier version of this did) is wrong,
   * since the drop handler only ever sees whichever pill the drop *landed
   * on*, not which one was picked up.
   */
  onChapterDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  onChapterDragEnd: () => void
  /** Drop directly on another chapter pill -- reorders within the chapters list. */
  onChapterDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  /** Drop on the bar's own background (past the last pill) -- appends to the end, mirroring useSectionTabs.ts's container-level drop. */
  onChapterContainerDragOver: (event: DragEvent<HTMLDivElement>) => void
  onChapterContainerDrop: (event: DragEvent<HTMLDivElement>) => void
  /** Drop on the parent tab itself -- promotes the dragged chapter to the parent slot (see handleChapterPromoteDrop's own doc comment). */
  onChapterPromoteDragOver: (event: DragEvent<HTMLDivElement>) => void
  onChapterPromoteDrop: (event: DragEvent<HTMLDivElement>) => void
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
    notes,
    persistenceReady,
    activateNote,
    refreshNotes,
    currentEditorText,
    editorSelection,
    applyProgrammaticEditorText,
    flushPendingSaveNow,
    onNotePermanentlyDeleted,
  } = options

  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [draggedChapterIndex, setDraggedChapterIndex] = useState<number | null>(null)

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

  // The auto-TOC chapter (if any) is a note-level fact (NoteSummary.isAutoToc),
  // not something ChapterEntry itself carries -- looked up against the
  // shared notes list rather than adding a new field to every chapter row.
  // Pinned to chapter-bar position 0 at creation time (see
  // createAutoTocChapter) and never moved after that; drag-reorder below
  // operates only on `reorderableChapters` (everything else) so it can never
  // be dragged, dropped onto, or displaced by an ordinary reorder.
  const autoTocChapterNoteId = useMemo(() => (
    chapters.find((chapter) => notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoToc)?.chapterNoteId ?? null
  ), [chapters, notes])
  const reorderableChapters = useMemo(() => (
    autoTocChapterNoteId === null ? chapters : chapters.filter((chapter) => chapter.chapterNoteId !== autoTocChapterNoteId)
  ), [chapters, autoTocChapterNoteId])

  // Keeps the auto-TOC chapter's existence a hard invariant of "this note has
  // at least one real chapter" -- no manual toggle. Appears the moment the
  // first real chapter does (however it was created: the "+" button, a
  // sidebar note dragged in, the scissors/split shortcuts, ...) and
  // disappears again the moment the last one does, mirroring
  // SectionEditorArea.tsx's own "chapter panel shows/hides itself, no manual
  // control" convention for the chapter bar as a whole. Deliberately doesn't
  // call activateNote either way -- creation/removal happens in the
  // background, wherever the user already is/was headed (typically the real
  // chapter they just created or collapsed) is left alone.
  const reorderableChapterCount = reorderableChapters.length
  useEffect(() => {
    if (!persistenceReady || !window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return

    if (reorderableChapterCount > 0 && autoTocChapterNoteId === null) {
      let cancelled = false
      void window.thockdownChapters.createAutoTocChapter(menuIdentityNoteId)
        .then(({ chapters: updatedChapters }) => {
          if (!cancelled) setChapters(updatedChapters)
        })
        .catch(async () => {
          // Another section open on the same note family may have already
          // created one in the brief window between this effect's own
          // "none exists yet" check and its createAutoTocChapter call
          // landing (createAutoTocChapter throws if one already exists) --
          // harmless: just re-sync from whichever call actually won.
          if (cancelled || !menuIdentityNoteId || !window.thockdownChapters) return
          const updatedChapters = await window.thockdownChapters.listChapters(menuIdentityNoteId)
          if (!cancelled) setChapters(updatedChapters)
        })
      return () => {
        cancelled = true
      }
    }

    if (reorderableChapterCount === 0 && autoTocChapterNoteId !== null) {
      const removedId = autoTocChapterNoteId
      let cancelled = false
      void (async () => {
        // The note being deleted can't be left as the active one -- switch
        // to the parent first if that's what's currently shown (this last
        // real chapter's own removal already switches the active note away
        // from *itself* through its own handler; this only ever matters if
        // the user was specifically browsing the auto-TOC chapter at the
        // exact moment the last real chapter disappeared elsewhere).
        if (activeNoteId === removedId && menuIdentityNoteId) {
          await activateNote(menuIdentityNoteId)
        }
        try {
          await window.thockdownChapters!.removeChapter(menuIdentityNoteId!, removedId)
          await window.thockdownNotes!.deleteNote({ id: removedId })
          onNotePermanentlyDeleted?.(removedId)
        } catch {
          // Same cross-section race as above, mirrored: another instance may
          // have already removed it first.
        }
        if (cancelled || !menuIdentityNoteId || !window.thockdownChapters) return
        const updatedChapters = await window.thockdownChapters.listChapters(menuIdentityNoteId)
        if (!cancelled) setChapters(updatedChapters)
      })()
      return () => {
        cancelled = true
      }
    }
  }, [reorderableChapterCount, autoTocChapterNoteId, menuIdentityNoteId, persistenceReady, activeNoteId, activateNote, onNotePermanentlyDeleted])

  const handleCreateChapter = useCallback(async () => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    const { chapters: updatedChapters, created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
    setChapters(updatedChapters)
    await refreshNotes(created.id)
    await activateNote(created.id)
  }, [menuIdentityNoteId, refreshNotes, activateNote])

  const handleChapterClick = useCallback((chapterNoteId: string) => {
    if (chapterNoteId === activeNoteId) return
    void activateNote(chapterNoteId)
  }, [activeNoteId, activateNote])

  const handleCloneNoteAsChapter = useCallback(async (sourceNoteId: string, insertBeforeChapterNoteId?: string) => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    if (sourceNoteId === menuIdentityNoteId) return
    const { chapters: createdChapters, created } = await window.thockdownChapters.cloneNoteAsChapter(menuIdentityNoteId, sourceNoteId)

    // cloneNoteAsChapter always appends the new chapter last -- move it in
    // front of insertBeforeChapterNoteId (dropped directly on an existing
    // pill), if given, pushing that one and everything after it back by one.
    const insertAt = insertBeforeChapterNoteId
      ? createdChapters.findIndex((chapter) => chapter.chapterNoteId === insertBeforeChapterNoteId)
      : -1
    if (insertAt < 0) {
      setChapters(createdChapters)
    } else {
      const orderedChapterNoteIds = createdChapters
        .filter((chapter) => chapter.chapterNoteId !== created.id)
        .map((chapter) => chapter.chapterNoteId)
      orderedChapterNoteIds.splice(insertAt, 0, created.id)
      const reorderedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)
      setChapters(reorderedChapters)
    }

    await refreshNotes(created.id)
    await activateNote(created.id)
  }, [menuIdentityNoteId, refreshNotes, activateNote])

  const handleExtractSelectionToChapter = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return
    // The auto-TOC chapter is regenerated (overwritten) on every visit --
    // cutting a "selection" out of it would just be silently discarded next
    // time it's viewed, so treat it the same as viewing nothing extractable.
    if (activeNoteId === autoTocChapterNoteId) return

    const start = Math.max(0, Math.min(editorSelection.start, currentEditorText.length))
    // A collapsed selection is just a caret -- there's nothing to highlight,
    // so it extracts from the caret to the end of the document instead of
    // no-op'ing. An expanded selection extracts exactly what's highlighted.
    const end = editorSelection.isCollapsed
      ? currentEditorText.length
      : Math.max(start, Math.min(editorSelection.end, currentEditorText.length))
    if (start >= end) return

    // Leading/trailing blank lines are trimmed off the extracted content
    // itself (the new chapter's own text), separately from the surgery-site
    // cleanup below (which tidies the document being cut *from*).
    const extractedText = trimBlankLines(currentEditorText.slice(start, end))
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
    await activateNote(created.id, extractedText.length)
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, editorSelection, currentEditorText, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, activateNote])

  const handleCollapseChapterIntoPrevious = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return
    // Viewing the parent directly -- there's no "current chapter" to collapse.
    if (!activeNoteId || activeNoteId === menuIdentityNoteId) return
    // The auto-TOC chapter is regenerated (overwritten) on every visit, and
    // isn't part of the real chapter sequence -- collapsing it would merge
    // its generated link markup into whatever's "previous", polluting real
    // content with throwaway TOC text.
    if (activeNoteId === autoTocChapterNoteId) return

    // Positional navigation ("previous"/"next" chapter) always operates on
    // reorderableChapters, never raw `chapters` -- the pinned auto-TOC
    // chapter sits at chapters[0] whenever it exists, which would otherwise
    // shift every real chapter's index by one and point "previous" at the
    // TOC chapter instead of the parent for the first real chapter.
    const currentIndex = reorderableChapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
    if (currentIndex < 0) return

    const currentChapterNoteId = activeNoteId
    const currentContent = currentEditorText
    // The first chapter's "previous" is the parent note itself; every other
    // chapter's previous is whichever one sits immediately before it.
    const previousId = currentIndex > 0 ? reorderableChapters[currentIndex - 1].chapterNoteId : menuIdentityNoteId

    const previousDoc = await window.thockdownNotes.loadNote({ id: previousId })
    const trimmedPrevious = previousDoc.text.replace(/\n+$/, '')
    const mergedText = trimmedPrevious.length > 0 ? `${trimmedPrevious}\n\n${currentContent}` : currentContent
    await window.thockdownNotes.saveNote({ id: previousId, text: mergedText })

    const updatedChapters = await window.thockdownChapters.removeChapter(menuIdentityNoteId, currentChapterNoteId)
    // Permanently removed, not trashed -- chapters have no independent trash
    // state, and its content has already been moved into the destination
    // note above, not destroyed.
    await window.thockdownNotes.deleteNote({ id: currentChapterNoteId })
    onNotePermanentlyDeleted?.(currentChapterNoteId)

    setChapters(updatedChapters)
    await refreshNotes(previousId)
    // Caret at the end of the merged note.
    await activateNote(previousId, mergedText.length)
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, reorderableChapters, currentEditorText, refreshNotes, activateNote, onNotePermanentlyDeleted])

  const handleChapterForwardSplitOrMerge = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId || !activeNoteId) return
    // Same reasoning as handleCollapseChapterIntoPrevious: the auto-TOC
    // chapter is regenerated on every visit and isn't part of the real
    // chapter sequence.
    if (activeNoteId === autoTocChapterNoteId) return

    const selectionEnd = Math.max(0, Math.min(editorSelection.end, currentEditorText.length))
    const afterSelection = currentEditorText.slice(selectionEnd)

    if (/\S/.test(afterSelection)) {
      const extractedText = trimBlankLines(afterSelection)
      const { text: remainingText, seamPos } = collapseSurgerySite(currentEditorText.slice(0, selectionEnd), '')

      applyProgrammaticEditorText(remainingText, seamPos, seamPos)
      await flushPendingSaveNow()

      const { created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
      await window.thockdownNotes.saveNote({ id: created.id, text: extractedText })

      // Reinsert relative to the reorderable subset only, then re-prepend
      // the pinned auto-TOC chapter (if any) before persisting --
      // createChapter's own "append last" would otherwise leave it
      // displaced from position 0.
      const reorderableIds = reorderableChapters.map((chapter) => chapter.chapterNoteId)
      const currentIndex = reorderableIds.findIndex((chapterNoteId) => chapterNoteId === activeNoteId)
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0
      reorderableIds.splice(insertAt, 0, created.id)
      const orderedChapterNoteIds = [
        ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
        ...reorderableIds,
      ]
      const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)

      setChapters(updatedChapters)
      await refreshNotes()
      return
    }

    // Positional navigation always operates on reorderableChapters -- see
    // handleCollapseChapterIntoPrevious's own comment on why raw `chapters`
    // (pinned auto-TOC chapter included) would point this at the wrong note.
    const currentIndex = reorderableChapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
    const nextChapterId = activeNoteId === menuIdentityNoteId
      ? reorderableChapters[0]?.chapterNoteId
      : (currentIndex >= 0 ? reorderableChapters[currentIndex + 1]?.chapterNoteId : undefined)
    if (!nextChapterId) return

    const nextDoc = await window.thockdownNotes.loadNote({ id: nextChapterId })
    const { text: mergedText, seamPos } = collapseSurgerySite(currentEditorText, nextDoc.text)

    // Update the live buffer + caret in place and flush before deleting the
    // source chapter -- same crash-safety ordering as the extract path
    // above, and no note switch/reload means the viewport can't jump.
    applyProgrammaticEditorText(mergedText, seamPos, seamPos)
    await flushPendingSaveNow()

    const updatedChapters = await window.thockdownChapters.removeChapter(menuIdentityNoteId, nextChapterId)
    await window.thockdownNotes.deleteNote({ id: nextChapterId })
    onNotePermanentlyDeleted?.(nextChapterId)

    setChapters(updatedChapters)
    await refreshNotes()
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, reorderableChapters, currentEditorText, editorSelection, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, onNotePermanentlyDeleted])

  const handleChapterBackwardSplitOrMerge = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId || !activeNoteId) return
    // Same reasoning as handleCollapseChapterIntoPrevious: the auto-TOC
    // chapter is regenerated on every visit and isn't part of the real
    // chapter sequence.
    if (activeNoteId === autoTocChapterNoteId) return

    const selectionStart = Math.max(0, Math.min(editorSelection.start, currentEditorText.length))
    const beforeSelection = currentEditorText.slice(0, selectionStart)

    if (/\S/.test(beforeSelection)) {
      // Viewing the parent: there's no chapter-list slot "before" it to
      // insert into (the parent tab is always first), so this flips which
      // side moves compared to the chapter case below -- the "before" text
      // simply stays as the parent's own new content (nothing about the
      // parent's identity changes), and everything from the selection
      // onward is cut into a brand-new chapter placed right after it (the
      // new first chapter), which we switch to -- same as every other
      // freshly-created chapter.
      if (activeNoteId === menuIdentityNoteId) {
        const cutText = trimBlankLines(currentEditorText.slice(selectionStart))
        const { text: keptText, seamPos } = collapseSurgerySite(beforeSelection, '')

        applyProgrammaticEditorText(keptText, seamPos, seamPos)
        await flushPendingSaveNow()

        const { created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
        await window.thockdownNotes.saveNote({ id: created.id, text: cutText })

        // "New first chapter" means first among the *real* chapters -- right
        // after the pinned auto-TOC chapter (if any), never displacing it
        // from position 0.
        const orderedChapterNoteIds = [
          ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
          created.id,
          ...reorderableChapters.map((chapter) => chapter.chapterNoteId),
        ]
        const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)

        setChapters(updatedChapters)
        await refreshNotes(created.id)
        // Explicit, rather than relying on a fresh note's UI state defaulting
        // to this already -- guarantees the caret (start of the cut text) is
        // scrolled fully into view rather than wherever a stale/inherited
        // scroll position would otherwise land.
        await window.thockdownNotes.saveNoteUiState({ id: created.id, payload: { anchorBlockIndex: 0, cursorPos: 0 } })
        await activateNote(created.id)
        return
      }

      const extractedText = trimBlankLines(beforeSelection)
      const { text: remainingText, seamPos } = collapseSurgerySite('', currentEditorText.slice(selectionStart))

      applyProgrammaticEditorText(remainingText, seamPos, seamPos)
      await flushPendingSaveNow()

      const { chapters: createdChapters, created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
      await window.thockdownNotes.saveNote({ id: created.id, text: extractedText })

      const currentIndex = createdChapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
      const insertAt = currentIndex >= 0 ? currentIndex : 0
      const orderedChapterNoteIds = createdChapters
        .filter((chapter) => chapter.chapterNoteId !== created.id)
        .map((chapter) => chapter.chapterNoteId)
      orderedChapterNoteIds.splice(insertAt, 0, created.id)
      const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)

      setChapters(updatedChapters)
      await refreshNotes()
      return
    }

    // The first chapter's "previous" is the parent -- unlike
    // handleCollapseChapterIntoPrevious (which folds the *current* chapter
    // away into it), this command would have to delete the parent to merge
    // it away, which can never happen. No-op there, and while viewing the
    // parent itself (nothing precedes it at all).
    if (activeNoteId === menuIdentityNoteId) return
    // Positional navigation always operates on reorderableChapters -- see
    // handleCollapseChapterIntoPrevious's own comment on why raw `chapters`
    // (pinned auto-TOC chapter included) would point this at the wrong note.
    const currentIndex = reorderableChapters.findIndex((chapter) => chapter.chapterNoteId === activeNoteId)
    if (currentIndex <= 0) return
    const previousChapterId = reorderableChapters[currentIndex - 1].chapterNoteId

    const previousDoc = await window.thockdownNotes.loadNote({ id: previousChapterId })
    const { text: mergedText, seamPos } = collapseSurgerySite(previousDoc.text, currentEditorText)

    applyProgrammaticEditorText(mergedText, seamPos, seamPos)
    await flushPendingSaveNow()

    const updatedChapters = await window.thockdownChapters.removeChapter(menuIdentityNoteId, previousChapterId)
    await window.thockdownNotes.deleteNote({ id: previousChapterId })
    onNotePermanentlyDeleted?.(previousChapterId)

    setChapters(updatedChapters)
    await refreshNotes()
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, reorderableChapters, currentEditorText, editorSelection, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, activateNote, onNotePermanentlyDeleted])

  // Chapter-pill drag-to-reorder -- deliberately mirrors useSectionTabs.ts's
  // handleTabDragStart/handleTabDrop/handleTabsContainerDrop pattern exactly
  // (dragged item tracked by index in state, set on dragstart; drop splices
  // that index out and back in at the target). An earlier version of this
  // instead threaded the dragged chapter's id through the drop target's own
  // event handler (`onChapterDrop(index, chapter.chapterNoteId)`), which
  // always resolved to the *target* pill's own id, not whatever was actually
  // picked up -- dropping on another pill silently no-op'd because the
  // "dragged" id it computed always equaled the target's own id. Tracking by
  // index in state (this hook already knows `chapters`) sidesteps that
  // entirely, same as the tab/tag bar never had the bug in the first place.
  const handleChapterDragStart = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const chapter = reorderableChapters[index]
    if (!chapter) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chapter.chapterNoteId)
    setDraggedChapterIndex(index)
  }, [reorderableChapters])

  const handleChapterDragEnd = useCallback(() => {
    setDraggedChapterIndex(null)
  }, [])

  // Persists a new order for the reorderable subset, always re-prepending
  // the pinned auto-TOC chapter (if any) first -- reorderChapters rewrites
  // every position from this exact list, so leaving it out (or sending it
  // anywhere but first) would un-pin it.
  const persistReorderedChapters = useCallback(async (reorderedReorderable: ChapterEntry[]) => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    const orderedChapterNoteIds = [
      ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
      ...reorderedReorderable.map((chapter) => chapter.chapterNoteId),
    ]
    const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)
    setChapters(updatedChapters)
  }, [menuIdentityNoteId, autoTocChapterNoteId])

  const handleChapterDrop = useCallback(async (event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    if (draggedChapterIndex === null) return
    event.preventDefault()
    event.stopPropagation()

    if (draggedChapterIndex === targetIndex || !window.thockdownChapters || !menuIdentityNoteId) {
      setDraggedChapterIndex(null)
      return
    }

    const reordered = [...reorderableChapters]
    const [moved] = reordered.splice(draggedChapterIndex, 1)
    setDraggedChapterIndex(null)
    if (!moved) return

    reordered.splice(targetIndex, 0, moved)
    await persistReorderedChapters(reordered)
  }, [draggedChapterIndex, reorderableChapters, menuIdentityNoteId, persistReorderedChapters])

  // Drop on the bar's own background, past the last pill -- appends to the
  // end, mirroring useSectionTabs.ts's handleTabsContainerDrop/
  // handleTagContainerDrop.
  const handleChapterContainerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedChapterIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [draggedChapterIndex])

  const handleChapterContainerDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    if (draggedChapterIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    if (!window.thockdownChapters || !menuIdentityNoteId) {
      setDraggedChapterIndex(null)
      return
    }

    const reordered = [...reorderableChapters]
    const [moved] = reordered.splice(draggedChapterIndex, 1)
    setDraggedChapterIndex(null)
    if (!moved) return

    reordered.push(moved)
    await persistReorderedChapters(reordered)
  }, [draggedChapterIndex, reorderableChapters, menuIdentityNoteId, persistReorderedChapters])

  // Drop directly on the parent tab -- the one place chapter drag-and-drop
  // diverges from a plain tab/tag reorder. The dragged chapter becomes the
  // new parent (promoteChapterToParent handles tag migration -- chapters
  // carry no tags of their own, see its own doc comment -- and the previous
  // parent becomes the new first chapter). No explicit activateNote/note
  // switch afterward: menuIdentityNoteId (EditorSection.tsx) is derived
  // reactively from the active note's own chapterParentId, so once
  // refreshNotes() lands the updated chapterOnly/chapterParentId flags, the
  // bar's own active-pill highlighting and parent-tab identity resolve
  // themselves on the next render regardless of which note was active when
  // the drop happened -- forcing a navigation here would just be an
  // unrequested side effect the tab/tag bar's own reorders never have either.
  const handleChapterPromoteDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedChapterIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [draggedChapterIndex])

  const handleChapterPromoteDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    if (draggedChapterIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    if (!window.thockdownChapters || !menuIdentityNoteId) {
      setDraggedChapterIndex(null)
      return
    }

    const dragged = reorderableChapters[draggedChapterIndex]
    setDraggedChapterIndex(null)
    if (!dragged) return

    const updatedChapters = await window.thockdownChapters.promoteChapterToParent(menuIdentityNoteId, dragged.chapterNoteId)
    setChapters(updatedChapters)
    await refreshNotes(activeNoteId)
  }, [draggedChapterIndex, reorderableChapters, menuIdentityNoteId, refreshNotes, activeNoteId])


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
    handleCloneNoteAsChapter,
    handleExtractSelectionToChapter,
    handleCollapseChapterIntoPrevious,
    handleChapterForwardSplitOrMerge,
    handleChapterBackwardSplitOrMerge,
    onChapterDragStart: handleChapterDragStart,
    onChapterDragEnd: handleChapterDragEnd,
    onChapterDrop: handleChapterDrop,
    onChapterContainerDragOver: handleChapterContainerDragOver,
    onChapterContainerDrop: handleChapterContainerDrop,
    onChapterPromoteDragOver: handleChapterPromoteDragOver,
    onChapterPromoteDrop: handleChapterPromoteDrop,
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
  }
}

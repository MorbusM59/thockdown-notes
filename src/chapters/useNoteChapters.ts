import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { ChapterEntry } from '../shared/chapters'
import { splitChapterFamily } from '../shared/chapters'
import { isArchivedNote, type NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'
import { collapseSurgerySite, trimBlankLines } from './chapterExtraction'
import { useInlinePillEdit } from '../shared/useInlinePillEdit'

const EMPTY_STRING_SET: ReadonlySet<string> = new Set()

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
  /** The chapter bar's render source. Merged with the parent's own archived-and-detached chapters when the parent itself is archived (every chapter, regardless of archived status -- see the doc comment on `displayChapters` at the definition site); identical to the live-only list otherwise. Every mutation path in this hook (reorder, create, collapse, chapterId edit, ...) reads and writes its own internal live-only state instead, never this. */
  chapters: ChapterEntry[]
  /** Which of `chapters` above have no real `chapters`-table row (archived-and-detached, merged in purely for display) -- see ChapterBar.tsx's own doc comment for what it disables on those. Empty whenever the parent isn't archived. */
  archivedMergedChapterIds: ReadonlySet<string>
  /** Re-fetches `chapters` from the backend -- see its own doc comment at the definition site for why this needs to be called explicitly after saves. */
  refreshChapters: () => Promise<void>
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
   * parent leaves the chapter panel itself showing -- its visibility no
   * longer tracks `chapters.length` (see SectionEditorArea.tsx's
   * `isChapterPanelOpen`), only whether there's an active note at all.
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
  /** Drop directly on another chapter pill -- reorders within the chapters list. Any other target is ignored. */
  onChapterDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  /** Which chapter pill (by chapterNoteId) is mid-inline-edit of its chapterId, if any. */
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  startEditingChapterId: (chapterNoteId: string) => void
  commitChapterIdEdit: () => void
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

  // Whether the chapter bar's own parent is itself archived -- the one
  // case where its chapter bar needs to show every chapter, live or
  // archived-and-detached, regardless of that chapter's own status (see
  // App.tsx's archive-view rules). `chapters` (above) stays live-only,
  // always -- every reorder/create/collapse/chapterId-edit path in this
  // hook keeps reading and writing that raw state, unchanged, since an
  // archived-and-detached chapter has no real `chapters`-table row for any
  // of those to safely operate against. The merged view assembled below is
  // purely a display-time overlay on top of it.
  const menuIdentityNoteSummary = useMemo(() => (
    menuIdentityNoteId ? (notes.find((note) => note.id === menuIdentityNoteId) ?? null) : null
  ), [notes, menuIdentityNoteId])
  const isMenuIdentityArchived = menuIdentityNoteSummary ? isArchivedNote(menuIdentityNoteSummary) : false

  const [archivedMergedChapters, setArchivedMergedChapters] = useState<ChapterEntry[]>([])

  useEffect(() => {
    if (!persistenceReady || !window.thockdownChapters || !menuIdentityNoteId || !isMenuIdentityArchived) {
      setArchivedMergedChapters([])
      return
    }
    let cancelled = false
    void window.thockdownChapters.listChaptersIncludingArchived(menuIdentityNoteId).then((entries) => {
      if (!cancelled) setArchivedMergedChapters(entries)
    })
    return () => {
      cancelled = true
    }
    // Re-fetches whenever `chapters` itself changes for any reason (a new
    // chapter created, one collapsed/reordered, a save patching the
    // auto-Open-Items group, ...) -- keeps the merged view in sync without
    // having to thread an explicit refresh call through every one of this
    // hook's own mutation paths.
  }, [persistenceReady, menuIdentityNoteId, isMenuIdentityArchived, chapters])

  // The chapter bar's actual render source -- merged when the parent is
  // archived, otherwise identical to the live list. `archivedMergedChapterIds`
  // marks which of `displayChapters` have no real `chapters`-table row, so
  // ChapterBar.tsx can render them non-interactively (no drag, no split-pill
  // hold gesture, no chapterId rename -- none of those have anywhere real to
  // write to). persistReorderedChapters below also uses this set as a
  // belt-and-suspenders guard against ever sending one of these ids through
  // reorderChapters, regardless of how it ended up mixed into a dragged
  // sequence.
  const displayChapters = isMenuIdentityArchived ? archivedMergedChapters : chapters
  const archivedMergedChapterIds = useMemo(() => {
    if (!isMenuIdentityArchived) return EMPTY_STRING_SET
    const liveIds = new Set(chapters.map((chapter) => chapter.chapterNoteId))
    return new Set(archivedMergedChapters.filter((chapter) => !liveIds.has(chapter.chapterNoteId)).map((chapter) => chapter.chapterNoteId))
  }, [isMenuIdentityArchived, chapters, archivedMergedChapters])

  // Re-fetches this note's chapters from the backend and syncs local state --
  // called (via EditorSection.tsx's onSaveCompleted, since useNoteSaveQueue is
  // declared before this hook and can't call it directly) after every save,
  // because the auto-Open-Items chapter can be lazily created/patched/torn
  // down by a save's own checklist-diff hook (noteLifecycleService.ts)
  // without this hook ever calling any of its own chapter-mutating handlers.
  // The auto-TOC chapter doesn't need this: its own creation/removal already
  // goes through the reactive effect below, which calls setChapters directly.
  const refreshChapters = useCallback(async () => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    const updatedChapters = await window.thockdownChapters.listChapters(menuIdentityNoteId)
    setChapters(updatedChapters)

    // The common case (a save with no chapter-structure side effect) should
    // cost only the cheap listChapters round trip above -- only pay for a
    // full notes refresh (needed so ChapterBar.tsx's `notes.find(...)
    // ?.isAutoOpenItems` lookup can see a brand-new Open Items chapter's
    // note record at all) when the chapter set actually changed.
    const previousIds = chapters.map((chapter) => chapter.chapterNoteId).sort()
    const nextIds = updatedChapters.map((chapter) => chapter.chapterNoteId).sort()
    const changed = previousIds.length !== nextIds.length || previousIds.some((id, index) => id !== nextIds[index])
    if (changed) {
      await refreshNotes()
    }
  }, [menuIdentityNoteId, chapters, refreshNotes])

  // The auto-TOC and auto-Open-Items chapters (if they exist) are note-level
  // facts (NoteSummary.isAutoToc/isAutoOpenItems), not something ChapterEntry
  // itself carries -- split out via the one shared, canonical rule
  // (splitChapterFamily) rather than a locally re-derived filter, so this
  // can never drift from ChapterBar.tsx's or the main process's own
  // exclusion logic again. Both are pinned at creation time (see
  // createAutoTocChapter/regenerateOpenItemsGroup) and never moved after
  // that; drag-reorder below operates only on `reorderableChapters`
  // (everything else) so neither can ever be dragged, dropped onto, or
  // displaced by an ordinary reorder.
  const { autoTocChapter, autoOpenItemsChapter, realChapters: reorderableChapters } = useMemo(() => (
    splitChapterFamily(chapters, notes)
  ), [chapters, notes])
  const autoTocChapterNoteId = autoTocChapter?.chapterNoteId ?? null
  const autoOpenItemsChapterNoteId = autoOpenItemsChapter?.chapterNoteId ?? null

  // The auto-TOC chapter's own existence is no longer tied to chapter count
  // at all -- every new note gets one from the moment it's created
  // (NoteLifecycleService.createNote's own default, see its doc comment),
  // and it's only ever removed by deleting the note itself (ordinary
  // cascade-delete). The effect below still exists purely as a *backfill*:
  // any note created before that became the default (or one whose ToC
  // creation failed and got silently swallowed at birth -- see createNote's
  // own doc comment) picks one up reactively the moment it becomes this
  // section's `menuIdentityNoteId` -- i.e. the moment it's actually opened,
  // regardless of whether it has any real chapters. (An earlier version of
  // this gated backfill on `reorderableChapterCount > 0`, matching the
  // original "only chapter-bearing notes get one" design this whole effect
  // used to enforce as a hard invariant -- that's exactly what left a
  // pre-existing chapterless note permanently without a ToC until it
  // happened to gain a chapter, which is the gap this now closes.) The
  // auto-Open-Items chapter is different and unchanged: it has no reason to
  // exist without a chapter bar to aggregate across (see
  // regenerateOpenItemsGroup's own doc comment), so it still appears with
  // the first real chapter and is torn down with the last one, below.
  // Neither branch calls activateNote either way -- creation/removal
  // happens in the background, wherever the user already is/was headed
  // (typically the real chapter they just created or collapsed) is left
  // alone.
  const reorderableChapterCount = reorderableChapters.length

  // Guards the effect below against firing a second, redundant
  // createAutoTocChapter call for the same parent while the first one is
  // still in flight. `autoTocChapterNoteId === null` stays true for the
  // effect's ENTIRE duration -- `chapters` state (and so
  // `autoTocChapterNoteId`) only updates once the call resolves and
  // setChapters runs -- so anything else that makes this effect re-run in
  // the meantime (activeNoteId changing, e.g. because handleCreateChapter
  // itself activates the freshly created chapter right after creating it;
  // or a callback prop like refreshNotes/activateNote getting a new
  // identity) would otherwise fire a second real IPC call before the first
  // one has had a chance to update `chapters`. The cleanup's own
  // `cancelled` flag only suppresses a stale call's effect on React state --
  // it was never enough on its own, since the underlying call had already
  // gone out. Keyed by note id (not a bare boolean) so a call still pending
  // for a DIFFERENT parent (e.g. the user switched away and back) doesn't
  // block this one.
  const pendingAutoTocCreateForNoteIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!persistenceReady || !window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return

    if (autoTocChapterNoteId === null) {
      if (pendingAutoTocCreateForNoteIdRef.current === menuIdentityNoteId) return
      pendingAutoTocCreateForNoteIdRef.current = menuIdentityNoteId

      let cancelled = false
      void window.thockdownChapters.createAutoTocChapter(menuIdentityNoteId)
        .then(async ({ chapters: updatedChapters }) => {
          if (cancelled) return
          setChapters(updatedChapters)
          // The brand-new TOC note has never been fetched into the shared
          // notes list -- without this, ChapterBar.tsx's `notes.find(...)
          // ?.isAutoToc` lookup finds nothing and renders it as an ordinary
          // chapter pill instead of the special TOC one, indefinitely (until
          // some unrelated flow happens to refresh notes).
          await refreshNotes()
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
        .finally(() => {
          if (pendingAutoTocCreateForNoteIdRef.current === menuIdentityNoteId) {
            pendingAutoTocCreateForNoteIdRef.current = null
          }
        })
      return () => {
        cancelled = true
      }
    }

    if (reorderableChapterCount === 0 && autoOpenItemsChapterNoteId !== null) {
      // Only the auto-Open-Items chapter is torn down here now -- the
      // auto-TOC chapter's own lifecycle is no longer tied to chapter count
      // at all, see reorderableChapterCount's own doc comment above.
      const removedId = autoOpenItemsChapterNoteId
      let cancelled = false
      void (async () => {
        // The note being deleted can't be left as the active one -- switch
        // to the parent first if that's what's currently shown (this last
        // real chapter's own removal already switches the active note away
        // from *itself* through its own handler; this only ever matters if
        // the user was specifically browsing the auto-Open-Items chapter at
        // the exact moment the last real chapter disappeared elsewhere).
        if (activeNoteId === removedId && menuIdentityNoteId) {
          await activateNote(menuIdentityNoteId)
        }
        try {
          await window.thockdownChapters!.removeChapter(menuIdentityNoteId!, removedId)
          await window.thockdownNotes!.deleteNote({ id: removedId })
          onNotePermanentlyDeleted?.(removedId)
        } catch {
          // Same cross-section race as above, mirrored: another instance
          // may have already removed it first.
        }
        if (cancelled || !menuIdentityNoteId || !window.thockdownChapters) return
        const updatedChapters = await window.thockdownChapters.listChapters(menuIdentityNoteId)
        if (!cancelled) setChapters(updatedChapters)
      })()
      return () => {
        cancelled = true
      }
    }
  }, [reorderableChapterCount, autoTocChapterNoteId, autoOpenItemsChapterNoteId, menuIdentityNoteId, persistenceReady, activeNoteId, activateNote, refreshNotes, onNotePermanentlyDeleted])

  const handleCreateChapter = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return
    const { chapters: updatedChapters, created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
    const initialText = '## '
    await window.thockdownNotes.saveNote({ id: created.id, text: initialText })
    setChapters(updatedChapters)
    await refreshNotes(created.id)
    await activateNote(created.id, initialText.length)
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
    if (activeNoteId === autoTocChapterNoteId || activeNoteId === autoOpenItemsChapterNoteId) return

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
    const initialText = extractedText ? `## \n\n${extractedText}` : '## '
    await window.thockdownNotes.saveNote({ id: created.id, text: initialText })

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
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, autoOpenItemsChapterNoteId, editorSelection, currentEditorText, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, activateNote])

  const handleCollapseChapterIntoPrevious = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId) return
    // Viewing the parent directly -- there's no "current chapter" to collapse.
    if (!activeNoteId || activeNoteId === menuIdentityNoteId) return
    // The auto-TOC chapter is regenerated (overwritten) on every visit, and
    // isn't part of the real chapter sequence -- collapsing it would merge
    // its generated link markup into whatever's "previous", polluting real
    // content with throwaway TOC text.
    if (activeNoteId === autoTocChapterNoteId || activeNoteId === autoOpenItemsChapterNoteId) return

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
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, autoOpenItemsChapterNoteId, reorderableChapters, currentEditorText, refreshNotes, activateNote, onNotePermanentlyDeleted])

  const handleChapterForwardSplitOrMerge = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId || !activeNoteId) return
    // Same reasoning as handleCollapseChapterIntoPrevious: the auto-TOC
    // chapter is regenerated on every visit and isn't part of the real
    // chapter sequence.
    if (activeNoteId === autoTocChapterNoteId || activeNoteId === autoOpenItemsChapterNoteId) return

    const selectionEnd = Math.max(0, Math.min(editorSelection.end, currentEditorText.length))
    const afterSelection = currentEditorText.slice(selectionEnd)

    if (/\S/.test(afterSelection)) {
      const extractedText = trimBlankLines(afterSelection)
      const { text: remainingText, seamPos } = collapseSurgerySite(currentEditorText.slice(0, selectionEnd), '')

      applyProgrammaticEditorText(remainingText, seamPos, seamPos)
      await flushPendingSaveNow()

      const { created } = await window.thockdownChapters.createChapter(menuIdentityNoteId)
      const initialText = extractedText ? `## \n\n${extractedText}` : '## '
      await window.thockdownNotes.saveNote({ id: created.id, text: initialText })

      // Reinsert relative to the reorderable subset only, then re-prepend
      // the pinned auto-chapters (if any) before persisting -- reorderChapters
      // rewrites every position from this exact list, so createChapter's own
      // "append last" would otherwise leave them displaced from positions
      // 0/1.
      const reorderableIds = reorderableChapters.map((chapter) => chapter.chapterNoteId)
      const currentIndex = reorderableIds.findIndex((chapterNoteId) => chapterNoteId === activeNoteId)
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0
      reorderableIds.splice(insertAt, 0, created.id)
      const orderedChapterNoteIds = [
        ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
        ...(autoOpenItemsChapterNoteId !== null ? [autoOpenItemsChapterNoteId] : []),
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
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, autoOpenItemsChapterNoteId, reorderableChapters, currentEditorText, editorSelection, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, onNotePermanentlyDeleted])

  const handleChapterBackwardSplitOrMerge = useCallback(async () => {
    if (!window.thockdownChapters || !window.thockdownNotes || !menuIdentityNoteId || !activeNoteId) return
    // Same reasoning as handleCollapseChapterIntoPrevious: the auto-TOC
    // chapter is regenerated on every visit and isn't part of the real
    // chapter sequence.
    if (activeNoteId === autoTocChapterNoteId || activeNoteId === autoOpenItemsChapterNoteId) return

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
        const initialText = cutText ? `## \n\n${cutText}` : '## '
        await window.thockdownNotes.saveNote({ id: created.id, text: initialText })

        // "New first chapter" means first among the *real* chapters -- right
        // after the pinned auto-chapters (if any), never displacing them
        // from positions 0/1.
        const orderedChapterNoteIds = [
          ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
          ...(autoOpenItemsChapterNoteId !== null ? [autoOpenItemsChapterNoteId] : []),
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
      const initialText = extractedText ? `## \n\n${extractedText}` : '## '
      await window.thockdownNotes.saveNote({ id: created.id, text: initialText })

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
  }, [menuIdentityNoteId, activeNoteId, autoTocChapterNoteId, autoOpenItemsChapterNoteId, reorderableChapters, currentEditorText, editorSelection, applyProgrammaticEditorText, flushPendingSaveNow, refreshNotes, activateNote, onNotePermanentlyDeleted])

  // Chapter-pill drag-to-reorder only accepts drops onto actual chapter pills.
  // Any other drag target (the parent tab, the bar background, or any
  // non-chapter element) is deliberately ignored as a no-op; the chapter bar
  // no longer has a background-append drop path at all.
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
  // the pinned auto-chapters (if any) first -- reorderChapters rewrites
  // every position from this exact list, so leaving one out (or sending it
  // anywhere but first) would un-pin it. Also strips out any
  // archived-merged id (belt-and-suspenders: those are never draggable and
  // never a drop target to begin with -- see ChapterBar.tsx -- but this is
  // the one place that would actually corrupt live chapters' positions if
  // one ever slipped through, by assigning them position numbers that
  // count a phantom entry with no real `chapters` row).
  const persistReorderedChapters = useCallback(async (reorderedReorderable: ChapterEntry[]) => {
    if (!window.thockdownChapters || !menuIdentityNoteId) return
    const orderedChapterNoteIds = [
      ...(autoTocChapterNoteId !== null ? [autoTocChapterNoteId] : []),
      ...(autoOpenItemsChapterNoteId !== null ? [autoOpenItemsChapterNoteId] : []),
      ...reorderedReorderable
        .filter((chapter) => !archivedMergedChapterIds.has(chapter.chapterNoteId))
        .map((chapter) => chapter.chapterNoteId),
    ]
    const updatedChapters = await window.thockdownChapters.reorderChapters(menuIdentityNoteId, orderedChapterNoteIds)
    setChapters(updatedChapters)
  }, [menuIdentityNoteId, autoTocChapterNoteId, autoOpenItemsChapterNoteId, archivedMergedChapterIds])

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

  const commitChapterIdEditValue = useCallback(async (chapterNoteId: string, draft: string) => {
    if (!menuIdentityNoteId || !window.thockdownChapters) return

    const current = chapters.find((chapter) => chapter.chapterNoteId === chapterNoteId)
    const trimmed = draft.trim()
    if (trimmed === (current?.chapterId ?? '')) return

    const resolved = await window.thockdownChapters.setChapterId(menuIdentityNoteId, chapterNoteId, trimmed)
    setChapters((previous) => previous.map((chapter) => (
      chapter.chapterNoteId === chapterNoteId ? { ...chapter, chapterId: resolved } : chapter
    )))
  }, [menuIdentityNoteId, chapters])

  const chapterIdEditKeyExists = useCallback((chapterNoteId: string) => (
    chapters.some((chapter) => chapter.chapterNoteId === chapterNoteId)
  ), [chapters])

  const {
    editingKey: editingChapterNoteId,
    draft: chapterIdDraft,
    setDraft: setChapterIdDraft,
    start: startChapterIdEdit,
    cancel: cancelChapterIdEdit,
    commit: commitChapterIdEdit,
  } = useInlinePillEdit<string>({ commit: commitChapterIdEditValue, keyExists: chapterIdEditKeyExists })

  const startEditingChapterId = useCallback((chapterNoteId: string) => {
    const current = chapters.find((chapter) => chapter.chapterNoteId === chapterNoteId)
    startChapterIdEdit(chapterNoteId, current?.chapterId ?? '')
  }, [chapters, startChapterIdEdit])

  return {
    chapters: displayChapters,
    archivedMergedChapterIds,
    refreshChapters,
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
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
  }
}

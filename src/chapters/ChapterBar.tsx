import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { ChapterEntry } from '../shared/chapters'
import { splitChapterFamily } from '../shared/chapters'
import { getChapterTabLabel, getParentTabLabel } from '../shared/tabLabels'

export interface ChapterBarProps {
  parentNoteId: string
  chapters: ChapterEntry[]
  notes: NoteSummary[]
  /** The note actually loaded in the editor right now -- whichever tab (parent or chapter) matches this is shown active. */
  activeNoteId: string | null
  /** Switches back to the parent note's own content -- the first tab. */
  onParentTabClick: () => void
  onChapterClick: (chapterNoteId: string) => void
  onChapterDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  onChapterDragEnd: () => void
  onChapterDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  onChapterContainerDragOver: (event: DragEvent<HTMLDivElement>) => void
  onChapterContainerDrop: (event: DragEvent<HTMLDivElement>) => void
  onChapterPromoteDragOver: (event: DragEvent<HTMLDivElement>) => void
  onChapterPromoteDrop: (event: DragEvent<HTMLDivElement>) => void
  /** Which chapter pill (by chapterNoteId) is mid-inline-edit of its chapterId, if any. */
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  onStartEditingChapterId: (chapterNoteId: string) => void
  onCommitChapterIdEdit: () => void
  onCancelChapterIdEdit: () => void
  /** Left mini button: cuts the current chapter's content, appends it to the previous chapter (or the parent, if this is the first chapter), and deletes the now-empty chapter. Disabled while viewing the parent directly -- there's no "current chapter" to collapse. */
  onCollapseChapterIntoPrevious: () => void
  /** Right mini button: cuts the current editor selection out of whatever's active (parent or a chapter) into a brand-new chapter. A no-op (not disabled) when there's nothing selected -- see useNoteChapters.ts. */
  onExtractSelectionToChapter: () => void
}

/**
 * The chapter-display bar inside the chapter-panel placeholder. Order: a
 * left mini icon button (collapse the current chapter back into the
 * previous one), the tab strip itself -- boxed the same way the tab mode
 * tab-display bar is (.tab-mode-shell), the parent note's own tab first
 * (click to return to its own content) then every chapter in order -- and a
 * right mini icon button (extract the current selection into a new
 * chapter), mirroring the regular tab bar's own
 * tagbar-toggle/section-create-toggle flanking buttons. Shown identically
 * in both edit and render view, since it lives outside the editor/preview
 * split in SectionEditorArea.tsx. The panel itself only ever appears when
 * there's at least one chapter -- see SectionEditorArea.tsx's derived
 * `isChapterPanelOpen`; new chapters are created from the bottom utility
 * bar's "+" button instead of from inside this bar.
 *
 * Dropping a note dragged in from the sidebar onto this bar's background (or
 * the bottom utility bar's "+" button) clones it into a brand-new last
 * chapter; dropping directly on an existing chapter pill (`.chapter-pill`,
 * matched via its `data-chapter-note-id`) clones it in *front* of that one
 * instead. That's a *different* drag (payload type `NOTE_DRAG_MIME_TYPE`,
 * claimed in capture phase by EditorSection.tsx's section-wide drop handler
 * before it ever reaches the handlers below) from the one this component
 * owns directly: chapter pills are themselves draggable, exactly like
 * useSectionTabs.ts's tab/tag pills, so the user can reorder them within the
 * bar by dropping on another pill or on the bar's own background (past the
 * last one, appends to the end). Dropping one directly on the *parent* tab
 * instead promotes it to the parent note, demoting the previous parent to
 * the new first chapter -- see useNoteChapters.ts's handleChapterPromoteDrop.
 */
export function ChapterBar({
  parentNoteId,
  chapters,
  notes,
  activeNoteId,
  onParentTabClick,
  onChapterClick,
  onChapterDragStart,
  onChapterDragEnd,
  onChapterDrop,
  onChapterContainerDragOver,
  onChapterContainerDrop,
  onChapterPromoteDragOver,
  onChapterPromoteDrop,
  editingChapterNoteId,
  chapterIdDraft,
  setChapterIdDraft,
  onStartEditingChapterId,
  onCommitChapterIdEdit,
  onCancelChapterIdEdit,
  onCollapseChapterIntoPrevious,
  onExtractSelectionToChapter,
}: ChapterBarProps) {
  const parentNote = notes.find((note) => note.id === parentNoteId)
  const parentLabel = getParentTabLabel()
  const isParentActive = activeNoteId === parentNoteId
  const hasCurrentChapter = !isParentActive

  // The auto-generated Table of Contents and Open Items chapters (if they
  // exist) always render pinned first, right after the parent tab -- not
  // draggable, not reorder/promote drop targets, no chapterId to
  // right-click-rename. Split out via the one shared, canonical rule
  // (splitChapterFamily, also used by useNoteChapters.ts and mirrored on
  // the main-process side by noteLifecycleService.ts's getRealChapterRows)
  // rather than a locally re-derived filter. Every other chapter renders
  // from `reorderableChapters` so drag-and-drop's index math
  // (useNoteChapters.ts) never sees either of them.
  const { autoTocChapter, autoOpenItemsChapter, realChapters: reorderableChapters } = splitChapterFamily(chapters, notes)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 1)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollEdges()
  }, [chapters.length, updateScrollEdges])

  useEffect(() => {
    window.addEventListener('resize', updateScrollEdges)
    return () => window.removeEventListener('resize', updateScrollEdges)
  }, [updateScrollEdges])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  const handleChapterIdInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommitChapterIdEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelChapterIdEdit()
    }
  }, [onCommitChapterIdEdit, onCancelChapterIdEdit])

  return (
    <div className="chapter-bar-row">
      <button
        type="button"
        className="btn-icon chapter-collapse-button"
        data-tooltip="Collapse this chapter into the previous one"
        aria-label="Collapse this chapter into the previous one"
        disabled={!hasCurrentChapter}
        onClick={onCollapseChapterIntoPrevious}
      >
        <span className="fa-solid fa-code-merge" aria-hidden="true" />
      </button>

      <div className="chapter-tab-mode-shell">
        <div className={`chapter-bar-scroll-shell${canScrollLeft ? ' fade-left' : ''}${canScrollRight ? ' fade-right' : ''}`}>
          <div
            className="chapter-bar-display"
            aria-label="Note chapters"
            role="group"
            ref={scrollerRef}
            onScroll={updateScrollEdges}
            onWheel={handleWheel}
            onDragOver={onChapterContainerDragOver}
            onDrop={onChapterContainerDrop}
          >
            <div
              className={`tag-pill note-tab-pill chapter-parent-pill${isParentActive ? ' active' : ''}`}
              onClick={onParentTabClick}
              onDragOver={onChapterPromoteDragOver}
              onDrop={onChapterPromoteDrop}
              data-tooltip={parentNote?.title ?? 'Parent note'}
            >
              <span className="tag-pill-label">{parentLabel}</span>
            </div>
            {autoTocChapter ? (() => {
              const isActive = autoTocChapter.chapterNoteId === activeNoteId
              const note = notes.find((entry) => entry.id === autoTocChapter.chapterNoteId)
              return (
                <div
                  key={autoTocChapter.chapterNoteId}
                  className={`tag-pill note-tab-pill chapter-pill chapter-auto-toc-pill${isActive ? ' active' : ''}`}
                  data-chapter-note-id={autoTocChapter.chapterNoteId}
                  onClick={() => onChapterClick(autoTocChapter.chapterNoteId)}
                  data-tooltip={note?.title ?? 'Table of Contents'}
                >
                  <span className="fa-solid fa-sitemap" aria-hidden="true" />
                </div>
              )
            })() : null}
            {autoOpenItemsChapter ? (() => {
              const isActive = autoOpenItemsChapter.chapterNoteId === activeNoteId
              const note = notes.find((entry) => entry.id === autoOpenItemsChapter.chapterNoteId)
              return (
                <div
                  key={autoOpenItemsChapter.chapterNoteId}
                  className={`tag-pill note-tab-pill chapter-pill chapter-auto-open-items-pill${isActive ? ' active' : ''}`}
                  data-chapter-note-id={autoOpenItemsChapter.chapterNoteId}
                  onClick={() => onChapterClick(autoOpenItemsChapter.chapterNoteId)}
                  data-tooltip={note?.title ?? 'Open Items'}
                >
                  <span className="fa-solid fa-square-check" aria-hidden="true" />
                </div>
              )
            })() : null}
            {reorderableChapters.map((chapter, index) => {
              const isEditing = editingChapterNoteId === chapter.chapterNoteId
              const isActive = chapter.chapterNoteId === activeNoteId
              const note = notes.find((entry) => entry.id === chapter.chapterNoteId)
              const label = getChapterTabLabel(chapter.chapterId, note?.contentText)

              if (isEditing) {
                return (
                  <input
                    key={chapter.chapterNoteId}
                    className="tag-pill note-tab-pill chapter-pill chapter-id-input"
                    value={chapterIdDraft}
                    autoFocus
                    onChange={(event) => setChapterIdDraft(event.target.value)}
                    onBlur={onCommitChapterIdEdit}
                    onKeyDown={handleChapterIdInputKeyDown}
                    aria-label={`Chapter ${index + 1} id`}
                  />
                )
              }

              return (
                <div
                  key={chapter.chapterNoteId}
                  className={`tag-pill note-tab-pill chapter-pill${isActive ? ' active' : ''}`}
                  data-chapter-note-id={chapter.chapterNoteId}
                  draggable
                  onDragStart={(event) => onChapterDragStart(event, index)}
                  onDragEnd={onChapterDragEnd}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => onChapterDrop(event, index)}
                  onClick={() => onChapterClick(chapter.chapterNoteId)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onStartEditingChapterId(chapter.chapterNoteId)
                  }}
                  data-tooltip={note?.title ?? 'Chapter'}
                >
                  <span className="tag-pill-label">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn-icon chapter-extract-button"
        data-tooltip="Cut the selection (or everything after the caret) into a new chapter right behind this one"
        aria-label="Cut the selection (or everything after the caret) into a new chapter right behind this one"
        onClick={onExtractSelectionToChapter}
      >
        <span className="fa-solid fa-scissors" aria-hidden="true" />
      </button>
    </div>
  )
}

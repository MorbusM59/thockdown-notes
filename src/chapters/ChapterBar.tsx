import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { ChapterEntry } from '../shared/chapters'

export interface ChapterBarProps {
  parentNoteId: string
  chapters: ChapterEntry[]
  notes: NoteSummary[]
  /** The note actually loaded in the editor right now -- whichever tab (parent or chapter) matches this is shown active. */
  activeNoteId: string | null
  /** Switches back to the parent note's own content -- the first tab. */
  onParentTabClick: () => void
  onCreateChapter: () => void
  onChapterClick: (chapterNoteId: string) => void
  /** Which chapter pill (by chapterNoteId) is mid-inline-edit of its chapterId, if any. */
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  onStartEditingChapterId: (chapterNoteId: string) => void
  onCommitChapterIdEdit: () => void
  onCancelChapterIdEdit: () => void
}

/**
 * The chapter-display bar inside the chapter-panel placeholder -- same pill
 * visuals and horizontal-scroll-with-fade behavior as the tab mode
 * tab-display bar (SectionTabBar.tsx). Order: the parent note's own tab
 * first (click to return to its own content), then every chapter in order,
 * then a trailing "+" mini icon button that creates a new chapter. Shown
 * identically in both edit and render view, since it lives outside the
 * editor/preview split in SectionEditorArea.tsx.
 *
 * Dropping a note dragged in from the sidebar anywhere onto this bar
 * attaches it as an existing chapter -- handled by EditorSection.tsx's
 * section-wide drop-capture handler (which recognizes a drop landing inside
 * `.chapter-bar-display`), not by this component, so there's no drag
 * handler here.
 */
export function ChapterBar({
  parentNoteId,
  chapters,
  notes,
  activeNoteId,
  onParentTabClick,
  onCreateChapter,
  onChapterClick,
  editingChapterNoteId,
  chapterIdDraft,
  setChapterIdDraft,
  onStartEditingChapterId,
  onCommitChapterIdEdit,
  onCancelChapterIdEdit,
}: ChapterBarProps) {
  const parentNote = notes.find((note) => note.id === parentNoteId)
  const parentLabel = parentNote?.assignedId != null ? `$${parentNote.assignedId}` : '···'
  const isParentActive = activeNoteId === parentNoteId

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
    <div className={`chapter-bar-scroll-shell${canScrollLeft ? ' fade-left' : ''}${canScrollRight ? ' fade-right' : ''}`}>
      <div
        className="chapter-bar-display"
        aria-label="Note chapters"
        role="group"
        ref={scrollerRef}
        onScroll={updateScrollEdges}
        onWheel={handleWheel}
      >
        <div
          className={`tag-pill note-tab-pill chapter-parent-pill${isParentActive ? ' active' : ''}`}
          onClick={onParentTabClick}
          title={parentNote?.title ?? 'Parent note'}
        >
          <span className="tag-pill-label">{parentLabel}</span>
        </div>
        {chapters.map((chapter, index) => {
          const isEditing = editingChapterNoteId === chapter.chapterNoteId
          const isActive = chapter.chapterNoteId === activeNoteId
          const note = notes.find((entry) => entry.id === chapter.chapterNoteId)
          const label = `§${index + 1}: ${chapter.chapterId ?? '···'}`

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
              onClick={() => onChapterClick(chapter.chapterNoteId)}
              onContextMenu={(event) => {
                event.preventDefault()
                onStartEditingChapterId(chapter.chapterNoteId)
              }}
              title={note?.title ?? 'Chapter'}
            >
              <span className="tag-pill-label">{label}</span>
            </div>
          )
        })}
        <button
          type="button"
          className="btn-icon chapter-add-button"
          title="Add a chapter"
          aria-label="Add a chapter"
          onClick={onCreateChapter}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

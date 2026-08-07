import type { NoteSummary } from '../shared/noteLifecycle'
import type { ChapterEntry } from '../shared/chapters'

export interface ChapterBarProps {
  chapters: ChapterEntry[]
  notes: NoteSummary[]
  /** The note actually loaded in the editor right now -- whichever chapter pill matches this is shown active. */
  activeNoteId: string | null
  onCreateChapter: () => void
  onChapterClick: (chapterNoteId: string) => void
}

/**
 * The chapter-display bar inside the chapter-panel placeholder -- same pill
 * visuals as the tab mode tab-display bar (SectionTabBar.tsx), plus a
 * leading "+" mini icon button that creates a new chapter. Shown identically
 * in both edit and render view, since it lives outside the editor/preview
 * split in SectionEditorArea.tsx.
 */
export function ChapterBar({ chapters, notes, activeNoteId, onCreateChapter, onChapterClick }: ChapterBarProps) {
  return (
    <div className="chapter-bar-scroll-shell">
      <div className="chapter-bar-display" aria-label="Note chapters" role="group">
        <button
          type="button"
          className="btn-icon chapter-add-button"
          title="Add a chapter"
          aria-label="Add a chapter"
          onClick={onCreateChapter}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
        {chapters.map((chapter) => {
          const note = notes.find((entry) => entry.id === chapter.chapterNoteId)
          const label = note?.assignedId != null ? `$${note.assignedId}` : '···'
          const isActive = chapter.chapterNoteId === activeNoteId
          return (
            <div
              key={chapter.chapterNoteId}
              className={`tag-pill note-tab-pill chapter-pill${isActive ? ' active' : ''}`}
              onClick={() => onChapterClick(chapter.chapterNoteId)}
              title={note?.title ?? 'Chapter'}
            >
              <span className="tag-pill-label">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

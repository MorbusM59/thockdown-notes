import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { ChapterEntry } from '../shared/chapters'
import { splitChapterFamily } from '../shared/chapters'
import { resolveIdentityLabel } from '../shared/tabLabels'
import { InlinePillOrInput } from '../shared/InlinePillOrInput'
import type { ChapterPillSplitArm } from './useChapterPillActions'

export interface ChapterBarProps {
  parentNoteId: string
  /** useNoteChapters.ts's own `chapters` (== `displayChapters` there): merged with the parent's archived-and-detached chapters when the parent itself is archived, otherwise identical to its live list -- see that hook's own doc comment. */
  chapters: ChapterEntry[]
  /** Which of `chapters` above have no real `chapters`-table row (archived-and-detached, merged in purely for display) -- see useNoteChapters.ts's own doc comment. Undefined/empty whenever the parent isn't archived, since nothing is ever merged in then. */
  archivedMergedChapterIds?: ReadonlySet<string>
  notes: NoteSummary[]
  /** The note actually loaded in the editor right now -- whichever tab (parent or chapter) matches this is shown active. */
  activeNoteId: string | null
  /** Switches back to the parent note's own content -- the first tab. */
  onParentTabClick: () => void
  /** The tab strip's own trailing "+" pill: creates a brand-new chapter and switches straight to it (mirrors useNoteChapters.ts's handleCreateChapter -- same call the bottom utility bar's own New Chapter action already uses). Not rendered at all while the family is locked (isLocked below) -- a timeless family can't gain a new chapter (databaseService.ts's assertNotTimeless), so there's nothing for it to do. */
  onCreateChapter: () => void | Promise<void>
  onChapterClick: (chapterNoteId: string) => void
  /** `index` is a position within useNoteChapters.ts's own *live-only* reorderableChapters, not `chapters` above -- an archived-merged chapter is never draggable (see the ghost-row rendering below), so this is only ever called with a real, live index. */
  onChapterDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  onChapterDragEnd: () => void
  /** Same live-only index space as onChapterDragStart -- an archived-merged chapter is never a drop target either. */
  onChapterDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  /** Which chapter pill (by chapterNoteId) is mid-inline-edit of its chapterId, if any. */
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  onCommitChapterIdEdit: () => void
  onCancelChapterIdEdit: () => void
  /** Mini button flanking the tab strip's right side (left of the extract button): cuts the current chapter's content, appends it to the previous chapter (or the parent, if this is the first chapter), and deletes the now-empty chapter. Disabled while viewing the parent directly -- there's no "current chapter" to collapse. */
  onCollapseChapterIntoPrevious: () => void
  /** Rightmost mini button: cuts the current editor selection out of whatever's active (parent or a chapter) into a brand-new chapter. A no-op (not disabled) when there's nothing selected -- see useNoteChapters.ts. */
  onExtractSelectionToChapter: () => void
  /** Which chapter pill (if any) is showing the split archive/delete mini pills right now -- see useChapterPillActions.ts. */
  splitArmedChapter: ChapterPillSplitArm | null
  onChapterPillMouseDown: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  onChapterPillMouseUp: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  onChapterPillMouseLeave: (chapterNoteId: string) => void
  onChapterPillContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  onArchiveChapterClick: (chapterNoteId: string) => void
  onDeleteChapterClick: (chapterNoteId: string) => void
  /** True while the parent note is timeless (SectionEditorArea.tsx's isViewingTimelessNote) -- every chapter pill is treated like an archived-merged ("ghost") pill (no drag, no rename, no archive/delete split), and the collapse/extract mini buttons are omitted entirely, since none of that is possible while the whole family is frozen (databaseService.ts's assertNotTimeless). */
  isLocked?: boolean
  /** True while this bar is showing the note's METADATA layer (tags + note id) instead of its CONTENT layer (chapters) -- see `tagBar`. */
  isTagBarMode: boolean
  toggleTagBarMode: () => void
  /**
   * The tag bar, injected rather than built here: tags are a note-level
   * property and belong on this bar (the chapter bar's dual -- metadata beside
   * content structure), but the tag machinery is a large prop bundle owned by
   * useSectionTabs. Passing the rendered element keeps that coupling out of
   * this component entirely.
   */
  tagBar: ReactNode
}

/**
 * The chapter-display bar inside the chapter-panel placeholder. Order,
 * left to right: the Open Items mini icon button, then the Table of
 * Contents mini icon button (each only rendered when that auto-generated
 * chapter exists -- see splitChapterFamily. The TOC one now exists for
 * essentially every note from the moment it's created --
 * NoteLifecycleService.createNote's own default, see its doc comment --
 * so in practice this condition is almost always true; it only still
 * matters for a note created before that became the default and that
 * hasn't gained a real chapter yet to trigger the reactive backfill in
 * useNoteChapters.ts. Open Items is unchanged: it still only exists
 * while there's at least one real chapter to aggregate across), then the
 * tab strip itself --
 * boxed the same way the tab mode tab-display bar is (.tab-mode-shell), the
 * parent note's own tab first (click to return to its own content) then
 * every real chapter in order -- then the collapse-into-previous mini icon
 * button, then the extract-selection-into-new-chapter mini icon button,
 * mirroring the regular tab bar's own tagbar-toggle/section-create-toggle
 * flanking buttons. The Open Items/TOC buttons behave like any other
 * chapter tab (onChapterClick navigates the editor to that chapter's
 * content) but are *not* rendered as pills inside the scrollable tab strip:
 * they're standalone `.chapter-auto-button`s outside it, toggled visually
 * via the shared `.is-active` convention when their chapter is the one
 * currently loaded, exactly like a pill's own `.is-active` state. Shown
 * identically in both edit and render view, since it lives outside the
 * editor/preview split in SectionEditorArea.tsx. The panel is always shown
 * whenever there's an active note -- see SectionEditorArea.tsx's derived
 * `isChapterPanelOpen` -- so the tab strip's own LEADING create pill (a plain
 * `.create-pill`, same icon-only pill treatment as the tab bar's own "new
 * note" pill, which it deliberately mirrors the position of) is reachable
 * even before the note has its first chapter, not
 * just from the bottom utility bar's "New Chapter" quick action
 * (EscapeHoldPanel.tsx), which still exists and calls the exact same
 * handler. Omitted entirely (not just disabled) while the family is locked
 * -- see onCreateChapter's own doc comment above.
 *
 * Dropping a note dragged in from the sidebar onto this bar's background (or
 * its trailing "+" pill, which carries no `data-chapter-note-id` and so
 * doesn't count as an existing-chapter target below) clones it into a
 * brand-new last chapter; dropping directly on an existing chapter pill
 * (`.chapter-pill`, matched via its `data-chapter-note-id`) clones it in
 * *front* of that one
 * instead. That's a *different* drag (payload type `NOTE_DRAG_MIME_TYPE`,
 * claimed in capture phase by EditorSection.tsx's section-wide drop handler
 * before it ever reaches the handlers below) from the one this component
 * owns directly: chapter pills are themselves draggable, exactly like
 * useSectionTabs.ts's tab/tag pills, so the user can reorder them within the
 * bar by dropping on another pill or on the bar's own background (past the
 * last one, appends to the end).
 *
 * A quick right-click on a chapter pill still starts the in-place chapterId
 * rename, same as before -- that decision (release before the hold
 * threshold vs. held long enough to split) now lives entirely in
 * useChapterPillActions.ts's onChapterPillMouseDown/onChapterPillMouseUp, so
 * this component no longer calls a rename-starting prop directly itself.
 * Holding the right mouse button down instead replaces the pill with
 * `.chapter-pill-split`, a fixed-width wrapper (pinned to the real pill's
 * own rendered width, so nothing else in the bar reflows) holding two square
 * `.chapter-pill-mini` buttons
 * side by side -- archive, then delete, same left-to-right order and same
 * mask-icon glyphs as the sidebar's own note-card archive/trash buttons, so
 * the two surfaces read as the same concept. A left click on either mini
 * pill fires it immediately (no separate confirm step -- picking which one
 * to click already *is* the confirmation); moving the pointer outside the
 * whole wrapper (mouseleave, which doesn't fire when crossing between the
 * wrapper's own children) reverts to the plain pill instead. All of the
 * timing/state for this lives in useChapterPillActions.ts, not here.
 *
 * The split wrapper and the plain pill each carry an explicit, distinct
 * `key` ("split"/"pill") even though this is a plain ternary, not a list --
 * without it, confirmed live, reverting from the split caused the chapter
 * bar to visibly grow taller for ~200ms before snapping back. Both branches
 * are a bare `<div>` at the same JSX position, so with no key React
 * reconciles them as the *same* host node and just patches its className --
 * and since `.tag-pill` (tags.css) declares `transition: all 0.2s` while
 * `.chapter-pill-split` has no padding/border of its own, that patch reads
 * as a live style change on one persistent element, so the newly-applied
 * transition animates padding/border-width in from 0 on that same node,
 * visibly inflating it until the transition finishes. A key forces React to
 * unmount/remount instead of patching in place, so the plain pill's final
 * style is just painted once, correctly, with nothing to transition from.
 */
export function ChapterBar({
  parentNoteId,
  chapters,
  archivedMergedChapterIds,
  notes,
  activeNoteId,
  onParentTabClick,
  onCreateChapter,
  onChapterClick,
  onChapterDragStart,
  onChapterDragEnd,
  onChapterDrop,
  editingChapterNoteId,
  chapterIdDraft,
  setChapterIdDraft,
  onCommitChapterIdEdit,
  onCancelChapterIdEdit,
  onCollapseChapterIntoPrevious,
  onExtractSelectionToChapter,
  splitArmedChapter,
  onChapterPillMouseDown,
  onChapterPillMouseUp,
  onChapterPillMouseLeave,
  onChapterPillContextMenu,
  onArchiveChapterClick,
  onDeleteChapterClick,
  isLocked = false,
  isTagBarMode,
  toggleTagBarMode,
  tagBar,
}: ChapterBarProps) {
  const parentNote = notes.find((note) => note.id === parentNoteId)
  const isParentActive = activeNoteId === parentNoteId
  const hasCurrentChapter = !isParentActive

  // The auto-generated Table of Contents and Open Items chapters (if they
  // exist) render as standalone mini buttons outside the tab strip, not as
  // pills inside it -- not draggable, not reorder/promote drop targets, no
  // chapterId to right-click-rename. Split out via the one shared, canonical
  // rule (splitChapterFamily, also used by useNoteChapters.ts and mirrored
  // on the main-process side by noteLifecycleService.ts's
  // getRealChapterRows) rather than a locally re-derived filter. Every
  // other chapter renders from `reorderableChapters` so drag-and-drop's
  // index math (useNoteChapters.ts) never sees either of them. Neither auto
  // chapter can ever be archived-and-merged in, so `chapters` including
  // merged entries doesn't change anything about this split.
  const { autoTocChapter, autoOpenItemsChapter, realChapters: reorderableChapters } = splitChapterFamily(chapters, notes)

  // `reorderableChapters` above can include archived-merged ("ghost")
  // entries interspersed with live ones when the parent is archived (see
  // useNoteChapters.ts's own doc comment on `displayChapters`) -- but
  // useNoteChapters.ts's onChapterDragStart/onChapterDrop handlers index
  // into their OWN, separately-computed, *live-only* reorderableChapters.
  // Passing a plain map-index here would silently target the wrong chapter
  // (or a nonexistent one) the moment a ghost sits anywhere before the
  // dragged/dropped pill. `liveIndex` instead only increments across real,
  // live entries -- skipping ghosts entirely -- so it always lines up with
  // that other, live-only array; a ghost's own `liveIndex` is -1 and is
  // never passed anywhere (draggable=false, no drop handlers -- see below).
  const reorderableChaptersWithLiveIndex = useMemo(() => {
    let liveIndex = -1
    return reorderableChapters.map((chapter) => {
      const isGhost = archivedMergedChapterIds?.has(chapter.chapterNoteId) ?? false
      if (!isGhost) liveIndex += 1
      return { chapter, liveIndex: isGhost ? -1 : liveIndex }
    })
  }, [reorderableChapters, archivedMergedChapterIds])

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

  return (
    <div className="chapter-bar-row">
      {/* A note's two layers meet on this bar: its metadata (tags, note id)
          and its content structure (chapters). The toggle is the only thing
          that survives the swap, so it reads as the label for whichever layer
          is showing -- the same "leading button names the bar" convention the
          tab bar and the chapter strip already use. Tags live HERE, not on the
          tab bar, because a tag is strictly per note: it has no meaning at the
          level of a collection of notes. */}
      <button
        type="button"
        className={`btn-icon chapter-auto-button${isTagBarMode ? ' is-active' : ''}`}
        data-tooltip={isTagBarMode ? 'Show chapters' : 'Show tags'}
        aria-label={isTagBarMode ? 'Show chapters' : 'Show tags'}
        aria-pressed={isTagBarMode}
        onClick={toggleTagBarMode}
      >
        <span className="fa-solid fa-tags" aria-hidden="true" />
      </button>

      {isTagBarMode ? tagBar : (<>
      {autoOpenItemsChapter ? (() => {
        const isActive = autoOpenItemsChapter.chapterNoteId === activeNoteId
        const note = notes.find((entry) => entry.id === autoOpenItemsChapter.chapterNoteId)
        return (
          <button
            type="button"
            className={`btn-icon chapter-auto-button${isActive ? ' is-active' : ''}`}
            data-tooltip={note?.title ?? 'Open Items'}
            aria-label={note?.title ?? 'Open Items'}
            onClick={() => onChapterClick(autoOpenItemsChapter.chapterNoteId)}
          >
            <span className="fa-solid fa-clipboard-list" aria-hidden="true" />
          </button>
        )
      })() : null}
      {autoTocChapter ? (() => {
        const isActive = autoTocChapter.chapterNoteId === activeNoteId
        const note = notes.find((entry) => entry.id === autoTocChapter.chapterNoteId)
        return (
          <button
            type="button"
            className={`btn-icon chapter-auto-button${isActive ? ' is-active' : ''}`}
            data-tooltip={note?.title ?? 'Table of Contents'}
            aria-label={note?.title ?? 'Table of Contents'}
            onClick={() => onChapterClick(autoTocChapter.chapterNoteId)}
          >
            <span className="fa-solid fa-bars-staggered" aria-hidden="true" />
          </button>
        )
      })() : null}

      <div className="chapter-tab-mode-shell">
        <div className={`chapter-bar-scroll-shell${canScrollLeft ? ' fade-left' : ''}${canScrollRight ? ' fade-right' : ''}`}>
          <div
            className="chapter-bar-display"
            aria-label="Note chapters"
            role="group"
            ref={scrollerRef}
            onScroll={updateScrollEdges}
            onWheel={handleWheel}
          >
            {/* Leading, not trailing -- it mirrors the tab bar's own "new note"
                pill, which sits at the head of the tab strip. Sitting first
                also lets the pair read as a label for what the strip contains:
                "new chapter" then the chapters, exactly as "new note" then the
                notes. A new chapter is still appended at the END of the strip,
                which is the one place this mirroring deliberately breaks --
                chapters are a document's own order, and creating one must
                never reorder the document. */}
            {!isLocked ? (
              <div
                className="tag-pill note-tab-pill chapter-pill create-pill"
                data-tooltip="Add a new chapter"
                onClick={() => void onCreateChapter()}
              >
                <span className="fa-solid fa-bookmark" aria-hidden="true" />
              </div>
            ) : null}
            <div
              className={`tag-pill note-tab-pill chapter-pill${isParentActive ? ' is-active' : ''}`}
              onClick={onParentTabClick}
              data-tooltip={parentNote?.title ?? 'INTRO'}
            >
              <span className="fa-solid fa-house" aria-hidden="true" />
            </div>
            {reorderableChaptersWithLiveIndex.map(({ chapter, liveIndex }, displayIndex) => {
              const isGhost = liveIndex === -1
              // Locked pills are disabled the same way a ghost (archived-
              // merged) pill already is -- no drag, no rename, no
              // archive/delete split -- but stay visually distinct (no
              // "(archived)" label/styling) since nothing about the chapter
              // itself changed, only its family's timeless state.
              const isInteractionDisabled = isGhost || isLocked
              const isEditing = !isInteractionDisabled && editingChapterNoteId === chapter.chapterNoteId
              const isActive = chapter.chapterNoteId === activeNoteId
              const note = notes.find((entry) => entry.id === chapter.chapterNoteId)
              const { text: label, isAssigned } = resolveIdentityLabel(chapter.chapterId, note?.contentText, 'chapter')
              const isSplitArmed = !isInteractionDisabled && splitArmedChapter?.chapterNoteId === chapter.chapterNoteId

              return (
                <InlinePillOrInput
                  key={chapter.chapterNoteId}
                  isEditing={isEditing}
                  value={chapterIdDraft}
                  onChange={setChapterIdDraft}
                  onCommit={onCommitChapterIdEdit}
                  onCancel={onCancelChapterIdEdit}
                  className="tag-pill note-tab-pill chapter-pill chapter-id-input"
                  ariaLabel={`Chapter ${displayIndex + 1} id`}
                >
                  {isSplitArmed ? (
                    <div
                      key="split"
                      className="chapter-pill-split"
                      style={{ width: `${splitArmedChapter!.widthPx}px` }}
                      onMouseLeave={() => onChapterPillMouseLeave(chapter.chapterNoteId)}
                    >
                      <button
                        type="button"
                        className="tag-pill chapter-pill-mini chapter-pill-mini-archive"
                        aria-label="Archive chapter"
                        data-tooltip="Archive chapter"
                        onClick={() => onArchiveChapterClick(chapter.chapterNoteId)}
                      />
                      <button
                        type="button"
                        className="tag-pill chapter-pill-mini chapter-pill-mini-delete"
                        aria-label="Delete chapter"
                        data-tooltip="Delete chapter"
                        onClick={() => onDeleteChapterClick(chapter.chapterNoteId)}
                      />
                    </div>
                  ) : (
                    <div
                      key="pill"
                      className={`tag-pill note-tab-pill chapter-pill${isActive ? ' is-active' : ''}${isGhost ? ' is-archived-ghost' : ''}`}
                      data-chapter-note-id={chapter.chapterNoteId}
                      draggable={!isInteractionDisabled}
                      onDragStart={isInteractionDisabled ? undefined : (event) => onChapterDragStart(event, liveIndex)}
                      onDragEnd={isInteractionDisabled ? undefined : onChapterDragEnd}
                      onDragOver={isInteractionDisabled ? undefined : (event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={isInteractionDisabled ? undefined : (event) => onChapterDrop(event, liveIndex)}
                      onClick={() => onChapterClick(chapter.chapterNoteId)}
                      onMouseDown={isInteractionDisabled ? undefined : (event) => onChapterPillMouseDown(event, chapter.chapterNoteId)}
                      onMouseUp={isInteractionDisabled ? undefined : (event) => onChapterPillMouseUp(event, chapter.chapterNoteId)}
                      onMouseLeave={isInteractionDisabled ? undefined : () => onChapterPillMouseLeave(chapter.chapterNoteId)}
                      onContextMenu={isInteractionDisabled ? undefined : onChapterPillContextMenu}
                      data-tooltip={isGhost ? `${label} (archived)` : label}
                    >
                      <span className={`tag-pill-label${isAssigned ? '' : ' tag-pill-label-derived'}`}>{label}</span>
                    </div>
                  )}
                </InlinePillOrInput>
              )
            })}
          </div>
        </div>
      </div>

      {!isLocked ? (
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
      ) : null}

      {!isLocked ? (
        <button
          type="button"
          className="btn-icon chapter-extract-button"
          data-tooltip="Cut the selection (or everything after the caret) into a new chapter right behind this one"
          aria-label="Cut the selection (or everything after the caret) into a new chapter right behind this one"
          onClick={onExtractSelectionToChapter}
        >
          <span className="fa-solid fa-scissors" aria-hidden="true" />
        </button>
      ) : null}
      </>)}
    </div>
  )
}

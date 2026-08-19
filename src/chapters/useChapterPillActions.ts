import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { ChapterEntry } from '../shared/chapters'

/** Matches the sidebar's own right-click-hold gesture (useNoteProtectionActions.ts's NOTE_RIGHT_CLICK_HOLD_MS) -- same duration, so the two gestures feel identical even though this one shows both options at once instead of escalating a single primed action. */
const CHAPTER_PILL_SPLIT_HOLD_MS = 200

export interface ChapterPillSplitArm {
  chapterNoteId: string
  /** The real chapter pill's rendered width at the moment the hold armed, in px -- the split wrapper is pinned to this so the bar doesn't reflow when the pill splits or un-splits. */
  widthPx: number
}

export interface UseChapterPillActionsOptions {
  chapters: ChapterEntry[]
  /** Same handler the existing quick-right-click rename already calls -- a hold released before CHAPTER_PILL_SPLIT_HOLD_MS falls through to it unchanged. */
  startEditingChapterId: (chapterNoteId: string) => void
}

export interface UseChapterPillActionsResult {
  /** Which chapter pill (if any) is currently showing the split archive/delete mini pills, and the width to pin the split wrapper to. */
  splitArmedChapter: ChapterPillSplitArm | null
  handleChapterPillMouseDown: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  handleChapterPillMouseUp: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  handleChapterPillMouseLeave: (chapterNoteId: string) => void
  handleChapterPillContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  handleArchiveChapterClick: (chapterNoteId: string) => void
  handleDeleteChapterClick: (chapterNoteId: string) => void
}

/**
 * Owns the chapter bar's right-click-hold-to-split gesture: holding the
 * right mouse button on a chapter pill for CHAPTER_PILL_SPLIT_HOLD_MS
 * replaces it with two mini pills (archive, delete) sized and iconed
 * exactly like the sidebar's own note-card archive/trash buttons -- see
 * ChapterBar.tsx's own doc comment on the split wrapper's markup/CSS.
 * Deliberately distinct from the sidebar's own hold gesture
 * (useNoteProtectionActions.ts): that one escalates a *single* pill through
 * two states (quick release = archive-primed, held = delete-primed) and
 * needs a second confirming click, since only one label fits in the full
 * pill's width at a time. A chapter pill's split shows both options side by
 * side up front instead -- clicking one fires it immediately, no priming.
 * A release before the hold completes is a quick right-click, which still
 * starts the existing chapterId rename (startEditingChapterId), unchanged.
 *
 * Only the gesture and its resulting armed/unarmed state live here --
 * handleArchiveChapterClick/handleDeleteChapterClick are wired to real
 * archive/delete mutations in a later change; for now they just clear the
 * armed state.
 */
export function useChapterPillActions({
  chapters,
  startEditingChapterId,
}: UseChapterPillActionsOptions): UseChapterPillActionsResult {
  const [splitArmedChapter, setSplitArmedChapter] = useState<ChapterPillSplitArm | null>(null)
  const holdTimerRef = useRef<{ chapterNoteId: string; timeoutId: number } | null>(null)

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current.timeoutId)
      holdTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer])

  // A chapter can disappear out from under an in-progress or already-armed
  // hold (collapsed into the previous chapter, dragged elsewhere and
  // removed, ...) -- same defensive pattern as useNoteProtectionActions.ts's
  // primedNoteActionState effect.
  useEffect(() => {
    if (!splitArmedChapter) return
    if (!chapters.some((chapter) => chapter.chapterNoteId === splitArmedChapter.chapterNoteId)) {
      setSplitArmedChapter(null)
    }
  }, [chapters, splitArmedChapter])

  const handleChapterPillMouseDown = useCallback((event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => {
    if (event.button !== 2) return
    clearHoldTimer()
    const widthPx = event.currentTarget.getBoundingClientRect().width
    const timeoutId = window.setTimeout(() => {
      holdTimerRef.current = null
      setSplitArmedChapter({ chapterNoteId, widthPx })
    }, CHAPTER_PILL_SPLIT_HOLD_MS)
    holdTimerRef.current = { chapterNoteId, timeoutId }
  }, [clearHoldTimer])

  const handleChapterPillMouseUp = useCallback((event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => {
    if (event.button !== 2) return
    const wasQuickRelease = holdTimerRef.current?.chapterNoteId === chapterNoteId
    clearHoldTimer()
    if (wasQuickRelease) {
      startEditingChapterId(chapterNoteId)
    }
  }, [clearHoldTimer, startEditingChapterId])

  // Attached to whichever element (the normal pill while arming, the split
  // wrapper once armed) currently renders for this chapter -- mouseleave
  // doesn't fire when the pointer moves between a parent and its own
  // children, so this alone already satisfies "hovering outside these mini
  // pills or their gap ends the interaction" once split, with no separate
  // per-mini-pill handler needed.
  const handleChapterPillMouseLeave = useCallback((chapterNoteId: string) => {
    setSplitArmedChapter((previous) => (previous?.chapterNoteId === chapterNoteId ? null : previous))
    if (holdTimerRef.current?.chapterNoteId === chapterNoteId) {
      clearHoldTimer()
    }
  }, [clearHoldTimer])

  const handleChapterPillContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  // TODO(chapter-archive-delete): wire to the real archive/delete mutations.
  const handleArchiveChapterClick = useCallback((_chapterNoteId: string) => {
    setSplitArmedChapter(null)
  }, [])

  const handleDeleteChapterClick = useCallback((_chapterNoteId: string) => {
    setSplitArmedChapter(null)
  }, [])

  return {
    splitArmedChapter,
    handleChapterPillMouseDown,
    handleChapterPillMouseUp,
    handleChapterPillMouseLeave,
    handleChapterPillContextMenu,
    handleArchiveChapterClick,
    handleDeleteChapterClick,
  }
}

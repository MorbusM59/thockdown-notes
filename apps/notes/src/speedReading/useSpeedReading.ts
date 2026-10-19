import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { EditorAdapter, EditorSelectionState } from '../editor/EditorContract'
import { startSpeedReadingSession, type SpeedReadingSession, type SpeedReadingSessionResult } from './speedReadingSession'

/**
 * A slot's way into speed reading (`speedReadingSession.ts`), published on its
 * section handle so App's Alt+< can start it in whichever slot is active.
 *
 * The session belongs to the note and the view it started in: a different
 * note arriving, the view switching, the slot losing the keyboard or going
 * away all end it. Most of those are already impossible while it runs -- it
 * takes every key, and a click ends it -- so these are the guarantee rather
 * than the expected path.
 *
 * Ending in the edit view leaves the caret at the start of the chunk that was
 * on show, so a reader who stops to edit finds themselves where they were
 * reading, with that line brought into view.
 */
export interface UseSpeedReadingOptions {
  isPreviewMode: boolean
  isSectionActive: boolean
  activeNoteId: string | null
  readDisplayedText: () => string
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
  adapterRef: MutableRefObject<EditorAdapter | null>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
}

export function useSpeedReading({
  isPreviewMode,
  isSectionActive,
  activeNoteId,
  readDisplayedText,
  latestEditorSelectionRef,
  adapterRef,
  previewScrollRef,
}: UseSpeedReadingOptions): { startSpeedReading: () => void } {
  const sessionRef = useRef<SpeedReadingSession | null>(null)

  useEffect(() => () => {
    sessionRef.current?.end()
  }, [isPreviewMode, isSectionActive, activeNoteId])

  const startSpeedReading = useCallback(() => {
    if (sessionRef.current || !activeNoteId || !isSectionActive) return
    // Only the reader's own ending moves the caret: an ending from outside
    // means the note or the view has already changed, and the offset belongs
    // to what was there before.
    const onEnd = ({ readOffset, byReader }: SpeedReadingSessionResult, view: 'edit' | 'render') => {
      sessionRef.current = null
      if (!byReader || view !== 'edit' || readOffset === null) return
      adapterRef.current?.applySnapshot({
        selection: { anchor: readOffset, focus: readOffset, start: readOffset, end: readOffset, isCollapsed: true },
        selectionScrollBehavior: 'center-caged',
      })
    }
    if (isPreviewMode) {
      const scroller = previewScrollRef.current
      if (!scroller) return
      sessionRef.current = startSpeedReadingSession({ view: 'render', scroller }, (result) => onEnd(result, 'render'))
      return
    }
    sessionRef.current = startSpeedReadingSession(
      { view: 'edit', text: readDisplayedText(), from: latestEditorSelectionRef.current.start },
      (result) => onEnd(result, 'edit'),
    )
  }, [activeNoteId, isSectionActive, isPreviewMode, previewScrollRef, readDisplayedText, latestEditorSelectionRef, adapterRef])

  return { startSpeedReading }
}

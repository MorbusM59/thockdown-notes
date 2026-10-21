import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { EditorAdapter, EditorSelectionState } from '../editor/EditorContract'
import { startSpeedReadingSession, type SpeedReadingSession } from './speedReadingSession'

/**
 * A slot's speed reading MODE (`speedReadingSession.ts`), published on its
 * section handle so App's F2, the slot's toggle button and the escape menu
 * can switch it in whichever slot they speak for.
 *
 * The mode belongs to the slot, not to a view: switching views keeps it and
 * reads on in the other one, and so does a different note arriving. A
 * SESSION is the mode running in one view over one note, so the session is
 * derived -- one runs exactly while the mode is on, the slot holds the
 * keyboard and the escape ring is not up over it, and it is replaced
 * whenever the view or the note changes.
 *
 * Wherever the edit view stops reading -- the mode switched off, or Escape
 * leaving for the render view -- the caret is left at the end of the last
 * chunk shown, on the last line of the editor's middle section, with no
 * animation: the reader is already looking at that place, and what was read
 * stays above it. Placing it before the render view opens is also what lets
 * the view switch carry the reading position across.
 */
export interface UseSpeedReadingOptions {
  isPreviewMode: boolean
  isSectionActive: boolean
  /** The escape ring, or a mode on it, is up over this slot. */
  isEscapeRingUp: boolean
  activeNoteId: string | null
  readDisplayedText: () => string
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
  adapterRef: MutableRefObject<EditorAdapter | null>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
}

export function useSpeedReading({
  isPreviewMode,
  isSectionActive,
  isEscapeRingUp,
  activeNoteId,
  readDisplayedText,
  latestEditorSelectionRef,
  adapterRef,
  previewScrollRef,
}: UseSpeedReadingOptions): { isSpeedReading: boolean; isReadingEditView: boolean; toggleSpeedReading: () => void } {
  const [isSpeedReading, setIsSpeedReading] = useState(false)
  const sessionRef = useRef<SpeedReadingSession | null>(null)
  const readTextRef = useRef(readDisplayedText)
  readTextRef.current = readDisplayedText

  const placeCaret = useCallback((offset: number) => {
    adapterRef.current?.applySnapshot({
      selection: { anchor: offset, focus: offset, start: offset, end: offset, isCollapsed: true },
      selectionScrollBehavior: 'bottom-caged-instant',
    })
  }, [adapterRef])

  const shouldRun = isSpeedReading && isSectionActive && !isEscapeRingUp && activeNoteId !== null

  useEffect(() => {
    if (!shouldRun) return
    if (isPreviewMode) {
      const scroller = previewScrollRef.current
      if (!scroller) return
      sessionRef.current = startSpeedReadingSession({ view: 'render', scroller }, { onLeave: () => {} })
    } else {
      sessionRef.current = startSpeedReadingSession(
        { view: 'edit', text: readTextRef.current(), from: latestEditorSelectionRef.current.start },
        { onLeave: placeCaret },
      )
    }
    return () => {
      sessionRef.current?.end()
      sessionRef.current = null
    }
  }, [shouldRun, isPreviewMode, activeNoteId, previewScrollRef, latestEditorSelectionRef, placeCaret])

  const toggleSpeedReading = useCallback(() => {
    if (!activeNoteId) return
    if (isSpeedReading) {
      // The session hands its position over before it goes, so the caret
      // is placed while the overlay is still the thing on screen.
      sessionRef.current?.leave()
      sessionRef.current?.end()
      sessionRef.current = null
    }
    setIsSpeedReading((on) => !on)
  }, [activeNoteId, isSpeedReading])

  // While the edit view reads, the note under the reading row is hidden, so
  // the editor is made read-only rather than having the session guess which
  // keys could edit it: a paste, a cut or a list shortcut carries a modifier
  // and passes the session by.
  return { isSpeedReading, isReadingEditView: shouldRun && !isPreviewMode, toggleSpeedReading }
}

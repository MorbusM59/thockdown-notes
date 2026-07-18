import { useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { EditorSelectionState } from '../editor/EditorContract'

const ZERO_SELECTION: EditorSelectionState = { anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true }

export interface UseDisplayedNoteSelectionResult {
  editorSelection: EditorSelectionState
  setEditorSelection: Dispatch<SetStateAction<EditorSelectionState>>
  /** The synchronous source of truth for "the selection right now" -- same relationship to `editorSelection` as `latestEditorTextRef` has to `activeNoteText`. */
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
}

/**
 * The displayed note's caret/selection state. Third slice of the
 * editor-mount extraction, same shape as `useActiveNoteId` and
 * `useDisplayedNoteText` -- state ownership only, every existing call site
 * keeps calling `setEditorSelection` / writing
 * `latestEditorSelectionRef.current` exactly as before.
 */
export function useDisplayedNoteSelection(sectionId: string): UseDisplayedNoteSelectionResult {
  void sectionId
  const [editorSelection, setEditorSelection] = useState<EditorSelectionState>(ZERO_SELECTION)
  const latestEditorSelectionRef = useRef<EditorSelectionState>(ZERO_SELECTION)

  return { editorSelection, setEditorSelection, latestEditorSelectionRef }
}

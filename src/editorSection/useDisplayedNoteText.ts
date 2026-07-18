import { useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

export interface UseDisplayedNoteTextResult {
  activeNoteText: string
  setActiveNoteText: Dispatch<SetStateAction<string>>
  /** Bumped on every text-changing operation so memos keyed on "has the text actually changed" (find/replace, snapshots) recompute without needing to diff strings. */
  editorTextVersion: number
  setEditorTextVersion: Dispatch<SetStateAction<number>>
  /** The synchronous source of truth for "the text right now" -- `activeNoteText` lags a render behind during rapid typing, this doesn't. */
  latestEditorTextRef: MutableRefObject<string>
}

/**
 * The displayed note's live text, alongside `useActiveNoteId`. Still just
 * state ownership at this point -- save/debounce, selection tracking, and
 * viewport persistence read these values but haven't moved here yet (next
 * slice). Every existing call site keeps calling `setActiveNoteText` /
 * `setEditorTextVersion` / writing `latestEditorTextRef.current` exactly as
 * before; only the declaration moved.
 */
export function useDisplayedNoteText(sectionId: string): UseDisplayedNoteTextResult {
  void sectionId
  const [activeNoteText, setActiveNoteText] = useState('')
  const [editorTextVersion, setEditorTextVersion] = useState(0)
  const latestEditorTextRef = useRef('')

  return {
    activeNoteText,
    setActiveNoteText,
    editorTextVersion,
    setEditorTextVersion,
    latestEditorTextRef,
  }
}

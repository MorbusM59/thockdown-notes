import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'

export interface UseDisplayedNoteTextResult {
  /**
   * The displayed note's text, now. Stable for the section's lifetime, so a
   * callback that calls it never has to list the text as a dependency. Always
   * canonical (`normalizeInternalText`): every writer stores canonical text.
   */
  readEditorText: () => string
  /**
   * Bumped by every `commitEditorText`. This is the ONLY reactive signal that
   * the text changed: a memo or effect that must re-run when it does keys on
   * this and reads the text through `readEditorText` inside.
   */
  editorTextVersion: number
  /**
   * Replaces the text and re-renders the section. With no argument, commits
   * whatever `latestEditorTextRef` already holds -- the editor writes that
   * ref on every change and the commit coalescer decides when to render it
   * (see documentCommitCoalescer.ts). The text must be canonical.
   */
  commitEditorText: (text?: string) => void
  /**
   * The store itself. Written directly only by the editor's own change
   * handler, which records a change without rendering it yet; everything
   * else writes through `commitEditorText` and reads through
   * `readEditorText`.
   */
  latestEditorTextRef: MutableRefObject<string>
}

/**
 * The displayed note's live text, held in ONE ref and never in React state.
 *
 * Text held in state (or passed down as a string) is a variable of every
 * render scope that closes over it. V8 gives all closures created in one
 * render a single shared scope object, so a memoized callback kept from an
 * earlier render keeps that render's copy of the text alive, together with
 * the memoized callbacks that render captured -- which keep older renders
 * alive in turn. Those chains are ordinary in React and cost nothing while
 * each scope is small; with a document in every scope they cost one full
 * copy of the note per keystroke, permanently (+267MB after 120 characters
 * on a 2MB note; `scripts/perf/measureTypingRetention.mjs` is the gate).
 *
 * So the text is never a value a render scope holds. Code that needs it
 * calls `readEditorText()` at the moment it runs; code that must re-run when
 * it changes keys on `editorTextVersion`. A render-time consumer that needs
 * the string itself (a child's prop) reads it inline, and nothing in that
 * scope may close over the result.
 */
export function useDisplayedNoteText(sectionId: string): UseDisplayedNoteTextResult {
  void sectionId
  const [editorTextVersion, setEditorTextVersion] = useState(0)
  const latestEditorTextRef = useRef('')

  const readEditorText = useCallback(() => latestEditorTextRef.current, [])
  const commitEditorText = useCallback((text?: string) => {
    if (text !== undefined) latestEditorTextRef.current = text
    setEditorTextVersion((previous) => previous + 1)
  }, [])

  return {
    readEditorText,
    editorTextVersion,
    commitEditorText,
    latestEditorTextRef,
  }
}

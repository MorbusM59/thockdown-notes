import { useCallback, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote, isSameNoteSummary } from '../shared/noteLifecycle'
import { normalizeInternalText } from '../editor/TextPolicy'

/** How long to wait after the last keystroke before persisting to disk. */
export const SAVE_DEBOUNCE_MS = 350

export interface UseNoteSaveQueueOptions {
  activeNoteId: string | null
  persistenceReady: boolean
  /** The full shared notes list, mirrored into a ref for the same reason the rest of the app reads it this way -- avoids re-subscribing the debounce timer callback to `notes` itself. */
  notesRef: MutableRefObject<NoteSummary[]>
  latestEditorTextRef: MutableRefObject<string>
  setActiveNoteText: Dispatch<SetStateAction<string>>
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>
}

export interface UseNoteSaveQueueResult {
  /** Debounces a save of `text` for the active note; repeated calls before the debounce window elapses collapse into one write. */
  queueSave: (text: string) => void
  /** Cancels any pending debounce timer and writes immediately -- used before operations that need the disk state current (tag mutations, note switches, section hibernation). */
  flushPendingSaveNow: () => Promise<void>
  /** Cancels any pending debounce timer and discards the pending text *without* writing it -- used when deliberately abandoning unsaved changes (closing an external note without saving) or tearing down on unmount. */
  cancelPendingSave: () => void
}

/**
 * Owns the debounced "write this note's text to disk" pipeline for one
 * section's active note. Deliberately does not know about the Lexical
 * editor, selection, typing sounds, or external-file sync bookkeeping --
 * those still live in App.tsx's `onTextChange` binding and
 * `applyProgrammaticEditorText`, which call `queueSave` exactly like they
 * called the old top-level function. This hook only owns *persisting*
 * whatever text it's handed.
 */
export function useNoteSaveQueue(options: UseNoteSaveQueueOptions): UseNoteSaveQueueResult {
  const { activeNoteId, persistenceReady, notesRef, latestEditorTextRef, setActiveNoteText, setNotes } = options

  const pendingSaveTextRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const flushSave = useCallback(async () => {
    if (!window.thockdownNotes || !activeNoteId) return
    const nextText = pendingSaveTextRef.current
    if (nextText === null) return

    pendingSaveTextRef.current = null
    try {
      const noteSummary = notesRef.current.find((note) => note.id === activeNoteId)
      const isExternal = noteSummary ? isExternalNote(noteSummary) : false
      if (isExternal) {
        console.warn('[external-note] flushSave triggered for external note', { noteId: activeNoteId, textLength: nextText.length, nextText })
      }
      const normalizedText = normalizeInternalText(nextText)
      console.debug('[external-note] flushing note into DB', { noteId: activeNoteId, textLength: normalizedText.length, normalizedText })

      const savedSummary = await window.thockdownNotes.saveNote({ id: activeNoteId, text: normalizedText })

      if (isExternal) {
        await window.thockdownNotes?.saveNoteSnapshot({ id: activeNoteId, content: normalizedText, isManual: false })
        console.warn('[external-note] external note current state persisted into DB snapshot', { noteId: activeNoteId, textLength: normalizedText.length })
        latestEditorTextRef.current = normalizedText
        setActiveNoteText(normalizedText)
      }

      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === savedSummary.id)
        if (index < 0) return previous

        const existing = previous[index]
        if (isSameNoteSummary(existing, savedSummary)) {
          return previous
        }

        const next = [...previous]
        next[index] = savedSummary
        return next
      })
    } catch (error) {
      console.error('Failed to persist note', error)
    }
  }, [activeNoteId, notesRef, latestEditorTextRef, setActiveNoteText, setNotes])

  const queueSave = useCallback((text: string) => {
    if (!persistenceReady) return
    pendingSaveTextRef.current = normalizeInternalText(text)
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }, [flushSave, persistenceReady])

  const flushPendingSaveNow = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await flushSave()
  }, [flushSave])

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingSaveTextRef.current = null
  }, [])

  return { queueSave, flushPendingSaveNow, cancelPendingSave }
}

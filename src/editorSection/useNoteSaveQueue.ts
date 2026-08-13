import { useCallback, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote, isSameNoteSummary } from '../shared/noteLifecycle'
import { normalizeInternalText } from '../editor/TextPolicy'
import { hashNormalizedText } from '../shared/hashText'
import { PREVIEW_BLOCK_CACHE_VERSION, type PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'

/** How long to wait after the last keystroke before persisting to disk. */
export const SAVE_DEBOUNCE_MS = 350

export interface UseNoteSaveQueueOptions {
  activeNoteId: string | null
  persistenceReady: boolean
  /** The full shared notes list, mirrored into a ref for the same reason the rest of the app reads it this way -- avoids re-subscribing the debounce timer callback to `notes` itself. */
  notesRef: MutableRefObject<NoteSummary[]>
  latestEditorTextRef: MutableRefObject<string>
  /** Warm-start cache from useEditorSectionMount's background preview-block parse. Used to persist the structural split alongside the note text so the next startup can warm-start. */
  previewBlockSplitCacheRef: MutableRefObject<PreviewBlockSplitCache | null>
  setActiveNoteText: Dispatch<SetStateAction<string>>
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>
  /**
   * Fires after every successful save with the saved note's id. The chapter
   * bar's own `chapters` state (useNoteChapters.ts) has no other way to
   * learn about the auto-Open-Items chapter being lazily created/patched/
   * torn down in the background by this same save (see
   * noteLifecycleService.ts's saveNote checklist-diff hook) -- unlike the
   * auto-TOC chapter, whose creation/removal is driven by a reactive effect
   * already watching `chapters` state directly. Optional: only EditorSection.tsx
   * wires this today, not e.g. tests instantiating this hook standalone.
   */
  onSaveCompleted?: (noteId: string) => void
}

export interface UseNoteSaveQueueResult {
  /**
   * Debounces a save of `text` for the active note; repeated calls before
   * the debounce window elapses collapse into one write. `cursorPos`, when
   * provided, piggybacks onto this same write (see databaseService.ts's
   * upsertNoteContent doc comment) -- always pass the latest value
   * available at call time; only the value from the call that actually
   * triggers the flush (the last one before the debounce timer fires) is
   * used, matching how `text` itself already works here. Scroll position
   * is never piggybacked here -- see saveNoteUiState/docs/editor-contract.md.
   */
  queueSave: (text: string, cursorPos?: number | null) => void
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
  const { activeNoteId, persistenceReady, notesRef, latestEditorTextRef, previewBlockSplitCacheRef, setActiveNoteText, setNotes, onSaveCompleted } = options

  const pendingSaveTextRef = useRef<string | null>(null)
  const pendingSaveCursorPosRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const flushSave = useCallback(async () => {
    if (!window.thockdownNotes || !activeNoteId) return
    const nextText = pendingSaveTextRef.current
    if (nextText === null) return

    const cursorPos = pendingSaveCursorPosRef.current
    pendingSaveTextRef.current = null
    pendingSaveCursorPosRef.current = null
    try {
      const noteSummary = notesRef.current.find((note) => note.id === activeNoteId)
      const isExternal = noteSummary ? isExternalNote(noteSummary) : false
      const normalizedText = normalizeInternalText(nextText)

      const splitCache = previewBlockSplitCacheRef.current
      const previewBlockCache = splitCache && splitCache.text === normalizedText
        ? {
            v: PREVIEW_BLOCK_CACHE_VERSION,
            textHash: await hashNormalizedText(normalizedText),
            ranges: splitCache.ranges.map(({ type, rangeStartLine1, rangeEndLine1 }) => ({
              type,
              rangeStartLine1,
              rangeEndLine1,
            })),
          }
        : null

      if (typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
        console.log('[preview-block-cache] piggybacking on saveNote', {
          noteId: activeNoteId,
          textLength: normalizedText.length,
          hasCache: !!previewBlockCache,
          ranges: previewBlockCache?.ranges.length,
        })
      }

      const savedSummary = await window.thockdownNotes.saveNote({
        id: activeNoteId,
        text: normalizedText,
        cursorPos,
        previewBlockCache,
      })

      if (isExternal) {
        await window.thockdownNotes?.saveNoteSnapshot({ id: activeNoteId, content: normalizedText, isManual: false })
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

      onSaveCompleted?.(activeNoteId)
    } catch (error) {
      console.error('Failed to persist note', error)
    }
  }, [activeNoteId, notesRef, latestEditorTextRef, previewBlockSplitCacheRef, setActiveNoteText, setNotes, onSaveCompleted])

  const queueSave = useCallback((text: string, cursorPos?: number | null) => {
    if (!persistenceReady) return
    // flushSave always re-normalizes pendingSaveTextRef.current right before
    // it's used (saveNote/saveNoteSnapshot/the isExternal branch all consume
    // its own normalizedText, never this raw value) -- normalizing here too
    // is a redundant O(document length) pass on every keystroke regardless of
    // whether `text` is already canonical.
    pendingSaveTextRef.current = text
    pendingSaveCursorPosRef.current = cursorPos ?? null
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

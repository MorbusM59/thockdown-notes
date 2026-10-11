import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { EditorAdapter } from '../editor/EditorContract'
import type { DocumentImage } from '../editor/DocumentImages'
import { requestDocumentImages } from '../editor/documentFactsClient'
import {
  imageSourcesToStore,
  imageStorageState,
  rewriteToOrigins,
  rewriteToStored,
  shapeableImages,
  storedImageIds,
  type ImageStorageState,
} from '../editor/ImageStorageRewrite'
import { describeImageFailure } from '../shared/images'
import { resolveStoredImages, storeImageSources } from '../shared/storedImages'
import { SAVE_DEBOUNCE_MS } from './useNoteSaveQueue'

// THE IMAGE BUTTON's state and its two actions (SectionEditorArea draws it).
//
// Which images the open note holds is a fact of the Markdown parse, asked of
// the document-facts worker (DocumentImages.ts): an image inside a code block
// is not one. A note with no `![` at all is answered without asking. After an
// edit the question waits until typing pauses (the save debounce) -- the
// answer changes only when an image is added or removed, and asking per
// keystroke would ship the whole text to the worker each time.
//
// Storing and restoring rewrite the note as ONE edit (EditorAdapter.applyEdit,
// one undo step), after a manual snapshot so the timeline holds the note as
// it was. The edit is applied only if the text is still what the rewrite was
// computed from; if the reader typed meanwhile, nothing is changed and the
// press can simply be repeated.

export interface ImageStorageButton {
  state: ImageStorageState
  busy: boolean
  /** Why the last store left some images where they were; empty when it did not. */
  failures: string[]
  store: () => void
  restore: () => void
}

export function useImageStorageButton({
  activeNoteId,
  readEditorText,
  editorTextVersion,
  adapterRef,
  canRewrite,
  createSnapshot,
}: {
  activeNoteId: string | null
  readEditorText: () => string
  editorTextVersion: number
  adapterRef: MutableRefObject<EditorAdapter | null>
  /** False on a read-only note or while a snapshot is shown. */
  canRewrite: boolean
  createSnapshot: () => Promise<void> | void
}): ImageStorageButton {
  const [facts, setFacts] = useState<{ noteId: string | null; images: DocumentImage[] }>({ noteId: null, images: [] })
  const [busy, setBusy] = useState(false)
  // Claimed synchronously, before anything is awaited, so a left and a right
  // hold in quick succession cannot both start.
  const busyRef = useRef(false)
  const [failures, setFailures] = useState<string[]>([])
  const askedForRef = useRef(0)

  useEffect(() => {
    const text = readEditorText()
    const asking = ++askedForRef.current
    if (!activeNoteId || !text.includes('![')) {
      setFacts({ noteId: activeNoteId, images: [] })
      return
    }
    const answer = () => {
      void requestDocumentImages(text).then((images) => {
        if (askedForRef.current === asking) setFacts({ noteId: activeNoteId, images: shapeableImages(text, images) })
      })
    }
    // A note just opened is answered at once (and free: the split that
    // opened it found its images); an edit waits for typing to pause.
    if (facts.noteId !== activeNoteId) {
      answer()
      return
    }
    const timer = window.setTimeout(answer, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // facts.noteId is read to tell an open from an edit, not to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, editorTextVersion, readEditorText])

  useEffect(() => { setFailures([]) }, [activeNoteId])

  const images = facts.noteId === activeNoteId ? facts.images : []

  const run = useCallback(async (direction: 'store' | 'restore') => {
    if (!canRewrite || busyRef.current || !activeNoteId) return
    busyRef.current = true
    setBusy(true)
    try {
      const text = readEditorText()
      const current = shapeableImages(text, await requestDocumentImages(text))
      let edit
      let notStored: string[] = []
      if (direction === 'store') {
        const results = await storeImageSources(imageSourcesToStore(current))
        notStored = Object.entries(results).flatMap(([source, result]) => (
          result.ok ? [] : [`${source}: ${describeImageFailure(result.reason)}`]
        ))
        edit = rewriteToStored(text, current, results)
      } else {
        const resolved = await resolveStoredImages(storedImageIds(current))
        const origins = Object.fromEntries(Object.entries(resolved).map(([id, image]) => [id, image?.origin ?? null]))
        edit = rewriteToOrigins(text, current, origins)
      }
      setFailures(notStored)
      if (!edit || readEditorText() !== text) return
      await createSnapshot()
      adapterRef.current?.applyEdit(edit, text)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [activeNoteId, adapterRef, canRewrite, createSnapshot, readEditorText])

  return {
    // Absent wherever it could not act (a frozen or sealed note, a snapshot
    // being browsed, a generated chapter), rather than a button that ignores
    // its own tooltip.
    state: canRewrite ? imageStorageState(images) : 'none',
    busy,
    failures,
    store: useCallback(() => { void run('store') }, [run]),
    restore: useCallback(() => { void run('restore') }, [run]),
  }
}

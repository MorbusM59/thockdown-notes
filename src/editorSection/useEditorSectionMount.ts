import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { PersistedViewportState } from '../shared/appState'
import type { EditorAdapter, EditorSelectionState } from '../editor/EditorContract'
import {
  type EditRestoreSnapshot,
  type EditViewportTelemetry,
  resolveSourceAnchorFromEditState,
  scrollTopPxToLines,
  scrollTopLinesToPx,
} from '../editor/EditRestoreMath'
import { normalizeInternalText } from '../editor/TextPolicy'

export interface UseEditorSectionMountOptions {
  activeNoteId: string | null
  activeNoteText: string
  isPreviewMode: boolean
  lineHeightPx: number
  latestEditorTextRef: MutableRefObject<string>
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
}

export interface UseEditorSectionMountResult {
  adapterRef: MutableRefObject<EditorAdapter | null>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  editModeSnapshotByNoteIdRef: MutableRefObject<Map<string, EditRestoreSnapshot>>
  pendingEditRestoreSnapshotRef: MutableRefObject<EditRestoreSnapshot | null>
  pendingRenderViewSourceAnchorRef: MutableRefObject<{ sourceAnchorLine: number; sourceAnchorText: string | null } | null>
  latestViewportRef: MutableRefObject<PersistedViewportState | null>
  latestEditViewportRef: MutableRefObject<PersistedViewportState | null>
  latestEditViewportTelemetryRef: MutableRefObject<EditViewportTelemetry | null>

  readCurrentEditUiPayload: () => { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null
  updateEditModeSnapshotCache: (snapshot: EditRestoreSnapshot) => void
  captureEditModeSnapshotFromEditor: (noteId: string) => EditRestoreSnapshot | null
  persistEditUiPayloadForNote: (
    noteId: string,
    payload: { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null },
  ) => Promise<void>
  resolvePreviewSourceAnchorFromContainer: (container: HTMLElement) => { sourceAnchorLine: number; sourceAnchorText: string | null } | null
  persistRenderViewStateForNoteNow: (noteId: string) => Promise<void>
  restoreEditorSelection: () => void
  focusEditorInEditMode: (options?: { restoreSelection?: boolean }) => void
  scheduleFocusEditorInEditMode: (options?: { restoreSelection?: boolean }) => void
  persistEditUiState: (noteId: string, options?: { immediate?: boolean }) => void
  /** Cancels a debounced persistEditUiState write without flushing it -- mirrors useNoteSaveQueue's cancelPendingSave, for unmount cleanup. */
  cancelPendingEditUiStatePersist: () => void
  persistActiveNoteEditModeStateNow: () => void
  applyEditRestoreSnapshot: (
    snapshot: EditRestoreSnapshot,
    options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void },
  ) => () => void
  captureEditModeSnapshotForRenderView: (noteId: string, activeText: string) => void
}

/**
 * Owns the editor's imperative refs (adapter, preview scroll container) and
 * "remember where the user was" machinery: capturing/restoring caret +
 * viewport position per note, in both edit and render mode, and persisting
 * it to disk. Deliberately does not yet own the live typing/selection
 * bindings or `applyProgrammaticEditorText` -- those depend on nearly
 * everything here (this is why position-memory had to move first) and are
 * the next slice. Every function here is called by App.tsx's still-local
 * pipeline code by the same name it always had.
 */
export function useEditorSectionMount(options: UseEditorSectionMountOptions): UseEditorSectionMountResult {
  const { activeNoteId, activeNoteText, isPreviewMode, lineHeightPx, latestEditorTextRef, latestEditorSelectionRef } = options

  const adapterRef = useRef<EditorAdapter | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const editModeSnapshotByNoteIdRef = useRef<Map<string, EditRestoreSnapshot>>(new Map())
  const pendingEditRestoreSnapshotRef = useRef<EditRestoreSnapshot | null>(null)
  const pendingRenderViewSourceAnchorRef = useRef<{ sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportTelemetryRef = useRef<EditViewportTelemetry | null>(null)
  const editUiStateSaveTimerRef = useRef<number | null>(null)
  const lastPersistedEditUiStateRef = useRef<{ noteId: string; progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)

  const readCurrentEditUiPayload = useCallback((): { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null => {
    const selection = latestEditorSelectionRef.current

    const liveSnapshot = adapterRef.current?.getSnapshot()
    const snapshotViewport = liveSnapshot?.viewport
    const snapshotViewportLines = liveSnapshot?.viewportLines
    let snapshotViewportState: PersistedViewportState | null = null

    if (snapshotViewportLines) {
      snapshotViewportState = {
        topBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.topBoundaryLines)),
        bottomBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.bottomBoundaryLines)),
        scrollTopLines: Math.max(0, Math.round(snapshotViewportLines.scrollTopLines)),
      }

      latestViewportRef.current = snapshotViewportState
      latestEditViewportRef.current = snapshotViewportState
    }

    if (snapshotViewport) {
      latestEditViewportTelemetryRef.current = {
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
      }
    }

    const viewport = snapshotViewportState ?? latestEditViewportRef.current ?? latestViewportRef.current
    if (!viewport) return null

    const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const { sourceAnchorLine, sourceAnchorText } = resolveSourceAnchorFromEditState({
      text: activeText,
      lineHeightPx: lineHeightPx,
      telemetry: latestEditViewportTelemetryRef.current ?? undefined,
      viewport,
    })

    const scrollTopLines = Math.max(0, Math.round(viewport.scrollTopLines))
    const scrollTop = scrollTopLinesToPx(scrollTopLines, lineHeightPx)
    const progressEdit = scrollTopLines
    const cursorPos = Math.max(0, selection.end)

    return {
      progressEdit,
      cursorPos,
      scrollTop,
      sourceAnchorLine,
      sourceAnchorText,
    }
  }, [activeNoteText, lineHeightPx])

  const updateEditModeSnapshotCache = useCallback((snapshot: EditRestoreSnapshot) => {
    editModeSnapshotByNoteIdRef.current.set(snapshot.noteId, snapshot)
  }, [])

  const captureEditModeSnapshotFromEditor = useCallback((noteId: string): EditRestoreSnapshot | null => {
    const liveSnapshot = adapterRef.current?.getSnapshot()
    const selection = liveSnapshot?.selection ?? latestEditorSelectionRef.current
    const snapshotViewport = liveSnapshot?.viewport
    const snapshotViewportLines = liveSnapshot?.viewportLines
    const viewport: PersistedViewportState | null = snapshotViewportLines
      ? {
          topBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.topBoundaryLines)),
          bottomBoundaryLines: Math.max(0, Math.round(snapshotViewportLines.bottomBoundaryLines)),
          scrollTopLines: Math.max(0, Math.round(snapshotViewportLines.scrollTopLines)),
        }
      : (latestEditViewportRef.current ?? latestViewportRef.current)

    if (snapshotViewportLines) {
      latestViewportRef.current = viewport
      latestEditViewportRef.current = viewport
    }

    if (snapshotViewport) {
      latestEditViewportTelemetryRef.current = {
        scrollTopPx: Math.round(snapshotViewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(snapshotViewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(snapshotViewport.clientHeightPx ?? 0)),
      }
    }

    if (!viewport) return null

    const collapsedSelection: EditorSelectionState = {
      anchor: selection.end,
      focus: selection.end,
      start: selection.end,
      end: selection.end,
      isCollapsed: true,
    }

    const snapshot: EditRestoreSnapshot = {
      noteId,
      collapsedSelection,
      fullSelection: selection,
      viewport,
    }

    pendingEditRestoreSnapshotRef.current = snapshot
    updateEditModeSnapshotCache(snapshot)
    return snapshot
  }, [updateEditModeSnapshotCache])

  const persistEditUiPayloadForNote = useCallback(async (
    noteId: string,
    payload: { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null },
  ) => {
    const notesApi = window.thockdownNotes
    if (!notesApi) return

    const { progressEdit, cursorPos, scrollTop, sourceAnchorLine, sourceAnchorText } = payload
    const previousPersisted = lastPersistedEditUiStateRef.current
    const changed =
      !previousPersisted
      || previousPersisted.noteId !== noteId
      || previousPersisted.scrollTop !== scrollTop
      || previousPersisted.cursorPos !== cursorPos
      || previousPersisted.sourceAnchorLine !== sourceAnchorLine
      || previousPersisted.sourceAnchorText !== sourceAnchorText
      || Math.abs(previousPersisted.progressEdit - progressEdit) >= 0.0001

    if (changed) {
      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
        sourceAnchorLine,
        sourceAnchorText,
      }
      await notesApi.saveNoteUiState({ id: noteId, payload })
      return
    }
  }, [])

  const resolvePreviewSourceAnchorFromContainer = useCallback((container: HTMLElement): { sourceAnchorLine: number; sourceAnchorText: string | null } | null => {
    const containerRect = container.getBoundingClientRect()
    const anchors = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const line = Number(element.dataset.sourceLine)
        return {
          element,
          line: Number.isFinite(line) ? Math.max(0, Math.round(line)) : -1,
          top: rect.top - containerRect.top,
          bottom: rect.bottom - containerRect.top,
        }
      })
      .filter((entry) => entry.line >= 0)

    if (anchors.length === 0) {
      return null
    }

    anchors.sort((a, b) => a.top - b.top)
    const visibleAtOrAboveTop = anchors.filter((entry) => entry.top <= 0)
    const selected = visibleAtOrAboveTop.length > 0
      ? visibleAtOrAboveTop.reduce((best, candidate) => (candidate.top > best.top ? candidate : best))
      : anchors.reduce((best, candidate) => (candidate.top < best.top ? candidate : best))

    return {
      sourceAnchorLine: selected.line,
      sourceAnchorText: selected.element.textContent?.trim() ?? null,
    }
  }, [])

  const persistRenderViewStateForNoteNow = useCallback(async (noteId: string) => {
    const container = previewScrollRef.current
    if (!container) return

    const sourceAnchor = resolvePreviewSourceAnchorFromContainer(container)
    if (!sourceAnchor) return

    const payload: { sourceAnchorLine: number; sourceAnchorText: string | null } = {
      sourceAnchorLine: sourceAnchor.sourceAnchorLine,
      sourceAnchorText: sourceAnchor.sourceAnchorText,
    }

    await window.thockdownNotes?.saveNoteUiState({ id: noteId, payload })
  }, [resolvePreviewSourceAnchorFromContainer])

  const restoreEditorSelection = useCallback(() => {
    const selection = latestEditorSelectionRef.current
    if (!selection) return

    const adapter = adapterRef.current
    if (adapter) {
      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
      })
      return
    }

    requestAnimationFrame(() => {
      adapterRef.current?.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
      })
    })
  }, [])

  const focusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    if (isPreviewMode || !activeNoteId) return

    const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
    if (!editorRoot) return
    if (document.activeElement === editorRoot) return

    if (options?.restoreSelection ?? true) {
      restoreEditorSelection()
    }
    editorRoot.focus({ preventScroll: true })
  }, [activeNoteId, isPreviewMode, restoreEditorSelection])

  const scheduleFocusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    const attemptFocus = () => {
      if (isPreviewMode || !activeNoteId) return

      const adapter = adapterRef.current
      const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
      if (!adapter || !editorRoot) {
        requestAnimationFrame(attemptFocus)
        return
      }

      focusEditorInEditMode(options)
    }

    window.setTimeout(() => {
      requestAnimationFrame(attemptFocus)
    }, 0)
  }, [activeNoteId, focusEditorInEditMode, isPreviewMode])

  const persistEditUiState = useCallback((noteId: string, options?: { immediate?: boolean }) => {
    const notesApi = window.thockdownNotes
    if (!notesApi) return

    const persistNow = async () => {
      const payload = readCurrentEditUiPayload()
      if (!payload) return
      const { progressEdit, cursorPos, scrollTop, sourceAnchorLine, sourceAnchorText } = payload

      const cached = editModeSnapshotByNoteIdRef.current.get(noteId)
      if (cached) {
        updateEditModeSnapshotCache({
          ...cached,
          collapsedSelection: {
            anchor: cursorPos,
            focus: cursorPos,
            start: cursorPos,
            end: cursorPos,
            isCollapsed: true,
          },
          fullSelection: {
            anchor: cursorPos,
            focus: cursorPos,
            start: cursorPos,
            end: cursorPos,
            isCollapsed: true,
          },
          viewport: {
            ...cached.viewport,
            scrollTopLines: scrollTopPxToLines(scrollTop, lineHeightPx),
          },
        })
      }

      const previousPersisted = lastPersistedEditUiStateRef.current
      if (
        previousPersisted &&
        previousPersisted.noteId === noteId &&
        previousPersisted.scrollTop === scrollTop &&
        previousPersisted.cursorPos === cursorPos &&
        previousPersisted.sourceAnchorLine === sourceAnchorLine &&
        previousPersisted.sourceAnchorText === sourceAnchorText &&
        Math.abs(previousPersisted.progressEdit - progressEdit) < 0.0001
      ) {
        return
      }

      lastPersistedEditUiStateRef.current = {
        noteId,
        progressEdit,
        cursorPos,
        scrollTop,
        sourceAnchorLine,
        sourceAnchorText,
      }

      await notesApi.saveNoteUiState({ id: noteId, payload })
    }

    if (options?.immediate) {
      if (editUiStateSaveTimerRef.current !== null) {
        window.clearTimeout(editUiStateSaveTimerRef.current)
        editUiStateSaveTimerRef.current = null
      }
      void persistNow()
      return
    }

    if (editUiStateSaveTimerRef.current !== null) {
      window.clearTimeout(editUiStateSaveTimerRef.current)
    }

    editUiStateSaveTimerRef.current = window.setTimeout(() => {
      editUiStateSaveTimerRef.current = null
      void persistNow()
    }, 280)
  }, [lineHeightPx, readCurrentEditUiPayload, updateEditModeSnapshotCache])

  const cancelPendingEditUiStatePersist = useCallback(() => {
    if (editUiStateSaveTimerRef.current !== null) {
      window.clearTimeout(editUiStateSaveTimerRef.current)
      editUiStateSaveTimerRef.current = null
    }
  }, [])

  const persistActiveNoteEditModeStateNow = useCallback(() => {
    if (!activeNoteId) return

    if (!isPreviewMode) {
      captureEditModeSnapshotFromEditor(activeNoteId)
    }

    const payload = readCurrentEditUiPayload() ?? (() => {
      const cachedSnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
      if (!cachedSnapshot) return null
      return {
        progressEdit: cachedSnapshot.viewport.scrollTopLines,
        cursorPos: cachedSnapshot.fullSelection.end,
        scrollTop: scrollTopLinesToPx(cachedSnapshot.viewport.scrollTopLines, lineHeightPx),
        sourceAnchorLine: Math.max(0, cachedSnapshot.viewport.scrollTopLines + cachedSnapshot.viewport.topBoundaryLines),
        sourceAnchorText: null,
      }
    })()
    if (!payload) return

    void persistEditUiPayloadForNote(activeNoteId, payload)
  }, [
    activeNoteId,
    captureEditModeSnapshotFromEditor,
    lineHeightPx,
    isPreviewMode,
    persistEditUiPayloadForNote,
  ])

  const applyEditRestoreSnapshot = useCallback((snapshot: EditRestoreSnapshot, options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void }) => {
    const restoreFullSelection = options?.restoreFullSelection ?? true
    const focusAfterApply = options?.focusAfterApply ?? false
    const onComplete = options?.onComplete
    let cancelled = false

    const applySourceAnchorToEditor = () => {
      if (typeof snapshot.sourceAnchorLine !== 'number' || !Number.isFinite(snapshot.sourceAnchorLine)) {
        return
      }

      const scroller = document.querySelector<HTMLElement>('.editor-stage .thockdown-custom-scrollbar')
      const editorRoot = document.querySelector<HTMLElement>('.editor-stage .editor-text[contenteditable="true"]')
      if (!scroller || !editorRoot) {
        return
      }

      const paragraphs = Array.from(editorRoot.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
      if (paragraphs.length === 0) {
        return
      }

      const targetIndex = Math.max(0, Math.min(paragraphs.length - 1, Math.round(snapshot.sourceAnchorLine)))
      const targetParagraph = paragraphs[targetIndex]
      const scrollerRect = scroller.getBoundingClientRect()
      const paragraphRect = targetParagraph.getBoundingClientRect()
      const topBoundaryPx = Math.max(0, Math.round(snapshot.viewport.topBoundaryLines * lineHeightPx))
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const targetScrollTop = Math.max(
        0,
        Math.min(
          maxScrollTop,
          scroller.scrollTop + (paragraphRect.top - scrollerRect.top) - topBoundaryPx,
        ),
      )

      scroller.scrollTop = targetScrollTop
      requestAnimationFrame(() => {
        if (!cancelled) {
          scroller.scrollTop = targetScrollTop
        }
      })
    }

    // Restoring from integer line counts is direct and idempotent: no
    // measurement-dependent clamping happens at apply time (see
    // EditorViewportLines / clampBoundaryLines), so a single applySnapshot
    // call is sufficient. The previous implementation needed a multi-frame
    // reconciliation loop to work around pixel-based restores being
    // invalidated by container-size races; that is no longer necessary.
    const applyWhenReady = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyWhenReady)
        return
      }

      const selection = restoreFullSelection ? snapshot.fullSelection : snapshot.collapsedSelection

      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
        viewportLines: snapshot.viewport,
      })

      requestAnimationFrame(() => {
        if (cancelled) return
        applySourceAnchorToEditor()
      })

      latestViewportRef.current = snapshot.viewport
      latestEditViewportRef.current = snapshot.viewport

      if (focusAfterApply) {
        requestAnimationFrame(() => {
          focusEditorInEditMode({ restoreSelection: false })
        })
      }

      if (onComplete) {
        onComplete()
      }
    }

    requestAnimationFrame(applyWhenReady)

    return () => {
      cancelled = true
    }
  }, [lineHeightPx, focusEditorInEditMode])

  const captureEditModeSnapshotForRenderView = useCallback((noteId: string, activeText: string) => {
    const snapshot = captureEditModeSnapshotFromEditor(noteId)
    const viewport = snapshot?.viewport ?? latestEditViewportRef.current ?? latestViewportRef.current

    if (!viewport) {
      pendingRenderViewSourceAnchorRef.current = null
      return
    }

    const anchor = resolveSourceAnchorFromEditState({
      text: activeText,
      lineHeightPx: lineHeightPx,
      telemetry: latestEditViewportTelemetryRef.current ?? undefined,
      viewport,
    })

    pendingRenderViewSourceAnchorRef.current = anchor
  }, [captureEditModeSnapshotFromEditor, lineHeightPx])

  return {
    adapterRef,
    previewScrollRef,
    editModeSnapshotByNoteIdRef,
    pendingEditRestoreSnapshotRef,
    pendingRenderViewSourceAnchorRef,
    latestViewportRef,
    latestEditViewportRef,
    latestEditViewportTelemetryRef,
    readCurrentEditUiPayload,
    updateEditModeSnapshotCache,
    captureEditModeSnapshotFromEditor,
    persistEditUiPayloadForNote,
    resolvePreviewSourceAnchorFromContainer,
    persistRenderViewStateForNoteNow,
    restoreEditorSelection,
    focusEditorInEditMode,
    scheduleFocusEditorInEditMode,
    persistEditUiState,
    cancelPendingEditUiStatePersist,
    persistActiveNoteEditModeStateNow,
    applyEditRestoreSnapshot,
    captureEditModeSnapshotForRenderView,
  }
}

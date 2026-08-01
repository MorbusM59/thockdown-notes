import { useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { PersistedViewportState } from '../shared/appState'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote, isSameNoteSummary } from '../shared/noteLifecycle'
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorTextChangeEvent,
  EditorViewportChangeEvent,
  EditorViewportState,
} from '../editor/EditorContract'
import {
  type EditRestoreSnapshot,
  type EditViewportTelemetry,
  resolveSourceAnchorFromEditState,
  scrollTopPxToLines,
  scrollTopLinesToPx,
  buildEditRestoreSnapshotFromUiState,
  findPreviewSourceAnchorElement,
  ZERO_EDITOR_SELECTION,
  ZERO_PERSISTED_VIEWPORT,
} from '../editor/EditRestoreMath'
import { normalizeInternalText } from '../editor/TextPolicy'
import {
  indentSelectionByStep,
  resolveMarkdownSelectionContext,
} from '../editor/MarkdownContext'
import { resolveMarkdownEnterTransform } from '../editor/EnterTransformPolicy'
import { resolveMarkdownChecklistTypeoverTransform } from '../editor/ChecklistTypingTransformPolicy'
import { typingSoundManager } from '../sound/TypingSoundManager'
import type { PreviewScrollToSourceLineFn } from './usePreviewMarkdownRendering'

/**
 * Throwaway checkpoint logger for the commit-to-paint input-lag
 * investigation (see CM6Editor.tsx's debugInputLagEnabled). Reads the
 * origin timestamp CM6Editor stashed on `window` for this keystroke and
 * logs elapsed time at each named point in onTextChange, to bisect where a
 * long gap between CM6's commit and the next painted frame actually goes.
 * Gated the same way (localStorage flag), effectively free when off.
 */
function debugLogCheckpoint(label: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('thockdown:debug-input-lag') !== '1') return
  const keydownAt = (window as unknown as { __thockdownDebugKeydownAt?: number }).__thockdownDebugKeydownAt
  if (keydownAt === undefined) return
  console.log(`[input-lag]   +${(performance.now() - keydownAt).toFixed(1)}ms  ${label}`)
}

export interface UseEditorSectionMountOptions {
  activeNoteId: string | null
  activeNoteText: string
  setActiveNoteText: Dispatch<SetStateAction<string>>
  setEditorTextVersion: Dispatch<SetStateAction<number>>
  editorSelection: EditorSelectionState
  setEditorSelection: Dispatch<SetStateAction<EditorSelectionState>>
  isPreviewMode: boolean
  setIsPreviewMode: Dispatch<SetStateAction<boolean>>
  previewedSnapshotId: number | null
  persistenceReady: boolean
  lineHeightPx: number
  /** Opt-in perf toggle: coalesces the preview-driving setActiveNoteText/setEditorTextVersion commit onto a single requestAnimationFrame per user-input burst instead of firing once per keystroke, so fast key-repeat (e.g. held Backspace) doesn't queue a full ReactMarkdown reparse per tick. Undo/redo/programmatic sources always stay synchronous. */
  deferPreviewOnRapidInput: boolean
  latestEditorTextRef: MutableRefObject<string>
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
  /** Owned in App.tsx, not here -- queueAppStateSave and activateNote (both staying in App.tsx) also read/write these. */
  isApplyingInitialViewportRef: MutableRefObject<boolean>
  pendingViewportRestoreRef: MutableRefObject<PersistedViewportState | null>

  /** The full shared notes list -- read (not just written) by onTextChange's external-note bookkeeping. */
  notes: NoteSummary[]
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>
  /** A ref, not a direct value: activeNoteHasDebugTag is computed later in App.tsx than this hook is called, and every usage here is a synchronous read-at-call-time guard, never a reactive dependency. */
  activeNoteHasDebugTagRef: MutableRefObject<boolean>
  setIsCaretSuspended: Dispatch<SetStateAction<boolean>>
  externalNoteOriginalTextByIdRef: MutableRefObject<Map<string, string>>

  queueSave: (text: string, cursorPos?: number | null, scrollTopPx?: number | null) => void
  queueAppStateSave: (selectedNoteId: string | null) => void
  updateActiveNoteTitlePreview: (nextText: string) => void
  /** Only ever referenced in bindings' own dependency array (matching the original code), never actually called here. */
  writeDebugEntry: (functionName: string, lines: string[]) => Promise<void>

  /** Markdown formatting commands -- shared with toolbar buttons, so they stay owned in App.tsx and get called from here, not moved in. */
  /**
   * Markdown formatting commands -- shared with toolbar buttons, so they
   * stay owned/defined in App.tsx, not moved in here. Passed as refs rather
   * than direct values: in App.tsx these are themselves defined later than
   * this hook is called (they in turn depend on several other formatting
   * helpers), so App.tsx keeps a ref pointed at the latest version instead
   * of restructuring declaration order across a much wider swath of the
   * file just to satisfy this one call site.
   */
  buildTextDecorationTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState, format: 'bold' | 'italic' | 'strikethrough') => { text: string; selection: EditorSelectionState } | null>
  buildToggleCurrentLineHeadingTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
  buildToggleBulletedListTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
  buildToggleNumberedListTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
  /** Scopes the editor/scrollbar DOM lookups below to this section's own stage -- other sections render the same class names, so an unscoped document.querySelector would grab whichever section's stage happens to be first in the DOM. */
  sectionContainerRef: MutableRefObject<HTMLDivElement | null>
  /**
   * True while `previewedSnapshotId` is non-null *because useSnapshotFreeze
   * hibernated this section* (same note open live in another section),
   * false while it's non-null because the user is genuinely browsing Time
   * Machine history. Both cases render read-only "preview" content through
   * the same `previewedSnapshotId` mechanism, but they need different
   * restore targets: a frozen section has a real scroll/caret position
   * worth preserving (wherever the user was when it hibernated); an
   * arbitrary historical snapshot doesn't, so it starts at the top. Owned
   * by EditorSection and written by useSnapshotFreeze/useNoteSnapshotTimeline
   * -- read-only from here.
   */
  isFrozenSectionPreviewRef: MutableRefObject<boolean>
}

export interface UseEditorSectionMountResult {
  adapterRef: MutableRefObject<EditorAdapter | null>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  /**
   * Set by usePreviewMarkdownRendering (mounted later in the same
   * component, since it needs previewScrollRef from here) to the current
   * "scroll to the block covering this source line" function backed by its
   * own preview virtualizer. Read via `.current?.(...)` rather than called
   * directly since this hook can't depend on that one without a circular
   * import -- see PreviewScrollToSourceLineFn's own doc comment.
   */
  previewScrollToSourceLineRef: MutableRefObject<PreviewScrollToSourceLineFn | null>
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

  /** The full EditorBindings object wired to <Editor>. */
  bindings: EditorBindings
  toggleRenderViewMode: () => Promise<void>
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
  /**
   * Seeds the initial editor state on cold start -- viewport *and*
   * selection -- retrying against the adapter until it's ready. Replaces a
   * separate effect that used to watch a ref for this -- called directly
   * from App.tsx's bootstrap flow once, right after persisted app state and
   * the initial note's own saved UI state both resolve. Safe against a fast
   * note-switch racing the retry loop: activateNote already nulls
   * pendingViewportRestoreRef on every switch, and the retry loop checks
   * that it's still the same pending value before applying.
   *
   * Deliberately its own function rather than a thin call to
   * `applyEditRestoreSnapshot` -- this one also owns
   * `isApplyingInitialViewportRef`/`pendingViewportRestoreRef`, the guard
   * that stops `queueAppStateSave` from persisting a spurious intermediate
   * viewport over the one just restored (see `onViewportChange`).
   * `applyEditRestoreSnapshot` doesn't touch those refs at all -- note
   * switches aren't behind that particular guard -- so folding this into
   * that function would either lose the guard or require threading it
   * through a codepath that has no other reason to know about it.
   */
  seedInitialViewport: (snapshot: EditRestoreSnapshot) => void
}

/**
 * Owns the full editor mount: imperative refs (adapter, preview scroll
 * container), "remember where the user was" position-memory in both edit
 * and render mode, the live typing/selection/viewport bindings wired to
 * <Editor>, and applyProgrammaticEditorText for callers (Time Machine
 * restore, find & replace) that need to push text into the editor
 * programmatically. This is the full editor-mount concern -- App.tsx no
 * longer owns any of the adapter-facing machinery directly, only the
 * orchestration that calls into what's exported here (activateNote,
 * Time Machine navigation handlers, the custom preview scrollbar widget).
 */
export function useEditorSectionMount(options: UseEditorSectionMountOptions): UseEditorSectionMountResult {
  const {
    activeNoteId,
    activeNoteText,
    setActiveNoteText,
    setEditorTextVersion,
    editorSelection,
    setEditorSelection,
    isPreviewMode,
    setIsPreviewMode,
    previewedSnapshotId,
    persistenceReady,
    lineHeightPx,
    deferPreviewOnRapidInput,
    latestEditorTextRef,
    latestEditorSelectionRef,
    isApplyingInitialViewportRef,
    pendingViewportRestoreRef,
    notes,
    setNotes,
    activeNoteHasDebugTagRef,
    setIsCaretSuspended,
    externalNoteOriginalTextByIdRef,
    queueSave,
    queueAppStateSave,
    updateActiveNoteTitlePreview,
    buildTextDecorationTransformRef,
    buildToggleCurrentLineHeadingTransformRef,
    buildToggleBulletedListTransformRef,
    buildToggleNumberedListTransformRef,
    sectionContainerRef,
    isFrozenSectionPreviewRef,
  } = options

  const adapterRef = useRef<EditorAdapter | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollToSourceLineRef = useRef<PreviewScrollToSourceLineFn | null>(null)
  const editModeSnapshotByNoteIdRef = useRef<Map<string, EditRestoreSnapshot>>(new Map())
  const pendingEditRestoreSnapshotRef = useRef<EditRestoreSnapshot | null>(null)
  const pendingRenderViewSourceAnchorRef = useRef<{ sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportTelemetryRef = useRef<EditViewportTelemetry | null>(null)
  const editUiStateSaveTimerRef = useRef<number | null>(null)
  const lastPersistedEditUiStateRef = useRef<{ noteId: string; progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number; sourceAnchorText: string | null } | null>(null)
  // Coalesces the preview-driving setActiveNoteText/setEditorTextVersion
  // commit under deferPreviewOnRapidInput -- see scheduleCoalescedPreviewCommit.
  const pendingPreviewFrameRef = useRef<number | null>(null)
  // Mirrors `notes` for onTextChange's external-note bookkeeping (inside the
  // `bindings` useMemo below), so a stale notes array can't be read between
  // memo recreations without forcing bindings -- and the editor's lifecycle
  // effects that key off its identity -- to rebuild on every notes update.
  const notesRef = useRef<NoteSummary[]>(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  // Cancels a still-pending coalesced preview commit without flushing it --
  // used both when a synchronous update supersedes it and on unmount.
  const cancelPendingPreviewFrame = useCallback(() => {
    if (pendingPreviewFrameRef.current !== null) {
      cancelAnimationFrame(pendingPreviewFrameRef.current)
      pendingPreviewFrameRef.current = null
    }
  }, [])

  // Coalesces repeated onTextChange ticks (e.g. autorepeat-driven Backspace)
  // onto a single rAF: latestEditorTextRef is already up to date on every
  // tick, so the frame just needs to commit whatever it holds when it fires
  // rather than react to every intermediate value. Bundles the title-preview
  // update in with the same frame -- deriveNoteTitleFromText is its own
  // O(document length) scan (split + two finds), and un-gating it here would
  // leave it running on every tick even with this toggle on, defeating the
  // point for a large note under rapid input.
  const scheduleCoalescedPreviewCommit = useCallback(() => {
    if (pendingPreviewFrameRef.current !== null) return
    pendingPreviewFrameRef.current = requestAnimationFrame(() => {
      pendingPreviewFrameRef.current = null
      const latestText = latestEditorTextRef.current
      setActiveNoteText(latestText)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(latestText)
    })
  }, [latestEditorTextRef, setActiveNoteText, setEditorTextVersion, updateActiveNoteTitlePreview])

  useEffect(() => {
    return () => {
      cancelPendingPreviewFrame()
    }
  }, [cancelPendingPreviewFrame])

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
      resolveSourceLineAtHeight: (heightPx) => adapterRef.current?.resolveSourceLineAtHeight(heightPx) ?? null,
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
  }, [activeNoteText, lineHeightPx, latestEditorSelectionRef, latestEditorTextRef])

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
  }, [updateEditModeSnapshotCache, latestEditorSelectionRef])

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
  }, [latestEditorSelectionRef])

  const focusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    if (isPreviewMode || !activeNoteId) return

    const editorRoot = sectionContainerRef.current?.querySelector<HTMLElement>('.editor-text[contenteditable="true"]')
    if (!editorRoot) return
    if (document.activeElement === editorRoot) return

    if (options?.restoreSelection ?? true) {
      restoreEditorSelection()
    }
    editorRoot.focus({ preventScroll: true })
  }, [activeNoteId, isPreviewMode, restoreEditorSelection, sectionContainerRef])

  const scheduleFocusEditorInEditMode = useCallback((options?: { restoreSelection?: boolean }) => {
    const attemptFocus = () => {
      if (isPreviewMode || !activeNoteId) return

      const adapter = adapterRef.current
      const editorRoot = sectionContainerRef.current?.querySelector<HTMLElement>('.editor-text[contenteditable="true"]')
      if (!adapter || !editorRoot) {
        requestAnimationFrame(attemptFocus)
        return
      }

      focusEditorInEditMode(options)
    }

    window.setTimeout(() => {
      requestAnimationFrame(attemptFocus)
    }, 0)
  }, [activeNoteId, focusEditorInEditMode, isPreviewMode, sectionContainerRef])

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
    readCurrentEditUiPayload,
  ])

  const applyEditRestoreSnapshot = useCallback((snapshot: EditRestoreSnapshot, options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void }) => {
    const restoreFullSelection = options?.restoreFullSelection ?? true
    const focusAfterApply = options?.focusAfterApply ?? false
    const onComplete = options?.onComplete
    let cancelled = false

    // Precisely aligns the edit view to match wherever the preview pane was
    // showing when the user left it, correcting the rough initial restore
    // above (viewportLines from the persisted uiState). Uses the adapter's
    // own line-at-height math (EditorAdapter.resolveHeightForSourceLine),
    // not DOM measurement -- source lines can span many visual rows under
    // soft-wrapping, and the target line may not even be mounted yet under
    // CM6's viewport-bound rendering, neither of which a DOM query handles.
    const applySourceAnchorToEditor = () => {
      if (typeof snapshot.sourceAnchorLine !== 'number' || !Number.isFinite(snapshot.sourceAnchorLine)) {
        return
      }

      const adapter = adapterRef.current
      if (!adapter) return

      const lineTopPx = adapter.resolveHeightForSourceLine(snapshot.sourceAnchorLine)
      if (lineTopPx === null) return

      const topBoundaryPx = Math.max(0, Math.round(snapshot.viewport.topBoundaryLines * lineHeightPx))
      const targetScrollTopPx = Math.max(0, lineTopPx - topBoundaryPx)

      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        viewportLines: {
          topBoundaryLines: snapshot.viewport.topBoundaryLines,
          bottomBoundaryLines: snapshot.viewport.bottomBoundaryLines,
          scrollTopLines: targetScrollTopPx / lineHeightPx,
        },
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
      resolveSourceLineAtHeight: (heightPx) => adapterRef.current?.resolveSourceLineAtHeight(heightPx) ?? null,
    })

    pendingRenderViewSourceAnchorRef.current = anchor
  }, [captureEditModeSnapshotFromEditor, lineHeightPx])

  const previousActiveNoteIdForEditRestoreRef = useRef<string | null>(null)
  const previousPreviewModeRef = useRef(false)
  const hasPreviewModeBaselineRef = useRef(false)
  const ignoreNextUserViewportChangeRef = useRef(false)
  const previewScrollSaveTimerRef = useRef<number | null>(null)

  // Pure predicate, single call site (onViewportChange below) -- no reason
  // for this to be a useCallback with its own identity.
  const areMatchingViewportLines = (expected: PersistedViewportState, event: EditorViewportState): boolean => {
    const lineHeight = Math.max(1, event.lineHeightPx)
    const actualTop = Math.max(0, Math.round(event.topBoundaryPx / lineHeight))
    const actualBottom = Math.max(0, Math.round(event.bottomBoundaryPx / lineHeight))
    const actualScrollTop = Math.max(0, Math.round(event.scrollTopPx / lineHeight))
    return (
      actualTop === expected.topBoundaryLines &&
      actualBottom === expected.bottomBoundaryLines &&
      actualScrollTop === expected.scrollTopLines
    )
  }

  const shouldPlayTypingSound = useCallback((event: EditorTextChangeEvent) => {
    if (event.source !== 'user-input') return false
    const delta = event.text.length - event.previousText.length
    return delta > 0 && delta <= 8
  }, [])

  const shouldPlayReverseTypingSound = useCallback((event: EditorTextChangeEvent) => {
    if (event.source !== 'user-input') return false
    const delta = event.text.length - event.previousText.length
    if (delta >= 0) return false
    // latestEditorSelectionRef still holds the pre-edit selection here --
    // it's only reassigned to event.selection after this check runs (below,
    // in bindings.onTextChange). A non-collapsed selection means the delete
    // was a single Backspace/Delete keystroke wiping out an arbitrary range,
    // which should always click regardless of how many characters that was
    // -- the 8-char cap below exists only to filter out bulk deletes that
    // didn't originate from one visible keystroke (e.g. a collapsed-caret
    // delta this large shouldn't normally occur from real typing).
    if (!latestEditorSelectionRef.current.isCollapsed) return true
    return delta >= -8
  }, [latestEditorSelectionRef])

  const deriveTypingSoundKeyId = useCallback((event: EditorTextChangeEvent): string | undefined => {
    if (event.source !== 'user-input') return undefined

    const delta = event.text.length - event.previousText.length
    if (delta === 1) {
      // For single character insertions, the character is at the point of the new
      // cursor position minus one.
      const char = event.text[event.selection.start - 1]
      if (char) {
        return `key:${char}`
      }
    }

    if (delta === -1) {
      return 'key:backspace'
    }

    return undefined
  }, [])

  const bindings = useMemo<EditorBindings>(() => ({
    onTextChange: (event: EditorTextChangeEvent) => {
      debugLogCheckpoint('onTextChange start')
      const keyId = deriveTypingSoundKeyId(event)
      debugLogCheckpoint('after deriveTypingSoundKeyId')
      if (shouldPlayTypingSound(event)) {
        void typingSoundManager.playRandomClick({ keyId })
      } else if (shouldPlayReverseTypingSound(event)) {
        void typingSoundManager.playRandomClick({ keyId, reverse: true, detune: 600 })
      }
      debugLogCheckpoint('after typing sound dispatch')

      // event.text always originates from ContractBridgePlugin's
      // readCanonicalRootText() (both the initial-load and regular-commit
      // producers already canonicalize it) -- re-normalizing here is a
      // redundant O(document length) pass on already-canonical text.
      const canonicalText = event.text

      if (previewedSnapshotId !== null) {
        // While previewing history, the editor is showing something other than
        // the live document text. Ignore these changes; they are just UI
        // reflections of the history data, not new edits to the note.
        return
      }

      latestEditorTextRef.current = canonicalText
      latestEditorSelectionRef.current = event.selection

      const isDeferredPreviewTick = deferPreviewOnRapidInput && event.source === 'user-input'
      if (isDeferredPreviewTick) {
        scheduleCoalescedPreviewCommit()
      } else {
        cancelPendingPreviewFrame()
        setActiveNoteText(canonicalText)
        setEditorTextVersion((previous) => previous + 1)
      }
      debugLogCheckpoint('after setActiveNoteText/scheduleCoalescedPreviewCommit')
      setEditorSelection(event.selection)
      debugLogCheckpoint('after setEditorSelection')

      if (!activeNoteId || !persistenceReady || activeNoteHasDebugTagRef.current) return

      const noteSummary = notesRef.current.find((note) => note.id === activeNoteId)
      const isExternal = noteSummary ? isExternalNote(noteSummary) : false
      const isUserEditableSource =
        event.source === 'user-input' || event.source === 'history-undo' || event.source === 'history-redo'

      if (isExternal && isUserEditableSource) {
        console.warn('[external-note] editor text change detected for external note', {
          noteId: activeNoteId,
          textLength: canonicalText.length,
          source: event.source,
        })

        const originalExternalText = externalNoteOriginalTextByIdRef.current.get(activeNoteId)
        debugLogCheckpoint('before canonicalText !== originalExternalText comparison')
        const isCurrentlyModified = originalExternalText !== undefined
          ? canonicalText !== originalExternalText
          : Boolean(noteSummary && noteSummary.hasUnsavedChanges)
        debugLogCheckpoint('after canonicalText !== originalExternalText comparison')

        if (noteSummary && noteSummary.hasUnsavedChanges !== isCurrentlyModified) {
          setNotes((previous) => {
            const index = previous.findIndex((note) => note.id === activeNoteId)
            if (index < 0) return previous
            const existing = previous[index]
            if (existing.hasUnsavedChanges === isCurrentlyModified) return previous
            const next = [...previous]
            next[index] = { ...existing, hasUnsavedChanges: isCurrentlyModified }
            return next
          })

          const notesApi = window.thockdownNotes
          if (notesApi) {
            void notesApi.updateExternalNoteState({
              id: activeNoteId,
              hasUnsavedChanges: isCurrentlyModified,
              syncMode: !isCurrentlyModified,
            }).then((updatedSummary) => {
              setNotes((previous) => {
                const index = previous.findIndex((note) => note.id === updatedSummary.id)
                if (index < 0) return previous
                const existing = previous[index]
                if (isSameNoteSummary(existing, updatedSummary)) return previous
                const next = [...previous]
                next[index] = updatedSummary
                return next
              })
            }).catch((error) => {
              console.error('[external-note] failed to persist unsaved state', { noteId: activeNoteId, isCurrentlyModified, error })
            })
          }
        }
      }
      debugLogCheckpoint('after isExternal block')

      if (!isUserEditableSource) {
        // Do not derive save/pause transitions from hydration/programmatic events.
        return
      }

      // Deferred already covers this: scheduleCoalescedPreviewCommit calls
      // updateActiveNoteTitlePreview itself once the frame fires, using
      // whatever text is latest by then -- calling it again here would
      // just redo the same O(document length) title derivation twice for
      // no benefit.
      if (!isDeferredPreviewTick) {
        updateActiveNoteTitlePreview(canonicalText)
      }
      debugLogCheckpoint('after updateActiveNoteTitlePreview')
      queueSave(canonicalText, event.selection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)
      debugLogCheckpoint('after queueSave (onTextChange end)')
    },
    onSelectionChange: (event: EditorSelectionChangeEvent) => {
      if (previewedSnapshotId !== null) {
        return
      }

      latestEditorSelectionRef.current = event.selection
      setEditorSelection(event.selection)

      if (!isPreviewMode && activeNoteId) {
        const cached = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
        if (cached) {
          updateEditModeSnapshotCache({
            ...cached,
            collapsedSelection: {
              anchor: event.selection.end,
              focus: event.selection.end,
              start: event.selection.end,
              end: event.selection.end,
              isCollapsed: true,
            },
            fullSelection: event.selection,
          })
        }
      }
    },
    onTabIndentTransform: ({ shiftKey, text, selection }) => {
      if (previewedSnapshotId !== null) {
        return null
      }
      if (!activeNoteId || activeNoteHasDebugTagRef.current) return null

      const sourceText = normalizeInternalText(text)
      const lineContext = resolveMarkdownSelectionContext(sourceText, selection).line

      if (lineContext.headingLevel > 0) {
        const nextHeadingLevel = shiftKey
          ? Math.max(1, lineContext.headingLevel - 1)
          : Math.min(6, lineContext.headingLevel + 1)

        if (nextHeadingLevel !== lineContext.headingLevel) {
          const nextLineText = lineContext.lineText.replace(
            /^(\s*(?:>\s*)*)#{1,6}(?=\s|$)/,
            `$1${'#'.repeat(nextHeadingLevel)}`,
          )

          if (nextLineText !== lineContext.lineText) {
            const nextText = `${sourceText.slice(0, lineContext.lineStart)}${nextLineText}${sourceText.slice(lineContext.lineEndExclusive)}`
            const markerMatch = lineContext.lineText.match(/^(\s*(?:>\s*)*)#{1,6}/)
            const markerStart = lineContext.lineStart + (markerMatch ? markerMatch[1].length : 0)
            const oldMarkerEnd = markerStart + lineContext.headingLevel
            const headingDelta = nextHeadingLevel - lineContext.headingLevel

            const remapSelectionOffset = (offset: number) => {
              if (offset <= markerStart) return offset
              if (offset <= oldMarkerEnd) {
                const relative = offset - markerStart
                return markerStart + Math.min(relative, nextHeadingLevel)
              }
              return offset + headingDelta
            }

            const nextAnchor = Math.max(0, Math.min(nextText.length, remapSelectionOffset(selection.anchor)))
            const nextFocus = Math.max(0, Math.min(nextText.length, remapSelectionOffset(selection.focus)))
            const nextSelection: EditorSelectionState = {
              anchor: nextAnchor,
              focus: nextFocus,
              start: Math.min(nextAnchor, nextFocus),
              end: Math.max(nextAnchor, nextFocus),
              isCollapsed: nextAnchor === nextFocus,
            }

            latestEditorTextRef.current = nextText
            setActiveNoteText(nextText)
            setEditorTextVersion((previous) => previous + 1)
            updateActiveNoteTitlePreview(nextText)
            queueSave(nextText, nextSelection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)

            latestEditorSelectionRef.current = nextSelection
            setEditorSelection(nextSelection)
            return { text: nextText, selection: nextSelection }
          }
        }
      }

      const direction = shiftKey ? 'outdent' : 'indent'
      const next = indentSelectionByStep(sourceText, selection, direction, 3)

      const didTextChange = next.text !== sourceText
      const didSelectionChange =
        next.selection.anchor !== selection.anchor ||
        next.selection.focus !== selection.focus

      if (!didTextChange && !didSelectionChange) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text, next.selection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)

      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return { text: next.text, selection: next.selection }
    },
    onMarkdownShortcutTransform: ({ shortcut, text, selection }) => {
      if (previewedSnapshotId !== null) {
        return null
      }
      if (!activeNoteId || activeNoteHasDebugTagRef.current) return null

      const sourceText = normalizeInternalText(text)
      let next: { text: string; selection: EditorSelectionState } | null = null

      if (shortcut === 'bold' || shortcut === 'italic' || shortcut === 'strikethrough') {
        next = buildTextDecorationTransformRef.current(sourceText, selection, shortcut)
      } else if (shortcut === 'heading-toggle') {
        next = buildToggleCurrentLineHeadingTransformRef.current(sourceText, selection)
      } else if (shortcut === 'unordered-list') {
        next = buildToggleBulletedListTransformRef.current(sourceText, selection)
      } else if (shortcut === 'ordered-list') {
        next = buildToggleNumberedListTransformRef.current(sourceText, selection)
      }

      if (!next) return null

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text, next.selection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)
      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return next
    },
    onCharacterInsertTransform: ({ char, text, selection }) => {
      if (previewedSnapshotId !== null) {
        return null
      }
      if (!activeNoteId || activeNoteHasDebugTagRef.current) return null

      const sourceText = normalizeInternalText(text)
      const next = resolveMarkdownChecklistTypeoverTransform({
        char,
        text: sourceText,
        selection,
      })
      if (!next) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text, next.selection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)
      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)
      return next
    },
    onEnterTransform: (event) => {
      if (previewedSnapshotId !== null) {
        return null
      }
      if (!activeNoteId || activeNoteHasDebugTagRef.current) return null
      void typingSoundManager.playRandomClick({ detune: -500 })
      const next = resolveMarkdownEnterTransform(event)
      if (!next) {
        return null
      }

      latestEditorTextRef.current = next.text
      setActiveNoteText(next.text)
      setEditorTextVersion((previous) => previous + 1)
      updateActiveNoteTitlePreview(next.text)
      queueSave(next.text, next.selection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)

      latestEditorSelectionRef.current = next.selection
      setEditorSelection(next.selection)

      return {
        text: next.text,
        selection: next.selection,
      }
    },
    onViewportChange: (event: EditorViewportChangeEvent) => {
      if (ignoreNextUserViewportChangeRef.current && event.source === 'user-input') {
        ignoreNextUserViewportChangeRef.current = false
        return
      }

      const pendingRestore = pendingViewportRestoreRef.current
      if (pendingRestore) {
        if (event.source === 'programmatic' && areMatchingViewportLines(pendingRestore, event.viewport)) {
          pendingViewportRestoreRef.current = null
          isApplyingInitialViewportRef.current = false
        } else {
          return
        }
      }

      if (event.source !== 'user-input') {
        return
      }

      if (previewedSnapshotId !== null) {
        // Scrolling a history preview should never override the document's
        // saved scroll position.
        return
      }

      const isViewportDrag = event.origin === 'viewport-drag'
      const isScroll = event.origin === 'scroll'
      if (!isViewportDrag && !isScroll) {
        return
      }

      // Derive line counts directly from the event's px values rather than
      // re-reading via adapterRef.current?.getSnapshot(). The adapter object
      // is recreated on the same render cycle as a boundary drag (because
      // buildViewportLines is in its dep array), causing adapterRef.current
      // to be briefly null between the old adapter's cleanup and the new
      // adapter's setup — exactly when this handler fires. Re-reading through
      // the adapter would return null and fall back to stale 0/0/0 values.
      // Reading from the event is safe: it carries the values from the render
      // that triggered this effect, so they're always current.
      const lh = Math.max(1, event.viewport.lineHeightPx)
      const nextViewport: PersistedViewportState = {
        topBoundaryLines: Math.max(0, Math.round(event.viewport.topBoundaryPx / lh)),
        bottomBoundaryLines: Math.max(0, Math.round(event.viewport.bottomBoundaryPx / lh)),
        scrollTopLines: Math.max(0, Math.round(event.viewport.scrollTopPx / lh)),
      }
      const nextTelemetry = {
        scrollTopPx: Math.round(event.viewport.scrollTopPx),
        scrollHeightPx: Math.max(0, Math.round(event.viewport.scrollHeightPx ?? 0)),
        clientHeightPx: Math.max(0, Math.round(event.viewport.clientHeightPx ?? 0)),
      }
      latestViewportRef.current = nextViewport
      latestEditViewportRef.current = nextViewport
      latestEditViewportTelemetryRef.current = nextTelemetry

      if (!isPreviewMode && activeNoteId) {
        const selection = latestEditorSelectionRef.current
        updateEditModeSnapshotCache({
          noteId: activeNoteId,
          collapsedSelection: {
            anchor: selection.end,
            focus: selection.end,
            start: selection.end,
            end: selection.end,
            isCollapsed: true,
          },
          fullSelection: selection,
          viewport: nextViewport,
        })
      }

      queueAppStateSave(activeNoteId)
    },
  }), [
    activeNoteId,
    isPreviewMode,
    persistenceReady,
    previewedSnapshotId,
    deferPreviewOnRapidInput,
    queueSave,
    queueAppStateSave,
    updateActiveNoteTitlePreview,
    updateEditModeSnapshotCache,
    activeNoteHasDebugTagRef,
    buildTextDecorationTransformRef,
    buildToggleBulletedListTransformRef,
    buildToggleCurrentLineHeadingTransformRef,
    buildToggleNumberedListTransformRef,
    cancelPendingPreviewFrame,
    scheduleCoalescedPreviewCommit,
    deriveTypingSoundKeyId,
    externalNoteOriginalTextByIdRef,
    isApplyingInitialViewportRef,
    latestEditorSelectionRef,
    latestEditorTextRef,
    pendingViewportRestoreRef,
    setActiveNoteText,
    setEditorSelection,
    setEditorTextVersion,
    setNotes,
    shouldPlayReverseTypingSound,
    shouldPlayTypingSound,
  ])

  useEffect(() => {
    latestEditorSelectionRef.current = editorSelection
  }, [editorSelection, latestEditorSelectionRef])

  useEffect(() => {
    if (!hasPreviewModeBaselineRef.current) {
      previousPreviewModeRef.current = isPreviewMode
      if (persistenceReady) {
        hasPreviewModeBaselineRef.current = true
      }
      return
    }

    const wasPreviewMode = previousPreviewModeRef.current
    previousPreviewModeRef.current = isPreviewMode

    if (!persistenceReady || !activeNoteId) return

    if (wasPreviewMode && !isPreviewMode) {
      pendingRenderViewSourceAnchorRef.current = null
    }

    const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)

    if (!wasPreviewMode && isPreviewMode) {
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

      if (viewport) {
        const collapsedSelection: EditorSelectionState = {
          anchor: selection.end,
          focus: selection.end,
          start: selection.end,
          end: selection.end,
          isCollapsed: true,
        }

        pendingEditRestoreSnapshotRef.current = {
          noteId: activeNoteId,
          collapsedSelection,
          fullSelection: selection,
          viewport,
        }
        updateEditModeSnapshotCache(pendingEditRestoreSnapshotRef.current)
      }

      persistEditUiState(activeNoteId, { immediate: true })
      return
    }

    if (!wasPreviewMode || isPreviewMode) {
      return
    }

    // Single-owner restore rule: render->edit transition owns restore for the
    // current note. Mark this note as handled so the note-activation effect
    // does not race in with a second restore source.
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current

    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
applyEditRestoreSnapshot(cachedSnapshot, { restoreFullSelection: true, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
applyEditRestoreSnapshot(memorySnapshot, { restoreFullSelection: true, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      return
    }

    let cancelled = false

    const restoreFromPersistedEditState = async () => {
      try {
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const fallbackSnapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: lineHeightPx,
        })
        updateEditModeSnapshotCache(fallbackSnapshot)

applyEditRestoreSnapshot(fallbackSnapshot, { restoreFullSelection: false, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      } catch (error) {
        console.warn('Failed to restore edit mode state from persisted UI data', error)
      }
    }

    void restoreFromPersistedEditState()

    return () => {
      cancelled = true
    }
  }, [
    activeNoteText,
    activeNoteId,
    applyEditRestoreSnapshot,
    lineHeightPx,
    isPreviewMode,
    persistEditUiState,
    persistenceReady,
    updateEditModeSnapshotCache,
    latestEditorSelectionRef,
    latestEditorTextRef,
    setIsCaretSuspended,
  ])

  const toggleRenderViewMode = useCallback(async () => {
    if (isPreviewMode && activeNoteId) {
      try {
        await persistRenderViewStateForNoteNow(activeNoteId)
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (uiState) {
          const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
          const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
          const restoreSnapshot = buildEditRestoreSnapshotFromUiState({
            noteId: activeNoteId,
            text: activeText,
            uiState,
            fallbackViewport,
            lineHeightPx: lineHeightPx,
          })
          pendingEditRestoreSnapshotRef.current = restoreSnapshot
          updateEditModeSnapshotCache(restoreSnapshot)
        }
      } catch (error) {
        console.warn('Failed to persist render view state before toggling mode', error)
      }

      pendingRenderViewSourceAnchorRef.current = null
    }

    setIsPreviewMode((previous) => {
      if (!previous && activeNoteId) {
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        setActiveNoteText(activeText)
        captureEditModeSnapshotForRenderView(activeNoteId, activeText)
      }
      return !previous
    })
  }, [
    activeNoteId,
    activeNoteText,
    captureEditModeSnapshotForRenderView,
    lineHeightPx,
    isPreviewMode,
    persistRenderViewStateForNoteNow,
    updateEditModeSnapshotCache,
    latestEditorTextRef,
    setActiveNoteText,
    setIsPreviewMode,
  ])

  useEffect(() => {
    if (!persistenceReady || !activeNoteId) return

    let cancelled = false

    const preloadEditModeSnapshot = async () => {
      try {
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        const snapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: lineHeightPx,
        })
        updateEditModeSnapshotCache(snapshot)
      } catch (error) {
        console.warn('Failed to preload edit mode snapshot for active note', error)
      }
    }

    void preloadEditModeSnapshot()

    return () => {
      cancelled = true
    }
  }, [activeNoteId, activeNoteText, lineHeightPx, persistenceReady, updateEditModeSnapshotCache, latestEditorTextRef])

  useEffect(() => {
    if (isPreviewMode) return
    if (!persistenceReady) return
    if (!activeNoteId) {
      // Reset the restore sentinel when editor selection is cleared.
      // Without this, re-selecting the same note id after a clear path can
      // skip edit-mode restore and leave the remounted editor unhydrated.
      previousActiveNoteIdForEditRestoreRef.current = null
      return
    }

    const wasPreviewMode = previousPreviewModeRef.current
    const previousActiveNoteId = previousActiveNoteIdForEditRestoreRef.current
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId
    if (previousActiveNoteId === activeNoteId && !wasPreviewMode) {
      // Note identity did not change and we are not returning from preview.
      // Avoid re-restoring on plain edit-mode re-renders or same-note updates.
      return
    }

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current
    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
      applyEditRestoreSnapshot(cachedSnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot && !wasPreviewMode) {
      applyEditRestoreSnapshot(memorySnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
      return
    }

    let cancelled = false

    const restorePersistedEditState = async () => {
      try {
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const activeText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        const restoreSnapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
          lineHeightPx: lineHeightPx,
        })
        updateEditModeSnapshotCache(restoreSnapshot)

        applyEditRestoreSnapshot(restoreSnapshot, {
          restoreFullSelection: false,
          // Matches its two sibling branches above in this same effect
          // (cached/memory snapshot restore), both of which already pass
          // focusAfterApply: true -- this path (persisted-state restore, the
          // one taken when a note is opened for the first time this
          // session) was the one case that didn't, leaving
          // document.activeElement off the editor after a note switch.
          // Harmless on Lexical (its caret renders regardless of DOM focus)
          // but CM6's caret overlay is hard-gated on focus
          // (CM6Editor.tsx's updateCaret), so this omission left the caret
          // invisible after switching to a not-yet-cached note until the
          // user clicked in manually. See docs/cm6-parity-hardening-plan.md
          // Bug 2.
          focusAfterApply: true,
          onComplete: () => setIsCaretSuspended(false),
        })
      } catch (error) {
        console.warn('Failed to restore persisted edit state on note activation', error)
      }
    }

    void restorePersistedEditState()

    return () => {
      cancelled = true
    }
  }, [
    activeNoteId,
    activeNoteText,
    applyEditRestoreSnapshot,
    lineHeightPx,
    isPreviewMode,
    persistenceReady,
    updateEditModeSnapshotCache,
    latestEditorTextRef,
    setIsCaretSuspended,
  ])

  useLayoutEffect(() => {
    if (!isPreviewMode) return
    if (!activeNoteId) return

    let cancelled = false

    const setPreviewScrollBehavior = (behavior: '' | 'auto') => {
      const container = previewScrollRef.current
      if (!container) return
      container.style.scrollBehavior = behavior
    }

    const applyPreviewSourceAnchor = (sourceLine: number) => {
      const container = previewScrollRef.current
      if (!container) return

      const previousScrollBehavior = container.style.scrollBehavior
      container.style.scrollBehavior = 'auto'

      // A source line of 0 means edit mode was scrolled to the very top of
      // the note. scrollIntoView on the first anchor would align that
      // element's own top edge with the viewport, ignoring any container
      // margin/padding above it, so the render view ends up scrolled down
      // slightly instead of sitting at true scrollTop 0.
      if (sourceLine <= 0) {
        previewScrollToSourceLineRef.current?.(0, { align: 'start' })
        requestAnimationFrame(() => {
          if (!container) return
          container.scrollTop = 0
          container.style.scrollBehavior = previousScrollBehavior
        })
        return
      }

      // Force the covering block to actually mount before querying for it --
      // under preview virtualization most of the document isn't real DOM
      // until scrolled near, so the query below (built when every block was
      // always real DOM) could otherwise silently resolve to the nearest
      // already-mounted anchor instead of the true target. The virtualizer's
      // own mount lands one React commit after this call, so retry the query
      // across a few frames rather than assuming a single frame is enough.
      previewScrollToSourceLineRef.current?.(sourceLine, { align: 'start' })

      const attemptFindAndScroll = (attemptsLeft: number) => {
        if (cancelled || !container) return

        const target = findPreviewSourceAnchorElement(container, sourceLine)
        if (!target) {
          if (attemptsLeft <= 0) {
            container.style.scrollBehavior = previousScrollBehavior
            return
          }
          requestAnimationFrame(() => attemptFindAndScroll(attemptsLeft - 1))
          return
        }

        target.scrollIntoView({ block: 'start', inline: 'nearest' })
        container.style.scrollBehavior = previousScrollBehavior
      }

      requestAnimationFrame(() => attemptFindAndScroll(10))
    }

    const pendingSourceAnchor = pendingRenderViewSourceAnchorRef.current
    if (pendingSourceAnchor) {
      pendingRenderViewSourceAnchorRef.current = null
      applyPreviewSourceAnchor(pendingSourceAnchor.sourceAnchorLine)
      return () => {
        cancelled = true
        setPreviewScrollBehavior('')
      }
    }

    const restorePreviewScroll = async () => {
      try {
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const sourceAnchorLine = uiState?.sourceAnchorLine
        if (typeof sourceAnchorLine === 'number' && Number.isFinite(sourceAnchorLine)) {
          applyPreviewSourceAnchor(sourceAnchorLine)
          return
        }

        // No source anchor available; preserve the current default scroll state.
      } catch (error) {
        console.warn('Failed to restore preview scroll state', error)
      }
    }

    void restorePreviewScroll()

    return () => {
      cancelled = true
      setPreviewScrollBehavior('')
    }
  }, [activeNoteId, isPreviewMode])

  useEffect(() => {
    if (!isPreviewMode) return
    if (!activeNoteId) return

    const container = previewScrollRef.current
    if (!container) return

    const persistPreviewScroll = () => {
      if (previewScrollSaveTimerRef.current !== null) {
        window.clearTimeout(previewScrollSaveTimerRef.current)
      }

      previewScrollSaveTimerRef.current = window.setTimeout(() => {
        previewScrollSaveTimerRef.current = null
        const sourceAnchor = resolvePreviewSourceAnchorFromContainer(container)
        if (!sourceAnchor) return
        const payload: { sourceAnchorLine: number; sourceAnchorText: string | null } = {
          sourceAnchorLine: sourceAnchor.sourceAnchorLine,
          sourceAnchorText: sourceAnchor.sourceAnchorText,
        }
        void window.thockdownNotes?.saveNoteUiState({ id: activeNoteId, payload })
      }, 120)
    }

    container.addEventListener('scroll', persistPreviewScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', persistPreviewScroll)
      if (previewScrollSaveTimerRef.current !== null) {
        window.clearTimeout(previewScrollSaveTimerRef.current)
        previewScrollSaveTimerRef.current = null
      }
    }
  }, [activeNoteId, isPreviewMode, resolvePreviewSourceAnchorFromContainer])
  // The Editor only makes its content visible once something calls
  // adapter.applySnapshot({ viewportLines: ... }) on it (see Editor.tsx's
  // hasViewportLines gate). Normally that happens via the note-activation
  // restore effect, keyed on activeNoteId -- but activeNoteId never changes
  // when toggling snapshot preview (only the synthetic `key` on <Editor>
  // does), so that effect never re-fires for a preview remount and the
  // freshly-mounted editor is left permanently hidden. This effect is the
  // preview-specific equivalent: it fires on every preview transition and
  // explicitly restores visibility for whichever content just got mounted.
  useEffect(() => {
    if (!activeNoteId) return

    // Derived from previewedSnapshotId directly rather than threaded in as
    // its own option: the fuller App.tsx definition also checks that the
    // snapshot's content actually resolved from noteSnapshots.snapshotsById,
    // but previewedSnapshotId is only ever set (by handleNavigateSnapshot or
    // useSnapshotFreeze) to an ID that genuinely exists, so this is
    // equivalent in every real code path without needing this hook to also
    // depend on the Time Machine snapshot list.
    const isPreviewingSnapshot = previewedSnapshotId !== null

    if (isPreviewingSnapshot) {
      if (isFrozenSectionPreviewRef.current) {
        // This "preview" is actually a hibernated section showing the same
        // live note open elsewhere, frozen read-only -- not the user
        // browsing history. It has a real scroll/caret position worth
        // keeping (captured right before freezing), unlike an arbitrary
        // historical snapshot -- restore that instead of snapping to top.
        const cachedAtFreeze = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
        if (cachedAtFreeze) {
          applyEditRestoreSnapshot(cachedAtFreeze, { restoreFullSelection: true, focusAfterApply: false })
          return
        }
      }

      // A historical snapshot has no saved scroll/cursor position of its
      // own -- just show it from the top, read-only.
      applyEditRestoreSnapshot({
        noteId: activeNoteId,
        collapsedSelection: ZERO_EDITOR_SELECTION,
        fullSelection: ZERO_EDITOR_SELECTION,
        viewport: ZERO_PERSISTED_VIEWPORT,
      }, { restoreFullSelection: false, focusAfterApply: false })
      return
    }

    // Returning to present: prefer the note's last-known live edit position
    // if we have one cached, so leaving and re-entering preview doesn't
    // reset your place in the document every time.
    const cached = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    applyEditRestoreSnapshot(
      cached ?? {
        noteId: activeNoteId,
        collapsedSelection: ZERO_EDITOR_SELECTION,
        fullSelection: ZERO_EDITOR_SELECTION,
        viewport: ZERO_PERSISTED_VIEWPORT,
      },
      { restoreFullSelection: Boolean(cached), focusAfterApply: false },
    )
  }, [activeNoteId, applyEditRestoreSnapshot, previewedSnapshotId, isFrozenSectionPreviewRef])
  const applyProgrammaticEditorText = useCallback((nextText: string, selectionStart?: number, selectionEnd?: number) => {
    if (activeNoteHasDebugTagRef.current) return

    const canonicalText = normalizeInternalText(nextText)
    latestEditorTextRef.current = canonicalText
    setActiveNoteText(canonicalText)
    setEditorTextVersion((previous) => previous + 1)
    updateActiveNoteTitlePreview(canonicalText)

    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      const safeSelectionStart = Math.max(0, Math.min(selectionStart, canonicalText.length))
      const safeSelectionEnd = Math.max(0, Math.min(selectionEnd, canonicalText.length))
      const nextSelection: EditorSelectionState = {
        anchor: safeSelectionStart,
        focus: safeSelectionEnd,
        start: Math.min(safeSelectionStart, safeSelectionEnd),
        end: Math.max(safeSelectionStart, safeSelectionEnd),
        isCollapsed: safeSelectionStart === safeSelectionEnd,
      }

      // Keep local selection state in sync with programmatic transforms so
      // subsequent operations never remap from stale offsets.
      latestEditorSelectionRef.current = nextSelection
      setEditorSelection(nextSelection)

      requestAnimationFrame(() => {
        adapterRef.current?.applySnapshot({
          selectionScrollBehavior: 'preserve-scroll',
          selection: nextSelection,
        })
      })

      queueSave(canonicalText, nextSelection.end, latestEditViewportTelemetryRef.current?.scrollTopPx)
    } else {
      queueSave(canonicalText, latestEditorSelectionRef.current?.end, latestEditViewportTelemetryRef.current?.scrollTopPx)
    }
  }, [
    queueSave,
    updateActiveNoteTitlePreview,
    activeNoteHasDebugTagRef,
    latestEditorSelectionRef,
    latestEditorTextRef,
    latestEditViewportTelemetryRef,
    setActiveNoteText,
    setEditorSelection,
    setEditorTextVersion,
  ])


  const seedInitialViewport = useCallback((snapshot: EditRestoreSnapshot) => {
    const viewport = snapshot.viewport
    pendingViewportRestoreRef.current = viewport
    latestViewportRef.current = viewport
    isApplyingInitialViewportRef.current = true

    const applyViewport = () => {
      // If activateNote (or another seed) has since superseded this pending
      // restore, this attempt is stale -- bail rather than clobber whatever
      // the user has already moved on to.
      if (pendingViewportRestoreRef.current !== viewport) return

      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyViewport)
        return
      }

      // Restoring from integer line counts is direct: no clamping or
      // measurement-dependent math happens here (see EditorViewportLines /
      // clampBoundaryLines in Editor.tsx). This call is correct even before
      // the editor's container has been measured. Selection restores the
      // same way activateNote's own restore does (applyEditRestoreSnapshot)
      // -- this used to be viewport-only, which is why cold start never
      // restored cursor position the way every other note switch does.
      ignoreNextUserViewportChangeRef.current = true
      adapter.applySnapshot({
        viewportLines: viewport,
        selectionScrollBehavior: 'preserve-scroll',
        selection: snapshot.fullSelection,
      })

      latestViewportRef.current = viewport
      latestEditViewportRef.current = viewport
      // Keep the pending restore until the editor reports the matching
      // restored viewport (see onViewportChange above). This guards against
      // an intermediate 0/0/0 programmatic event that can arrive directly
      // after applySnapshot.
    }

    requestAnimationFrame(applyViewport)
  }, [isApplyingInitialViewportRef, pendingViewportRestoreRef])

  return {
    adapterRef,
    previewScrollRef,
    previewScrollToSourceLineRef,
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
    bindings,
    toggleRenderViewMode,
    applyProgrammaticEditorText,
    seedInitialViewport,
  }
}

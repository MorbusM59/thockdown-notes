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
  RESTORE_OFFSET_LINES,
  ZERO_EDITOR_SELECTION,
  ZERO_PERSISTED_VIEWPORT,
} from '../editor/EditRestoreMath'
import { normalizeInternalText } from '../editor/TextPolicy'
import { hashNormalizedText } from '../shared/hashText'
import {
  splitMarkdownIntoPreviewBlocks,
  splitMarkdownIntoPreviewBlocksIncremental,
  PREVIEW_BLOCK_CACHE_VERSION,
  type PreviewMarkdownBlock,
  type PreviewBlockSplitCache,
} from '../editor/PreviewBlockSplit'
import { resolvePreviewBlockIndexForSourceLine, resolveSourceLineForAnchorBlockIndex } from '../editor/PreviewBlockIndex'
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

/** Same opt-in flag as debugLogCheckpoint, but not tied to a keydown origin -- for logging mode-toggle scroll-sync diagnostics, which don't happen inside a keydown at all. */
function debugLogScrollSync(label: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('thockdown:debug-input-lag') !== '1') return
  console.log(`[scroll-sync] ${label}`)
}

/** Same opt-in flag: logs preview-block cache lifecycle (DB restore and incremental reuse). */
function debugLogPreviewBlockCache(label: string, details?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('thockdown:debug-input-lag') !== '1') return
  const detailString = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[preview-block-cache] ${label}${detailString}`)
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

  queueSave: (text: string, cursorPos?: number | null) => void
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
  /**
   * The content of whichever Timeline snapshot `previewedSnapshotId` refers
   * to, or null when not previewing a snapshot (genuinely live, or frozen --
   * see isFrozenSectionPreviewRef). Populated as a plain ref mutation during
   * EditorSection's render (same pattern as `activeNoteHasDebugTagRef.current
   * = ...`) rather than an effect, because useNoteSnapshotTimeline (the
   * source of this content) is mounted later in the same component than this
   * hook -- writing it during render guarantees this hook's own effects see
   * the up-to-date value on the same commit that changed
   * `previewedSnapshotId`, not one render behind. Used only to resolve a
   * historical snapshot's own persisted anchorBlockIndex into a source line
   * at restore time, and to capture that snapshot's own position when
   * leaving it (see docs/editor-contract.md's Viewport Model section).
   */
  previewedSnapshotContentRef: MutableRefObject<string | null>
  /**
   * Cache refs owned by EditorSection so useNoteSaveQueue (declared earlier
   * due to the hook-order rule) and useEditorSectionMount can share the same
   * preview-block split state. useEditorSectionMount writes these during its
   * background parse; useNoteSaveQueue reads them to persist the cache.
   */
  previewBlockSplitCacheRef: MutableRefObject<PreviewBlockSplitCache | null>
  previewBlocksCacheRef: MutableRefObject<{ text: string; blocks: PreviewMarkdownBlock[] } | null>
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
  pendingRenderViewSourceAnchorRef: MutableRefObject<{ sourceAnchorLine: number } | null>
  latestViewportRef: MutableRefObject<PersistedViewportState | null>
  latestEditViewportRef: MutableRefObject<PersistedViewportState | null>
  latestEditViewportTelemetryRef: MutableRefObject<EditViewportTelemetry | null>

  readCurrentEditUiPayload: () => { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number } | null
  updateEditModeSnapshotCache: (snapshot: EditRestoreSnapshot) => void
  captureEditModeSnapshotFromEditor: (noteId: string) => EditRestoreSnapshot | null
  /**
   * Phase 3's "captureCurrentBlockForNote(mode)": resolves the canonical
   * mode-agnostic BLOCK (anchorBlockIndex) for whichever mode -- edit or
   * preview -- is currently on screen, live-derived from the adapter/DOM,
   * not a cached/persisted read. Works unmodified whether the content on
   * screen is the live note or a Timeline snapshot preview (both render
   * through the same editor/preview DOM). Returns null when no position can
   * currently be determined (e.g. neither pane is mounted yet).
   */
  captureCurrentAnchorBlockIndex: () => number | null
  resolvePreviewSourceAnchorFromContainer: (container: HTMLElement) => { sourceAnchorLine: number; sourceAnchorText: string | null } | null
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

  /** The full EditorBindings object wired to <Editor>. */
  bindings: EditorBindings
  toggleRenderViewMode: () => void
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
  /**
   * Background preview-block split cache. Populated by a deferred parse
   * while in edit mode so the first toggle to preview can warm-start
   * usePreviewMarkdownRendering's incremental parser instead of paying for
   * a full remark parse on demand. Also seeded from the persisted DB cache
   * when a note is activated.
   */
  previewBlockSplitCacheRef: MutableRefObject<PreviewBlockSplitCache | null>
  previewBlocksCacheRef: MutableRefObject<{ text: string; blocks: PreviewMarkdownBlock[] } | null>
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
    previewedSnapshotContentRef,
    previewBlockSplitCacheRef,
    previewBlocksCacheRef,
  } = options

  const adapterRef = useRef<EditorAdapter | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollToSourceLineRef = useRef<PreviewScrollToSourceLineFn | null>(null)
  const editModeSnapshotByNoteIdRef = useRef<Map<string, EditRestoreSnapshot>>(new Map())
  const pendingEditRestoreSnapshotRef = useRef<EditRestoreSnapshot | null>(null)
  // Set only when a mode switch needs to hand the entering preview pane a
  // fresh block to land on (sectionRequiresScrollUpdateRef was true at
  // toggle time) -- consumed once by the preview-apply effect below, then
  // cleared. Left null otherwise, in which case that effect does nothing at
  // all: dual-mount (SectionEditorArea.tsx toggles `display`, never
  // unmounts) means preview's DOM is already sitting exactly where it was.
  const pendingRenderViewSourceAnchorRef = useRef<{ sourceAnchorLine: number } | null>(null)
  // True whenever edit or preview has scrolled/resized/been-edited since
  // the two modes were last known to be in sync -- gates the mode-switch
  // fast path (do nothing, dual-mount already has both panes correctly
  // positioned) vs. the slow path (resolve a fresh block from the mode
  // being left, land the mode being entered on it). See toggleRenderViewMode
  // and docs/editor-contract.md's Viewport Model section.
  const sectionRequiresScrollUpdateRef = useRef(false)
  // Prevents the preview scroll listener from treating the programmatic
  // scroll issued by applyPreviewSourceAnchor as a genuine user scroll.
  // Set just before the scroll write; the debounced listener bails if the
  // callback fires inside the suppression window, but still updates the
  // known-anchor baseline so later real scrolls compare correctly.
  const suppressPreviewScrollUpdateUntilRef = useRef(0)
  // Tracks which (note + snapshot) preview targets have already received a
  // first-load restore, so subsequent edit<->preview toggles can be a pure
  // CSS visibility switch without re-running scroll code.
  const previewRestoreCompletedForNoteIdRef = useRef<Set<string>>(new Set())
  // Tracks which notes have had edit mode restored for the current live
  // document while this section owns them, so returning to edit from preview
  // can also be a pure CSS visibility switch when the edit pane hasn't been
  // replaced. Mirrors previewRestoreCompletedForNoteIdRef on the edit side.
  const editRestoreCompletedForNoteIdRef = useRef<Set<string>>(new Set())
  // The block our own most recent programmatic preview restore intended to
  // land on (mode-switch landing, first-load restore, snapshot return). The
  // preview scroll listener compares its own resolved anchor against this
  // value rather than trying to suppress scroll events for some duration --
  // react-virtual's own reconciliation can keep generating genuine scroll
  // events for an unbounded time after a restore as nearby rows mount and
  // get their real measured heights, all converging toward this same block;
  // no duration can be trusted to outlast that, but as long as they
  // converge here, none of them represent an actual change worth reacting
  // to. Null means no restore has run yet this session for this section.
  const lastKnownPreviewAnchorLineRef = useRef<number | null>(null)
  // Diagnostic-only call counter, see applyEditRestoreSnapshot's own entry log.
  const applyEditRestoreSnapshotCallCounterRef = useRef(0)
  const restoreInProgressRef = useRef(false)
  const restoreActiveCallerRef = useRef<string | null>(null)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportRef = useRef<PersistedViewportState | null>(null)
  const latestEditViewportTelemetryRef = useRef<EditViewportTelemetry | null>(null)
  const editUiStateSaveTimerRef = useRef<number | null>(null)
  const lastPersistedEditUiStateRef = useRef<{ noteId: string; progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number } | null>(null)
  // Tracks the last text for which a background preview-block prewarm was
  // initiated, so we don't restart the parse on every keystroke while the
  // user is typing. A new parse is scheduled only after the text has been
  // stable for PREVIEW_BLOCK_PREWARM_DEBOUNCE_MS.
  const previewBlockPrewarmTextRef = useRef<string | null>(null)
  const previewBlockPrewarmTimerRef = useRef<number | null>(null)
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

  const readCurrentEditUiPayload = useCallback((): { progressEdit: number; cursorPos: number; scrollTop: number; sourceAnchorLine: number } | null => {
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
    const { sourceAnchorLine } = resolveSourceAnchorFromEditState({
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
    }
  }, [activeNoteText, lineHeightPx, latestEditorSelectionRef, latestEditorTextRef])

  // Returns the preview blocks for `text`, caching the result so the
  // expensive full-document remark parse is only repeated when the text
  // actually changes. Both DB-persistence and mode-switch round-tripping
  // need these blocks, and without caching the same document can be parsed
  // multiple times in one user operation.
  const getPreviewBlocksForText = useCallback((text: string): PreviewMarkdownBlock[] => {
    const cached = previewBlocksCacheRef.current
    if (cached && cached.text === text) {
      debugLogPreviewBlockCache('reusing in-memory blocks cache', { textLength: text.length, blocks: cached.blocks.length })
      return cached.blocks
    }
    // Reuse the full split cache if it matches; otherwise fall back to a
    // fresh parse. The split cache is populated by the background prewarm
    // path below, by usePreviewMarkdownRendering's own incremental parser,
    // and by the persisted DB cache loaded on note activation, so this
    // avoids duplicating the expensive full remark parse.
    const splitCache = previewBlockSplitCacheRef.current
    if (splitCache && splitCache.text === text) {
      previewBlocksCacheRef.current = { text, blocks: splitCache.blocks }
      debugLogPreviewBlockCache('reusing split-cache blocks', { textLength: text.length, blocks: splitCache.blocks.length })
      return splitCache.blocks
    }
    debugLogPreviewBlockCache('falling back to full remark parse', { textLength: text.length })
    const blocks = splitMarkdownIntoPreviewBlocks(text)
    previewBlocksCacheRef.current = { text, blocks }
    return blocks
  }, [previewBlockSplitCacheRef, previewBlocksCacheRef])

  /**
   * Builds a PersistedPreviewBlockCache from the current in-memory split
   * cache, if it matches the supplied text. The result is small (just
   * structural ranges) and can be persisted alongside the note text so the
   * next app startup warm-starts the first preview toggle.
   */
  const buildPersistedPreviewBlockCache = useCallback((text: string) => {
    const cache = previewBlockSplitCacheRef.current
    if (!cache || cache.text !== text) return null
    return {
      v: PREVIEW_BLOCK_CACHE_VERSION,
      textHash: '', // filled in by the caller once an async hash resolves
      ranges: cache.ranges.map(({ type, rangeStartLine1, rangeEndLine1 }) => ({
        type,
        rangeStartLine1,
        rangeEndLine1,
      })),
    }
  }, [previewBlockSplitCacheRef])

  // Boundary conversion for the scroll-sync rewrite: everything in this hook
  // still computes/caches position in terms of a raw source line internally
  // (unchanged from before this rewrite -- see resolveSourceAnchorFromEditState
  // et al.), but the only thing ever written to storage is the mode-agnostic
  // BLOCK -- an index into the note's current PreviewMarkdownBlock[] array
  // (PreviewBlockIndex.ts's resolvePreviewBlockIndexForSourceLine). This is
  // the single place that conversion happens on the write side; every
  // saveNoteUiState/saveSnapshotAnchor call site funnels through it. Only
  // called at enumerated leave-editor checkpoints (never per-keystroke), so
  // the O(document length) remark parse this triggers is not a hot-path cost.
  const computeAnchorBlockIndexFromLine = useCallback((text: string, sourceAnchorLine: number): number => {
    const blocks = getPreviewBlocksForText(text)
    return resolvePreviewBlockIndexForSourceLine(blocks, sourceAnchorLine)
  }, [getPreviewBlocksForText])

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

  // Resolves the current source line for whichever mode is active, with no
  // markdown parsing at all -- edit's own analytical/DOM primitives only.
  // Shared by captureCurrentAnchorBlockIndex (DB-persistence path, which
  // needs the extra line->block-index conversion since a save/restore gap
  // can shift line numbers) and toggleRenderViewMode's runtime mode-switch
  // (which does not: the document hasn't changed between "leaving" and
  // "entering" within the same synchronous toggle, so round-tripping the
  // line through a block index there would just be two redundant
  // full-document parses for zero benefit -- exactly what made a mode
  // toggle on a very large document slow).
  const resolveCurrentSourceAnchorLine = useCallback((): number | null => {
    if (isPreviewMode) {
      const container = previewScrollRef.current
      if (!container) return null
      const sourceAnchor = resolvePreviewSourceAnchorFromContainer(container)
      return sourceAnchor?.sourceAnchorLine ?? null
    }

    const payload = readCurrentEditUiPayload()
    if (payload) return payload.sourceAnchorLine

    const cachedSnapshot = activeNoteId ? editModeSnapshotByNoteIdRef.current.get(activeNoteId) : null
    if (!cachedSnapshot) return null
    return Math.max(0, cachedSnapshot.viewport.scrollTopLines + cachedSnapshot.viewport.topBoundaryLines)
  }, [activeNoteId, isPreviewMode, readCurrentEditUiPayload, resolvePreviewSourceAnchorFromContainer])

  const captureCurrentAnchorBlockIndex = useCallback((): number | null => {
    const sourceAnchorLine = resolveCurrentSourceAnchorLine()
    if (sourceAnchorLine === null) return null

    const text = normalizeInternalText(
      previewedSnapshotContentRef.current ?? (latestEditorTextRef.current || activeNoteText),
    )
    return computeAnchorBlockIndexFromLine(text, sourceAnchorLine)
  }, [activeNoteText, computeAnchorBlockIndexFromLine, latestEditorTextRef, previewedSnapshotContentRef, resolveCurrentSourceAnchorLine])


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
      const { progressEdit, cursorPos, scrollTop, sourceAnchorLine } = payload

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
      }

      const text = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
      const anchorBlockIndex = computeAnchorBlockIndexFromLine(text, sourceAnchorLine)
      const previewBlockCache = buildPersistedPreviewBlockCache(text)
      if (previewBlockCache) {
        previewBlockCache.textHash = await hashNormalizedText(text)
      }
      debugLogPreviewBlockCache('persisting edit-ui cache', {
        noteId,
        hasCache: !!previewBlockCache,
        ranges: previewBlockCache?.ranges.length,
      })
      await notesApi.saveNoteUiState({
        id: noteId,
        payload: { anchorBlockIndex, cursorPos, previewBlockCache },
      })
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
  }, [activeNoteText, buildPersistedPreviewBlockCache, computeAnchorBlockIndexFromLine, latestEditorTextRef, lineHeightPx, readCurrentEditUiPayload, updateEditModeSnapshotCache])

  const cancelPendingEditUiStatePersist = useCallback(() => {
    if (editUiStateSaveTimerRef.current !== null) {
      window.clearTimeout(editUiStateSaveTimerRef.current)
      editUiStateSaveTimerRef.current = null
    }
  }, [])

  // The App.tsx-driven "note leaves this section" checkpoint: section
  // close/delete/swap/clear, app quit. Mode-agnostic per the scroll-sync
  // policy -- captures whichever mode (edit or preview) is actually on
  // screen via captureCurrentAnchorBlockIndex, not just edit mode.
  const persistActiveNoteEditModeStateNow = useCallback(() => {
    if (!activeNoteId) return

    if (!isPreviewMode) {
      captureEditModeSnapshotFromEditor(activeNoteId)
    }

    const notesApi = window.thockdownNotes
    if (!notesApi) return

    const anchorBlockIndex = captureCurrentAnchorBlockIndex()
    if (anchorBlockIndex === null) return

    // cursorPos is an edit-mode-only (caret) concern -- preview mode has no
    // caret to persist, so this checkpoint leaves cursorPos untouched when
    // leaving from preview. The key must be entirely absent from the
    // payload object (not just `undefined`-valued) for that -- saveNoteUiState
    // distinguishes "key present" from "key absent" via hasOwnProperty, and
    // an explicit `cursorPos: undefined` still counts as present.
    const cursorPos = isPreviewMode ? undefined : readCurrentEditUiPayload()?.cursorPos

    const text = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const previewBlockCache = buildPersistedPreviewBlockCache(text)
    const payloadBase: { anchorBlockIndex: number | null; cursorPos?: number | null; previewBlockCache?: ReturnType<typeof buildPersistedPreviewBlockCache> } =
      { anchorBlockIndex, previewBlockCache }
    if (cursorPos !== undefined) {
      payloadBase.cursorPos = cursorPos
    }

    void (async () => {
      if (payloadBase.previewBlockCache) {
        payloadBase.previewBlockCache.textHash = await hashNormalizedText(text)
      }
      debugLogPreviewBlockCache('persisting leave-note cache', {
        noteId: activeNoteId,
        hasCache: !!payloadBase.previewBlockCache,
        ranges: payloadBase.previewBlockCache?.ranges.length,
      })
      await notesApi.saveNoteUiState({ id: activeNoteId, payload: payloadBase })
    })()
  }, [
    activeNoteId,
    activeNoteText,
    buildPersistedPreviewBlockCache,
    captureCurrentAnchorBlockIndex,
    captureEditModeSnapshotFromEditor,
    isPreviewMode,
    latestEditorTextRef,
    readCurrentEditUiPayload,
  ])

  const applyEditRestoreSnapshot = useCallback((snapshot: EditRestoreSnapshot, options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void }) => {
    const restoreFullSelection = options?.restoreFullSelection ?? true
    const focusAfterApply = options?.focusAfterApply ?? false
    const onComplete = options?.onComplete
    let cancelled = false

    if (restoreInProgressRef.current) {
      debugLogScrollSync(`applyEditRestoreSnapshot skipped: another restore already in progress from ${restoreActiveCallerRef.current ?? 'unknown'}`)
      return () => {
        cancelled = true
      }
    }
    restoreInProgressRef.current = true
    // Diagnostic: which call site invoked this -- the second line of a
    // captured stack trace is the caller's own frame. Lets a future
    // collision (see the skip log above) name its culprit instead of being
    // pure guesswork.
    restoreActiveCallerRef.current = new Error().stack?.split('\n')[2]?.trim() ?? 'unknown'

    // Diagnostic: which call site invoked this, and how many times total
    // this render cycle -- pinpoints whether two independent effects are
    // both applying a restore for the same transition.
    applyEditRestoreSnapshotCallCounterRef.current += 1

    // Applies the rough placement immediately (safe and idempotent: integer
    // line counts, no measurement-dependent clamping -- see
    // EditorViewportLines/clampBoundaryLines). `viewport.scrollTopLines`
    // there is a naive line-COUNT, though (sourceAnchorLine minus boundary
    // lines), which is only correct when nothing wraps -- see
    // EditRestoreSnapshot's own doc comment. If `snapshot.sourceAnchorLine`
    // is present, correctWrappingOnceReady below fixes that up to an
    // analytically exact value one frame later, once the adapter is
    // confirmed mounted -- computed fresh from the same block every time,
    // not a cached/round-tripped pixel value, so it carries none of the
    // drift risk the pre-rewrite sync/spoof caching existed to paper over
    // (docs/cm6-parity-hardening-plan.md's Bug 5 follow-up).
    const applyWhenReady = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyWhenReady)
        return
      }

      const selection = restoreFullSelection ? snapshot.fullSelection : snapshot.collapsedSelection

      // The pane going from visibility:hidden back to normal layout right
      // around this same call can itself fire a native scroll event with no
      // CM6 transaction to tag it "programmatic" -- it then defaults to
      // "user-input" (see docs/editor-contract.md's Event Semantics) and
      // gets read by onViewportChange as a genuine user scroll, re-dirtying
      // sectionRequiresScrollUpdateRef right after this restore and forcing
      // an unnecessary slow-path toggle next time. seedInitialViewport
      // already guards its own applySnapshot call the same way.
      ignoreNextUserViewportChangeRef.current = true
      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        selection,
        viewportLines: snapshot.viewport,
      })

      latestViewportRef.current = snapshot.viewport
      latestEditViewportRef.current = snapshot.viewport

      if (typeof snapshot.sourceAnchorLine === 'number') {
        requestAnimationFrame(() => {
          if (cancelled) return
          correctWrappingOnceReady(snapshot.sourceAnchorLine!, snapshot.viewport)
        })
      }

      if (focusAfterApply) {
        requestAnimationFrame(() => {
          focusEditorInEditMode({ restoreSelection: false })
        })
      }

      if (onComplete) {
        onComplete()
      }
      // Restore completed — clear the in-progress sentinel so future
      // callers can proceed. Also clear the active-caller diagnostic ref.
      restoreInProgressRef.current = false
      restoreActiveCallerRef.current = null
    }

    const correctWrappingOnceReady = (sourceAnchorLine: number, viewport: PersistedViewportState) => {
      const adapter = adapterRef.current
      if (!adapter) return

      const lineTopPx = adapter.resolveHeightForSourceLine(sourceAnchorLine)
      if (lineTopPx === null) return

      const topBoundaryPx = Math.max(0, Math.round(viewport.topBoundaryLines * lineHeightPx))
      const correctedScrollTopLines = Math.max(
        0,
        Math.round((lineTopPx - topBoundaryPx) / lineHeightPx) + RESTORE_OFFSET_LINES,
      )
      const correctedViewport: PersistedViewportState = { ...viewport, scrollTopLines: correctedScrollTopLines }

      // Same reasoning as applyWhenReady's own applySnapshot call above.
      ignoreNextUserViewportChangeRef.current = true
      adapter.applySnapshot({
        selectionScrollBehavior: 'preserve-scroll',
        viewportLines: correctedViewport,
      })

      latestViewportRef.current = correctedViewport
      latestEditViewportRef.current = correctedViewport
    }

    requestAnimationFrame(applyWhenReady)
    return () => {
      cancelled = true
      restoreInProgressRef.current = false
    }
  }, [focusEditorInEditMode, lineHeightPx])

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
      queueSave(canonicalText, event.selection.end)
      debugLogCheckpoint('after queueSave (onTextChange end)')

      // Mark that a change occurred that requires recomputing scroll
      // offsets on the next mode switch. We intentionally do not compute
      // offsets now; computation is deferred until the actual switch.
      sectionRequiresScrollUpdateRef.current = true
      debugLogScrollSync(`sectionRequiresScrollUpdateRef set (onTextChange): note=${activeNoteId ?? 'null'}`)
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
            queueSave(nextText, nextSelection.end)

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
      queueSave(next.text, next.selection.end)

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
      queueSave(next.text, next.selection.end)
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
      queueSave(next.text, next.selection.end)
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
      queueSave(next.text, next.selection.end)

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
        // A user scroll in edit mode should also mark the section as
        // requiring a fresh scroll-offset computation on the next mode
        // switch. This ensures edit-driven scrolls are observed by the
        // deferred computation path the same way preview-driven scrolls
        // are.
        sectionRequiresScrollUpdateRef.current = true
        debugLogScrollSync(
          `sectionRequiresScrollUpdateRef set (onViewportChange - edit scroll): note=${activeNoteId} scrollTopPx=${nextTelemetry.scrollTopPx} topLines=${nextViewport.topBoundaryLines} scrollTopLines=${nextViewport.scrollTopLines}`,
        )
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

    const editRestoreKey = `${activeNoteId}:${previewedSnapshotId ?? 'live'}`

    if (!sectionRequiresScrollUpdateRef.current) {
      // Fast path: both panes are already in sync, so this is a pure CSS
      // visibility toggle. Do not run any restore/scroll code.
      debugLogScrollSync(`render->edit fast path skipped (flag false): note=${activeNoteId}`)
      previousActiveNoteIdForEditRestoreRef.current = activeNoteId
      editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
      return
    }

    // The flag is true, so something genuinely changed since the two modes
    // were last in sync. Re-derive edit's position rather than trusting that
    // the hidden edit pane is still correctly positioned.
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId

    const cachedSnapshot = pendingEditRestoreSnapshotRef.current

    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
      editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
applyEditRestoreSnapshot(cachedSnapshot, { restoreFullSelection: true, focusAfterApply: true, onComplete: () => setIsCaretSuspended(false) })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
      editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
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
        })
        updateEditModeSnapshotCache(fallbackSnapshot)
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)

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
    previewedSnapshotId,
    setIsCaretSuspended,
  ])

  // The actual edit<->preview mode toggle. Fast path (the common case):
  // if nothing has scrolled/resized/been-edited since the two modes were
  // last in sync, just flip which pane is visible -- dual-mount
  // (SectionEditorArea.tsx toggles `display`, neither pane ever unmounts)
  // means both panes' DOM is already sitting exactly where it should be, so
  // there is nothing to compute or apply. Slow path (sectionRequiresScrollUpdateRef
  // true): resolve the current block from whichever mode is being LEFT
  // (via each mode's own analytical/DOM anchor-resolution, same primitives
  // Phase 3/4 use), and land the mode being ENTERED on (block, one
  // line-height offset) via that mode's own stable align-to-block
  // mechanism -- never a raw/translated pixel value. See
  // docs/editor-contract.md's Viewport Model section.
  const toggleRenderViewMode = useCallback(() => {
    const enteringPreview = !isPreviewMode
    const editRestoreKey = activeNoteId ? `${activeNoteId}:${previewedSnapshotId ?? 'live'}` : null
    debugLogScrollSync(`toggleRenderViewMode start: enteringPreview=${enteringPreview} flag=${sectionRequiresScrollUpdateRef.current}`)

    if (!activeNoteId || !sectionRequiresScrollUpdateRef.current) {
      debugLogScrollSync(`toggleRenderViewMode fast path: enteringPreview=${enteringPreview}`)
      if (enteringPreview && editRestoreKey) {
        // Edit is currently live and positioned; record that so returning
        // to edit later can be a pure visibility flip.
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
        setActiveNoteText(normalizeInternalText(latestEditorTextRef.current || activeNoteText))
      }
      setIsPreviewMode((previous) => !previous)
      return
    }

    const text = normalizeInternalText(latestEditorTextRef.current || activeNoteText)

    const rawSourceAnchorLine = resolveCurrentSourceAnchorLine()
    debugLogScrollSync(
      `toggleRenderViewMode rawSourceAnchorLine=${rawSourceAnchorLine ?? 'null'} mode=${isPreviewMode ? 'preview' : 'edit'} note=${activeNoteId}`,
    )

    // Resolve the current source line from whichever mode is being left,
    // then round-trip it through the mode-agnostic BLOCK representation so
    // both directions of the toggle speak the same language. Edit's own
    // anchor resolver reports the raw logical line at the top of the
    // viewport, while Preview's resolver reports a block's start line
    // (real block boundary). Passing those raw values across directly
    // causes a systematic mismatch: edit hands preview a non-boundary line,
    // preview resolves to a different block, and the next trip back lands
    // edit at that block's start instead of the original viewport line.
    // Converting both sides to/from anchorBlockIndex forces convergence on
    // the same canonical block boundary (docs/editor-contract.md's Viewport
    // Model). The blocks are cached, so this parse is only paid once per
    // text change, not twice per toggle.

    if (rawSourceAnchorLine === null || rawSourceAnchorLine < 0) {
      sectionRequiresScrollUpdateRef.current = false
      if (enteringPreview && editRestoreKey) {
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
        setActiveNoteText(text)
      }
      setIsPreviewMode((previous) => !previous)
      return
    }

    const blockResolveStart = performance.now()
    const blocks = getPreviewBlocksForText(text)
    const blockResolveMs = performance.now() - blockResolveStart
    debugLogPreviewBlockCache('toggleRenderViewMode block resolve', {
      noteId: activeNoteId,
      textLength: text.length,
      blockCount: blocks.length,
      blockResolveMs: Number(blockResolveMs.toFixed(2)),
    })
    const containingBlockIndex = resolvePreviewBlockIndexForSourceLine(blocks, rawSourceAnchorLine)
    // The edit -> render transition consistently lands one block higher than
    // the edit viewport's visible top block. Rather than fight the underlying
    // architectural offset, target the following block when we are actually
    // updating preview's scroll position from a changed/scrolled edit state.
    const anchorBlockIndex = enteringPreview
      ? Math.min(blocks.length - 1, Math.max(0, containingBlockIndex + 1))
      : Math.max(0, containingBlockIndex)
    const sourceAnchorLine = resolveSourceLineForAnchorBlockIndex(blocks, anchorBlockIndex)
    debugLogScrollSync(
      `toggleRenderViewMode blocks: rawLine=${rawSourceAnchorLine} containingIndex=${containingBlockIndex} anchorIndex=${anchorBlockIndex} anchorStartLine=${sourceAnchorLine} note=${activeNoteId}`,
    )

    if (enteringPreview) {
      pendingRenderViewSourceAnchorRef.current = { sourceAnchorLine }
      if (editRestoreKey) {
        // Edit is live and positioned right now; remember that so the return
        // to edit is a pure CSS visibility flip, not a re-derived snapshot.
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
      }
    } else {
      // Returning to edit after a real scroll/resize/edit change. The edit
      // pane is dual-mounted and alive while hidden, but its position is
      // stale if preview scrolled while it was hidden. Re-derive edit's
      // position from the current preview anchor (the canonical BLOCK) and
      // apply it. The flag being true means something genuinely changed
      // since the two modes were last in sync -- spurious react-virtual
      // convergence events are filtered by the preview scroll listener.
      if (editRestoreKey) {
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
      }
      const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
      const topBoundaryLines = fallbackViewport?.topBoundaryLines ?? 0
      const collapsedSelection = ZERO_EDITOR_SELECTION
      const restoreSnapshot: EditRestoreSnapshot = {
        noteId: activeNoteId,
        collapsedSelection,
        fullSelection: collapsedSelection,
        viewport: {
          topBoundaryLines,
          bottomBoundaryLines: fallbackViewport?.bottomBoundaryLines ?? 0,
          // Rough placement (naive line count -- see EditRestoreSnapshot's
          // own doc comment); applyEditRestoreSnapshot corrects this to an
          // analytically exact value via sourceAnchorLine below, one frame
          // later, once the adapter is confirmed mounted.
          scrollTopLines: Math.max(0, sourceAnchorLine - topBoundaryLines + RESTORE_OFFSET_LINES),
        },
        sourceAnchorLine,
      }
      updateEditModeSnapshotCache(restoreSnapshot)
      pendingEditRestoreSnapshotRef.current = null
      applyEditRestoreSnapshot(restoreSnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
    }

    sectionRequiresScrollUpdateRef.current = false

    if (enteringPreview) {
      setActiveNoteText(text)
    }
    setIsPreviewMode((previous) => !previous)
  }, [
    activeNoteId,
    activeNoteText,
    applyEditRestoreSnapshot,
    resolveCurrentSourceAnchorLine,
    getPreviewBlocksForText,
    isPreviewMode,
    latestEditViewportRef,
    latestEditorTextRef,
    latestViewportRef,
    previewedSnapshotId,
    setActiveNoteText,
    setIsCaretSuspended,
    setIsPreviewMode,
    updateEditModeSnapshotCache,
  ])

  useEffect(() => {
    if (!persistenceReady || !activeNoteId) return
    // activateNote (EditorSection.tsx) already computes and caches a restore
    // snapshot for the note it's activating, synchronously, before it calls
    // setActiveNoteId -- by the time this effect runs (activeNoteId change),
    // that cache entry already exists for the common "note loaded via
    // activateNote" path. Skip the redundant IPC round trip + parse in that
    // case; this effect exists only to cover any other path that sets
    // activeNoteId without pre-populating the cache.
    if (editModeSnapshotByNoteIdRef.current.has(activeNoteId)) return

    let cancelled = false

    const preloadEditModeSnapshot = async () => {
      try {
        const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
        if (cancelled) return

        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        // latestEditorTextRef.current alone, not `|| activeNoteText` -- this
        // effect must not depend on activeNoteText (see below): that state
        // updates on every keystroke, and re-running this on every keystroke
        // would mean re-running buildEditRestoreSnapshotFromUiState's
        // now-real markdown parse (resolveEditSourceAnchorLineFromUiState /
        // splitMarkdownIntoPreviewBlocks) on every keystroke -- exactly the
        // input-lag regression this comment is here to prevent reintroducing.
        const activeText = normalizeInternalText(latestEditorTextRef.current)
        const snapshot = buildEditRestoreSnapshotFromUiState({
          noteId: activeNoteId,
          text: activeText,
          uiState,
          fallbackViewport,
        })
        updateEditModeSnapshotCache(snapshot)
      } catch (error) {
        console.warn('Failed to preload edit mode snapshot for active note', error)
      }
    }

    const prewarmPreviewBlocks = () => {
      const text = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
      if (previewBlockSplitCacheRef.current?.text === text) {
        debugLogPreviewBlockCache('background prewarm skipped (cache already matches)', { textLength: text.length })
        return
      }
      if (previewBlockPrewarmTextRef.current === text) {
        debugLogPreviewBlockCache('background prewarm skipped (already scheduled)', { textLength: text.length })
        return
      }
      previewBlockPrewarmTextRef.current = text
      debugLogPreviewBlockCache('scheduling background prewarm', { textLength: text.length })

      if (previewBlockPrewarmTimerRef.current !== null) {
        window.clearTimeout(previewBlockPrewarmTimerRef.current)
      }

      previewBlockPrewarmTimerRef.current = window.setTimeout(() => {
        previewBlockPrewarmTimerRef.current = null
        const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
        if (previewBlockSplitCacheRef.current?.text === currentText) return
        if (previewBlockPrewarmTextRef.current !== currentText) return
        // Use a single requestIdleCallback or setTimeout(0) boundary so the
        // parse doesn't run synchronously inside this effect and block the
        // initial note paint/focus.
        const run = () => {
          try {
            const splitCache = splitMarkdownIntoPreviewBlocksIncremental(currentText, previewBlockSplitCacheRef.current)
            previewBlockSplitCacheRef.current = splitCache
            previewBlocksCacheRef.current = { text: currentText, blocks: splitCache.blocks }
            debugLogPreviewBlockCache('background prewarm completed', { textLength: currentText.length, blocks: splitCache.blocks.length, ranges: splitCache.ranges.length })
          } catch (error) {
            console.warn('Failed to prewarm preview blocks', error)
          }
        }
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(run, { timeout: 2000 })
        } else {
          window.setTimeout(run, 0)
        }
      }, 500)
    }

    void preloadEditModeSnapshot()
    prewarmPreviewBlocks()

    return () => {
      cancelled = true
      if (previewBlockPrewarmTimerRef.current !== null) {
        window.clearTimeout(previewBlockPrewarmTimerRef.current)
        previewBlockPrewarmTimerRef.current = null
      }
    }
    // Deliberately NOT dependent on activeNoteText -- this preloads the
    // persisted-position cache once per note activation (activeNoteId
    // change), not on every edit. See the comment above.
  }, [activeNoteId, activeNoteText, lineHeightPx, persistenceReady, updateEditModeSnapshotCache, latestEditorTextRef, previewBlockSplitCacheRef, previewBlocksCacheRef])

  /**
   * Note-activation effect: restores edit-mode position when the active
   * note in this section changes. This is intentionally *not* an edit<->
   * preview mode-transition handler -- the dedicated transition effect
   * above owns that -- so it must not clear preview-restore state or apply
   * a second restore when the same note is merely toggled between modes.
   */
  useEffect(() => {
    if (!persistenceReady) return
    if (!activeNoteId) {
      // Reset sentinels when the section is cleared.
      previousActiveNoteIdForEditRestoreRef.current = null
      sectionRequiresScrollUpdateRef.current = false
      previewRestoreCompletedForNoteIdRef.current.clear()
      editRestoreCompletedForNoteIdRef.current.clear()
      return
    }

    const editRestoreKey = `${activeNoteId}:${previewedSnapshotId ?? 'live'}`

    const wasPreviewMode = previousPreviewModeRef.current
    const previousActiveNoteId = previousActiveNoteIdForEditRestoreRef.current

    // Same note, same mode: nothing to restore (e.g. keystroke re-renders
    // in edit mode, or a no-op re-render while preview is already active).
    if (previousActiveNoteId === activeNoteId && wasPreviewMode === isPreviewMode) {
      return
    }

    // Same-note edit<->preview transitions are owned by the transition
    // effect above. Bailing here prevents that effect's pending restore
    // from being overwritten by a second memory/persisted restore, and
    // prevents us from clearing previewRestoreCompletedForNoteIdRef which
    // would make every preview entry look like a first-load restore.
    if (previousActiveNoteId === activeNoteId && wasPreviewMode !== isPreviewMode) {
      return
    }

    // Genuine note activation: update sentinels and give the new note a
    // clean scroll hand-off slate.
    previousPreviewModeRef.current = isPreviewMode
    previousActiveNoteIdForEditRestoreRef.current = activeNoteId
    sectionRequiresScrollUpdateRef.current = false
    previewRestoreCompletedForNoteIdRef.current.clear()
    editRestoreCompletedForNoteIdRef.current.clear()

    if (isPreviewMode) {
      // Edit mode has not been restored for this note yet; force a real
      // hand-off the first time the user toggles back to edit.
      sectionRequiresScrollUpdateRef.current = true
      return
    }

    // Restore edit mode for the newly activated note.
    const cachedSnapshot = pendingEditRestoreSnapshotRef.current
    if (cachedSnapshot && cachedSnapshot.noteId === activeNoteId) {
      pendingEditRestoreSnapshotRef.current = null
      editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
      applyEditRestoreSnapshot(cachedSnapshot, {
        restoreFullSelection: true,
        focusAfterApply: true,
        onComplete: () => setIsCaretSuspended(false),
      })
      return
    }

    const memorySnapshot = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
    if (memorySnapshot) {
      editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)
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
        })
        updateEditModeSnapshotCache(restoreSnapshot)
        editRestoreCompletedForNoteIdRef.current.add(editRestoreKey)

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
    previewedSnapshotId,
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

    // Lands on the block covering `sourceLine`, one line-height below the
    // top border (never flush at 0) -- the same RESTORE_OFFSET_LINES
    // convention every other restore uses, achieved via `scroll-padding-top`
    // on the container so the browser's own native `scrollIntoView` lands
    // there directly. This is the ONLY scroll write this function makes.
    // There is deliberately no follow-up nudge, and no "wait until
    // scrollTop stops changing" polling: a raw/computed scrollTop write
    // after the fact is exactly what fights react-virtual's own
    // reconciliation as newly-mounted neighboring rows get their real
    // measured heights (see docs/cm6-parity-hardening-plan.md's Bug 5
    // follow-up) -- that reasoning is why this mechanism was originally
    // built purely on scrollToIndex-to-mount + scrollIntoView-on-the-real-
    // element with no override, and it stays that way; scroll-padding-top
    // is a declarative shift of *where* scrollIntoView lands, not a second
    // write competing with the first.
    const applyPreviewSourceAnchor = (sourceLine: number) => {
      const container = previewScrollRef.current
      if (!container) return

      container.style.scrollPaddingTop = `${Math.max(0, lineHeightPx)}px`

      // Entering a snapshot preview invalidates any earlier "live" preview
      // restore for this note, so returning to present later re-restores.
      if (previewedSnapshotId !== null) {
        previewRestoreCompletedForNoteIdRef.current.delete(`${activeNoteId}:live`)
      }

      const previousScrollBehavior = container.style.scrollBehavior
      container.style.scrollBehavior = 'auto'
      const clampedSourceLine = Math.max(0, sourceLine)
      // Programmatic scrolls below will fire native 'scroll' events. Tell
      // the listener to ignore the first burst so it doesn't flag a restore
      // as a real user scroll.
      suppressPreviewScrollUpdateUntilRef.current = performance.now() + 250

      // The block we intend to land on. The scroll listener below compares
      // its own resolved anchor against this, not against "did a scroll
      // event fire" -- react-virtual's own reconciliation (nearby rows
      // mounting, real measured heights replacing initial estimates) can
      // keep generating genuine native scroll events for an unbounded,
      // unknowable time after we call scrollIntoView, all converging toward
      // this same block. No duration, however generous, can be trusted to
      // outlast that; but as long as they all converge here, none of them
      // represent an actual change worth reacting to. Set before either
      // call below, so it covers the whole operation regardless of how many
      // events fire or how long convergence takes.
      lastKnownPreviewAnchorLineRef.current = clampedSourceLine
      previewScrollToSourceLineRef.current?.(clampedSourceLine, { align: 'start' })

      const attemptFindAndScroll = (attemptsLeft: number) => {
        if (cancelled || !container) return

        const target = findPreviewSourceAnchorElement(container, clampedSourceLine)
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

    const previewRestoreKey = `${activeNoteId}:${previewedSnapshotId ?? 'live'}`

    const pendingSourceAnchor = pendingRenderViewSourceAnchorRef.current
    if (pendingSourceAnchor) {
      pendingRenderViewSourceAnchorRef.current = null
      previewRestoreCompletedForNoteIdRef.current.add(previewRestoreKey)
      applyPreviewSourceAnchor(pendingSourceAnchor.sourceAnchorLine)

      return () => {
        cancelled = true
        setPreviewScrollBehavior('')
      }
    }

    // Not a toggle-triggered entry (first mount into preview for this note,
    // or a note switch while a section is already in preview mode) --
    // genuinely a "restore on load" case. Reads the persisted anchor for
    // whichever content is on screen: a Timeline snapshot's own
    // (independently maintained) BLOCK when previewing one, otherwise the
    // live note's.
    if (previewRestoreCompletedForNoteIdRef.current.has(previewRestoreKey)) {
      // Preview for this target has already been restored; toggling back
      // and forth without scrolling should be a pure CSS visibility flip.
      return () => {
        cancelled = true
        setPreviewScrollBehavior('')
      }
    }

    previewRestoreCompletedForNoteIdRef.current.add(previewRestoreKey)

    const restorePreviewScroll = async () => {
      try {
        let sourceAnchorLine: number | null = null

        if (previewedSnapshotId !== null) {
          const anchorBlockIndex = await window.thockdownNotes?.getSnapshotAnchor({ snapshotId: previewedSnapshotId }) ?? 0
          if (cancelled) return
          const snapshotText = normalizeInternalText(previewedSnapshotContentRef.current ?? '')
          const blocks = splitMarkdownIntoPreviewBlocks(snapshotText)
          sourceAnchorLine = resolveSourceLineForAnchorBlockIndex(blocks, anchorBlockIndex)
        } else {
          const uiState = await window.thockdownNotes?.getNoteUiState({ id: activeNoteId })
          if (cancelled) return
          const text = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
          const blocks = getPreviewBlocksForText(text)
          if (uiState && typeof uiState.anchorBlockIndex === 'number' && Number.isFinite(uiState.anchorBlockIndex)) {
            const totalLines = Math.max(1, text.split('\n').length)
            const rawLine = resolveSourceLineForAnchorBlockIndex(blocks, Math.round(uiState.anchorBlockIndex))
            sourceAnchorLine = Math.min(Math.max(0, rawLine), totalLines - 1)
          }
        }

        if (cancelled) return
        if (typeof sourceAnchorLine === 'number' && Number.isFinite(sourceAnchorLine)) {
          applyPreviewSourceAnchor(sourceAnchorLine)
        }
      } catch (error) {
        console.warn('Failed to restore preview scroll state', error)
      }
    }

    void restorePreviewScroll()

    return () => {
      cancelled = true
      setPreviewScrollBehavior('')
    }
  }, [activeNoteId, isPreviewMode, activeNoteText, lineHeightPx, latestEditorTextRef, previewedSnapshotId, previewedSnapshotContentRef, getPreviewBlocksForText])

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

        // Compare against the block our own last restore intended, not
        // against "did a scroll event fire" -- react-virtual's own
        // reconciliation can keep generating genuine scroll events for an
        // unbounded time after a restore as nearby rows mount and get their
        // real measured heights, all converging toward this same block.
        // None of that is a real change; only landing on a genuinely
        // different block is.
        // A programmatic restore just fired; absorb its settle events as
        // the new baseline without treating them as a user scroll.
        if (performance.now() < suppressPreviewScrollUpdateUntilRef.current) {
          debugLogScrollSync(`preview scroll ignored (programmatic restore): note=${activeNoteId} anchorLine=${sourceAnchor.sourceAnchorLine}`)
          lastKnownPreviewAnchorLineRef.current = sourceAnchor.sourceAnchorLine
          return
        }

        if (sourceAnchor.sourceAnchorLine === lastKnownPreviewAnchorLineRef.current) {
          debugLogScrollSync(`preview scroll settled at already-known anchorLine=${sourceAnchor.sourceAnchorLine} -- not a real change, ignored`)
          return
        }

        lastKnownPreviewAnchorLineRef.current = sourceAnchor.sourceAnchorLine
        // Do not persist preview scroll to the DB here. Instead, mark
        // that this section requires a fresh scroll-offset computation on
        // the next mode switch. This avoids progressive drift caused by
        // saving block anchors during preview-settle.
        sectionRequiresScrollUpdateRef.current = true
        debugLogScrollSync(`sectionRequiresScrollUpdateRef set (preview scroll): note=${activeNoteId} anchorLine=${sourceAnchor.sourceAnchorLine}`)
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

      // A historical snapshot tracks its own canonical BLOCK independently
      // of the live note's, maintained the same way (see
      // docs/editor-contract.md's Viewport Model section) -- restore from
      // that, landing one line-height down from the top border, same
      // convention as any other first-load restore. Falls back to top of
      // document if the snapshot has never had a position saved
      // (getSnapshotAnchor defaults to 0, which resolveSourceLineForAnchorBlockIndex
      // also treats as "top") or its content isn't available yet.
      const snapshotId = previewedSnapshotId
      const noteIdForRestore = activeNoteId
      let cancelled = false

      const restoreSnapshotPosition = async () => {
        const anchorBlockIndex = snapshotId !== null
          ? (await window.thockdownNotes?.getSnapshotAnchor({ snapshotId }) ?? 0)
          : 0
        if (cancelled) return

        const snapshotText = normalizeInternalText(previewedSnapshotContentRef.current ?? '')
        const blocks = splitMarkdownIntoPreviewBlocks(snapshotText)
        const sourceLine = resolveSourceLineForAnchorBlockIndex(blocks, anchorBlockIndex)
        const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
        const topBoundaryLines = fallbackViewport?.topBoundaryLines ?? 0

        applyEditRestoreSnapshot({
          noteId: noteIdForRestore,
          collapsedSelection: ZERO_EDITOR_SELECTION,
          fullSelection: ZERO_EDITOR_SELECTION,
          viewport: {
            topBoundaryLines,
            bottomBoundaryLines: fallbackViewport?.bottomBoundaryLines ?? 0,
            scrollTopLines: Math.max(0, sourceLine - topBoundaryLines + RESTORE_OFFSET_LINES),
          },
          sourceAnchorLine: sourceLine,
        }, { restoreFullSelection: false, focusAfterApply: false })
      }

      void restoreSnapshotPosition()
      return () => {
        cancelled = true
      }
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
  }, [activeNoteId, applyEditRestoreSnapshot, previewedSnapshotId, isFrozenSectionPreviewRef, previewedSnapshotContentRef, latestEditViewportRef, latestViewportRef])
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

      queueSave(canonicalText, nextSelection.end)
    } else {
      queueSave(canonicalText, latestEditorSelectionRef.current?.end)
    }
  }, [
    queueSave,
    updateActiveNoteTitlePreview,
    activeNoteHasDebugTagRef,
    latestEditorSelectionRef,
    latestEditorTextRef,
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
    captureCurrentAnchorBlockIndex,
    resolvePreviewSourceAnchorFromContainer,
    restoreEditorSelection,
    focusEditorInEditMode,
    scheduleFocusEditorInEditMode,
    persistEditUiState,
    cancelPendingEditUiStatePersist,
    persistActiveNoteEditModeStateNow,
    applyEditRestoreSnapshot,
    bindings,
    toggleRenderViewMode,
    applyProgrammaticEditorText,
    seedInitialViewport,
    previewBlockSplitCacheRef,
    previewBlocksCacheRef,
  }
}

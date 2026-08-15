import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent, MouseEvent, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote } from '../shared/noteLifecycle'
import type { PersistedViewportState } from '../shared/appState'
import { NOTE_DRAG_MIME_TYPE, parseNoteDragPayload } from '../shared/noteDrag'
import { normalizeInternalText } from '../editor/TextPolicy'
import { normalizeChapterHeadings, CHAPTER_HEADLINE_LEVEL_RULE, NOTE_HEADLINE_LEVEL_RULE } from '../shared/markdownHeadings'
import { parseMarkdownHeading } from '../shared/tableOfContentsText'
import { countWords, trackWordCount } from '../editor/WordCount'
import { buildEditRestoreSnapshotFromUiState } from '../editor/EditRestoreMath'
import type { EditorRuntimeMetrics } from '../editor/EditorTypography'
import type { UseSectionTabsResult } from '../tabBar/useSectionTabs'
import { SectionTabBar } from '../tabBar/SectionTabBar'
import { SectionEditorArea, type SectionEditorAreaProps } from './SectionEditorArea'
import { useDisplayedNoteRenderMode } from './useDisplayedNoteRenderMode'
import { useActiveNoteId } from './useActiveNoteId'
import { useDisplayedNoteText } from './useDisplayedNoteText'
import { usePreviewedSnapshot } from './usePreviewedSnapshot'
import { useDisplayedNoteSelection } from './useDisplayedNoteSelection'
import { useNoteSaveQueue } from './useNoteSaveQueue'
import { useEditorSectionMount } from './useEditorSectionMount'
import { useSnapshotFreeze } from './useSnapshotFreeze'
import { useSectionTabs } from '../tabBar/useSectionTabs'
import { useNoteChapters } from '../chapters/useNoteChapters'
import { useNoteProtectionActions } from './useNoteProtectionActions'
import { useNoteSnapshotTimeline } from './useNoteSnapshotTimeline'
import { useDocumentFind } from '../find/useDocumentFind'
import { usePreviewMarkdownRendering } from './usePreviewMarkdownRendering'
import { usePreviewScrollbar } from './usePreviewScrollbar'
import { useDocumentFindNavigation } from './useDocumentFindNavigation'
import { useMarkdownFormattingToolbar } from './useMarkdownFormattingToolbar'
import { useHeadlineLevelGuard } from './useHeadlineLevelGuard'
import { hashNormalizedText } from '../shared/hashText'
import { restorePreviewBlockSplitCacheFromRanges } from '../editor/PreviewBlockSplit'
import type { PreviewMarkdownBlock, PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'
import type { SectionHandle } from './sectionRegistry'

type ViewStyleKey =
  | 'modern'
  | 'narrow'
  | 'cute'
  | 'xkcd'
  | 'print'
  | 'calibrilight'
  | 'opensans'
  | 'notoserif'
  | 'neuton'
  | 'faunaone'
  | 'fredericka'
  | 'bubblerone'
export interface EditorSectionProps extends Omit<SectionEditorAreaProps,
  'sectionId' | 'isSectionActive' | 'activeNoteId' | 'isPreviewMode' | 'previewedSnapshotId' | 'bindings' | 'adapterRef' | 'sectionContainerRef'
  | 'editorDisplayText' | 'activeNoteHasDebugTag' | 'isPreviewingSnapshot' | 'isCaretSuspended' | 'previewTextureRef'
  | 'previewScrollRef' | 'handlePreviewScroll' | 'blockPreviewEditMutation' | 'previewMarkdownElement'
  | 'previewScrollbarTrackRef' | 'handlePreviewTrackMouseDown' | 'handlePreviewTrackContextMenu' | 'previewScrollbarThumbRef' | 'isDraggingPreviewScrollThumb'
  | 'isPreviewScrollThumbActive' | 'handlePreviewThumbMouseDown' | 'activeNoteDocumentStats' | 'noteSnapshots'
  | 'handleNavigateSnapshot' | 'handleBranchOpened' | 'handleBranchError' | 'timelineCurveConstant' | 'setTimelineCurveConstant'
  | 'setTimelineTrackLengthPx' | 'handleCreateManualSnapshot' | 'handleReturnToPresent' | 'handleMergeAdjacentSnapshots'
  | 'scrollbarHostEl' | 'setScrollbarHostEl' | 'notes' | 'menuIdentityNoteId' | 'chapters' | 'onParentTabClick' | 'onCreateChapter' | 'onChapterClick'
  | 'onChapterDragStart' | 'onChapterDragEnd' | 'onChapterDrop' | 'onChapterContainerDragOver' | 'onChapterContainerDrop' | 'onChapterPromoteDragOver' | 'onChapterPromoteDrop'
  | 'editingChapterNoteId' | 'chapterIdDraft' | 'setChapterIdDraft' | 'onStartEditingChapterId' | 'onCommitChapterIdEdit' | 'onCancelChapterIdEdit'
  | 'onCollapseChapterIntoPrevious' | 'onExtractSelectionToChapter'> {
  sectionId: string
  markSectionActive: (sectionId: string) => void
  isSidebarVisible: boolean
  toggleSidebarVisible: () => void
  persistenceReady: boolean
  notes: NoteSummary[]
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>
  notesRef: MutableRefObject<NoteSummary[]>

  activeSectionId: string
  registerSectionHandle: (sectionId: string, handle: SectionHandle) => void
  reportSectionHandle: (sectionId: string, handle: SectionHandle) => void

  isApplyingInitialViewportRef: MutableRefObject<boolean>
  pendingViewportRestoreRef: MutableRefObject<PersistedViewportState | null>
  externalNoteOriginalTextByIdRef: MutableRefObject<Map<string, string>>
  externalNoteOriginalHashByIdRef: MutableRefObject<Map<string, string>>
  activeNoteExternalPathRef: MutableRefObject<string | null>
  setCurrentExternalNoteHash: Dispatch<SetStateAction<string | null>>

  queueAppStateSaveStable: (selectedNoteId: string | null) => void
  updateActiveNoteTitlePreviewStable: (nextText: string) => void
  revealNoteInMenuStable: () => void
  writeDebugEntryStable: (functionName: string, lines: string[]) => Promise<void>
  activeNoteHasDebugTagRef: MutableRefObject<boolean>

  saveSelectedNoteState: (selectedNoteId: string | null) => Promise<void>
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  noteTransitionLockRef: MutableRefObject<boolean>
  updateNoteAssignedId: (noteId: string, assignedId: string) => void
  /** Records the note/chapter this anchor lives in (as `$id`/`chapterId` labels, "" if unassigned) plus its own id, whenever an anchor is set anywhere in the app -- see App.tsx's `lastAnchorRef` doc comment. */
  recordLastAnchor: (payload: { noteId: string; chapterId: string; anchorId: string }) => void
  /** Builds the `$<noteid>§<chapterid>#<anchorid>` link target to prefill "Insert Link" with, from whatever `recordLastAnchor` last recorded (each part "" if nothing's been recorded yet this session). */
  getLinkTargetPrefill: () => string
  restoredTabBarMode: 'tags' | 'tabs' | null
  tabBarModeRef: MutableRefObject<'tags' | 'tabs'>

  sidebarMode: 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options'

  restoredDocumentFindCaseSensitive: boolean | null
  documentFindCaseSensitiveRef: MutableRefObject<boolean>

  editorRuntimeMetrics: EditorRuntimeMetrics
  deferPreviewOnRapidInput: boolean
  viewStyle: ViewStyleKey
  viewFontSize: number
  viewSpacing: number
  viewLetterSpacingEm: number

  isLeftmostSection: boolean
  canCreateSection: boolean
  onCreateSection: () => void
  onCloseSection: () => void
  /** "Clear this section" from the section picker's leading pill: vacates this slot (parking/deleting the section per the usual close rules) and backfills it with a fresh blank section, without touching this section's own name/tabs/note. */
  onClearSection: () => void

  sectionName: string | null
  onRenameSection: (name: string | null) => void
  onFetchSwapCandidates: () => Promise<{ id: string; name: string }[]>
  onSwapSection: (incomingSectionId: string) => void
  /** Permanently deletes a named section -- the section picker's right-click-then-left-click confirm gesture on one of its candidate pills. */
  onDeleteSection: (sectionId: string) => void

  /** Unpins a note's tab from a *different* section -- called when this section claims a tab dragged in from elsewhere. */
  unpinNoteFromSection: (sectionId: string, noteId: string) => void
  /** Whether some *other* section currently has the given note open -- see useSnapshotFreeze. */
  isNoteOpenInOtherSection: (sectionId: string, noteId: string) => boolean
}

/**
 * One full editor section: every section-scoped hook (note identity/text/
 * selection, the editor mount, snapshot freeze/thaw, tabs, note-protection
 * actions, the Time Machine timeline, document find, preview rendering,
 * the preview scrollbar, and the markdown-formatting toolbar), plus
 * `activateNote` itself -- all called once per <EditorSection> instance,
 * self-registering into the section registry so chrome (EditorToolbar, the
 * sidebar, export, etc.) can read/act on "the active section" without
 * knowing how many sections exist. App.tsx mounts one of these per entry
 * in window.thockdownSections.listSections() (Phase 4c), side by side in
 * a plain flex row -- no divider/drag/create/close UI yet (Phase 6).
 */
export function EditorSection({
  sectionId,
  markSectionActive,
  isSidebarVisible,
  toggleSidebarVisible,
  persistenceReady,
  notes,
  setNotes,
  notesRef,
  activeSectionId,
  registerSectionHandle,
  reportSectionHandle,
  isApplyingInitialViewportRef,
  pendingViewportRestoreRef,
  externalNoteOriginalTextByIdRef,
  externalNoteOriginalHashByIdRef,
  activeNoteExternalPathRef,
  setCurrentExternalNoteHash,
  queueAppStateSaveStable,
  updateActiveNoteTitlePreviewStable,
  revealNoteInMenuStable,
  writeDebugEntryStable,
  activeNoteHasDebugTagRef,
  saveSelectedNoteState,
  refreshNotes,
  noteTransitionLockRef,
  updateNoteAssignedId,
  recordLastAnchor,
  getLinkTargetPrefill,
  restoredTabBarMode,
  tabBarModeRef,
  sidebarMode,
  restoredDocumentFindCaseSensitive,
  documentFindCaseSensitiveRef,
  editorRuntimeMetrics,
  deferPreviewOnRapidInput,
  viewStyle,
  viewFontSize,
  viewSpacing,
  viewLetterSpacingEm,
  editorStageRef,
  editorFontFamily,
  editorFontLoadVersion,
  spellCheckEditEnabled,
  spellCheckRenderEnabled,
  highlightSearchColor,
  showLineNumbers,
  showReviewFlags,
  onToggleReviewGutter,
  onToggleReviewFlags,
  isLeftmostSection,
  canCreateSection,
  onCreateSection,
  onCloseSection,
  onClearSection,
  sectionName,
  onRenameSection,
  onFetchSwapCandidates,
  onSwapSection,
  onDeleteSection,
  unpinNoteFromSection,
  isNoteOpenInOtherSection,
}: EditorSectionProps) {
  // Local, not a prop: the scrollbar-slot DOM node lives entirely within
  // this section's own SectionEditorArea render, so each section needs its
  // own -- sharing one across instances would have every section but the
  // last-mounted one's custom scrollbar pointing at the wrong DOM node.
  const [scrollbarHostEl, setScrollbarHostEl] = useState<HTMLDivElement | null>(null)

  // Identity-tab UI state: renaming this section, editing the active note's
  // assigned id, and the right-click section-picker that takes over the tab
  // bar's pill area to offer a swap. Purely transient chrome, not section
  // content -- stays local rather than round-tripping to App.tsx.
  const [isEditingSectionName, setIsEditingSectionName] = useState(false)
  const [sectionNameDraft, setSectionNameDraft] = useState('')
  const [isEditingNoteId, setIsEditingNoteId] = useState(false)
  const [noteIdDraft, setNoteIdDraft] = useState('')
  const [isSectionPickerOpen, setIsSectionPickerOpen] = useState(false)
  const [swapCandidates, setSwapCandidates] = useState<{ id: string; name: string }[]>([])
  /** Right-click on a picker candidate pill arms it for deletion; a left-click while armed confirms. Anything else (mouse leaving, picking a different candidate) disarms it. */
  const [deletionPrimedSectionId, setDeletionPrimedSectionId] = useState<string | null>(null)

  const startRenamingSection = useCallback(() => {
    setSectionNameDraft(sectionName ?? '')
    setIsEditingSectionName(true)
  }, [sectionName])

  const commitSectionRename = useCallback(() => {
    setIsEditingSectionName(false)
    const trimmed = sectionNameDraft.trim()
    if (trimmed === (sectionName ?? '')) return
    onRenameSection(trimmed.length > 0 ? trimmed : null)
  }, [onRenameSection, sectionName, sectionNameDraft])

  const cancelSectionRename = useCallback(() => {
    setIsEditingSectionName(false)
  }, [])

  const openSectionPicker = useCallback(async () => {
    const candidates = await onFetchSwapCandidates()
    setSwapCandidates(candidates)
    setIsSectionPickerOpen(true)
  }, [onFetchSwapCandidates])

  const closeSectionPicker = useCallback(() => {
    setIsSectionPickerOpen(false)
    setDeletionPrimedSectionId(null)
  }, [])

  const handleSectionPickerCandidateContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, candidateId: string) => {
    event.preventDefault()
    setDeletionPrimedSectionId(candidateId)
  }, [])

  const handleSectionPickerCandidateMouseLeave = useCallback((candidateId: string) => {
    setDeletionPrimedSectionId((previous) => (previous === candidateId ? null : previous))
  }, [])

  // Dismiss the section picker on any click outside it -- a standard
  // click-away pattern, scoped to only run while it's actually open. The
  // picker itself lives inside the tab bar's own pill area now (not a
  // floating dropdown), so its own pills are excluded the same way the
  // identity button already is.
  useEffect(() => {
    if (!isSectionPickerOpen) return
    const handleWindowMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.tabbar-section-picker, .section-identity-tab')) {
        return
      }
      setIsSectionPickerOpen(false)
    }
    window.addEventListener('mousedown', handleWindowMouseDown)
    return () => window.removeEventListener('mousedown', handleWindowMouseDown)
  }, [isSectionPickerOpen])
  const { isPreviewMode: persistedIsPreviewMode, setIsPreviewMode } = useDisplayedNoteRenderMode(sectionId)
  // TOC/Open Items are synthetic, link-only notes -- raw markdown bracket
  // syntax looks broken in edit mode there, so they're hard-locked to render
  // view (no toggle at all), without touching the real per-section
  // isPreviewMode toggle: leaving a forced note reveals whatever mode the
  // user actually had it in.
  const [isForcedPreviewNote, setIsForcedPreviewNote] = useState(false)
  const isPreviewMode = isForcedPreviewNote || persistedIsPreviewMode
  const { activeNoteId, setActiveNoteId } = useActiveNoteId(sectionId)
  const {
    activeNoteText,
    setActiveNoteText,
    editorTextVersion,
    setEditorTextVersion,
    latestEditorTextRef,
  } = useDisplayedNoteText(sectionId)
  const { previewedSnapshotId, setPreviewedSnapshotId } = usePreviewedSnapshot(sectionId)
  /** See useEditorSectionMount's doc comment on this ref: distinguishes a hibernated live section from a genuine Time Machine browse, both of which drive previewedSnapshotId. */
  const isFrozenSectionPreviewRef = useRef(false)
  const { editorSelection, setEditorSelection, latestEditorSelectionRef } = useDisplayedNoteSelection(sectionId)
  // Moved ahead of useNoteChapters (which needs it to read the live
  // selection text for the extract-into-chapter action) from its original
  // spot further down, alongside the rest of useNoteSnapshotTimeline's
  // inputs -- kept here since it only depends on values already available
  // this early (activeNoteText/editorTextVersion/latestEditorTextRef).
  const currentEditorText = useMemo(() => {
    // latestEditorTextRef, once populated, is always already canonical (it's
    // set directly from ContractBridgePlugin's canonical event.text) -- only
    // the activeNoteText fallback (used before the ref is first populated,
    // e.g. right after a note switch) still needs normalizing here.
    const latest = latestEditorTextRef.current
    return latest ? latest : normalizeInternalText(activeNoteText)
    // editorTextVersion isn't read here -- it's a version counter bumped
    // alongside every latestEditorTextRef mutation, the only signal that
    // tells this memo to recompute (ref writes aren't reactive on their own).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteText, editorTextVersion, latestEditorTextRef])
  const [isCaretSuspended, setIsCaretSuspended] = useState(false)
  // Owned here so useNoteSaveQueue (which must be declared earlier) and
  // useEditorSectionMount share the same preview-block split cache.
  const previewBlockSplitCacheRef = useRef<PreviewBlockSplitCache | null>(null)
  const previewBlocksCacheRef = useRef<{ text: string; blocks: PreviewMarkdownBlock[] } | null>(null)
  // Mirrors activeNoteText into a ref so activateNote can read the latest
  // value without taking a reactive dependency that would recreate the
  // callback (and the SectionHandle that contains it) on every keystroke.
  const activeNoteTextRef = useRef(activeNoteText)
  useEffect(() => {
    activeNoteTextRef.current = activeNoteText
  }, [activeNoteText])

  // useNoteChapters (which owns refreshChapters) is declared further down
  // this function than useNoteSaveQueue needs it -- routed through a ref,
  // kept current by the effect right after useNoteChapters below, same
  // pattern as activeNoteTextRef above.
  const refreshChaptersRef = useRef<() => Promise<void>>(async () => {})
  // Stable identity (empty deps -- only ever reads the ref) so it doesn't
  // recreate useNoteSaveQueue's own memoized callbacks on every render; an
  // inline arrow here previously did exactly that, cascading into an
  // infinite render loop the moment any effect downstream depended on
  // flushPendingSaveNow's identity.
  const handleSaveCompleted = useCallback(() => {
    void refreshChaptersRef.current()
  }, [])
  const { queueSave, flushPendingSaveNow, cancelPendingSave } = useNoteSaveQueue({
    activeNoteId,
    persistenceReady,
    notesRef,
    latestEditorTextRef,
    previewBlockSplitCacheRef,
    setActiveNoteText,
    setNotes,
    onSaveCompleted: handleSaveCompleted,
  })

  const buildTextDecorationTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState, format: 'bold' | 'italic' | 'strikethrough') => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleCurrentLineHeadingTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleBulletedListTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleNumberedListTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const sectionContainerRef = useRef<HTMLDivElement | null>(null)
  const tabbarGridRef = useRef<HTMLElement | null>(null)
  /** See useEditorSectionMount's UseEditorSectionMountOptions doc comment -- written below, once useNoteSnapshotTimeline resolves the previewed snapshot's content. */
  const previewedSnapshotContentRef = useRef<string | null>(null)

  const {
    adapterRef,
    previewScrollRef,
    editModeSnapshotByNoteIdRef,
    pendingEditRestoreSnapshotRef,
    latestViewportRef,
    latestEditViewportRef,
    readCurrentEditUiPayload,
    updateEditModeSnapshotCache,
    captureEditModeSnapshotFromEditor,
    captureCurrentAnchorBlockIndex,
    scheduleFocusEditorInEditMode,
    applyEditRestoreSnapshot,
    bindings,
    toggleRenderViewMode,
    applyProgrammaticEditorText,
    ...editorSectionMountRest
  } = useEditorSectionMount({
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
    lineHeightPx: editorRuntimeMetrics.lineHeightPx,
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
    queueAppStateSave: queueAppStateSaveStable,
    updateActiveNoteTitlePreview: updateActiveNoteTitlePreviewStable,
    writeDebugEntry: writeDebugEntryStable,
    buildTextDecorationTransformRef,
    buildToggleCurrentLineHeadingTransformRef,
    buildToggleBulletedListTransformRef,
    buildToggleNumberedListTransformRef,
    sectionContainerRef,
    isFrozenSectionPreviewRef,
    previewedSnapshotContentRef,
    previewBlockSplitCacheRef,
    previewBlocksCacheRef,
  })

  const getActiveNoteLiveText = useCallback(() => (
    latestEditorTextRef.current || activeNoteText
  ), [activeNoteText, latestEditorTextRef])

  // A permanently-deleted note's id can never be loaded again, so any
  // per-note-id cache keyed on it (unlike the note-switch caches these
  // maps/sets otherwise exist for) is pure dead weight from this point on --
  // evicted here rather than left to accumulate for the rest of the app
  // session. externalNoteOriginalTextByIdRef/HashByIdRef already self-evict
  // in closeExternalNoteWithoutSaving; this covers the other permanent-
  // deletion paths (trash purge, chapter collapse/merge) that don't.
  const evictPermanentlyDeletedNoteCaches = useCallback((noteId: string) => {
    editModeSnapshotByNoteIdRef.current.delete(noteId)
    externalNoteOriginalTextByIdRef.current.delete(noteId)
    externalNoteOriginalHashByIdRef.current.delete(noteId)
  }, [editModeSnapshotByNoteIdRef, externalNoteOriginalTextByIdRef, externalNoteOriginalHashByIdRef])

  useSnapshotFreeze({
    sectionId,
    activeSectionId,
    noteId: activeNoteId,
    previewedSnapshotId,
    setPreviewedSnapshotId,
    getLiveText: getActiveNoteLiveText,
    flushPendingSaveNow,
    isNoteOpenInOtherSection,
    captureEditModeSnapshotFromEditor: (id) => { captureEditModeSnapshotFromEditor(id) },
    isFrozenSectionPreviewRef,
  })

  const activateNote = useCallback(async (noteId: string, overrideCursorPos?: number) => {
    if (!window.thockdownNotes) return

    const debugTiming = window.localStorage.getItem('thockdown:debug-input-lag') === '1'
    const logStep = (label: string, start: number) => {
      if (debugTiming) {
        console.log(`[activate-note-timing] ${label}: ${(performance.now() - start).toFixed(1)}ms`)
      }
    }
    const activateStart = performance.now()

    const previousNoteId = activeNoteId
    // Only an actual note switch needs the caret suspended -- the
    // note-activation effect (useEditorSectionMount.ts) deliberately skips
    // re-restoring when noteId hasn't changed ("Avoid re-restoring on plain
    // edit-mode re-renders or same-note updates"), so nothing would ever
    // clear the flag again for a same-note reactivation (e.g. tag
    // add/remove/rename re-calling activateNote(activeNoteId) to refresh
    // note metadata) -- leaving the caret permanently hidden until a real
    // note switch happens to clear it.
    if (previousNoteId !== noteId) {
      setIsCaretSuspended(true)
    }
    const persistOutStart = performance.now()
    if (persistenceReady && previousNoteId && previousNoteId !== noteId) {
      const anchorBlockIndex = captureCurrentAnchorBlockIndex()
      if (anchorBlockIndex !== null) {
        const cursorPos = readCurrentEditUiPayload()?.cursorPos
          ?? editModeSnapshotByNoteIdRef.current.get(previousNoteId)?.fullSelection.end
        const leavingText = normalizeInternalText(latestEditorTextRef.current || activeNoteTextRef.current)
        const previewBlockCache = previewBlockSplitCacheRef.current?.text === leavingText
          ? {
              v: 1,
              textHash: await hashNormalizedText(leavingText),
              ranges: previewBlockSplitCacheRef.current.ranges.map(({ type, rangeStartLine1, rangeEndLine1 }) => ({
                type,
                rangeStartLine1,
                rangeEndLine1,
              })),
            }
          : null
        const payload: { anchorBlockIndex: number; cursorPos?: number; previewBlockCache?: typeof previewBlockCache } = { anchorBlockIndex, previewBlockCache }
        if (cursorPos !== undefined) payload.cursorPos = cursorPos
        await window.thockdownNotes.saveNoteUiState({ id: previousNoteId, payload })
      }
    }
    logStep('persist outgoing UI state', persistOutStart)

    const loadStart = performance.now()
    const [loadedInitial, nextUiState] = await Promise.all([
      window.thockdownNotes.loadNote({ id: noteId }),
      window.thockdownNotes?.getNoteUiState({ id: noteId }) ?? Promise.resolve(null),
    ])
    let loaded = loadedInitial
    logStep('load note + UI state', loadStart)

    // Refreshes the auto-TOC chapter's own content the instant it's about to
    // be shown -- see noteLifecycleService.ts's regenerateAutoTocChapter doc
    // comment for why this is a "materialized view, refreshed on read"
    // rather than eagerly kept in sync in the background: zero cost while
    // it's not being looked at, always accurate the moment it is. Every way
    // of switching to a note funnels through this one function, so this is
    // the single choke point that needs to know about it, not each
    // individual navigation path (chapter-pill click, a link, session
    // restore, ...).
    //
    // Checked off `loaded` itself (a fresh DB read, via the loadNote call
    // just above), not the `notes` summaries array -- found live, not
    // assumed: a brand-new note's own summary isn't guaranteed to be in
    // `notes` yet at the moment some *other* in-flight callback's closure
    // reads it (refreshNotes()'s setNotes() call schedules a re-render, it
    // doesn't synchronously hand an already-running callback's own closure a
    // fresh `notes` to read) -- a `notes.find(...)` check here can silently
    // find nothing and skip regeneration entirely right after creation.
    // `loaded`/`chapterParentId` carry no such staleness --
    // they're both real DB reads.
    if (loaded.isAutoToc && loaded.chapterParentId && window.thockdownChapters) {
      await window.thockdownChapters.regenerateAutoTocChapter(loaded.chapterParentId)
      loaded = await window.thockdownNotes.loadNote({ id: noteId })
      // Edit mode shows raw markdown text -- `[Label]($noteId#anchor)` isn't
      // a real, clickable link there, only in the rendered preview pane (see
      // PreviewMarkdown.tsx). A read-only page that exists purely to be
      // clicked through would otherwise look broken (unclickable bracket
      // syntax) to anyone who happens to be in edit mode when they open it,
      // so force preview mode on entry. Not restored on the way back out --
      // same as every other view-mode change, it's just where you land, not
      // a special saved/restored state.
      setIsForcedPreviewNote(true)
    } else if (loaded.isAutoOpenItems) {
      // Same "its own links look broken as raw bracket syntax in edit mode"
      // reasoning as the auto-TOC branch above, minus the regenerate-on-read
      // step -- Open Items is patched incrementally on specific write-time
      // triggers (noteLifecycleService.ts's saveNote checklist-diff hook),
      // never rescanned just because it's being viewed.
      setIsForcedPreviewNote(true)
    } else {
      setIsForcedPreviewNote(false)

      // A real chapter's own live heading-level enforcement
      // (useHeadlineLevelGuard.ts's effect) only ever clamps an EXISTING
      // first-line heading -- it deliberately never synthesizes one, since
      // doing that on every keystroke would forcibly prepend boilerplate
      // the instant the user starts typing plain text as a chapter's first
      // line, before they've had a chance to type a heading at all. Missing
      // titles are instead backfilled once, right here, at the one choke
      // point every note activation already funnels through -- the same
      // `## Unnamed Chapter` insertion normalizeChapterHeadings applies at
      // chapter-creation time, just re-applied lazily for chapters that
      // predate that logic (or otherwise lost their first line) rather than
      // left permanently titleless.
      if (loaded.chapterOnly && loaded.chapterParentId && !parseMarkdownHeading(loaded.text.split('\n', 1)[0] ?? '')) {
        const normalizedText = normalizeChapterHeadings(loaded.text)
        await window.thockdownNotes.saveNote({ id: loaded.id, text: normalizedText })
        loaded = await window.thockdownNotes.loadNote({ id: noteId })
      }
    }

    const cacheRestoreStart = performance.now()
    const hydratedText = normalizeInternalText(loaded.text)
    if (nextUiState?.previewBlockCache && nextUiState.previewBlockCache.v === 1) {
      const textHash = await hashNormalizedText(hydratedText)
      const cacheHash = nextUiState.previewBlockCache.textHash
      const cacheRanges = nextUiState.previewBlockCache.ranges.length
      if (textHash === cacheHash) {
        previewBlockSplitCacheRef.current = restorePreviewBlockSplitCacheFromRanges(hydratedText, nextUiState.previewBlockCache.ranges)
        previewBlocksCacheRef.current = { text: hydratedText, blocks: previewBlockSplitCacheRef.current.blocks }
        if (window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
          console.log('[preview-block-cache] restored from DB cache', {
            noteId,
            textHash,
            blocks: previewBlocksCacheRef.current.blocks.length,
            ranges: cacheRanges,
          })
        }
      } else {
        previewBlockSplitCacheRef.current = null
        previewBlocksCacheRef.current = null
        if (window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
          console.log('[preview-block-cache] DB cache hash mismatch; will parse', {
            noteId,
            textHash,
            cacheHash,
            ranges: cacheRanges,
          })
        }
      }
    } else {
      previewBlockSplitCacheRef.current = null
      previewBlocksCacheRef.current = null
      if (window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
        console.log('[preview-block-cache] no DB cache found; will parse', {
          noteId,
          hasPreviewBlockCache: !!nextUiState?.previewBlockCache,
        })
      }
    }
    logStep('restore/clear preview block cache', cacheRestoreStart)

    const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
    const restoreSnapshotStart = performance.now()
    const cachedBlocks = previewBlocksCacheRef.current?.text === hydratedText
      ? previewBlocksCacheRef.current.blocks
      : undefined
    const preloadedSnapshot = buildEditRestoreSnapshotFromUiState({
      noteId,
      text: hydratedText,
      uiState: nextUiState,
      fallbackViewport,
      overrideCursorPos,
      previewBlocks: cachedBlocks,
    })
    logStep('build edit restore snapshot', restoreSnapshotStart)
    updateEditModeSnapshotCache(preloadedSnapshot)

    const externalStart = performance.now()
    let originalText: string | null = null
    let originalHash: string | null = null

    if (isExternalNote(loaded)) {
      const snapshotRows = await window.thockdownNotes?.getNoteSnapshots({ id: loaded.id }) ?? []
      const originalSnapshotRow = snapshotRows.find((row) => !row.isManual) ?? snapshotRows[0]

      originalText = originalSnapshotRow
        ? normalizeInternalText(originalSnapshotRow.content)
        : hydratedText

      console.warn('[external-note] activating external note', {
        noteId: loaded.id,
        snapshotCount: snapshotRows.length,
        hasOriginalSnapshot: !!originalSnapshotRow,
        hydratedLength: hydratedText.length,
        externalPath: loaded.externalPath,
      })

      if (!snapshotRows.some((row) => !row.isManual)) {
        await window.thockdownNotes?.saveNoteSnapshot({ id: loaded.id, content: hydratedText, isManual: false })
        console.warn('[external-note] created initial original snapshot for external note', { noteId: loaded.id, textLength: hydratedText.length })
      }

      externalNoteOriginalTextByIdRef.current.set(loaded.id, originalText)
      originalHash = await hashNormalizedText(originalText)
      externalNoteOriginalHashByIdRef.current.set(loaded.id, originalHash)
      activeNoteExternalPathRef.current = loaded.externalPath ?? null
      console.warn('[external-note] stored original hash for external note', {
        noteId: loaded.id,
        originalHash,
        externalPath: loaded.externalPath,
      })
    }
    logStep('external note setup', externalStart)

    const stateUpdateStart = performance.now()
    latestEditorTextRef.current = hydratedText
    pendingEditRestoreSnapshotRef.current = preloadedSnapshot
    setActiveNoteId(loaded.id)
    setActiveNoteText(hydratedText)
    pendingViewportRestoreRef.current = null
    await saveSelectedNoteState(loaded.id)
    logStep('state updates + save selected note', stateUpdateStart)
    logStep('total activateNote', activateStart)
    void window.thockdownSections?.setActiveNote(sectionId, loaded.id)
  }, [
    activeNoteId,
    captureCurrentAnchorBlockIndex,
    persistenceReady,
    saveSelectedNoteState,
    sectionId,
    updateEditModeSnapshotCache,
    activeNoteExternalPathRef,
    activeNoteTextRef,
    editModeSnapshotByNoteIdRef,
    externalNoteOriginalHashByIdRef,
    externalNoteOriginalTextByIdRef,
    latestEditViewportRef,
    latestEditorTextRef,
    latestViewportRef,
    pendingEditRestoreSnapshotRef,
    pendingViewportRestoreRef,
    readCurrentEditUiPayload,
    setActiveNoteId,
    setActiveNoteText,
    setIsForcedPreviewNote,
  ])

  // Unloads this section back to its brand-new-section empty state -- same
  // "no note loaded" state a freshly created section starts in, just applied
  // in place rather than by creating a new slot. Persists the outgoing
  // note's edit-ui state the same way activateNote does when switching notes.
  const clearActiveNote = useCallback(async () => {
    const previousNoteId = activeNoteId
    if (!previousNoteId) return

    setIsCaretSuspended(true)
    await flushPendingSaveNow()

    if (persistenceReady) {
      const anchorBlockIndex = captureCurrentAnchorBlockIndex()
      if (anchorBlockIndex !== null) {
        const cursorPos = readCurrentEditUiPayload()?.cursorPos
          ?? editModeSnapshotByNoteIdRef.current.get(previousNoteId)?.fullSelection.end
        await window.thockdownNotes?.saveNoteUiState({
          id: previousNoteId,
          payload: cursorPos === undefined ? { anchorBlockIndex } : { anchorBlockIndex, cursorPos },
        })
      }
    }

    latestEditorTextRef.current = ''
    pendingEditRestoreSnapshotRef.current = null
    setActiveNoteId(null)
    setActiveNoteText('')
    pendingViewportRestoreRef.current = null
    await saveSelectedNoteState(null)
    void window.thockdownSections?.setActiveNote(sectionId, null)
  }, [
    activeNoteId,
    captureCurrentAnchorBlockIndex,
    flushPendingSaveNow,
    persistenceReady,
    saveSelectedNoteState,
    sectionId,
    editModeSnapshotByNoteIdRef,
    latestEditorTextRef,
    pendingEditRestoreSnapshotRef,
    pendingViewportRestoreRef,
    readCurrentEditUiPayload,
    setActiveNoteId,
    setActiveNoteText,
  ])

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  // See sectionRegistry.ts's SectionHandle doc comment: the note identity
  // menu-facing code (sidebar highlight/reveal, tab bar pill highlighting +
  // pinning) should treat as active. Resolves to the active note's own
  // `chapterParentId` when it's a chapter -- a DB fact now (a chapter
  // belongs to exactly one parent, ever), not navigation state -- otherwise
  // falls back to the note's own identity. Chapters never appear in any menu
  // view themselves regardless.
  const menuIdentityNoteId = useMemo(() => {
    if (activeNoteSummary?.chapterOnly && activeNoteSummary.chapterParentId) {
      return activeNoteSummary.chapterParentId
    }
    return activeNoteId
  }, [activeNoteId, activeNoteSummary])

  const menuIdentityNoteSummary = useMemo(() => {
    if (!menuIdentityNoteId) return null
    if (menuIdentityNoteId === activeNoteId) return activeNoteSummary
    return notes.find((note) => note.id === menuIdentityNoteId) ?? null
  }, [menuIdentityNoteId, activeNoteId, activeNoteSummary, notes])

  const {
    tagInputRef,
    tagInputValue,
    setTagInputValue,
    orderedActiveTags,
    suggestedTags,
    deletePrimedTagName,
    renamingTagName,
    isTagMutationPending,
    activeNoteIsExternal,
    handleTagInputKeyDown,
    handleAddSuggestedTag,
    handleTagChipClick,
    handleTagChipMouseLeave,
    handleTagDragStart,
    handleTagDragEnd,
    handleTagDrop,
    handleTagContainerDragOver,
    handleTagContainerDrop,
    handleTagContextMenu,
    isSuggestedTagsExpanded,
    toggleSuggestedTagsExpanded,
    suggestedTagsScrollerRef,
    suggestedTagsCanScrollLeft,
    suggestedTagsCanScrollRight,
    updateSuggestedTagsScrollEdges,
    handleSuggestedTagsWheel,
    tabBarMode,
    toggleTabBarMode,
    setTabBarMode,
    pinnedTabs,
    unpinPrimedTabNoteId,
    activeNoteIsPinned,
    tempTabNoteId,
    pinArmingTabNoteId,
    tabsScrollerRef,
    tabsCanScrollLeft,
    tabsCanScrollRight,
    handleAddCurrentNoteToTabs,
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
    handleTempTabMouseDown,
    clearTempTabHoldTimer,
    updateTabsScrollEdges,
    handleTabsWheel,
    handleTabDragStart,
    handleTabDragEnd,
    handleTabDrop,
    handleTabsContainerDragOver,
    handleTabsContainerDrop,
    unpinNoteTab,
    pinNoteAsRightmostTab,
  }: UseSectionTabsResult = useSectionTabs({
    sectionId,
    activeNoteId,
    tabIdentityNoteId: menuIdentityNoteId,
    notes,
    persistenceReady,
    activateNote,
    clearActiveNote,
    revealNoteInMenu: revealNoteInMenuStable,
    flushPendingSaveNow,
    refreshNotes,
    noteTransitionLockRef,
    scheduleFocusEditorInEditMode,
    updateNoteAssignedId,
    initialTabBarMode: restoredTabBarMode,
  })

  const {
    chapters,
    refreshChapters,
    handleCreateChapter,
    handleChapterClick,
    handleCloneNoteAsChapter,
    handleExtractSelectionToChapter,
    handleCollapseChapterIntoPrevious,
    handleChapterForwardSplitOrMerge,
    handleChapterBackwardSplitOrMerge,
    onChapterDragStart,
    onChapterDragEnd,
    onChapterDrop,
    onChapterContainerDragOver,
    onChapterContainerDrop,
    onChapterPromoteDragOver,
    onChapterPromoteDrop,
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
  } = useNoteChapters({
    menuIdentityNoteId,
    activeNoteId,
    notes,
    persistenceReady,
    activateNote,
    refreshNotes,
    currentEditorText,
    editorSelection,
    applyProgrammaticEditorText,
    flushPendingSaveNow,
    onNotePermanentlyDeleted: evictPermanentlyDeletedNoteCaches,
  })

  useHeadlineLevelGuard({
    activeNoteId,
    notes,
    currentEditorText,
    editorSelection,
    applyProgrammaticEditorText,
  })

  useEffect(() => {
    refreshChaptersRef.current = refreshChapters
  }, [refreshChapters])

  // Clicking the chapter bar's parent tab returns to the parent's own
  // content. A no-op if it's already what's showing (matches handleTabClick's
  // own "second click doesn't reload" rule, though there's no reveal-in-menu
  // equivalent to fall back to here).
  const handleParentTabClick = useCallback(() => {
    if (!menuIdentityNoteId || menuIdentityNoteId === activeNoteId) return
    void activateNote(menuIdentityNoteId)
  }, [menuIdentityNoteId, activeNoteId, activateNote])

  // Fires whenever useMarkdownFormattingToolbar's applyAnchor sets a new
  // anchor -- records which note/chapter it lives in (as `$id`/`chapterId`
  // labels, matching the $noteid§chapterid#anchorid link syntax) so
  // "Insert Link" can prefill a working link to it later, from anywhere.
  // `$noteid` is always the *parent's* label (menuIdentityNoteSummary,
  // already resolved through chapterParentId when viewing a chapter);
  // `chapterId` is only non-empty when the anchor itself was set inside a
  // chapter, not the parent.
  const handleAnchorCreated = useCallback((anchorId: string) => {
    const isChapter = Boolean(activeNoteSummary?.chapterOnly)
    const noteId = (isChapter ? menuIdentityNoteSummary?.assignedId : activeNoteSummary?.assignedId) ?? ''
    const chapterId = isChapter ? (chapters.find((chapter) => chapter.chapterNoteId === activeNoteId)?.chapterId ?? '') : ''
    recordLastAnchor({ noteId, chapterId, anchorId })
  }, [activeNoteSummary, menuIdentityNoteSummary, chapters, activeNoteId, recordLastAnchor])

  useEffect(() => {
    tabBarModeRef.current = tabBarMode
  }, [tabBarMode, tabBarModeRef])

  // The tag bar is transient chrome, not a sticky preference -- but it must
  // survive clicks that pick a different note to tag (sidebar, a *different*
  // section's tab bar) so bulk-assigning a tag across several notes doesn't
  // require re-opening tag mode after every click. Only clicking into an
  // editor's own text -- i.e. actually going back to writing -- should drop
  // it back to the tab bar.
  useEffect(() => {
    if (tabBarMode !== 'tags') return
    const handleWindowMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof HTMLElement && target.closest('.editor-stage')) {
        setTabBarMode('tabs')
      }
    }
    window.addEventListener('mousedown', handleWindowMouseDown)
    return () => window.removeEventListener('mousedown', handleWindowMouseDown)
  }, [tabBarMode, setTabBarMode])

  const {
    primedNoteActionById,
    isTrashViewDeletePrimed,
    setIsTrashViewDeletePrimed,
    clearTrashButtonArmTimer,
    handleNoteRightPressStart,
    handleNoteRightPressEnd,
    handleNoteMouseLeave,
    handlePrimedNoteLeftClick,
    handleSaveButtonClick,
    handleCloseButtonClick,
    handleArchiveClick,
    handleTrashClick,
    purgeDeletedNotesPermanently,
    handleTrashViewButtonMouseDown,
    handleTrashViewButtonMouseUp,
    handleTrashViewButtonContextMenu,
  } = useNoteProtectionActions({
    notes,
    activeNoteId,
    activeNoteText,
    latestEditorTextRef,
    setNotes,
    setActiveNoteId,
    setActiveNoteText,
    activateNote,
    flushPendingSaveNow,
    cancelPendingSave,
    persistenceReady,
    refreshNotes,
    noteTransitionLockRef,
    sidebarMode,
    activeNoteExternalPathRef,
    externalNoteOriginalTextByIdRef,
    externalNoteOriginalHashByIdRef,
    setCurrentExternalNoteHash,
    onNotePermanentlyDeleted: evictPermanentlyDeletedNoteCaches,
  })

  const activeNoteHasDebugTag = useMemo(() => {
    return activeNoteSummary?.tags.some((tag) => tag.trim().toLowerCase() === 'debug') ?? false
  }, [activeNoteSummary])
  activeNoteHasDebugTagRef.current = activeNoteHasDebugTag

  const {
    noteSnapshots,
    timelineCurveConstant,
    setTimelineCurveConstant,
    setTimelineTrackLengthPx,
    isPreviewingSnapshot,
    editorDisplayText,
    renderedDisplayText,
    handleNavigateSnapshot,
    handleCreateManualSnapshot,
    handleMergeAdjacentSnapshots,
    handleReturnToPresent,
    handleBranchOpened,
    handleBranchError,
  } = useNoteSnapshotTimeline({
    activeNoteId,
    activeNoteText,
    currentEditorText,
    latestEditorTextRef,
    previewedSnapshotId,
    setPreviewedSnapshotId,
    captureEditModeSnapshotFromEditor,
    captureCurrentAnchorBlockIndex,
    flushPendingSaveNow,
    applyEditRestoreSnapshot,
    editModeSnapshotByNoteIdRef,
    refreshNotes,
    activateNote,
    isFrozenSectionPreviewRef,
  })

  // See useEditorSectionMount's UseEditorSectionMountOptions doc comment --
  // a plain render-time ref mutation (not an effect) so this hook's own
  // effects, which read it lazily when their callbacks fire, always see the
  // value that matches whatever `previewedSnapshotId` they're reacting to on
  // this same commit.
  previewedSnapshotContentRef.current = isPreviewingSnapshot ? editorDisplayText : null

  // Word count is now "establish once, track the delta" (WordCount.ts):
  // countWords is the full O(document length) scan, run only when there's
  // no usable previous count to track forward from (note switch, or the
  // very first computation); trackWordCount reuses that baseline and only
  // rescans the small window actually touched by the edit, regardless of
  // document size. Character count needs none of this -- `text.length` is
  // already O(1). This value only ever feeds a footer word/character count
  // display (SectionEditorArea.tsx), never editor state, selection, or save
  // logic, so the still-present 200ms debounce (now just pacing the display
  // refresh, not hiding an expensive computation) is about not thrashing the
  // footer's re-render during a fast typing burst, not about performance.
  const [activeNoteDocumentStats, setActiveNoteDocumentStats] = useState({ wordCount: 0, characterCount: 0 })
  const documentWordCountBaselineRef = useRef<{ noteId: string | null; text: string; wordCount: number } | null>(null)
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const hasSelection = !editorSelection.isCollapsed && editorSelection.end > editorSelection.start
      const selectionStart = Math.max(0, Math.min(currentEditorText.length, editorSelection.start))
      const selectionEnd = Math.max(selectionStart, Math.min(currentEditorText.length, editorSelection.end))

      if (hasSelection) {
        // Bounded by the selection's own size, not the document's -- no
        // baseline to track against (the selection can jump anywhere), and
        // a full scan of a user-selected range is never the O(document)
        // per-keystroke cost this was built to eliminate.
        const text = currentEditorText.slice(selectionStart, selectionEnd)
        setActiveNoteDocumentStats({ wordCount: countWords(text), characterCount: text.length })
        return
      }

      const baseline = documentWordCountBaselineRef.current
      const wordCount = baseline && baseline.noteId === activeNoteId
        ? trackWordCount(baseline.text, baseline.wordCount, currentEditorText)
        : countWords(currentEditorText)
      documentWordCountBaselineRef.current = { noteId: activeNoteId, text: currentEditorText, wordCount }

      setActiveNoteDocumentStats({ wordCount, characterCount: currentEditorText.length })
    }, 200)
    return () => window.clearTimeout(timeoutId)
  }, [activeNoteId, currentEditorText, editorSelection.end, editorSelection.isCollapsed, editorSelection.start])

  const {
    documentFindQuery,
    setDocumentFindQuery,
    documentReplaceQuery,
    setDocumentReplaceQuery,
    isDocumentReplaceMode,
    setIsDocumentReplaceMode,
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
    effectiveCaseSensitive,
    preserveCase,
    documentFindDirective,
    documentFindHits,
  } = useDocumentFind({
    sectionId,
    sourceText: currentEditorText,
    initialCaseSensitive: restoredDocumentFindCaseSensitive,
  })

  useEffect(() => {
    documentFindCaseSensitiveRef.current = isDocumentFindCaseSensitive
  }, [isDocumentFindCaseSensitive, documentFindCaseSensitiveRef])

  const { previewMarkdownElement } = usePreviewMarkdownRendering({
    notes,
    activeNoteId,
    activeNoteText,
    latestEditorTextRef,
    activateNote,
    previewScrollRef,
    documentFindDirective,
    isDocumentFindCaseSensitive: effectiveCaseSensitive,
    renderedDisplayText,
    previewScrollToSourceLineRef: editorSectionMountRest.previewScrollToSourceLineRef,
    previewBlockSplitCacheRef,
  })

  const {
    previewTextureRef,
    previewScrollbarTrackRef,
    previewScrollbarThumbRef,
    isPreviewScrollThumbActive,
    isDraggingPreviewScrollThumb,
    syncPreviewCustomScrollbar,
    handlePreviewTrackMouseDown,
    handlePreviewTrackContextMenu,
    handlePreviewThumbMouseDown,
    handlePreviewScroll,
    blockPreviewEditMutation,
  } = usePreviewScrollbar({
    isPreviewMode,
    isPreviewScrollInteractionBlocked: editorSectionMountRest.isPreviewScrollInteractionBlocked,
    previewScrollRef,
    activeNoteId,
    currentEditorText,
    viewStyle,
    viewFontSize,
    viewSpacing,
    viewLetterSpacingEm,
  })

  const {
    handleJumpToDocumentFindHit,
    replaceDocumentFindHit,
    replaceAllDocumentFindHits,
  } = useDocumentFindNavigation({
    previewScrollRef,
    documentFindDirective,
    documentFindHits,
    effectiveCaseSensitive,
    preserveCase,
    currentEditorText,
    syncPreviewCustomScrollbar,
    isPreviewMode,
    adapterRef,
    latestEditorTextRef,
    activeNoteText,
    documentFindQuery,
    documentReplaceQuery,
    isDocumentReplaceMode,
    applyProgrammaticEditorText,
  })

  // Same exemption useHeadlineLevelGuard.ts's own effect applies (the guard
  // this rule has to stay in lockstep with -- see
  // UseMarkdownFormattingToolbarOptions' headlineRule doc comment for why):
  // an external note's structure isn't this app's to enforce, and the
  // auto-TOC/auto-Open-Items synthetic chapters are generated, read-only
  // output this toolbar never actually reaches.
  const activeHeadlineRule = useMemo(() => {
    if (!activeNoteSummary) return null
    if (activeNoteSummary.isAutoToc || activeNoteSummary.isAutoOpenItems || isExternalNote(activeNoteSummary)) return null
    return activeNoteSummary.chapterOnly ? CHAPTER_HEADLINE_LEVEL_RULE : NOTE_HEADLINE_LEVEL_RULE
  }, [activeNoteSummary])

  const {
    activeDecorationFormats,
    activeHeadingLevel,
    isChecklistActive,
    isBulletedListActive,
    isNumberedListActive,
    isBlockquoteActive,
    isCodeBlockActive,
    isInlineCodeActive,
    isTableOfContentsActive,
    applyTextDecoration,
    applyHeading,
    toggleCurrentLineHeading,
    toggleBulletedList,
    toggleNumberedList,
    toggleChecklistList,
    toggleBlockquote,
    applyLink,
    applyAnchor,
    applyInlineCode,
    applyCodeBlock,
    insertHorizontalRule,
    insertTableOfContents,
    toggleTableOfContents,
  } = useMarkdownFormattingToolbar({
    activeNoteId,
    currentEditorText,
    editorSelection,
    latestEditorTextRef,
    latestEditorSelectionRef,
    applyProgrammaticEditorText,
    buildTextDecorationTransformRef,
    buildToggleCurrentLineHeadingTransformRef,
    buildToggleBulletedListTransformRef,
    buildToggleNumberedListTransformRef,
    getLinkTargetPrefill,
    onAnchorCreated: handleAnchorCreated,
    headlineRule: activeHeadlineRule,
  })

  const currentSectionHandle: SectionHandle = {
    ...editorSectionMountRest,
    queueSave,
    flushPendingSaveNow,
    cancelPendingSave,
    tagInputRef,
    tagInputValue,
    setTagInputValue,
    orderedActiveTags,
    suggestedTags,
    deletePrimedTagName,
    renamingTagName,
    isTagMutationPending,
    activeNoteIsExternal,
    handleTagInputKeyDown,
    handleAddSuggestedTag,
    handleTagChipClick,
    handleTagChipMouseLeave,
    handleTagDragStart,
    handleTagDragEnd,
    handleTagDrop,
    handleTagContainerDragOver,
    handleTagContainerDrop,
    handleTagContextMenu,
    isSuggestedTagsExpanded,
    toggleSuggestedTagsExpanded,
    suggestedTagsScrollerRef,
    suggestedTagsCanScrollLeft,
    suggestedTagsCanScrollRight,
    updateSuggestedTagsScrollEdges,
    handleSuggestedTagsWheel,
    tabBarMode,
    toggleTabBarMode,
    setTabBarMode,
    pinnedTabs,
    unpinPrimedTabNoteId,
    activeNoteIsPinned,
    tempTabNoteId,
    pinArmingTabNoteId,
    tabsScrollerRef,
    tabsCanScrollLeft,
    tabsCanScrollRight,
    handleAddCurrentNoteToTabs,
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
    handleTempTabMouseDown,
    clearTempTabHoldTimer,
    updateTabsScrollEdges,
    handleTabsWheel,
    handleTabDragStart,
    handleTabDragEnd,
    handleTabDrop,
    handleTabsContainerDragOver,
    handleTabsContainerDrop,
    unpinNoteTab,
    pinNoteAsRightmostTab,
    chapters,
    refreshChapters,
    handleCreateChapter,
    handleChapterClick,
    handleCloneNoteAsChapter,
    handleExtractSelectionToChapter,
    handleCollapseChapterIntoPrevious,
    handleChapterForwardSplitOrMerge,
    handleChapterBackwardSplitOrMerge,
    onChapterDragStart,
    onChapterDragEnd,
    onChapterDrop,
    onChapterContainerDragOver,
    onChapterContainerDrop,
    onChapterPromoteDragOver,
    onChapterPromoteDrop,
    editingChapterNoteId,
    chapterIdDraft,
    setChapterIdDraft,
    startEditingChapterId,
    commitChapterIdEdit,
    cancelChapterIdEdit,
    adapterRef,
    previewScrollRef,
    editModeSnapshotByNoteIdRef,
    pendingEditRestoreSnapshotRef,
    latestViewportRef,
    latestEditViewportRef,
    previewBlockSplitCacheRef,
    previewBlocksCacheRef,
    readCurrentEditUiPayload,
    updateEditModeSnapshotCache,
    captureEditModeSnapshotFromEditor,
    captureCurrentAnchorBlockIndex,
    scheduleFocusEditorInEditMode,
    applyEditRestoreSnapshot,
    bindings,
    toggleRenderViewMode,
    applyProgrammaticEditorText,
    sectionId,
    activeNoteId,
    setActiveNoteId,
    activeNoteText,
    currentEditorText,
    latestEditorTextRef,
    activeNoteSummary,
    menuIdentityNoteId,
    menuIdentityNoteSummary,
    editorSelection,
    previewedSnapshotId,
    isPreviewMode,
    setIsPreviewMode,
    isForcedPreviewNote,
    activateNote,
    activeDecorationFormats,
    activeHeadingLevel,
    isChecklistActive,
    isBulletedListActive,
    isNumberedListActive,
    isBlockquoteActive,
    isCodeBlockActive,
    isInlineCodeActive,
    isTableOfContentsActive,
    applyTextDecoration,
    applyHeading,
    toggleCurrentLineHeading,
    toggleBulletedList,
    toggleNumberedList,
    toggleChecklistList,
    toggleBlockquote,
    applyLink,
    applyAnchor,
    applyInlineCode,
    applyCodeBlock,
    insertHorizontalRule,
    insertTableOfContents,
    toggleTableOfContents,
    primedNoteActionById,
    isTrashViewDeletePrimed,
    setIsTrashViewDeletePrimed,
    clearTrashButtonArmTimer,
    handleNoteRightPressStart,
    handleNoteRightPressEnd,
    handleNoteMouseLeave,
    handlePrimedNoteLeftClick,
    handleSaveButtonClick,
    handleCloseButtonClick,
    handleArchiveClick,
    handleTrashClick,
    purgeDeletedNotesPermanently,
    handleTrashViewButtonMouseDown,
    handleTrashViewButtonMouseUp,
    handleTrashViewButtonContextMenu,
    documentFindQuery,
    setDocumentFindQuery,
    documentReplaceQuery,
    setDocumentReplaceQuery,
    isDocumentReplaceMode,
    setIsDocumentReplaceMode,
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
    effectiveCaseSensitive,
    preserveCase,
    documentFindDirective,
    documentFindHits,
    handleJumpToDocumentFindHit,
    replaceDocumentFindHit,
    replaceAllDocumentFindHits,
  }

  // Section-wide drop target: a tab dragged in from another section, or a
  // note dragged from the sidebar, lands anywhere on this section (not just
  // its tab bar) and becomes its new rightmost tab.
  //
  // Runs in the *capture* phase (top-down, before the event reaches
  // whatever's actually under the pointer) rather than the usual bubble
  // phase. The editor content is a contentEditable region (CodeMirror
  // internally, or the render-mode preview), and contentEditable elements
  // get their own native/library drag-and-drop handling for text -- which,
  // for a payload type it doesn't recognize, may swallow the drop outright
  // before it can bubble back up here. Capturing lets us claim the event on
  // the way down, before any of that runs. (dragover acceptance/cursor is
  // handled separately, globally, in App.tsx -- purely cosmetic and not
  // tied to any one section.)
  //
  // An in-bar reorder (same sectionId as the drag's source) needs to reach
  // the more specific, index-aware pill/container bubble handlers in
  // useSectionTabs instead, so this only claims (and stops) drops that are
  // actually headed somewhere else -- a different section's tab, or a
  // sidebar note.
  const handleSectionDropCapture = useCallback((event: DragEvent<HTMLDivElement>) => {
    const raw = event.dataTransfer.getData(NOTE_DRAG_MIME_TYPE)
    if (!raw) return
    const payload = parseNoteDragPayload(raw)
    if (!payload) return

    // A drop landing on the chapter bar always means "clone this note's
    // content into a new chapter of whichever note it's showing chapters
    // of" -- regardless of where the drag started (sidebar or a tab, even
    // one of this section's own), since that's a structurally different
    // drop target than "open/pin this as a tab." Claimed before the
    // same-section check below, which exists only to let an in-bar *tab*
    // reorder drag fall through to useSectionTabs's own handlers --
    // irrelevant here. Dropping directly on an existing chapter pill inserts
    // the new chapter right in front of it instead of appending it last.
    // (The "+" add-chapter button used to be part of this drop target too,
    // but it now lives in the global toolbar, outside this section's DOM
    // subtree, so it can no longer receive these drops.)
    const dropTarget = event.target
    if (dropTarget instanceof Element && dropTarget.closest('.chapter-bar-display')) {
      event.preventDefault()
      event.stopPropagation()
      const targetPill = dropTarget.closest<HTMLElement>('.chapter-pill[data-chapter-note-id]')
      void handleCloneNoteAsChapter(payload.noteId, targetPill?.dataset.chapterNoteId)
      return
    }

    if (payload.sourceSectionId === sectionId) return

    event.preventDefault()
    event.stopPropagation()

    // A sidebar-origin drop also loads the note into this section's editor
    // -- unlike a tab dragged in from another section, there's no tab to
    // switch away from, so nothing else should happen there. If it's
    // already pinned here, this is just a shortcut to switch to it, not a
    // request to re-pin/reorder it.
    if (payload.sourceSectionId === null) {
      if (pinnedTabs.some((tab) => tab.noteId === payload.noteId)) {
        void activateNote(payload.noteId)
      } else {
        void pinNoteAsRightmostTab(payload.noteId).then(() => activateNote(payload.noteId))
      }
      return
    }

    void pinNoteAsRightmostTab(payload.noteId)
    unpinNoteFromSection(payload.sourceSectionId, payload.noteId)
  }, [activateNote, pinNoteAsRightmostTab, pinnedTabs, sectionId, unpinNoteFromSection, handleCloneNoteAsChapter])

  // Plain assignment (not an effect) -- safe, it's just a ref mutation. Powers
  // imperative, non-reactive registry lookups (getActiveSectionHandle()).
  registerSectionHandle(sectionId, currentSectionHandle)

  // Reactive counterpart: tells App.tsx (the parent) about this section's
  // latest state via an effect, since a child's own state changes don't
  // automatically re-render its parent (or the parent's other children,
  // like the global EditorToolbar). See App.tsx's reportSectionHandle for
  // the shallow-equality guard that keeps this from looping.
  useEffect(() => {
    reportSectionHandle(sectionId, currentSectionHandle)
  })

  // The identity button's meaning depends on which bar is showing: in
  // tab-bar mode it's the section id, left-click opens the section-picker
  // (this slot's swap targets, rendered into the tab bar's own pill area);
  // in tag-bar mode it's the active note's assigned id, left-click toggles
  // the suggested-tags-expanded view. The tag/tab bar mode switch itself now
  // lives on its own dedicated button (see the tags-toggle button), freeing
  // up the identity button's left-click for both of these. Right-click still
  // depends on which bar is showing: assign the active note's id in tag-bar
  // mode, or rename this section in tab-bar mode.
  const startEditingNoteId = useCallback(() => {
    setNoteIdDraft(activeNoteSummary?.assignedId ?? '')
    setIsEditingNoteId(true)
  }, [activeNoteSummary])

  const commitNoteIdEdit = useCallback(() => {
    setIsEditingNoteId(false)
    const trimmed = noteIdDraft.trim()
    if (!activeNoteId || !window.thockdownNotes) return
    if (trimmed === (activeNoteSummary?.assignedId ?? '')) return
    const noteId = activeNoteId
    void (async () => {
      try {
        const updated = await window.thockdownNotes!.setNoteAssignedId({ id: noteId, requestedId: trimmed })
        if (updated?.assignedId) {
          updateNoteAssignedId(noteId, updated.assignedId)
        }
      } catch (error) {
        console.error('Failed to set note internal ID', error)
      }
    })()
  }, [activeNoteId, activeNoteSummary, noteIdDraft, updateNoteAssignedId])

  const cancelNoteIdEdit = useCallback(() => {
    setIsEditingNoteId(false)
  }, [])

  const handleIdentityClick = useCallback(() => {
    if (tabBarMode === 'tabs') {
      if (isSectionPickerOpen) {
        closeSectionPicker()
      } else {
        void openSectionPicker()
      }
      return
    }
    toggleSuggestedTagsExpanded()
  }, [tabBarMode, isSectionPickerOpen, closeSectionPicker, openSectionPicker, toggleSuggestedTagsExpanded])

  const handleIdentityContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (tabBarMode === 'tabs') {
      startRenamingSection()
    } else {
      startEditingNoteId()
    }
  }, [tabBarMode, startRenamingSection, startEditingNoteId])

  const handleSectionPickerCandidateClick = useCallback((candidateId: string) => {
    if (deletionPrimedSectionId === candidateId) {
      closeSectionPicker()
      onDeleteSection(candidateId)
      return
    }
    closeSectionPicker()
    onSwapSection(candidateId)
  }, [deletionPrimedSectionId, closeSectionPicker, onDeleteSection, onSwapSection])

  const handleSectionPickerClearClick = useCallback(() => {
    closeSectionPicker()
    onClearSection()
  }, [closeSectionPicker, onClearSection])

  return (
    <div
      className={`editor-section-column${sectionId === activeSectionId ? ' is-active' : ''}`}
      data-section-id={sectionId}
      onDropCapture={handleSectionDropCapture}
      onFocusCapture={() => markSectionActive(sectionId)}
      onMouseDownCapture={() => markSectionActive(sectionId)}
      onKeyDownCapture={() => markSectionActive(sectionId)}
    >
      <SectionTabBar
        tabbarGridRef={tabbarGridRef}
        tabs={{
          tagInputRef,
          tagInputValue,
          setTagInputValue,
          orderedActiveTags,
          suggestedTags,
          deletePrimedTagName,
          renamingTagName,
          isTagMutationPending,
          activeNoteIsExternal,
          handleTagInputKeyDown,
          handleAddSuggestedTag,
          handleTagChipClick,
          handleTagChipMouseLeave,
          handleTagDragStart,
          handleTagDragEnd,
          handleTagDrop,
          handleTagContainerDragOver,
          handleTagContainerDrop,
          handleTagContextMenu,
          isSuggestedTagsExpanded,
          toggleSuggestedTagsExpanded,
          suggestedTagsScrollerRef,
          suggestedTagsCanScrollLeft,
          suggestedTagsCanScrollRight,
          updateSuggestedTagsScrollEdges,
          handleSuggestedTagsWheel,
          tabBarMode,
          toggleTabBarMode,
          setTabBarMode,
          pinnedTabs,
          unpinPrimedTabNoteId,
          activeNoteIsPinned,
          tempTabNoteId,
          pinArmingTabNoteId,
          tabsScrollerRef,
          tabsCanScrollLeft,
          tabsCanScrollRight,
          handleAddCurrentNoteToTabs,
          handleTabContextMenu,
          handleTabMouseLeave,
          handleTabClick,
          handleTempTabMouseDown,
          clearTempTabHoldTimer,
          updateTabsScrollEdges,
          handleTabsWheel,
          handleTabDragStart,
          handleTabDragEnd,
          handleTabDrop,
          handleTabsContainerDragOver,
          handleTabsContainerDrop,
          unpinNoteTab,
          pinNoteAsRightmostTab,
        }}
        isSidebarVisible={isSidebarVisible}
        toggleSidebarVisible={toggleSidebarVisible}
        persistenceReady={persistenceReady}
        activeNoteId={activeNoteId}
        tabIdentityNoteId={menuIdentityNoteId}
        notes={notes}
        activeNoteSummary={activeNoteSummary}
        isLeftmostSection={isLeftmostSection}
        canCreateSection={canCreateSection}
        onCreateSection={onCreateSection}
        onCloseSection={onCloseSection}
        sectionName={sectionName}
        isEditingSectionName={isEditingSectionName}
        sectionNameDraft={sectionNameDraft}
        setSectionNameDraft={setSectionNameDraft}
        onCommitSectionRename={commitSectionRename}
        onCancelSectionRename={cancelSectionRename}
        isEditingNoteId={isEditingNoteId}
        noteIdDraft={noteIdDraft}
        setNoteIdDraft={setNoteIdDraft}
        onCommitNoteIdEdit={commitNoteIdEdit}
        onCancelNoteIdEdit={cancelNoteIdEdit}
        onIdentityClick={handleIdentityClick}
        onIdentityContextMenu={handleIdentityContextMenu}
        isSectionPickerOpen={isSectionPickerOpen}
        swapCandidates={swapCandidates}
        onSectionPickerCandidateClick={handleSectionPickerCandidateClick}
        deletionPrimedSectionId={deletionPrimedSectionId}
        onSectionPickerCandidateContextMenu={handleSectionPickerCandidateContextMenu}
        onSectionPickerCandidateMouseLeave={handleSectionPickerCandidateMouseLeave}
        onSectionPickerClearClick={handleSectionPickerClearClick}
      />

      <SectionEditorArea
        sectionId={sectionId}
        isSectionActive={sectionId === activeSectionId}
        isPreviewMode={isPreviewMode}
        editorStageRef={editorStageRef}
        sectionContainerRef={sectionContainerRef}
        previewedSnapshotId={previewedSnapshotId}
        bindings={bindings}
        adapterRef={adapterRef}
        activeNoteId={activeNoteId}
        editorDisplayText={editorDisplayText}
        scrollbarHostEl={scrollbarHostEl}
        setScrollbarHostEl={setScrollbarHostEl}
        editorFontFamily={editorFontFamily}
        editorRuntimeMetrics={editorRuntimeMetrics}
        editorFontLoadVersion={editorFontLoadVersion}
        activeNoteHasDebugTag={activeNoteHasDebugTag}
        isPreviewingSnapshot={isPreviewingSnapshot}
        isCaretSuspended={isCaretSuspended}
        spellCheckEditEnabled={spellCheckEditEnabled}
        previewTextureRef={previewTextureRef}
        previewScrollRef={previewScrollRef}
        handlePreviewScroll={handlePreviewScroll}
        viewStyle={viewStyle}
        viewFontSize={viewFontSize}
        viewSpacing={viewSpacing}
        viewLetterSpacingEm={viewLetterSpacingEm}
        highlightSearchColor={highlightSearchColor}
        showLineNumbers={showLineNumbers}
        showReviewFlags={showReviewFlags}
        onToggleReviewGutter={onToggleReviewGutter}
        onToggleReviewFlags={onToggleReviewFlags}
        spellCheckRenderEnabled={spellCheckRenderEnabled}
        blockPreviewEditMutation={blockPreviewEditMutation}
        previewMarkdownElement={previewMarkdownElement}
        previewScrollbarTrackRef={previewScrollbarTrackRef}
        handlePreviewTrackMouseDown={handlePreviewTrackMouseDown}
        handlePreviewTrackContextMenu={handlePreviewTrackContextMenu}
        previewScrollbarThumbRef={previewScrollbarThumbRef}
        isDraggingPreviewScrollThumb={isDraggingPreviewScrollThumb}
        isPreviewScrollThumbActive={isPreviewScrollThumbActive}
        handlePreviewThumbMouseDown={handlePreviewThumbMouseDown}
        activeNoteDocumentStats={activeNoteDocumentStats}
        noteSnapshots={noteSnapshots}
        handleNavigateSnapshot={handleNavigateSnapshot}
        handleBranchOpened={handleBranchOpened}
        handleBranchError={handleBranchError}
        timelineCurveConstant={timelineCurveConstant}
        setTimelineCurveConstant={setTimelineCurveConstant}
        setTimelineTrackLengthPx={setTimelineTrackLengthPx}
        handleCreateManualSnapshot={handleCreateManualSnapshot}
        handleReturnToPresent={handleReturnToPresent}
        handleMergeAdjacentSnapshots={handleMergeAdjacentSnapshots}
        notes={notes}
        menuIdentityNoteId={menuIdentityNoteId}
        chapters={chapters}
        onParentTabClick={handleParentTabClick}
        onChapterClick={handleChapterClick}
        onChapterDragStart={onChapterDragStart}
        onChapterDragEnd={onChapterDragEnd}
        onChapterDrop={onChapterDrop}
        onChapterContainerDragOver={onChapterContainerDragOver}
        onChapterContainerDrop={onChapterContainerDrop}
        onChapterPromoteDragOver={onChapterPromoteDragOver}
        onChapterPromoteDrop={onChapterPromoteDrop}
        editingChapterNoteId={editingChapterNoteId}
        chapterIdDraft={chapterIdDraft}
        setChapterIdDraft={setChapterIdDraft}
        onStartEditingChapterId={startEditingChapterId}
        onCommitChapterIdEdit={commitChapterIdEdit}
        onCancelChapterIdEdit={cancelChapterIdEdit}
        onCollapseChapterIntoPrevious={handleCollapseChapterIntoPrevious}
        onExtractSelectionToChapter={handleExtractSelectionToChapter}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent, MouseEvent, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote } from '../shared/noteLifecycle'
import type { PersistedViewportState } from '../shared/appState'
import { NOTE_DRAG_MIME_TYPE, parseNoteDragPayload } from '../shared/noteDrag'
import { normalizeInternalText } from '../editor/TextPolicy'
import { buildEditRestoreSnapshotFromUiState, scrollTopLinesToPx } from '../editor/EditRestoreMath'
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
import { useNoteProtectionActions } from './useNoteProtectionActions'
import { useNoteSnapshotTimeline } from './useNoteSnapshotTimeline'
import { useDocumentFind } from '../find/useDocumentFind'
import { usePreviewMarkdownRendering } from './usePreviewMarkdownRendering'
import { usePreviewScrollbar } from './usePreviewScrollbar'
import { useDocumentFindNavigation } from './useDocumentFindNavigation'
import { useMarkdownFormattingToolbar } from './useMarkdownFormattingToolbar'
import type { SectionHandle } from './sectionRegistry'

async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type NoteTreeGroup = {
  secondary: Array<{
    tertiary: Array<{
      notes: NoteSummary[]
    }>
  }>
}

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
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'

export interface EditorSectionProps extends Omit<SectionEditorAreaProps,
  'sectionId' | 'markSectionActive' | 'activeNoteId' | 'isPreviewMode' | 'previewedSnapshotId' | 'bindings' | 'adapterRef' | 'sectionContainerRef'
  | 'editorDisplayText' | 'activeNoteHasDebugTag' | 'isPreviewingSnapshot' | 'isCaretSuspended' | 'previewTextureRef'
  | 'previewScrollRef' | 'handlePreviewScroll' | 'blockPreviewEditMutation' | 'previewMarkdownElement'
  | 'previewScrollbarTrackRef' | 'handlePreviewTrackMouseDown' | 'previewScrollbarThumbRef' | 'isDraggingPreviewScrollThumb'
  | 'isPreviewScrollThumbActive' | 'handlePreviewThumbMouseDown' | 'activeNoteDocumentStats' | 'noteSnapshots'
  | 'handleNavigateSnapshot' | 'handleBranchOpened' | 'handleBranchError' | 'timelineCurveConstant' | 'setTimelineCurveConstant'
  | 'setTimelineTrackLengthPx' | 'handleCreateManualSnapshot' | 'handleReturnToPresent' | 'handleMergeAdjacentSnapshots'
  | 'scrollbarHostEl' | 'setScrollbarHostEl'> {
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
  currentExternalNoteHash: string | null
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
  restoredTabBarMode: 'tags' | 'tabs' | null
  tabBarModeRef: MutableRefObject<'tags' | 'tabs'>

  sidebarMode: 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options'
  dateFilteredNotesRef: MutableRefObject<NoteSummary[]>
  trashFilteredNotesRef: MutableRefObject<NoteSummary[]>
  categoryTreeRef: MutableRefObject<NoteTreeGroup[]>
  archiveTreeRef: MutableRefObject<NoteTreeGroup[]>

  restoredDocumentFindCaseSensitive: boolean | null
  documentFindCaseSensitiveRef: MutableRefObject<boolean>

  editorRuntimeMetrics: EditorRuntimeMetrics
  viewStyle: ViewStyleKey
  viewFontSize: ViewSizeKey
  viewSpacing: ViewSpacingKey

  isLeftmostSection: boolean
  canCreateSection: boolean
  onCreateSection: () => void
  onCloseSection: () => void

  sectionName: string | null
  onRenameSection: (name: string | null) => void
  onFetchSwapCandidates: () => Promise<{ id: string; name: string }[]>
  onSwapSection: (incomingSectionId: string) => void

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
  currentExternalNoteHash,
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
  restoredTabBarMode,
  tabBarModeRef,
  sidebarMode,
  dateFilteredNotesRef,
  trashFilteredNotesRef,
  categoryTreeRef,
  archiveTreeRef,
  restoredDocumentFindCaseSensitive,
  documentFindCaseSensitiveRef,
  editorRuntimeMetrics,
  viewStyle,
  viewFontSize,
  viewSpacing,
  editorStageRef,
  editorFontFamily,
  editorFontLoadVersion,
  spellCheckEditEnabled,
  spellCheckRenderEnabled,
  highlightSearchColor,
  isLeftmostSection,
  canCreateSection,
  onCreateSection,
  onCloseSection,
  sectionName,
  onRenameSection,
  onFetchSwapCandidates,
  onSwapSection,
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
  const { isPreviewMode, setIsPreviewMode } = useDisplayedNoteRenderMode(sectionId)
  const { activeNoteId, setActiveNoteId } = useActiveNoteId(sectionId)
  const {
    activeNoteText,
    setActiveNoteText,
    editorTextVersion,
    setEditorTextVersion,
    latestEditorTextRef,
  } = useDisplayedNoteText(sectionId)
  const { previewedSnapshotId, setPreviewedSnapshotId } = usePreviewedSnapshot(sectionId)
  const { editorSelection, setEditorSelection, latestEditorSelectionRef } = useDisplayedNoteSelection(sectionId)
  const [isCaretSuspended, setIsCaretSuspended] = useState(false)

  const { queueSave, flushPendingSaveNow, cancelPendingSave } = useNoteSaveQueue({
    activeNoteId,
    persistenceReady,
    notesRef,
    latestEditorTextRef,
    setActiveNoteText,
    setNotes,
  })

  const buildTextDecorationTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState, format: 'bold' | 'italic' | 'strikethrough') => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleCurrentLineHeadingTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleBulletedListTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const buildToggleNumberedListTransformRef = useRef<(text: string, selection: import('../editor/EditorContract').EditorSelectionState) => { text: string; selection: import('../editor/EditorContract').EditorSelectionState } | null>(() => null)
  const sectionContainerRef = useRef<HTMLDivElement | null>(null)
  const tabbarGridRef = useRef<HTMLElement | null>(null)

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
    persistEditUiPayloadForNote,
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
  })

  const getActiveNoteLiveText = useCallback(() => (
    latestEditorTextRef.current || activeNoteText
  ), [activeNoteText, latestEditorTextRef])

  useSnapshotFreeze({
    sectionId,
    activeSectionId,
    noteId: activeNoteId,
    previewedSnapshotId,
    setPreviewedSnapshotId,
    getLiveText: getActiveNoteLiveText,
    flushPendingSaveNow,
    isNoteOpenInOtherSection,
  })

  const activateNote = useCallback(async (noteId: string, overrideCursorPos?: number) => {
    if (!window.thockdownNotes) return

    setIsCaretSuspended(true)
    const previousNoteId = activeNoteId
    if (persistenceReady && previousNoteId && previousNoteId !== noteId) {
      const previousPayload = readCurrentEditUiPayload()
      const previousSnapshot = editModeSnapshotByNoteIdRef.current.get(previousNoteId)
      const snapshotPayload = previousPayload ?? (previousSnapshot ? {
        progressEdit: previousSnapshot.viewport.scrollTopLines,
        cursorPos: previousSnapshot.fullSelection.end,
        scrollTop: scrollTopLinesToPx(previousSnapshot.viewport.scrollTopLines, editorRuntimeMetrics.lineHeightPx),
        sourceAnchorLine: Math.max(0, previousSnapshot.viewport.scrollTopLines + previousSnapshot.viewport.topBoundaryLines),
        sourceAnchorText: null,
      } : null)

      if (snapshotPayload) {
        await persistEditUiPayloadForNote(previousNoteId, snapshotPayload)
      }
    }

    const [loaded, nextUiState] = await Promise.all([
      window.thockdownNotes.loadNote({ id: noteId }),
      window.thockdownNotes?.getNoteUiState({ id: noteId }) ?? Promise.resolve(null),
    ])
    const hydratedText = normalizeInternalText(loaded.text)
    const fallbackViewport = latestEditViewportRef.current ?? latestViewportRef.current
    const preloadedSnapshot = buildEditRestoreSnapshotFromUiState({
      noteId,
      text: hydratedText,
      uiState: nextUiState,
      fallbackViewport,
      lineHeightPx: editorRuntimeMetrics.lineHeightPx,
      overrideCursorPos,
    })
    updateEditModeSnapshotCache(preloadedSnapshot)

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

    latestEditorTextRef.current = hydratedText
    pendingEditRestoreSnapshotRef.current = preloadedSnapshot
    setActiveNoteId(loaded.id)
    setActiveNoteText(hydratedText)
    pendingViewportRestoreRef.current = null
    await saveSelectedNoteState(loaded.id)
    void window.thockdownSections?.setActiveNote(sectionId, loaded.id)
  }, [
    activeNoteId,
    editorRuntimeMetrics.lineHeightPx,
    persistEditUiPayloadForNote,
    persistenceReady,
    saveSelectedNoteState,
    sectionId,
    updateEditModeSnapshotCache,
    activeNoteExternalPathRef,
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
      const previousPayload = readCurrentEditUiPayload()
      const previousSnapshot = editModeSnapshotByNoteIdRef.current.get(previousNoteId)
      const snapshotPayload = previousPayload ?? (previousSnapshot ? {
        progressEdit: previousSnapshot.viewport.scrollTopLines,
        cursorPos: previousSnapshot.fullSelection.end,
        scrollTop: scrollTopLinesToPx(previousSnapshot.viewport.scrollTopLines, editorRuntimeMetrics.lineHeightPx),
        sourceAnchorLine: Math.max(0, previousSnapshot.viewport.scrollTopLines + previousSnapshot.viewport.topBoundaryLines),
        sourceAnchorText: null,
      } : null)

      if (snapshotPayload) {
        await persistEditUiPayloadForNote(previousNoteId, snapshotPayload)
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
    editorRuntimeMetrics.lineHeightPx,
    flushPendingSaveNow,
    persistEditUiPayloadForNote,
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
    notes,
    persistenceReady,
    activateNote,
    revealNoteInMenu: revealNoteInMenuStable,
    flushPendingSaveNow,
    refreshNotes,
    noteTransitionLockRef,
    scheduleFocusEditorInEditMode,
    updateNoteAssignedId,
    initialTabBarMode: restoredTabBarMode,
  })

  useEffect(() => {
    tabBarModeRef.current = tabBarMode
  }, [tabBarMode, tabBarModeRef])

  // The tag bar is transient chrome, not a sticky preference -- any click
  // outside this section's own tab-bar strip (typing in the editor,
  // clicking the sidebar, clicking a *different* section) drops it back to
  // the tab bar. Scoped to this section's own tabbarGridRef so a click
  // inside a neighboring section's tag bar doesn't collapse this one too.
  useEffect(() => {
    if (tabBarMode !== 'tags') return
    const handleWindowMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (target instanceof Node && tabbarGridRef.current?.contains(target)) {
        return
      }
      setTabBarMode('tabs')
    }
    window.addEventListener('mousedown', handleWindowMouseDown)
    return () => window.removeEventListener('mousedown', handleWindowMouseDown)
  }, [tabBarMode, setTabBarMode])

  // Full reset to the same blank state a freshly created section starts in:
  // no active note, no pinned tabs, no name. Unpins every tab first (while a
  // note may still be active, so unpinNoteTab's own "reactivate the
  // neighboring tab" side effect is free to fire harmlessly) and clears the
  // active note last, so the end state is deterministic regardless of what
  // that side effect did along the way.
  const resetSectionToEmpty = useCallback(async () => {
    for (const tab of pinnedTabs) {
      await unpinNoteTab(tab.noteId)
    }
    await clearActiveNote()
    if (sectionName !== null) {
      onRenameSection(null)
    }
  }, [pinnedTabs, unpinNoteTab, clearActiveNote, sectionName, onRenameSection])

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
    dateFilteredNotesRef,
    trashFilteredNotesRef,
    categoryTreeRef,
    archiveTreeRef,
    activeNoteExternalPathRef,
    externalNoteOriginalTextByIdRef,
    externalNoteOriginalHashByIdRef,
    currentExternalNoteHash,
    setCurrentExternalNoteHash,
  })

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const activeNoteHasDebugTag = useMemo(() => {
    return activeNoteSummary?.tags.some((tag) => tag.trim().toLowerCase() === 'debug') ?? false
  }, [activeNoteSummary])
  activeNoteHasDebugTagRef.current = activeNoteHasDebugTag

  const currentEditorText = useMemo(() => {
    return normalizeInternalText(latestEditorTextRef.current || activeNoteText)
  }, [activeNoteText, editorTextVersion, latestEditorTextRef])

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
    flushPendingSaveNow,
    applyEditRestoreSnapshot,
    editModeSnapshotByNoteIdRef,
    refreshNotes,
    activateNote,
  })

  const activeNoteDocumentStats = useMemo(() => {
    const hasSelection = !editorSelection.isCollapsed && editorSelection.end > editorSelection.start
    const selectionStart = Math.max(0, Math.min(currentEditorText.length, editorSelection.start))
    const selectionEnd = Math.max(selectionStart, Math.min(currentEditorText.length, editorSelection.end))
    const text = hasSelection
      ? currentEditorText.slice(selectionStart, selectionEnd)
      : currentEditorText
    const characterCount = text.length
    const trimmed = text.trim()
    const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length

    return {
      wordCount,
      characterCount,
    }
  }, [currentEditorText, editorSelection.end, editorSelection.isCollapsed, editorSelection.start])

  const {
    documentFindQuery,
    setDocumentFindQuery,
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
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
    isDocumentFindCaseSensitive,
    renderedDisplayText,
  })

  const {
    previewTextureRef,
    previewScrollbarTrackRef,
    previewScrollbarThumbRef,
    isPreviewScrollThumbActive,
    isDraggingPreviewScrollThumb,
    syncPreviewCustomScrollbar,
    handlePreviewTrackMouseDown,
    handlePreviewThumbMouseDown,
    handlePreviewScroll,
    blockPreviewEditMutation,
  } = usePreviewScrollbar({
    isPreviewMode,
    previewScrollRef,
    activeNoteId,
    currentEditorText,
    viewStyle,
    viewFontSize,
    viewSpacing,
  })

  const {
    handleJumpToDocumentFindHit,
    replaceDocumentFindHit,
    replaceAllDocumentFindHits,
  } = useDocumentFindNavigation({
    previewScrollRef,
    documentFindDirective,
    documentFindHits,
    isDocumentFindCaseSensitive,
    currentEditorText,
    syncPreviewCustomScrollbar,
    isPreviewMode,
    adapterRef,
    latestEditorTextRef,
    activeNoteText,
    documentFindQuery,
    applyProgrammaticEditorText,
  })

  const {
    activeDecorationFormats,
    activeHeadingLevel,
    isChecklistActive,
    isBulletedListActive,
    isNumberedListActive,
    isBlockquoteActive,
    isCodeBlockActive,
    isInlineCodeActive,
    applyTextDecoration,
    applyHeading,
    toggleCurrentLineHeading,
    toggleBulletedList,
    toggleNumberedList,
    toggleChecklistList,
    toggleBlockquote,
    applyLink,
    applyInlineCode,
    applyCodeBlock,
    insertHorizontalRule,
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
    adapterRef,
    previewScrollRef,
    editModeSnapshotByNoteIdRef,
    pendingEditRestoreSnapshotRef,
    latestViewportRef,
    latestEditViewportRef,
    readCurrentEditUiPayload,
    updateEditModeSnapshotCache,
    captureEditModeSnapshotFromEditor,
    persistEditUiPayloadForNote,
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
    editorSelection,
    previewedSnapshotId,
    isPreviewMode,
    setIsPreviewMode,
    activateNote,
    activeDecorationFormats,
    activeHeadingLevel,
    isChecklistActive,
    isBulletedListActive,
    isNumberedListActive,
    isBlockquoteActive,
    isCodeBlockActive,
    isInlineCodeActive,
    applyTextDecoration,
    applyHeading,
    toggleCurrentLineHeading,
    toggleBulletedList,
    toggleNumberedList,
    toggleChecklistList,
    toggleBlockquote,
    applyLink,
    applyInlineCode,
    applyCodeBlock,
    insertHorizontalRule,
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
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
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
  }, [activateNote, pinNoteAsRightmostTab, pinnedTabs, sectionId, unpinNoteFromSection])

  // Plain assignment (not an effect) -- safe, it's just a ref mutation. Powers
  // imperative, non-reactive registry lookups (getActiveSectionHandle()).
  registerSectionHandle(sectionId, currentSectionHandle)

  // Reactive counterpart: tells App.tsx (the parent) about this section's
  // latest state via an effect, since a child's own state changes don't
  // automatically re-render its parent (or the parent's other children,
  // like the global EditorToolbar). See App.tsx's reportSectionHandle for
  // the shallow-equality guard that keeps this from looping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    closeSectionPicker()
    onSwapSection(candidateId)
  }, [closeSectionPicker, onSwapSection])

  const handleSectionPickerClearClick = useCallback(() => {
    closeSectionPicker()
    void resetSectionToEmpty()
  }, [closeSectionPicker, resetSectionToEmpty])

  return (
    <div
      className={`editor-section-column${sectionId === activeSectionId ? ' is-active' : ''}`}
      onDropCapture={handleSectionDropCapture}
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
        onSectionPickerClearClick={handleSectionPickerClearClick}
      />

      <SectionEditorArea
        sectionId={sectionId}
        markSectionActive={markSectionActive}
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
        highlightSearchColor={highlightSearchColor}
        spellCheckRenderEnabled={spellCheckRenderEnabled}
        blockPreviewEditMutation={blockPreviewEditMutation}
        previewMarkdownElement={previewMarkdownElement}
        previewScrollbarTrackRef={previewScrollbarTrackRef}
        handlePreviewTrackMouseDown={handlePreviewTrackMouseDown}
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
      />
    </div>
  )
}

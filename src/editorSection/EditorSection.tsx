import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote } from '../shared/noteLifecycle'
import type { PersistedViewportState } from '../shared/appState'
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

type ViewStyleKey = 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print'
type ViewSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl'
type ViewSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide'

export interface EditorSectionProps extends Omit<SectionEditorAreaProps,
  'sectionId' | 'markSectionActive' | 'activeNoteId' | 'isPreviewMode' | 'previewedSnapshotId' | 'bindings' | 'adapterRef'
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
}: EditorSectionProps) {
  // Local, not a prop: the scrollbar-slot DOM node lives entirely within
  // this section's own SectionEditorArea render, so each section needs its
  // own -- sharing one across instances would have every section but the
  // last-mounted one's custom scrollbar pointing at the wrong DOM node.
  const [scrollbarHostEl, setScrollbarHostEl] = useState<HTMLDivElement | null>(null)
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
  })

  const getActiveNoteLiveText = useCallback(() => (
    latestEditorTextRef.current || activeNoteText
  ), [activeNoteText, latestEditorTextRef])

  // Today this section is always the active one (there's only one), so this
  // is correct-but-inert -- it starts doing real work the moment a second
  // section can take focus away from it.
  useSnapshotFreeze({
    sectionId,
    activeSectionId,
    noteId: activeNoteId,
    previewedSnapshotId,
    setPreviewedSnapshotId,
    getLiveText: getActiveNoteLiveText,
    flushPendingSaveNow,
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
    tabBarMode,
    toggleTabBarMode,
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
    tabBarMode,
    toggleTabBarMode,
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

  return (
    <div className="editor-section-column">
      <SectionTabBar
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
          tabBarMode,
          toggleTabBarMode,
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
      />

      <SectionEditorArea
        sectionId={sectionId}
        markSectionActive={markSectionActive}
        isPreviewMode={isPreviewMode}
        editorStageRef={editorStageRef}
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

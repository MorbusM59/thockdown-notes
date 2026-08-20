import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, DragEvent, MouseEvent, MutableRefObject, ReactNode, RefObject } from 'react'
import { CM6Editor } from '../components/CM6Editor'
import { SnapshotTimelineSlider } from '../editor/SnapshotTimelineSlider'
import { PresentStateCircle } from '../editor/PresentStateCircle'
import { getEmptyStateSceneMaskUrl } from '../editor/EmptyStateScene'
import type { EditorAdapter, EditorBindings } from '../editor/EditorContract'
import type { EditorRuntimeMetrics } from '../editor/EditorTypography'
import type { UseNoteSnapshotsResult } from '../editor/useNoteSnapshots'
import { resolvePreviewEdgePaddingPx } from '../exportStyles'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { ChapterEntry } from '../shared/chapters'
import { resolveSpellCheckSurfaceState } from '../shared/spellCheckPolicy'
import { ChapterBar } from '../chapters/ChapterBar'
import type { ChapterPillSplitArm } from '../chapters/useChapterPillActions'
import { EscapeHoldPanel } from './EscapeHoldPanel'
import { HelpModeOverlay } from '../helpMode/HelpModeOverlay'

export interface SectionEditorAreaProps {
  sectionId: string
  isSectionActive: boolean
  isPreviewMode: boolean
  editorStageRef: RefObject<HTMLDivElement>
  sectionContainerRef: MutableRefObject<HTMLDivElement | null>
  previewedSnapshotId: number | null
  bindings: EditorBindings
  adapterRef: MutableRefObject<EditorAdapter | null>
  activeNoteId: string | null
  editorDisplayText: string
  scrollbarHostEl: HTMLDivElement | null
  setScrollbarHostEl: (element: HTMLDivElement | null) => void
  editorFontFamily: string
  editorRuntimeMetrics: EditorRuntimeMetrics
  editorFontLoadVersion: number
  activeNoteHasDebugTag: boolean
  isPreviewingSnapshot: boolean
  isCaretSuspended: boolean
  isEscapeHoldPanelOpen: boolean
  onEscapeHoldPanelClose: () => void
  onEscapeHoldCreateNote: () => void | Promise<void>
  onEscapeHoldCreateChapter: () => void | Promise<void>
  onEscapeHoldExportPdf: () => void | Promise<void>
  onEscapeHoldExportMd: () => void | Promise<void>
  onEscapeHoldOpenHelp: () => void | Promise<void>
  isExportingPdf: boolean
  isExportingMd: boolean
  isHelpModeActive: boolean
  onHelpModeClose: () => void
  spellCheckEditEnabled: boolean
  previewTextureRef: RefObject<HTMLDivElement>
  previewScrollRef: RefObject<HTMLDivElement>
  handlePreviewScroll: () => void
  viewStyle: string
  viewFontSize: number
  viewSpacing: number
  viewLetterSpacingEm: number
  highlightSearchColor: string
  spellCheckRenderEnabled: boolean
  blockPreviewEditMutation: (event: { preventDefault: () => void }) => void
  previewMarkdownElement: ReactNode
  previewScrollbarTrackRef: RefObject<HTMLDivElement>
  handlePreviewTrackMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  handlePreviewTrackContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  previewScrollbarThumbRef: RefObject<HTMLDivElement>
  isDraggingPreviewScrollThumb: boolean
  isPreviewScrollThumbActive: boolean
  handlePreviewThumbMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  activeNoteDocumentStats: { wordCount: number; characterCount: number }
  noteSnapshots: UseNoteSnapshotsResult
  handleNavigateSnapshot: (snapshotId: number | null) => void
  handleBranchOpened: (noteId: string) => void
  handleBranchError: (message: string) => void
  timelineCurveConstant: number
  setTimelineCurveConstant: (value: number) => void
  setTimelineTrackLengthPx: (value: number) => void
  /** The manual-save button's click handler -- creates a Time Machine save point for a real note, or (while isViewingAutoTocChapter/isViewingAutoOpenItemsChapter) regenerates that auto-chapter from live state instead. See EditorSection.tsx's handleManualSaveOrRefresh. */
  handleCreateManualSnapshot: () => void | Promise<void>
  handleReturnToPresent: () => void
  handleMergeAdjacentSnapshots: () => void
  notes: NoteSummary[]
  /** The chapter-aware "menu identity" (see EditorSection.tsx's `menuIdentityNoteId`) -- the note the chapter bar shows chapters *of*, and its first tab. Non-null exactly when activeNoteId is. */
  menuIdentityNoteId: string | null
  chapters: ChapterEntry[]
  archivedMergedChapterIds: ReadonlySet<string>
  onParentTabClick: () => void
  onChapterClick: (chapterNoteId: string) => void
  onChapterDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  onChapterDragEnd: () => void
  onChapterDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  onCommitChapterIdEdit: () => void
  onCancelChapterIdEdit: () => void
  onCollapseChapterIntoPrevious: () => void
  onExtractSelectionToChapter: () => void
  /** Which chapter pill (if any) is currently showing the split archive/delete mini pills -- see useChapterPillActions.ts. */
  splitArmedChapter: ChapterPillSplitArm | null
  onChapterPillMouseDown: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  onChapterPillMouseUp: (event: MouseEvent<HTMLDivElement>, chapterNoteId: string) => void
  onChapterPillMouseLeave: (chapterNoteId: string) => void
  onChapterPillContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  onArchiveChapterClick: (chapterNoteId: string) => void
  onDeleteChapterClick: (chapterNoteId: string) => void
  /**
   * Line-number/review-flag gutter toggles, per editor slot -- see App.tsx's
   * reviewGutterVisibleBySection/reviewFlagsVisibleBySection. Independently
   * switchable: onToggleReviewGutter (left click) flips both together, based
   * on the current line-number state; onToggleReviewFlags (right click)
   * flips the flag column alone.
   */
  showLineNumbers: boolean
  showReviewFlags: boolean
  onToggleReviewGutter: () => void
  onToggleReviewFlags: () => void
  /**
   * Computed once in EditorSection.tsx off the same activeNoteSummary every
   * other per-render fact about the active note goes through, rather than
   * this component deriving its own copy via a fresh notes.find(...) --
   * see EditorSection.tsx's own comment on why that's the single source of
   * truth. isViewingAutoTocChapter/isViewingAutoOpenItemsChapter each gate
   * this note type's own read-only editing and Time Machine suppression.
   */
  isViewingAutoTocChapter: boolean
  isViewingAutoOpenItemsChapter: boolean
}

/**
 * The editor + its scrollbar + the Time Machine timeline/manual-save-dot for
 * one section -- extracted verbatim from App.tsx's JSX with zero behavior
 * change, the second slice of turning the section chrome into a real
 * per-section component (see SectionTabBar for the first). Still entirely
 * prop-driven; the hooks it depends on stay called in App.tsx for now.
 */
export function SectionEditorArea({
  sectionId,
  isSectionActive,
  isPreviewMode,
  editorStageRef,
  sectionContainerRef,
  previewedSnapshotId,
  bindings,
  adapterRef,
  activeNoteId,
  editorDisplayText,
  scrollbarHostEl,
  setScrollbarHostEl,
  editorFontFamily,
  editorRuntimeMetrics,
  editorFontLoadVersion,
  activeNoteHasDebugTag,
  isPreviewingSnapshot,
  isCaretSuspended,
  isEscapeHoldPanelOpen,
  onEscapeHoldPanelClose,
  onEscapeHoldCreateNote,
  onEscapeHoldCreateChapter,
  onEscapeHoldExportPdf,
  onEscapeHoldExportMd,
  onEscapeHoldOpenHelp,
  isExportingPdf,
  isExportingMd,
  isHelpModeActive,
  onHelpModeClose,
  spellCheckEditEnabled,
  previewTextureRef,
  previewScrollRef,
  handlePreviewScroll,
  viewStyle,
  viewFontSize,
  viewSpacing,
  viewLetterSpacingEm,
  highlightSearchColor,
  spellCheckRenderEnabled,
  blockPreviewEditMutation,
  previewMarkdownElement,
  previewScrollbarTrackRef,
  handlePreviewTrackMouseDown,
  handlePreviewTrackContextMenu,
  previewScrollbarThumbRef,
  isDraggingPreviewScrollThumb,
  isPreviewScrollThumbActive,
  handlePreviewThumbMouseDown,
  activeNoteDocumentStats,
  noteSnapshots,
  handleNavigateSnapshot,
  handleBranchOpened,
  handleBranchError,
  timelineCurveConstant,
  setTimelineCurveConstant,
  setTimelineTrackLengthPx,
  handleCreateManualSnapshot,
  handleReturnToPresent,
  handleMergeAdjacentSnapshots,
  notes,
  menuIdentityNoteId,
  chapters,
  archivedMergedChapterIds,
  onParentTabClick,
  onChapterClick,
  onChapterDragStart,
  onChapterDragEnd,
  onChapterDrop,
  editingChapterNoteId,
  chapterIdDraft,
  setChapterIdDraft,
  onCommitChapterIdEdit,
  onCancelChapterIdEdit,
  onCollapseChapterIntoPrevious,
  onExtractSelectionToChapter,
  splitArmedChapter,
  onChapterPillMouseDown,
  onChapterPillMouseUp,
  onChapterPillMouseLeave,
  onChapterPillContextMenu,
  onArchiveChapterClick,
  onDeleteChapterClick,
  showLineNumbers,
  showReviewFlags,
  onToggleReviewGutter,
  onToggleReviewFlags,
  isViewingAutoTocChapter,
  isViewingAutoOpenItemsChapter,
}: SectionEditorAreaProps) {
  const setStageEl = useCallback((el: HTMLDivElement | null) => {
    (editorStageRef as MutableRefObject<HTMLDivElement | null>).current = el
    sectionContainerRef.current = el
  }, [editorStageRef, sectionContainerRef])

  // Bumped on click to reroll the scene below -- an undocumented easter egg,
  // so it deliberately carries no hover/cursor affordance (see .editor-empty-state
  // in editor.css). Local state (not persisted) is enough since it only needs
  // to survive re-renders while this section stays mounted, not reloads.
  const [sceneRerollNonce, setSceneRerollNonce] = useState(0)
  const emptyStateSceneMaskUrl = useMemo(
    () => getEmptyStateSceneMaskUrl(`${sectionId}:${sceneRerollNonce}`),
    [sectionId, sceneRerollNonce],
  )

  const emptyState = (
    <div
      className="editor-empty-state"
      style={{ '--empty-state-scene-mask': emptyStateSceneMaskUrl } as CSSProperties}
      onClick={() => setSceneRerollNonce((n) => n + 1)}
    >
    </div>
  )

  const editorSpellCheckEnabled = resolveSpellCheckSurfaceState({
    globalToggleEnabled: spellCheckEditEnabled,
    isEditorSurface: true,
    isActiveEditor: isSectionActive,
    isInputField: false,
  })
  const previewSpellCheckEnabled = resolveSpellCheckSurfaceState({
    globalToggleEnabled: spellCheckRenderEnabled,
    isEditorSurface: true,
    isActiveEditor: isSectionActive,
    isInputField: false,
  })

  // Smart-toggled, not manually: the panel shows itself exactly when the
  // current note (or its own currently-open chapter) actually has chapters,
  // and hides itself the moment the last one collapses back into its
  // parent -- see the chapter-panel-hides-when-empty behavior on the
  // collapse action in useNoteChapters.ts. No user-facing show/hide control
  // exists anymore; the old toggle button is now the "+" create-chapter
  // button below, which opens the panel as a side effect of chapters.length
  // becoming positive, not by toggling visibility directly.
  const isChapterPanelOpen = chapters.length > 0

  // Help mode takes over this section's whole editor slot -- it renders its
  // own copy of the editor-viewer-frame/editor-shell/editor-stage/
  // editor-scrollbar-slot/chapter-panel skeleton below (HelpModeOverlay.tsx)
  // so the User Guide's chapter bar lands in the exact same bottom-anchored
  // spot a real note's chapter bar does, rather than nesting inside
  // editor-stage as a top-of-column overlay. Early return, not a branch
  // inside the JSX below, since none of the real editor's own containers
  // (edit-container, the real ChapterBar, the wordcount/timeline footer)
  // apply to the read-only guide.
  if (isHelpModeActive && isSectionActive) {
    return <HelpModeOverlay notes={notes} onClose={onHelpModeClose} />
  }

  // isViewingAutoTocChapter/isViewingAutoOpenItemsChapter (props -- see
  // their own doc comment) each make the editor read-only below, for
  // different reasons. TOC: it's regenerated (overwritten) the instant it's
  // next viewed (EditorSection.tsx's activateNote), so nothing typed here
  // would survive a round trip away and back -- same editorReadOnly
  // mechanism (EditorView.editable) already used for Time Machine snapshot
  // preview, not a new one. Open Items: it's not regenerated on every view
  // like the TOC (see noteLifecycleService.ts's regenerateOpenItemsGroup),
  // but it exists purely to be a read/click-through view of state you
  // manage in the corresponding chapter, not a place to edit directly --
  // any edit made here would just be silently overwritten (or left stale)
  // by the next real checklist change anywhere in the family, which would
  // be a confusing way to lose typed text.
  return (
    <div
      className="editor-viewer-frame"
      style={{ flex: '1 1 0' }}
    >
      <main className={`editor-shell${isChapterPanelOpen ? ' chapter-panel-is-open' : ''}`}>
        <div className="editor-background">
          <div ref={setStageEl} className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}${!activeNoteId ? ' is-empty' : ''}`}>
            {isEscapeHoldPanelOpen && isSectionActive && activeNoteId ? (
              <div
                className="editor-escape-hold-overlay"
                role="dialog"
                aria-label="Quick note panel"
                onClick={onEscapeHoldPanelClose}
              >
                <div
                  className="editor-escape-hold-panel"
                  onClick={(event) => event.stopPropagation()}
                  aria-live="polite"
                >
                  <div className="editor-escape-hold-panel-inner">
                    <div className="editor-escape-hold-panel-title">Quick Actions</div>
                    <EscapeHoldPanel
                      activeNoteId={activeNoteId}
                      isExportingPdf={isExportingPdf}
                      isExportingMd={isExportingMd}
                      onCreateNote={onEscapeHoldCreateNote}
                      onCreateChapter={onEscapeHoldCreateChapter}
                      onExportPdf={onEscapeHoldExportPdf}
                      onExportMd={onEscapeHoldExportMd}
                      onOpenHelp={onEscapeHoldOpenHelp}
                      onClose={onEscapeHoldPanelClose}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            <div className={`edit-container${isPreviewMode ? ' is-pane-hidden' : ''}`}>
              <div className="markdown-editor-texture" />
              {activeNoteId ? (
                <CM6Editor
                  bindings={bindings}
                  adapterRef={adapterRef}
                  isSectionActive={isSectionActive}
                  noteId={activeNoteId}
                  initialText={editorDisplayText}
                  scrollbarHost={scrollbarHostEl}
                  fontFamily={editorFontFamily}
                  fontSizePx={editorRuntimeMetrics.fontSizePx}
                  lineHeightPx={editorRuntimeMetrics.lineHeightPx}
                  glyphWidthPx={editorRuntimeMetrics.glyphWidthPx}
                  cellWidthPx={editorRuntimeMetrics.cellWidthPx}
                  editorReadOnly={activeNoteHasDebugTag || isPreviewingSnapshot || isViewingAutoTocChapter || isViewingAutoOpenItemsChapter}
                  spellCheckEnabled={editorSpellCheckEnabled}
                  fontReady={editorFontLoadVersion > 0}
                  caretSuspended={isCaretSuspended}
                  showLineNumbers={showLineNumbers}
                  showReviewFlags={showReviewFlags}
                />
              ) : emptyState}
            </div>
            <div className={`render-container${isPreviewMode ? '' : ' is-pane-hidden'}`} aria-hidden={!isPreviewMode}>
              <div ref={previewTextureRef} className="markdown-preview-texture" />
              <div
                ref={previewScrollRef}
                onScroll={handlePreviewScroll}
                className={`markdown-preview thockdown-custom-scrollbar style-${viewStyle}`}
                style={{
                  '--search-hit-color': highlightSearchColor,
                  '--preview-edge-padding': `${resolvePreviewEdgePaddingPx(viewSpacing)}px`,
                  fontSize: viewFontSize,
                  lineHeight: viewSpacing,
                  letterSpacing: `${viewLetterSpacingEm}em`,
                } as CSSProperties}
                contentEditable={previewSpellCheckEnabled}
                suppressContentEditableWarning={previewSpellCheckEnabled}
                spellCheck={previewSpellCheckEnabled}
                onBeforeInput={previewSpellCheckEnabled ? blockPreviewEditMutation : undefined}
                onPaste={previewSpellCheckEnabled ? blockPreviewEditMutation : undefined}
                onCut={previewSpellCheckEnabled ? blockPreviewEditMutation : undefined}
                onDrop={previewSpellCheckEnabled ? blockPreviewEditMutation : undefined}
              >
                {activeNoteId ? previewMarkdownElement : emptyState}
              </div>
            </div>
          </div>
        </div>
      </main>
      <aside className={`editor-scrollbar-slot${isChapterPanelOpen ? ' chapter-panel-is-open' : ''}`}>
        <div className="editor-scrollbar-slot-inner" aria-hidden="true">
          {!isPreviewMode ? (
            activeNoteId ? (
              <div ref={setScrollbarHostEl} className="editor-scrollbar-slot-inner" />
            ) : (
              <div className="thockdown-scroll-rail">
                <div className="thockdown-scroll-track">
                  <div className="thockdown-scroll-thumb is-inactive" style={{ top: 3, bottom: 3 }} />
                </div>
              </div>
            )
          ) : (
            <div className="thockdown-scroll-rail">
              <div
                ref={previewScrollbarTrackRef}
                className="thockdown-scroll-track"
                onMouseDown={handlePreviewTrackMouseDown}
                onContextMenu={handlePreviewTrackContextMenu}
              >
                <div
                  ref={previewScrollbarThumbRef}
                  className={`thockdown-scroll-thumb${isDraggingPreviewScrollThumb ? ' is-dragging' : ''}${isPreviewScrollThumbActive ? '' : ' is-inactive'}`}
                  onMouseDown={handlePreviewThumbMouseDown}
                />
              </div>
            </div>
          )}
        </div>
      </aside>
      <div className={`chapter-panel${isChapterPanelOpen ? ' is-open' : ''}`} aria-hidden={!isChapterPanelOpen}>
        {activeNoteId && menuIdentityNoteId ? (
          <ChapterBar
            parentNoteId={menuIdentityNoteId}
            chapters={chapters}
            archivedMergedChapterIds={archivedMergedChapterIds}
            notes={notes}
            activeNoteId={activeNoteId}
            onParentTabClick={onParentTabClick}
            onChapterClick={onChapterClick}
            onChapterDragStart={onChapterDragStart}
            onChapterDragEnd={onChapterDragEnd}
            onChapterDrop={onChapterDrop}
            editingChapterNoteId={editingChapterNoteId}
            chapterIdDraft={chapterIdDraft}
            setChapterIdDraft={setChapterIdDraft}
            onCommitChapterIdEdit={onCommitChapterIdEdit}
            onCancelChapterIdEdit={onCancelChapterIdEdit}
            onCollapseChapterIntoPrevious={onCollapseChapterIntoPrevious}
            onExtractSelectionToChapter={onExtractSelectionToChapter}
            splitArmedChapter={splitArmedChapter}
            onChapterPillMouseDown={onChapterPillMouseDown}
            onChapterPillMouseUp={onChapterPillMouseUp}
            onChapterPillMouseLeave={onChapterPillMouseLeave}
            onChapterPillContextMenu={onChapterPillContextMenu}
            onArchiveChapterClick={onArchiveChapterClick}
            onDeleteChapterClick={onDeleteChapterClick}
          />
        ) : null}
      </div>
      <div className="editor-document-stats" aria-live="polite">
        <div className="chapter-toggle-panel">
          <button
            type="button"
            className={`chapter-toggle-button btn-icon${(showLineNumbers || showReviewFlags) ? ' is-active' : ''}`}
            aria-label="Toggle line numbers and review flags (right-click to toggle review flags only)"
            aria-pressed={showLineNumbers || showReviewFlags}
            data-tooltip="Left-click: toggle line numbers + review flags. Right-click: toggle review flags only."
            onClick={onToggleReviewGutter}
            onContextMenu={(event) => {
              event.preventDefault()
              onToggleReviewFlags()
            }}
          >
            <span className="fa-solid fa-hashtag" aria-hidden="true" />
          </button>
        </div>
        <div className="wordcount-panel" aria-live="polite">
          {activeNoteId && (
            <span><b>{activeNoteDocumentStats.wordCount.toLocaleString()}</b> ({activeNoteDocumentStats.characterCount.toLocaleString()})</span>
          )}
        </div>
        <div className="timeline-panel">
        {activeNoteId && !isViewingAutoTocChapter && !isViewingAutoOpenItemsChapter ? (
          <SnapshotTimelineSlider
            sourceNoteId={activeNoteId}
            placements={noteSnapshots.placements}
            snapshotsById={noteSnapshots.snapshotsById}
            snapshotIdsMatchingPresent={noteSnapshots.snapshotIdsMatchingPresent}
            activeSnapshotId={previewedSnapshotId}
            onNavigate={handleNavigateSnapshot}
            onBranchOpened={handleBranchOpened}
            onBranchError={handleBranchError}
            curveConstant={timelineCurveConstant}
            onCurveConstantChange={setTimelineCurveConstant}
            onTrackLengthChange={setTimelineTrackLengthPx}
          />
        ) : (
          <div className="utility-setting-scrollbar-shell snapshot-timeline-shell" aria-hidden="true">
            <div className="utility-setting-scrollbar-rail snapshot-timeline-rail" />
          </div>
        )}
        </div>
        <div className="manual-snapshot-panel">
          <PresentStateCircle
            hasPendingManualChanges={activeNoteId ? ((isViewingAutoTocChapter || isViewingAutoOpenItemsChapter) ? true : noteSnapshots.hasPendingManualChanges) : false}
            onCreateManualSnapshot={() => { void handleCreateManualSnapshot() }}
            onGoToPresent={activeNoteId ? handleReturnToPresent : undefined}
            onMergeAdjacentSnapshots={activeNoteId && !isViewingAutoTocChapter && !isViewingAutoOpenItemsChapter ? handleMergeAdjacentSnapshots : undefined}
            isPresent={previewedSnapshotId === null}
            disabled={!activeNoteId}
            pendingActionLabel={
              isViewingAutoTocChapter
                ? 'Refresh table of contents from live state'
                : isViewingAutoOpenItemsChapter
                  ? 'Refresh open items from live state'
                  : undefined
            }
          />
        </div>
      </div>
    </div>
  )
}

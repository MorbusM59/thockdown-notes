import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, MutableRefObject, ReactNode, RefObject } from 'react'
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
import { ChapterBar } from '../chapters/ChapterBar'

export interface SectionEditorAreaProps {
  sectionId: string
  markSectionActive: (sectionId: string) => void
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
  handleCreateManualSnapshot: () => void | Promise<void>
  handleReturnToPresent: () => void
  handleMergeAdjacentSnapshots: () => void
  notes: NoteSummary[]
  /** The chapter-aware "menu identity" (see EditorSection.tsx's `menuIdentityNoteId`) -- the note the chapter bar shows chapters *of*, and its first tab. Non-null exactly when activeNoteId is. */
  menuIdentityNoteId: string | null
  chapters: ChapterEntry[]
  onParentTabClick: () => void
  onChapterClick: (chapterNoteId: string) => void
  editingChapterNoteId: string | null
  chapterIdDraft: string
  setChapterIdDraft: (value: string) => void
  onStartEditingChapterId: (chapterNoteId: string) => void
  onCommitChapterIdEdit: () => void
  onCancelChapterIdEdit: () => void
  onCollapseChapterIntoPrevious: () => void
  onExtractSelectionToChapter: () => void
  /** Line-number/review-flag gutter toggle, per editor slot -- see App.tsx's reviewGutterVisibleBySection. */
  showReviewGutter: boolean
  onToggleReviewGutter: () => void
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
  markSectionActive,
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
  onParentTabClick,
  onChapterClick,
  editingChapterNoteId,
  chapterIdDraft,
  setChapterIdDraft,
  onStartEditingChapterId,
  onCommitChapterIdEdit,
  onCancelChapterIdEdit,
  onCollapseChapterIntoPrevious,
  onExtractSelectionToChapter,
  showReviewGutter,
  onToggleReviewGutter,
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

  // Smart-toggled, not manually: the panel shows itself exactly when the
  // current note (or its own currently-open chapter) actually has chapters,
  // and hides itself the moment the last one collapses back into its
  // parent -- see the chapter-panel-hides-when-empty behavior on the
  // collapse action in useNoteChapters.ts. No user-facing show/hide control
  // exists anymore; the old toggle button is now the "+" create-chapter
  // button below, which opens the panel as a side effect of chapters.length
  // becoming positive, not by toggling visibility directly.
  const isChapterPanelOpen = chapters.length > 0
  return (
    <div
      className="editor-viewer-frame"
      style={{ flex: '1 1 0' }}
      onFocusCapture={() => markSectionActive(sectionId)}
      onMouseDownCapture={() => markSectionActive(sectionId)}
      onKeyDownCapture={() => markSectionActive(sectionId)}
    >
      <main className={`editor-shell${isChapterPanelOpen ? ' chapter-panel-is-open' : ''}`}>
        <div className="editor-background">
          <div ref={setStageEl} className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}${!activeNoteId ? ' is-empty' : ''}`}>
            <div className={`edit-container${isPreviewMode ? ' is-pane-hidden' : ''}`}>
              <div className="markdown-editor-texture" />
              {activeNoteId ? (
                <CM6Editor
                  bindings={bindings}
                  adapterRef={adapterRef}
                  noteId={activeNoteId}
                  initialText={editorDisplayText}
                  scrollbarHost={scrollbarHostEl}
                  fontFamily={editorFontFamily}
                  fontSizePx={editorRuntimeMetrics.fontSizePx}
                  lineHeightPx={editorRuntimeMetrics.lineHeightPx}
                  glyphWidthPx={editorRuntimeMetrics.glyphWidthPx}
                  cellWidthPx={editorRuntimeMetrics.cellWidthPx}
                  editorReadOnly={activeNoteHasDebugTag || isPreviewingSnapshot}
                  spellCheckEnabled={spellCheckEditEnabled}
                  fontReady={editorFontLoadVersion > 0}
                  caretSuspended={isCaretSuspended}
                  showReviewGutter={showReviewGutter}
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
                contentEditable={spellCheckRenderEnabled}
                suppressContentEditableWarning={spellCheckRenderEnabled}
                spellCheck={spellCheckRenderEnabled}
                onBeforeInput={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onPaste={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onCut={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onDrop={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
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
            notes={notes}
            activeNoteId={activeNoteId}
            onParentTabClick={onParentTabClick}
            onChapterClick={onChapterClick}
            editingChapterNoteId={editingChapterNoteId}
            chapterIdDraft={chapterIdDraft}
            setChapterIdDraft={setChapterIdDraft}
            onStartEditingChapterId={onStartEditingChapterId}
            onCommitChapterIdEdit={onCommitChapterIdEdit}
            onCancelChapterIdEdit={onCancelChapterIdEdit}
            onCollapseChapterIntoPrevious={onCollapseChapterIntoPrevious}
            onExtractSelectionToChapter={onExtractSelectionToChapter}
          />
        ) : null}
      </div>
      <div className="editor-document-stats" aria-live="polite">
        <div className="chapter-toggle-panel">
          <button
            type="button"
            className={`chapter-toggle-button btn-icon${showReviewGutter ? ' is-active' : ''}`}
            aria-label="Toggle line numbers and review flags"
            aria-pressed={showReviewGutter}
            title="Toggle line numbers and review flags"
            onClick={onToggleReviewGutter}
          >
            <span className="fa-solid fa-list-ol" aria-hidden="true" />
          </button>
        </div>
        <div className="wordcount-panel" aria-live="polite">
          {activeNoteId && (
            <span><b>{activeNoteDocumentStats.wordCount.toLocaleString()}</b> ({activeNoteDocumentStats.characterCount.toLocaleString()})</span>
          )}
        </div>
        <div className="timeline-panel">
        {activeNoteId ? (
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
            hasPendingManualChanges={activeNoteId ? noteSnapshots.hasPendingManualChanges : false}
            onCreateManualSnapshot={() => { void handleCreateManualSnapshot() }}
            onGoToPresent={activeNoteId ? handleReturnToPresent : undefined}
            onMergeAdjacentSnapshots={activeNoteId ? handleMergeAdjacentSnapshots : undefined}
            isPresent={previewedSnapshotId === null}
            disabled={!activeNoteId}
          />
        </div>
      </div>
    </div>
  )
}

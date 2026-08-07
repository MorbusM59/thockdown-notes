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
import MouseCursorOverlay from '../components/MouseCursorOverlay'
import type { CustomCursorSettings } from '../shared/cursorSettings'
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
  customCursorSettings: CustomCursorSettings
  notes: NoteSummary[]
  chapters: ChapterEntry[]
  onCreateChapter: () => void
  onChapterClick: (chapterNoteId: string) => void
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
  customCursorSettings,
  notes,
  chapters,
  onCreateChapter,
  onChapterClick,
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

  const [isChapterPanelOpen, setIsChapterPanelOpen] = useState(false)
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
          <div ref={setStageEl} className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}${!activeNoteId ? ' is-empty' : ''}${activeNoteId && customCursorSettings.enabled ? ' hide-native-cursor' : ''}`}>
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
            {/* Mouse cursor overlay: hides native cursor and paints animated arc. Only
                mounted while there's a real note to edit and the feature is toggled on
                (Options > Mouse options) -- hide-native-cursor above is gated the same
                way, so the empty-state pane and the disabled case both keep the normal
                arrow cursor. Uses sectionContainerRef, not editorStageRef -- the latter is one ref
                shared across every section (see TODO.md), so it only ever points at
                whichever section's stage mounted/updated last; every section's overlay
                would end up attaching its pointer listeners to that one section's DOM
                node instead of its own. sectionContainerRef is created fresh per
                EditorSection instance and set to this same stage element. */}
            {activeNoteId && customCursorSettings.enabled ? (
              <MouseCursorOverlay stageRef={sectionContainerRef} settings={customCursorSettings} />
            ) : null}
          </div>
        </div>
      </main>
      <aside className="editor-scrollbar-slot">
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
        {activeNoteId ? (
          <ChapterBar
            chapters={chapters}
            notes={notes}
            activeNoteId={activeNoteId}
            onCreateChapter={onCreateChapter}
            onChapterClick={onChapterClick}
          />
        ) : null}
      </div>
      <div className="editor-document-stats" aria-live="polite">
        <div className="chapter-toggle-panel">
          <button
            type="button"
            className={[
              'chapter-toggle-button btn-icon',
              isChapterPanelOpen ? 'is-active' : '',
            ].filter(Boolean).join(' ')}
            aria-pressed={isChapterPanelOpen}
            aria-label={isChapterPanelOpen ? 'Hide chapter panel' : 'Show chapter panel'}
            title={isChapterPanelOpen ? 'Hide chapter panel' : 'Show chapter panel'}
            onClick={() => setIsChapterPanelOpen((v) => !v)}
          >
            <span className="fa-solid fa-caret-up" aria-hidden="true" />
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

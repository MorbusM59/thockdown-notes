import type { CSSProperties, MutableRefObject, ReactNode, RefObject } from 'react'
import { Editor } from '../components/Editor'
import { SnapshotTimelineSlider } from '../editor/SnapshotTimelineSlider'
import { PresentStateCircle } from '../editor/PresentStateCircle'
import type { EditorAdapter, EditorBindings } from '../editor/EditorContract'
import type { EditorRuntimeMetrics } from '../editor/EditorTypography'
import type { UseNoteSnapshotsResult } from '../editor/useNoteSnapshots'

export interface SectionEditorAreaProps {
  sectionId: string
  markSectionActive: (sectionId: string) => void
  isPreviewMode: boolean
  editorStageRef: RefObject<HTMLDivElement>
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
  viewFontSize: string
  viewSpacing: string
  highlightSearchColor: string
  spellCheckRenderEnabled: boolean
  blockPreviewEditMutation: (event: { preventDefault: () => void }) => void
  previewMarkdownElement: ReactNode
  previewScrollbarTrackRef: RefObject<HTMLDivElement>
  handlePreviewTrackMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
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
  highlightSearchColor,
  spellCheckRenderEnabled,
  blockPreviewEditMutation,
  previewMarkdownElement,
  previewScrollbarTrackRef,
  handlePreviewTrackMouseDown,
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
}: SectionEditorAreaProps) {
  return (
    <div
      className="editor-viewer-frame"
      style={{ flex: '1 1 0' }}
      onFocusCapture={() => markSectionActive(sectionId)}
      onMouseDownCapture={() => markSectionActive(sectionId)}
      onKeyDownCapture={() => markSectionActive(sectionId)}
    >
      <main className="editor-shell">
        <div className="editor-background">
          <div ref={editorStageRef} className={`editor-stage${isPreviewMode ? ' is-preview-mode' : ''}`}>
            <div className="edit-container" style={{ display: isPreviewMode ? 'none' : undefined }}>
              <Editor
                key={previewedSnapshotId ?? 'present'}
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
                fontReady={editorFontLoadVersion > 0}
                editorReadOnly={activeNoteHasDebugTag || isPreviewingSnapshot}
                caretSuspended={isCaretSuspended}
                spellCheckEnabled={spellCheckEditEnabled}
              />
            </div>
            <div className="render-container" style={{ display: isPreviewMode ? undefined : 'none' }} aria-hidden={!isPreviewMode}>
              <div ref={previewTextureRef} className="markdown-preview-texture" />
              <div
                ref={previewScrollRef}
                onScroll={handlePreviewScroll}
                className={`markdown-preview thockdown-custom-scrollbar style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}
                style={{ '--search-hit-color': highlightSearchColor } as CSSProperties}
                contentEditable={spellCheckRenderEnabled}
                suppressContentEditableWarning={spellCheckRenderEnabled}
                spellCheck={spellCheckRenderEnabled}
                onBeforeInput={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onPaste={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onCut={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
                onDrop={spellCheckRenderEnabled ? blockPreviewEditMutation : undefined}
              >
                {previewMarkdownElement}
              </div>
            </div>
          </div>
        </div>
      </main>
      <aside className="editor-scrollbar-slot">
        <div className="editor-scrollbar-slot-inner" aria-hidden="true">
          {!isPreviewMode ? (
            <div ref={setScrollbarHostEl} className="editor-scrollbar-slot-inner" />
          ) : (
            <div className="thockdown-scroll-rail">
              <div
                ref={previewScrollbarTrackRef}
                className="thockdown-scroll-track"
                onMouseDown={handlePreviewTrackMouseDown}
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
      <div className="editor-document-stats" aria-live="polite">
      {activeNoteId && (
        <div className="wordcount-panel" aria-live="polite">
          <span><b>{activeNoteDocumentStats.wordCount.toLocaleString()}</b> ({activeNoteDocumentStats.characterCount.toLocaleString()})</span>
        </div>
      )}
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
          <span>0 words</span>
        )}
        </div>
        <div className="manual-snapshot-panel">
        {activeNoteId && (
          <PresentStateCircle
            hasPendingManualChanges={noteSnapshots.hasPendingManualChanges}
            onCreateManualSnapshot={() => { void handleCreateManualSnapshot() }}
            onGoToPresent={handleReturnToPresent}
            onMergeAdjacentSnapshots={handleMergeAdjacentSnapshots}
            isPresent={previewedSnapshotId === null}
          />
        )}
        </div>
      </div>
    </div>
  )
}

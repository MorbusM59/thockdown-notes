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
import { isSealedNoteId } from '../shared/helpGuide'
import type { ChapterPillSplitArm } from '../chapters/useChapterPillActions'
import { EscapeHoldPanel, type ExportScope } from './EscapeHoldPanel'
import { focusEscapeHoldRing } from './escapeHoldRingFocus'
import { splitChapterFamily } from '../shared/chapters'
import type { EscapeMenuContribution } from '../escapeMenu/escapeMenuContract'
import { EscapeMenuChromeBarRow, EscapeMenuChromeGauges, EscapeMenuChromeStatsRow } from '../escapeMenu/EscapeMenuStatus'

export interface SectionEditorAreaProps {
  sectionId: string
  isSectionActive: boolean
  isPreviewMode: boolean
  editorStageRef: RefObject<HTMLDivElement>
  sectionContainerRef: MutableRefObject<HTMLDivElement | null>
  previewedSnapshotId: number | null
  bindings: EditorBindings
  adapterRef: MutableRefObject<EditorAdapter | null>
  /** Passed to the editor as `onSurfaceReady` -- see useEditorSectionMount's handleEditorSurfaceReady. */
  onEditorSurfaceReady: () => void
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
  onEscapeHoldExportPdf: (scope: ExportScope) => void | Promise<void>
  onEscapeHoldExportMd: (scope: ExportScope) => void | Promise<void>
  onEscapeHoldOpenHelp: () => void | Promise<void>
  /** Passed straight through to EscapeHoldPanel -- see its own `escapeMenu` prop and escapeMenuContract.ts. */
  escapeMenu?: EscapeMenuContribution | null
  isExportingPdf: boolean
  isExportingMd: boolean
  /** Live user-configurable corner-radius/spacing base units (options menu sliders) -- threaded through so the escape-hold ring (escapeHoldRingLayout.ts) recomputes to match .editor-empty-state's actual on-screen shape instead of drifting from a stale hardcoded mirror. */
  borderRadiusRegularPx: number
  spacingRegularPx: number
  /** The Performance section's "Reduce visual effects" toggle (App.tsx) -- also picked up by the escape-hold ring to fall back from its curve-sampled dial rotation to a plain CSS transform transition. */
  reduceVisualEffects: boolean
  spellCheckEditEnabled: boolean
  previewTextureRef: RefObject<HTMLDivElement>
  /** Where the long-journey bridge draws -- see editor/scrollBridge.ts. */
  previewBridgeHostRef: RefObject<HTMLDivElement>
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
  /** The chapter bar's own trailing "+" pill -- see ChapterBar.tsx's onCreateChapter doc comment. */
  onCreateChapter: () => void | Promise<void>
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
  /** Options > Caret "size" slider -- see CM6Editor's updateCaret for how it reshapes the caret box. */
  caretSizeDeviationPx: number
  showLineNumbers: boolean
  showReviewFlags: boolean
  /** Immersive mode (App.tsx isImmersiveMode) -- the edit view draws its scroll track into the grid (CM6Editor). */
  isImmersiveMode: boolean
  onToggleReviewGutter: () => void
  onToggleReviewFlags: () => void
  /** Whether the active note (or its whole chapter family) is frozen in time -- see databaseService.ts's freezeNoteFamily. Forces the editor read-only, hides the Time Machine timeline, and disables chapter/tag mutation affordances, same shape as isViewingAutoTocChapter/isViewingAutoOpenItemsChapter below. */
  isViewingTimelessNote: boolean
  /** The repurposed line-numbers/review-flags button's preview-mode action -- freezes/unfreezes the active note. See EditorSection.tsx's onToggleTimeless. */
  onToggleTimeless: () => void | Promise<void>
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
  /** Chapter bar's metadata/content swap -- see ChapterBar's own props. */
  isTagBarMode: boolean
  toggleTagBarMode: () => void
  tagBar: ReactNode
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
  onEditorSurfaceReady,
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
  escapeMenu,
  isExportingPdf,
  isExportingMd,
  borderRadiusRegularPx,
  spacingRegularPx,
  reduceVisualEffects,
  spellCheckEditEnabled,
  previewTextureRef,
  previewBridgeHostRef,
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
  onCreateChapter,
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
  caretSizeDeviationPx,
  showLineNumbers,
  showReviewFlags,
  isImmersiveMode,
  onToggleReviewGutter,
  onToggleReviewFlags,
  isViewingTimelessNote,
  onToggleTimeless,
  isViewingAutoTocChapter,
  isViewingAutoOpenItemsChapter,
  isTagBarMode,
  toggleTagBarMode,
  tagBar,
}: SectionEditorAreaProps) {
  // Sealed: shipped documentation the user reads but never edits -- see
  // isSealedNoteId. Checked against the note's family identity, so every
  // chapter of the guide is sealed too, not just its root.
  const isSealedNote = isSealedNoteId(menuIdentityNoteId) || isSealedNoteId(activeNoteId)

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

  // Gates both the escape-hold panel's own visibility and the shared
  // .editor-empty-state box's visibility below -- see the box's own render
  // for why it's the same node either way. `isEscapeHoldPanelOpen` already
  // accounts for a mode owning a slot (App.tsx's isEscapeRingUp); deriving
  // that a second time here would give this component a private opinion
  // about whether the ring is up, which is how Escape stopped closing it.
  /**
   * Whether THIS slot draws the ring.
   *
   * Two different things can put one here, and only one of them follows
   * focus. The quick-actions ring is a transient menu the reader raised over
   * whatever they are looking at, so it belongs to the active slot. A MODE
   * is not that: it is this slot's persistent interface, which happens to be
   * drawn as a ring because it borrows the escape menu's chrome. It does not
   * compete for the window's single ring and does not move when focus does.
   *
   * ANDing both against `isSectionActive` is what made opening a second slot
   * take the game's own interface away from it -- the game was still there,
   * still occupying its slot, with no menu.
   */
  const isEscapeHoldActive = Boolean(escapeMenu?.activeMode) || (isEscapeHoldPanelOpen && isSectionActive)

  // Which cell the ring is sitting on, so the chapter bar can show what that
  // cell would DO. Held here because this is the one component that renders
  // both the ring and that bar; the panel resolves it and nothing else in the
  // app needs it, so there is no store and no context.
  //
  // It costs nothing while the ring is an ordinary quick-actions menu: those
  // cells carry no detail, so the resolved value is null on every step and
  // React bails out of the re-render. It only ever moves under a MODE -- and
  // a mode has emptied this slot's editor, so what re-renders is a blank one.
  const [activeRingCellId, setActiveRingCellId] = useState<string | null>(null)
  const activeRingCellDetail = escapeMenu?.activeMode?.cells
    .find((cell) => cell.id === activeRingCellId)?.detail ?? null
  const isEmptyStateVisible = !activeNoteId || isEscapeHoldActive

  // The reroll easter egg is disabled while the quick-actions panel is up --
  // otherwise every click on the grid's own padding/gaps (anything that
  // isn't a button) would reroll the animation out from under the buttons.
  const handleEmptyStateClick = useCallback(() => {
    if (isEscapeHoldActive) return
    setSceneRerollNonce((n) => n + 1)
  }, [isEscapeHoldActive])

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

  // Always shown for any active note, chapters or not -- ChapterBar's own
  // trailing "+" pill (its onCreateChapter) is how a note gets its first
  // chapter now, so the bar needs to be reachable before chapters.length
  // ever goes positive, not just after. No user-facing show/hide control
  // exists; it simply tracks whether there's a note to show chapters of.
  // A mode that owns this slot (escapeMenuContract.ts) has no note and so no
  // chapters and no tags -- but it does have something to say. This bar is
  // where the editor already shows "what is going on with the thing you are
  // looking at", so the panel opens for a mode too and shows the mode's
  // NARRATION here. Its state goes to the tab bar above instead -- see
  // EscapeMenuStatus.tsx for why the two are split that way round.
  const modeStatus = escapeMenu?.activeMode?.status ?? null
  const isChapterPanelOpen = Boolean(activeNoteId) || Boolean(modeStatus)

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
            {isEscapeHoldActive ? (
              // Pure dim+blur backdrop: its backdrop-filter blurs whatever's
              // behind it (the real note content in edit/render-container
              // below), and it swallows clicks aimed at the note underneath.
              // It does NOT close the panel -- see EscapeHoldPanel.tsx's doc
              // comment for why nothing outside the ring dismisses it. It also
              // does NOT wrap the panel: the panel is a sibling that paints in
              // front of this, so the blur never touches it (backdrop-filter
              // only blurs what's behind the element it's set on, not its own
              // descendants -- see the empty-state box further down for why
              // that matters).
              <div
                className="editor-escape-hold-backdrop"
                aria-hidden="true"
                // A CLICK HERE BELONGS TO THE RING, so it hands the ring
                // the keyboard -- it does not merely decline to take it away.
                //
                // Declining was the whole of this, and it only worked from a
                // state you were already in: preventDefault stops the
                // mousedown moving focus to <body>, which is right when focus
                // is in the ring, and does nothing at all when the reader has
                // been in the sidebar since. Then the dimmed area was the one
                // surface with no way back -- the ring's own recovery
                // (handleRingFocusOut) only fires for focus that landed on
                // <body>, and App.tsx's click-to-refocus stands down entirely
                // while a ring is up, both correctly. Nobody owned it.
                //
                // preventDefault stays, and for the same reason as before: it
                // is what stops the browser clearing focus after this runs.
                onMouseDown={(event) => {
                  event.preventDefault()
                  focusEscapeHoldRing(sectionContainerRef.current)
                }}
              />
            ) : null}
            <div className={`edit-container${isPreviewMode ? ' is-pane-hidden' : ''}`}>
              <div className="markdown-editor-texture" />
              {activeNoteId ? (
                <CM6Editor
                  bindings={bindings}
                  adapterRef={adapterRef}
                  onSurfaceReady={onEditorSurfaceReady}
                  isSectionActive={isSectionActive}
                  isEditPaneVisible={!isPreviewMode}
                  noteId={activeNoteId}
                  initialText={editorDisplayText}
                  scrollbarHost={scrollbarHostEl}
                  fontFamily={editorFontFamily}
                  fontSizePx={editorRuntimeMetrics.fontSizePx}
                  lineHeightPx={editorRuntimeMetrics.lineHeightPx}
                  glyphWidthPx={editorRuntimeMetrics.glyphWidthPx}
                  cellWidthPx={editorRuntimeMetrics.cellWidthPx}
                  editorReadOnly={activeNoteHasDebugTag || isPreviewingSnapshot || isViewingAutoTocChapter || isViewingAutoOpenItemsChapter || isViewingTimelessNote}
                  spellCheckEnabled={editorSpellCheckEnabled}
                  fontReady={editorFontLoadVersion > 0}
                  caretSuspended={isCaretSuspended}
                  caretSizeDeviationPx={caretSizeDeviationPx}
                  showLineNumbers={showLineNumbers}
                  showReviewFlags={showReviewFlags}
                  isImmersive={isImmersiveMode}
                />
              ) : null}
            </div>
            <div ref={previewBridgeHostRef} className={`render-container${isPreviewMode ? '' : ' is-pane-hidden'}`} aria-hidden={!isPreviewMode}>
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
                {activeNoteId ? previewMarkdownElement : null}
              </div>
            </div>
            {/* The one shared "no note here" visual -- same node whether a
                note simply isn't open or the quick-actions panel is up over
                one that is (see isEmptyStateVisible above), so the animation
                is always the literal same instance, never restarted or
                duplicated, and always the same fixed --circle-diameter size.
                The plate right below is its opaque backing (see editor.css
                for why they're two elements sharing one geometry rule), so
                the circle looks identical here and in the plain empty state
                regardless of whether the escape-hold blur is showing behind
                both of them. The grid inside stays permanently mounted too
                -- it toggles its own display:none internally off the
                `isOpen` prop -- so EscapeHoldPanel's focus-management (also
                keyed off `isOpen`, not mount) keeps working across repeated
                opens. */}
            <div className={`editor-empty-state-plate${isEmptyStateVisible ? ' is-visible' : ''}`}/>
            <div
              className={`editor-empty-state${isEmptyStateVisible ? ' is-visible' : ''}`}
              style={{ '--empty-state-scene-mask': emptyStateSceneMaskUrl } as CSSProperties}
              onClick={handleEmptyStateClick}
              role={isEscapeHoldActive ? 'dialog' : undefined}
              aria-label={isEscapeHoldActive ? 'Quick note panel' : undefined}
              aria-live={isEscapeHoldActive ? 'polite' : undefined}
            >
              <EscapeHoldPanel
                isOpen={isEscapeHoldActive}
                isSectionActive={isSectionActive}
                activeNoteId={activeNoteId}
                isActiveNoteTimeless={isViewingTimelessNote}
                hasChapters={splitChapterFamily(chapters, notes).realChapters.length > 0}
                isPreviewMode={isPreviewMode}
                isExportingPdf={isExportingPdf}
                isExportingMd={isExportingMd}
                borderRadiusRegularPx={borderRadiusRegularPx}
                spacingRegularPx={spacingRegularPx}
                reduceVisualEffects={reduceVisualEffects}
                onCreateNote={onEscapeHoldCreateNote}
                onCreateChapter={onEscapeHoldCreateChapter}
                onExportPdf={onEscapeHoldExportPdf}
                onExportMd={onEscapeHoldExportMd}
                onOpenHelp={onEscapeHoldOpenHelp}
                onActiveCellChange={setActiveRingCellId}
                escapeMenu={escapeMenu}
                onClose={onEscapeHoldPanelClose}
              />
            </div>
          </div>
        </div>
      </main>
      <aside className={`editor-scrollbar-slot${isChapterPanelOpen ? ' chapter-panel-is-open' : ''}${isPreviewMode ? ' is-preview-mode' : ''}`}>
        <div className="editor-scrollbar-slot-inner" aria-hidden={modeStatus ? undefined : true}>
          {modeStatus ? (
            <EscapeMenuChromeGauges status={modeStatus} />
          ) : !isPreviewMode ? (
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
                data-secondary-press="action"
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
        {modeStatus ? (
          <EscapeMenuChromeBarRow status={modeStatus} detail={activeRingCellDetail} />
        ) : activeNoteId && menuIdentityNoteId ? (
          <ChapterBar
            parentNoteId={menuIdentityNoteId}
            chapters={chapters}
            archivedMergedChapterIds={archivedMergedChapterIds}
            notes={notes}
            activeNoteId={activeNoteId}
            isLocked={isViewingTimelessNote}
            onParentTabClick={onParentTabClick}
            onCreateChapter={onCreateChapter}
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
            isTagBarMode={isTagBarMode}
            toggleTagBarMode={toggleTagBarMode}
            tagBar={tagBar}
          />
        ) : null}
      </div>
      <div className="editor-document-stats" aria-live="polite">
        {/* The branch is at the ROW, not at each position in it. A mode owning
            a slot owns this whole row -- the rule was already true and was
            spelled four times, once per panel, which is how the row's SHAPE
            ended up being the editor's with a mode's contents poured into it.
            The mode's row has boxes the editor's does not (an identity, two
            meters flanking the strip), so it lays itself out.
            See escapeMenuContract.ts's EscapeMenuModeChrome. */}
        {modeStatus ? (
          <EscapeMenuChromeStatsRow status={modeStatus} />
        ) : (
        <>
        <div className="chapter-toggle-panel">
          {/*
            Mode-aware: in edit mode this is the line-numbers/review-flags
            toggle (unchanged). In preview mode -- where line numbers have
            nothing to show, so this button did nothing before -- it becomes
            the timeless toggle instead: a snowflake, lit up when the active
            note is currently frozen. Since a timeless note is always forced
            into preview (EditorSection.tsx's activateNote), this is also the
            only place the button is ever reachable for an already-frozen
            note -- exactly the "clearing the flag" escape hatch.
          */}
          {isPreviewMode ? (
            <button
              type="button"
              className={`chapter-toggle-button btn-icon${isViewingTimelessNote ? ' is-active' : ''}`}
              aria-label={isSealedNote
                ? 'This document is read-only'
                : (isViewingTimelessNote ? 'Unfreeze this note' : 'Freeze this note in time')}
              aria-pressed={isViewingTimelessNote}
              // A sealed document (the built-in User Guide) can never be
              // unfrozen -- the main process refuses it too, so this is the
              // honest presentation of a rule that holds either way rather
              // than the rule itself.
              disabled={isSealedNote}
              data-tooltip={isSealedNote
                ? 'The User Guide cannot be modified'
                : (isViewingTimelessNote ? 'Unfreeze this note' : 'Freeze this note in time (read-only, no history)')}
              onClick={() => { void onToggleTimeless() }}
            >
              <span className="fa-solid fa-snowflake" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className={`chapter-toggle-button btn-icon${(showLineNumbers || showReviewFlags) ? ' is-active' : ''}`}
              aria-label="Toggle line numbers and review flags (right-click to toggle review flags only)"
              aria-pressed={showLineNumbers || showReviewFlags}
              data-tooltip="Left-click: toggle line numbers + review flags. Right-click: toggle review flags only."
              onClick={onToggleReviewGutter}
              data-secondary-press="action"
              onContextMenu={(event) => {
                event.preventDefault()
                onToggleReviewFlags()
              }}
            >
              <span className="fa-solid fa-hashtag" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="wordcount-panel" aria-live="polite">
          {activeNoteId ? (
            <span><b>{activeNoteDocumentStats.wordCount.toLocaleString()}</b> ({activeNoteDocumentStats.characterCount.toLocaleString()})</span>
          ) : null}
        </div>
        <div className="timeline-panel">
        {activeNoteId && !isViewingAutoTocChapter && !isViewingAutoOpenItemsChapter && !isViewingTimelessNote ? (
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
            hasPendingManualChanges={activeNoteId && !isViewingTimelessNote ? ((isViewingAutoTocChapter || isViewingAutoOpenItemsChapter) ? true : noteSnapshots.hasPendingManualChanges) : false}
            onCreateManualSnapshot={() => { void handleCreateManualSnapshot() }}
            onGoToPresent={activeNoteId ? handleReturnToPresent : undefined}
            onMergeAdjacentSnapshots={activeNoteId && !isViewingAutoTocChapter && !isViewingAutoOpenItemsChapter && !isViewingTimelessNote ? handleMergeAdjacentSnapshots : undefined}
            isPresent={previewedSnapshotId === null}
            disabled={!activeNoteId || isViewingTimelessNote}
            pendingActionLabel={
              isViewingAutoTocChapter
                ? 'Refresh table of contents from live state'
                : isViewingAutoOpenItemsChapter
                  ? 'Refresh open items from live state'
                  : undefined
            }
          />
        </div>
        </>
        )}
      </div>
    </div>
  )
}

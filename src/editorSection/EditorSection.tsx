import type { MouseEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { UseSectionTabsResult } from '../tabBar/useSectionTabs'
import { SectionTabBar } from '../tabBar/SectionTabBar'
import { SectionEditorArea, type SectionEditorAreaProps } from './SectionEditorArea'
import type { UseMarkdownFormattingToolbarResult } from './useMarkdownFormattingToolbar'

export interface EditorSectionProps extends UseSectionTabsResult, UseMarkdownFormattingToolbarResult, Omit<SectionEditorAreaProps, 'sectionId' | 'markSectionActive' | 'activeNoteId'> {
  sectionId: string
  markSectionActive: (sectionId: string) => void
  activeNoteId: string | null
  isSidebarVisible: boolean
  toggleSidebarVisible: () => void
  persistenceReady: boolean
  notes: NoteSummary[]
  activeNoteSummary: NoteSummary | null

  toggleRenderViewMode: () => void
  createNote: (initialText?: string) => Promise<void>
  setSpellCheckRenderEnabled: (updater: (previous: boolean) => boolean) => void
  setSpellCheckEditEnabled: (updater: (previous: boolean) => boolean) => void
  queueAppStateSave: (selectedNoteId: string | null) => void
  handleExportPdf: () => void | Promise<void>
  chooseExportFolder: () => Promise<void>
  isExportingPdf: boolean
  handleExportMd: (forceChooseFolder?: boolean) => Promise<void>
  isExportingMd: boolean
}

/**
 * One full editor section: the markdown-formatting toolbar, the tag/tab
 * bar, and the editor+preview+timeline area. Extracted verbatim from
 * App.tsx's JSX with zero behavior change -- everything it needs is still
 * a plain prop, called once today with DEFAULT_EDITOR_SECTION_ID. Moving
 * the section-scoped hooks to live inside this component (instead of being
 * called in App.tsx and threaded down) is a later, separate step.
 */
export function EditorSection({
  sectionId,
  markSectionActive,
  activeNoteId,
  isSidebarVisible,
  toggleSidebarVisible,
  persistenceReady,
  notes,
  activeNoteSummary,
  toggleRenderViewMode,
  createNote,
  setSpellCheckRenderEnabled,
  setSpellCheckEditEnabled,
  queueAppStateSave,
  handleExportPdf,
  chooseExportFolder,
  isExportingPdf,
  handleExportMd,
  isExportingMd,
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
  toggleBulletedList,
  toggleNumberedList,
  toggleChecklistList,
  toggleBlockquote,
  applyLink,
  applyInlineCode,
  applyCodeBlock,
  insertHorizontalRule,
  isPreviewMode,
  spellCheckEditEnabled,
  spellCheckRenderEnabled,
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
  ...editorAreaProps
}: EditorSectionProps) {
  return (
    <>
      <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Editor toolbar">
        <div className="note-tools">
          <button
            className={`btn-icon ${!isPreviewMode ? 'active' : ''}`}
            type="button"
            title={isPreviewMode ? 'Switch to Edit Mode (Esc)' : 'Switch to Render View (Esc)'}
            aria-label={isPreviewMode ? 'Switch to Edit Mode (Esc)' : 'Switch to Render View (Esc)'}
            onClick={toggleRenderViewMode}
          >
            <span className="fa-solid fa-pen-to-square" aria-hidden="true" />
          </button>
          <button
            className="btn-icon"
            type="button"
            title="Create note (Ctrl+N)"
            aria-label="Create note"
            onClick={() => {
              void createNote()
            }}
          >
            <span className="fa-solid fa-file" aria-hidden="true" />
          </button>
          <button
            className={`btn-icon ${(isPreviewMode ? spellCheckRenderEnabled : spellCheckEditEnabled) ? 'active' : ''}`}
            type="button"
            title={
              isPreviewMode
                ? (spellCheckRenderEnabled ? 'Disable spell check' : 'Enable spell check')
                : (spellCheckEditEnabled ? 'Disable spell check' : 'Enable spell check')
            }
            aria-label={
              isPreviewMode
                ? (spellCheckRenderEnabled ? 'Disable spell check' : 'Enable spell check')
                : (spellCheckEditEnabled ? 'Disable spell check' : 'Enable spell check')
            }
            aria-pressed={isPreviewMode ? spellCheckRenderEnabled : spellCheckEditEnabled}
            onClick={() => {
              if (isPreviewMode) {
                setSpellCheckRenderEnabled((prev) => !prev)
              } else {
                setSpellCheckEditEnabled((prev) => !prev)
              }
              queueAppStateSave(activeNoteId)
            }}
          >
            <span className="fa-solid fa-spell-check" aria-hidden="true" />
          </button>

          {isPreviewMode ? (
            <button
              type="button"
              className="btn-icon"
              title="Export PDF"
              aria-label="Export current note to PDF"
              onClick={handleExportPdf}
              onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                void chooseExportFolder()
              }}
              disabled={!activeNoteId || isExportingPdf}
            >
              <span className="fa-solid fa-file-pdf" aria-hidden="true" />
            </button>
          ) : null}

          {!isPreviewMode ? (
            <button
              type="button"
              className="btn-icon"
              title="Export Markdown"
              aria-label="Export current note to Markdown"
              onClick={() => void handleExportMd()}
              onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault()
                void handleExportMd(true)
              }}
              disabled={!activeNoteId || isExportingMd}
            >
              <span className="fa-solid fa-file-code" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="toolbar-container">
          {!isPreviewMode ? (
            <div className="markdown-toolbar" aria-label="Markdown toolbar">
              <div className="toolbar-group">
                <button
                  type="button"
                  className={`btn-icon ${activeDecorationFormats.has('bold') ? 'active' : ''}`}
                  onClick={() => applyTextDecoration('bold')}
                  title="Bold"
                  aria-label="Bold"
                  disabled={!activeNoteId}
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  className={`btn-icon ${activeDecorationFormats.has('italic') ? 'active' : ''}`}
                  onClick={() => applyTextDecoration('italic')}
                  title="Italic"
                  aria-label="Italic"
                  disabled={!activeNoteId}
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  className={`btn-icon ${activeDecorationFormats.has('strikethrough') ? 'active' : ''}`}
                  onClick={() => applyTextDecoration('strikethrough')}
                  title="Strikethrough"
                  aria-label="Strikethrough"
                  disabled={!activeNoteId}
                >
                  <span style={{ textDecoration: 'line-through' }}>S</span>
                </button>
              </div>

              <div className="toolbar-group">
                <button type="button" className={`btn-icon ${activeHeadingLevel === 1 ? 'active' : ''}`} title="Heading 1" onClick={() => applyHeading(1)} disabled={!activeNoteId}>H1</button>
                <button type="button" className={`btn-icon ${activeHeadingLevel === 2 ? 'active' : ''}`} title="Heading 2" onClick={() => applyHeading(2)} disabled={!activeNoteId}>H2</button>
                <button type="button" className={`btn-icon ${activeHeadingLevel === 3 ? 'active' : ''}`} title="Heading 3" onClick={() => applyHeading(3)} disabled={!activeNoteId}>H3</button>
              </div>

              <div className="toolbar-group">
                <button type="button" className={`btn-icon ${isBulletedListActive ? 'active' : ''}`} title="Bulleted list" onClick={toggleBulletedList} disabled={!activeNoteId}>≡</button>
                <button type="button" className={`btn-icon ${isNumberedListActive ? 'active' : ''}`} title="Numbered list" onClick={toggleNumberedList} disabled={!activeNoteId}>#</button>
                <button type="button" className={`btn-icon ${isChecklistActive ? 'active' : ''}`} title="Checklist" onClick={toggleChecklistList} disabled={!activeNoteId}>☐</button>
              </div>

              <div className="toolbar-group">
                <button type="button" className={`btn-icon ${isBlockquoteActive ? 'active' : ''}`} title="Blockquote" onClick={toggleBlockquote} disabled={!activeNoteId}>&quot;</button>
                <button type="button" className={`btn-icon ${isCodeBlockActive ? 'active' : ''}`} title="Code block" onClick={applyCodeBlock} disabled={!activeNoteId}>{'{ }'}</button>
                <button type="button" className={`btn-icon ${isInlineCodeActive ? 'active' : ''}`} title="Inline code" onClick={applyInlineCode} disabled={!activeNoteId}>{'<>'}</button>
              </div>

              <div className="toolbar-group">
                <button type="button" className="btn-icon" title="Horizontal rule" onClick={insertHorizontalRule} disabled={!activeNoteId}>—</button>
                <button type="button" className="btn-icon" title="Link" onClick={applyLink} disabled={!activeNoteId}>🔗</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

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
      />

      <SectionEditorArea
        sectionId={sectionId}
        markSectionActive={markSectionActive}
        isPreviewMode={isPreviewMode}
        activeNoteId={activeNoteId}
        spellCheckEditEnabled={spellCheckEditEnabled}
        spellCheckRenderEnabled={spellCheckRenderEnabled}
        {...editorAreaProps}
      />
    </>
  )
}

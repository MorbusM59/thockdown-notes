import type { MouseEvent } from 'react'
import type { UseMarkdownFormattingToolbarResult } from '../editorSection/useMarkdownFormattingToolbar'

export interface EditorToolbarProps extends UseMarkdownFormattingToolbarResult {
  isPreviewMode: boolean
  /** True while the active note is an auto-TOC/auto-Open-Items chapter, which is always shown in render view and can't be switched to edit mode. Disables and relabels the edit/preview toggle instead of leaving it clickable-but-inert. */
  isForcedPreview: boolean
  activeNoteId: string | null
  toggleRenderViewMode: () => void
  createNote: (initialText?: string) => Promise<void>
  spellCheckEditEnabled: boolean
  spellCheckRenderEnabled: boolean
  setSpellCheckRenderEnabled: (updater: (previous: boolean) => boolean) => void
  setSpellCheckEditEnabled: (updater: (previous: boolean) => boolean) => void
  queueAppStateSave: (selectedNoteId: string | null) => void
  handleExportPdf: () => void | Promise<void>
  chooseExportFolder: () => Promise<string | null>
  isExportingPdf: boolean
  handleExportMd: (forceChooseFolder?: boolean) => Promise<void>
  isExportingMd: boolean
  handleCreateChapter: () => void | Promise<void>
}

/**
 * The single global toolbar -- one instance for the whole app, a "remote
 * control" that always acts on the active section rather than one per
 * section. Sits in the `toolbar` grid cell, sharing the top row with
 * `window_control`; the tabbar/viewer rectangle below it is what actually
 * repeats per section. Extracted verbatim from App.tsx's JSX with zero
 * behavior change.
 */
export function EditorToolbar({
  isPreviewMode,
  isForcedPreview,
  activeNoteId,
  toggleRenderViewMode,
  createNote,
  spellCheckEditEnabled,
  spellCheckRenderEnabled,
  setSpellCheckRenderEnabled,
  setSpellCheckEditEnabled,
  queueAppStateSave,
  handleExportPdf,
  chooseExportFolder,
  isExportingPdf,
  handleExportMd,
  isExportingMd,
  handleCreateChapter,
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
}: EditorToolbarProps) {
  return (
    <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Editor toolbar">
      <div className="note-tools">
        <button
          className={`btn-icon ${!isPreviewMode ? 'is-active' : ''}`}
          type="button"
          data-tooltip={isForcedPreview ? 'This chapter is always shown in render view' : (isPreviewMode ? 'Switch to Edit Mode (Esc)' : 'Switch to Render View (Esc)')}
          aria-label={isForcedPreview ? 'This chapter is always shown in render view' : (isPreviewMode ? 'Switch to Edit Mode (Esc)' : 'Switch to Render View (Esc)')}
          onClick={toggleRenderViewMode}
          disabled={isForcedPreview}
        >
          <span className="fa-solid fa-pen-to-square" aria-hidden="true" />
        </button>
        <button
          className="btn-icon"
          type="button"
          data-tooltip="Create note (Ctrl+N)"
          aria-label="Create note"
          onClick={() => {
            void createNote()
          }}
        >
          <span className="fa-solid fa-file" aria-hidden="true" />
        </button>
        <button
          className={`btn-icon ${(isPreviewMode ? spellCheckRenderEnabled : spellCheckEditEnabled) ? 'is-active' : ''}`}
          type="button"
          data-tooltip={
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
            data-tooltip="Export PDF"
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
            data-tooltip="Export Markdown"
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
                className={`btn-icon ${activeDecorationFormats.has('bold') ? 'is-active' : ''}`}
                onClick={() => applyTextDecoration('bold')}
                data-tooltip="Bold"
                aria-label="Bold"
                disabled={!activeNoteId}
              >
                <span className="fa-solid fa-bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`btn-icon ${activeDecorationFormats.has('italic') ? 'is-active' : ''}`}
                onClick={() => applyTextDecoration('italic')}
                data-tooltip="Italic"
                aria-label="Italic"
                disabled={!activeNoteId}
              >
                <span className="fa-solid fa-italic" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`btn-icon ${activeDecorationFormats.has('strikethrough') ? 'is-active' : ''}`}
                onClick={() => applyTextDecoration('strikethrough')}
                data-tooltip="Strikethrough"
                aria-label="Strikethrough"
                disabled={!activeNoteId}
              >
                <span className="fa-solid fa-strikethrough" aria-hidden="true" />
              </button>
            </div>

            <div className="toolbar-group">
              <button type="button" className={`btn-icon ${activeHeadingLevel === 1 ? 'is-active' : ''}`} data-tooltip="Heading 1" aria-label="Heading 1" onClick={() => applyHeading(1)} disabled={!activeNoteId}>
                <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h1" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${activeHeadingLevel === 2 ? 'is-active' : ''}`} data-tooltip="Heading 2" aria-label="Heading 2" onClick={() => applyHeading(2)} disabled={!activeNoteId}>
                <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h2" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${activeHeadingLevel === 3 ? 'is-active' : ''}`} data-tooltip="Heading 3" aria-label="Heading 3" onClick={() => applyHeading(3)} disabled={!activeNoteId}>
                <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h3" aria-hidden="true" />
              </button>
            </div>

            <div className="toolbar-group">
              <button type="button" className={`btn-icon ${isBulletedListActive ? 'is-active' : ''}`} data-tooltip="Bulleted list" aria-label="Bulleted list" onClick={toggleBulletedList} disabled={!activeNoteId}>
                <span className="fa-solid fa-list" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${isNumberedListActive ? 'is-active' : ''}`} data-tooltip="Numbered list" aria-label="Numbered list" onClick={toggleNumberedList} disabled={!activeNoteId}>
                <span className="fa-solid fa-list-ol" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${isChecklistActive ? 'is-active' : ''}`} data-tooltip="Checklist" aria-label="Checklist" onClick={toggleChecklistList} disabled={!activeNoteId}>
                <span className="fa-solid fa-square-check" aria-hidden="true" />
              </button>
            </div>

            <div className="toolbar-group">
              <button type="button" className={`btn-icon ${isBlockquoteActive ? 'is-active' : ''}`} data-tooltip="Blockquote" aria-label="Blockquote" onClick={toggleBlockquote} disabled={!activeNoteId}>
                <span className="fa-solid fa-quote-left" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${isCodeBlockActive ? 'is-active' : ''}`} data-tooltip="Code block" aria-label="Code block" onClick={applyCodeBlock} disabled={!activeNoteId}>
                <span className="fa-solid fa-terminal" aria-hidden="true" />
              </button>
              <button type="button" className={`btn-icon ${isInlineCodeActive ? 'is-active' : ''}`} data-tooltip="Inline code" aria-label="Inline code" onClick={applyInlineCode} disabled={!activeNoteId}>
                <span className="fa-solid fa-code" aria-hidden="true" />
              </button>
            </div>

            <div className="toolbar-group">
              <button type="button" className="btn-icon" data-tooltip="Horizontal rule" aria-label="Horizontal rule" onClick={insertHorizontalRule} disabled={!activeNoteId}>
                <span className="fa-solid fa-window-minimize" aria-hidden="true" />
              </button>
              <button type="button" className="btn-icon" data-tooltip="Link (Ctrl+L)" onClick={applyLink} disabled={!activeNoteId}><span className="fa-solid fa-link" aria-hidden="true" /></button>
              <button type="button" className="btn-icon" data-tooltip="Set anchor (Shift+Ctrl+L)" onClick={applyAnchor} disabled={!activeNoteId}><span className="fa-solid fa-anchor" aria-hidden="true" /></button>
            </div>
            <div className="toolbar-group chapter-group">
              <button
                type="button"
                className={`btn-icon ${isTableOfContentsActive ? 'is-active' : ''}`}
                data-tooltip={isTableOfContentsActive ? 'Remove table of contents' : 'Insert table of contents'}
                aria-label={isTableOfContentsActive ? 'Remove table of contents' : 'Insert table of contents'}
                disabled={!activeNoteId}
                onClick={() => {
                  if (isTableOfContentsActive) {
                    toggleTableOfContents()
                  } else {
                    insertTableOfContents()
                  }
                }}
              >
                <span className="fa-solid fa-list-ol" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-icon"
                data-tooltip="Add a chapter"
                aria-label="Add a chapter"
                disabled={!activeNoteId}
                onClick={() => {
                  void handleCreateChapter()
                }}
              >
                <span className="fa-solid fa-book-medical" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : <div className="markdown-toolbar" aria-label="Markdown toolbar"/>}
      </div>
    </section>
  )
}

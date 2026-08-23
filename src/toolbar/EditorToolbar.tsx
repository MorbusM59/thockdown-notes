import type { UseMarkdownFormattingToolbarResult } from '../editorSection/useMarkdownFormattingToolbar'

export interface EditorToolbarProps extends UseMarkdownFormattingToolbarResult {
  isPreviewMode: boolean
  activeNoteId: string | null
  /** 'dark' while the app is in dark UI mode -- drives the top arm of the note-tools split button. */
  uiMode: string
  toggleUiMode: () => void
  isDoubleSizeMode: boolean
  handleToggleDoubleSizeMode: () => void
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
  activeNoteId,
  uiMode,
  toggleUiMode,
  isDoubleSizeMode,
  handleToggleDoubleSizeMode,
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
        <div className="note-tools-split" role="group" aria-label="Dark mode and double size controls">
          <button
            type="button"
            className={`btn-icon note-tools-split-btn dark-mode${uiMode === 'dark' ? ' is-active' : ''}`}
            data-tooltip="Toggle dark mode"
            aria-label="Toggle dark mode"
            aria-pressed={uiMode === 'dark'}
            onClick={toggleUiMode}
          >
            <span className="fa-solid fa-moon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`btn-icon note-tools-split-btn double-size${isDoubleSizeMode ? ' is-active' : ''}`}
            data-tooltip={isDoubleSizeMode ? 'Exit double size' : 'Double size'}
            aria-label={isDoubleSizeMode ? 'Exit double size mode' : 'Enable double size mode'}
            aria-pressed={isDoubleSizeMode}
            onClick={handleToggleDoubleSizeMode}
          >
            <span className="double-size-glyph fa-solid fa-eye" aria-hidden="true" />
          </button>
        </div>
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

import type { UseMarkdownFormattingToolbarResult } from '../editorSection/useMarkdownFormattingToolbar'

export interface EditorToolbarProps extends UseMarkdownFormattingToolbarResult {
  isPreviewMode: boolean
  /** True while the active note is an auto-TOC/auto-Open-Items chapter, which is always shown in render view and can't be switched to edit mode. The formatting buttons stay visible but disabled, since their preview-mode behavior (switch to edit mode) is impossible there. */
  isForcedPreview: boolean
  activeNoteId: string | null
  /** Flips the active section between edit and render view -- what every formatting button does instead of formatting while the section is in preview mode. */
  toggleRenderViewMode: () => void
  /** 'dark' while the app is in dark UI mode -- drives the top arm of the display-modes split button. */
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
 * repeats per section.
 *
 * The formatting group is rendered in both edit and preview mode -- the
 * toolbar's shape shouldn't change under you just because the active section
 * flipped to render view. In preview mode every one of those buttons is
 * re-purposed into "switch this section to edit mode" (see `inEditMode`)
 * rather than being hidden or inert: the first click gets you somewhere the
 * button can actually work, the second click does the formatting.
 */
export function EditorToolbar({
  isPreviewMode,
  isForcedPreview,
  activeNoteId,
  toggleRenderViewMode,
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
  /**
   * Wraps a formatting action so it only ever runs in edit mode. While the
   * active section is in preview mode the click leaves the document alone and
   * switches to edit mode instead -- deliberately NOT "switch, then apply",
   * so a stray click on a rendered note can't silently edit it.
   */
  const inEditMode = (action: () => void) => () => {
    if (isPreviewMode) {
      toggleRenderViewMode()
      return
    }
    action()
  }

  // A forced-preview chapter can't leave render view at all, so the
  // preview-mode behavior above has nowhere to go -- disable rather than
  // leaving a row of buttons that do nothing when clicked.
  const formattingDisabled = !activeNoteId || (isPreviewMode && isForcedPreview)

  return (
    <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Editor toolbar">
      <div className="display-modes">
        <div className="display-modes-split" role="group" aria-label="Dark mode and double size controls">
          <button
            type="button"
            className={`btn-icon display-modes-split-btn dark-mode${uiMode === 'dark' ? ' is-active' : ''}`}
            data-tooltip="Toggle dark mode"
            aria-label="Toggle dark mode"
            aria-pressed={uiMode === 'dark'}
            onClick={toggleUiMode}
          >
            <span className="fa-solid fa-moon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`btn-icon display-modes-split-btn double-size${isDoubleSizeMode ? ' is-active' : ''}`}
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
        <div className="markdown-toolbar" aria-label="Markdown toolbar">
          <div className="toolbar-group">
            <button
              type="button"
              className={`btn-icon ${activeDecorationFormats.has('bold') ? 'is-active' : ''}`}
              onClick={inEditMode(() => applyTextDecoration('bold'))}
              data-tooltip="Bold"
              aria-label="Bold"
              disabled={formattingDisabled}
            >
              <span className="fa-solid fa-bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`btn-icon ${activeDecorationFormats.has('italic') ? 'is-active' : ''}`}
              onClick={inEditMode(() => applyTextDecoration('italic'))}
              data-tooltip="Italic"
              aria-label="Italic"
              disabled={formattingDisabled}
            >
              <span className="fa-solid fa-italic" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`btn-icon ${activeDecorationFormats.has('strikethrough') ? 'is-active' : ''}`}
              onClick={inEditMode(() => applyTextDecoration('strikethrough'))}
              data-tooltip="Strikethrough"
              aria-label="Strikethrough"
              disabled={formattingDisabled}
            >
              <span className="fa-solid fa-strikethrough" aria-hidden="true" />
            </button>
          </div>

          <div className="toolbar-group">
            <button type="button" className={`btn-icon ${activeHeadingLevel === 1 ? 'is-active' : ''}`} data-tooltip="Heading 1" aria-label="Heading 1" onClick={inEditMode(() => applyHeading(1))} disabled={formattingDisabled}>
              <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h1" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${activeHeadingLevel === 2 ? 'is-active' : ''}`} data-tooltip="Heading 2" aria-label="Heading 2" onClick={inEditMode(() => applyHeading(2))} disabled={formattingDisabled}>
              <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h2" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${activeHeadingLevel === 3 ? 'is-active' : ''}`} data-tooltip="Heading 3" aria-label="Heading 3" onClick={inEditMode(() => applyHeading(3))} disabled={formattingDisabled}>
              <span className="fa-solid fa-heading toolbar-heading-icon toolbar-heading-icon--h3" aria-hidden="true" />
            </button>
          </div>

          <div className="toolbar-group">
            <button type="button" className={`btn-icon ${isBulletedListActive ? 'is-active' : ''}`} data-tooltip="Bulleted list" aria-label="Bulleted list" onClick={inEditMode(toggleBulletedList)} disabled={formattingDisabled}>
              <span className="fa-solid fa-list" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${isNumberedListActive ? 'is-active' : ''}`} data-tooltip="Numbered list" aria-label="Numbered list" onClick={inEditMode(toggleNumberedList)} disabled={formattingDisabled}>
              <span className="fa-solid fa-list-ol" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${isChecklistActive ? 'is-active' : ''}`} data-tooltip="Checklist" aria-label="Checklist" onClick={inEditMode(toggleChecklistList)} disabled={formattingDisabled}>
              <span className="fa-solid fa-square-check" aria-hidden="true" />
            </button>
          </div>

          <div className="toolbar-group">
            <button type="button" className={`btn-icon ${isBlockquoteActive ? 'is-active' : ''}`} data-tooltip="Blockquote" aria-label="Blockquote" onClick={inEditMode(toggleBlockquote)} disabled={formattingDisabled}>
              <span className="fa-solid fa-quote-left" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${isCodeBlockActive ? 'is-active' : ''}`} data-tooltip="Code block" aria-label="Code block" onClick={inEditMode(applyCodeBlock)} disabled={formattingDisabled}>
              <span className="fa-solid fa-terminal" aria-hidden="true" />
            </button>
            <button type="button" className={`btn-icon ${isInlineCodeActive ? 'is-active' : ''}`} data-tooltip="Inline code" aria-label="Inline code" onClick={inEditMode(applyInlineCode)} disabled={formattingDisabled}>
              <span className="fa-solid fa-code" aria-hidden="true" />
            </button>
          </div>

          <div className="toolbar-group">
            <button type="button" className="btn-icon" data-tooltip="Horizontal rule" aria-label="Horizontal rule" onClick={inEditMode(insertHorizontalRule)} disabled={formattingDisabled}>
              <span className="fa-solid fa-window-minimize" aria-hidden="true" />
            </button>
            <button type="button" className="btn-icon" data-tooltip="Link (Ctrl+L)" onClick={inEditMode(applyLink)} disabled={formattingDisabled}><span className="fa-solid fa-link" aria-hidden="true" /></button>
            <button type="button" className="btn-icon" data-tooltip="Set anchor (Shift+Ctrl+L)" onClick={inEditMode(applyAnchor)} disabled={formattingDisabled}><span className="fa-solid fa-anchor" aria-hidden="true" /></button>
          </div>
          <div className="toolbar-group chapter-group">
            <button
              type="button"
              className={`btn-icon ${isTableOfContentsActive ? 'is-active' : ''}`}
              data-tooltip={isTableOfContentsActive ? 'Remove table of contents' : 'Insert table of contents'}
              aria-label={isTableOfContentsActive ? 'Remove table of contents' : 'Insert table of contents'}
              disabled={formattingDisabled}
              onClick={inEditMode(() => {
                if (isTableOfContentsActive) {
                  toggleTableOfContents()
                } else {
                  insertTableOfContents()
                }
              })}
            >
              <span className="fa-solid fa-list-ol" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              data-tooltip="Add a chapter"
              aria-label="Add a chapter"
              disabled={formattingDisabled}
              onClick={inEditMode(() => {
                void handleCreateChapter()
              })}
            >
              <span className="fa-solid fa-book-medical" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

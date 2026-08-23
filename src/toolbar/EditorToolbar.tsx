import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { UseMarkdownFormattingToolbarResult } from '../editorSection/useMarkdownFormattingToolbar'

/**
 * Picks the formatting group's layout from the room it actually has: full-size
 * square buttons (the size of a window control) on one row while they fit,
 * mini squares wrapping onto two rows when they don't.
 *
 * Both layouts are the audio player's grid: a full-size button is one large
 * button box (a window control), a compact one is half of that box, two of
 * them stacked in the same footprint -- spacing-small between buttons and
 * rows, spacing-large between the groups of three.
 *
 * The threshold is measured, not a hardcoded breakpoint, because every term in
 * it -- button size, gaps, group padding -- scales with the user's spacing
 * setting, and the button count changes whenever this file's JSX does. The one
 * value that can't be read back as a resolved length is the full button size
 * (it's a custom property, whose computed value is an unresolved token list),
 * so it's derived from the toolbar's own content-box height instead: both
 * layouts share one row height, and a full-size button is exactly that box.
 */
function useFormattingToolbarCompact(toolbarRef: RefObject<HTMLDivElement | null>) {
  const [isCompact, setIsCompact] = useState(false)

  // Deliberately no dependency array: this re-measures after every render as
  // well as on every resize. The ResizeObserver alone would be enough in a
  // steady state, but at mount the toolbar hasn't been given its final grid
  // width yet, so the first measurement is against a width that's about to
  // change -- and anything that changes the spacing tokens re-renders without
  // necessarily resizing this element.
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return

    const measure = () => {
      const availableWidthPx = el.clientWidth
      if (!availableWidthPx) return
      const styles = getComputedStyle(el)
      const paddingXPx = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const buttonSizePx = el.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom)
      const groups = Array.from(el.querySelectorAll<HTMLElement>('.toolbar-group'))
      if (!groups.length || buttonSizePx <= 0) return

      let requiredWidthPx = paddingXPx + (parseFloat(styles.columnGap) || 0) * (groups.length - 1)
      for (const group of groups) {
        const groupStyles = getComputedStyle(group)
        const buttonCount = group.querySelectorAll('button').length
        requiredWidthPx += parseFloat(groupStyles.paddingLeft)
          + parseFloat(groupStyles.paddingRight)
          + buttonCount * buttonSizePx
          + Math.max(0, buttonCount - 1) * (parseFloat(groupStyles.columnGap) || 0)
      }
      // Switching layouts changes neither the row height nor the toolbar's own
      // width, so this can't feed back into the observer (or the render) that
      // triggered it -- setIsCompact with an unchanged value is a no-op.
      setIsCompact(requiredWidthPx > availableWidthPx)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })

  return isCompact
}

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
  const formattingToolbarRef = useRef<HTMLDivElement | null>(null)
  const isFormattingToolbarCompact = useFormattingToolbarCompact(formattingToolbarRef)

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
        <div
          className={`markdown-toolbar${isFormattingToolbarCompact ? ' is-compact' : ''}`}
          aria-label="Markdown toolbar"
          ref={formattingToolbarRef}
        >
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
              <span className="fa-regular fa-square-check" aria-hidden="true" />
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
              <span className="fa-regular fa-bookmark" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

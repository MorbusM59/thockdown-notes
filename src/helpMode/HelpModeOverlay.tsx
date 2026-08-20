import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { HELP_GUIDE_AUTO_TOC_ID, HELP_GUIDE_CHAPTER_IDS, HELP_GUIDE_NOTE_IDS, HELP_GUIDE_ROOT_ID } from '../shared/helpGuide'
import { usePreviewMarkdownRendering, type PreviewScrollToSourceLineFn } from '../editorSection/usePreviewMarkdownRendering'
import type { DocumentFindDirective } from '../editor/FindReplaceEngine'

const EMPTY_FIND_DIRECTIVE: DocumentFindDirective = { findText: '', replaceText: '', isReplaceMode: false }

export interface HelpModeOverlayProps {
  /** The app's full notes array -- filtered internally to the guide's own family (HELP_GUIDE_NOTE_IDS), same source of truth every other note view reads, so the guide's content is never more than one refreshNotes() behind whatever's actually in the database. */
  notes: NoteSummary[]
  onClose: () => void
}

/**
 * The read-only "User Guide" viewer that takes over an editor slot while
 * help mode is active for its section -- see the escape-hold panel's own
 * Help button (EscapeHoldPanel.tsx) for how it's entered, and App.tsx's
 * global Escape handler for how a single tap closes it. Called by
 * SectionEditorArea.tsx as an early return, in place of that component's own
 * normal editor-viewer-frame markup -- not nested inside it -- so this
 * component owns rendering that same container skeleton itself: it must
 * stay pixel-identical to the real editor's
 * editor-viewer-frame > editor-shell > editor-background > editor-stage
 * (content) / editor-scrollbar-slot (aside) / chapter-panel (chapter bar)
 * layout (see editor.css and SectionEditorArea.tsx), just with guide
 * content loaded into it instead of a real note. The chapter bar in
 * particular MUST stay inside `.chapter-panel` (absolutely positioned,
 * bottom-anchored, per editor.css) rather than stacked above the content --
 * putting it anywhere else visibly breaks this layout contract.
 *
 * Deliberately independent of the section's own real note-lifecycle
 * machinery (activateNote, useNoteChapters, autosave, snapshot freeze/thaw,
 * scroll-anchor persistence): this overlay never touches the section's
 * actual `activeNoteId`, so nothing about it needs restoring when it
 * closes, and there's no risk of the guide leaking into persisted
 * app-state as if it were a real open tab (see CLAUDE.md's own history of
 * exactly that bug class). Its own "which note in the guide family is
 * currently shown" state is entirely local to this component and resets
 * to the guide's parent every time help mode opens (this component only
 * ever exists in the tree while it's open).
 *
 * Still reuses real, shared infrastructure rather than reinventing it:
 * usePreviewMarkdownRendering (the exact same virtualized-preview +
 * internal-link-navigation hook every regular note's render view uses,
 * including `$HELP§CHAPTER-ID#anchor-id` cross-links and the auto-TOC's
 * own `@noteId` links) and the same `.chapter-pill`/`.chapter-bar-*`
 * classNames a real chapter bar uses, so it reads as the same visual
 * language -- just click-to-navigate only (no drag reorder, no rename, no
 * archive/delete), since none of that ever applies to a protected system
 * note. Not the real `ChapterBar` component itself: that component's
 * drag-reorder/right-click-rename/hold-to-archive-or-delete gestures are
 * all live editing affordances with nothing behind them here, so reusing it
 * outright would mean either faking out a pile of its handlers or letting
 * a system note look editable when it isn't -- this hand-rolled, strictly
 * click-only bar (same classNames, so same visual result) avoids both.
 */
export function HelpModeOverlay({ notes, onClose }: HelpModeOverlayProps) {
  const guideNotes = useMemo(() => notes.filter((note) => HELP_GUIDE_NOTE_IDS.has(note.id)), [notes])
  const [guideActiveNoteId, setGuideActiveNoteId] = useState(HELP_GUIDE_ROOT_ID)

  const activeNote = guideNotes.find((note) => note.id === guideActiveNoteId)
  const activeNoteText = activeNote?.contentText ?? ''

  const latestEditorTextRef = useRef(activeNoteText)
  useEffect(() => {
    latestEditorTextRef.current = activeNoteText
  }, [activeNoteText])

  // usePreviewMarkdownRendering's activateNote -- switching the guide's own
  // local "which note is shown" state is all a navigation within this
  // family ever needs; there's no real section/editor to hand off to.
  const guideActivateNote = useCallback(async (noteId: string) => {
    setGuideActiveNoteId(noteId)
  }, [])

  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const previewTextureRef = useRef<HTMLDivElement | null>(null)
  const previewScrollToSourceLineRef = useRef<PreviewScrollToSourceLineFn | null>(null)

  const { previewMarkdownElement } = usePreviewMarkdownRendering({
    notes: guideNotes,
    activeNoteId: guideActiveNoteId,
    activeNoteText,
    latestEditorTextRef,
    activateNote: guideActivateNote,
    previewScrollRef,
    documentFindDirective: EMPTY_FIND_DIRECTIVE,
    isDocumentFindCaseSensitive: false,
    renderedDisplayText: activeNoteText,
    previewScrollToSourceLineRef,
    isViewingAutoOpenItemsChapter: false,
  })

  const isRootActive = guideActiveNoteId === HELP_GUIDE_ROOT_ID
  const isTocActive = guideActiveNoteId === HELP_GUIDE_AUTO_TOC_ID

  return (
    <div className="editor-viewer-frame" style={{ flex: '1 1 0' }} role="region" aria-label="User Guide">
      <main className="editor-shell chapter-panel-is-open">
        <div className="editor-background">
          <div className="editor-stage">
            <div className="render-container">
              <div ref={previewTextureRef} className="markdown-preview-texture" />
              <div
                ref={previewScrollRef}
                className="markdown-preview thockdown-custom-scrollbar style-modern"
                style={{ '--search-hit-color': 'transparent' } as CSSProperties}
              >
                {previewMarkdownElement}
              </div>
            </div>
            <button
              type="button"
              className="btn-icon help-mode-close-button"
              data-tooltip="Close User Guide (Esc)"
              aria-label="Close User Guide"
              onClick={onClose}
            >
              <span className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>

      <aside className="editor-scrollbar-slot chapter-panel-is-open">
        <div className="editor-scrollbar-slot-inner" aria-hidden="true">
          <div className="thockdown-scroll-rail">
            <div className="thockdown-scroll-track">
              <div className="thockdown-scroll-thumb is-inactive" style={{ top: 3, bottom: 3 }} />
            </div>
          </div>
        </div>
      </aside>

      <div className="chapter-panel is-open">
        <div className="chapter-bar-row">
          <button
            type="button"
            className={`btn-icon chapter-auto-button${isTocActive ? ' is-active' : ''}`}
            data-tooltip="Table of Contents"
            aria-label="Table of Contents"
            onClick={() => setGuideActiveNoteId(HELP_GUIDE_AUTO_TOC_ID)}
          >
            <span className="fa-solid fa-bookmark" aria-hidden="true" />
          </button>

          <div className="chapter-tab-mode-shell">
            <div className="chapter-bar-scroll-shell">
              <div className="chapter-bar-display" aria-label="User Guide chapters" role="group">
                <div
                  className={`tag-pill note-tab-pill chapter-pill${isRootActive ? ' is-active' : ''}`}
                  onClick={() => setGuideActiveNoteId(HELP_GUIDE_ROOT_ID)}
                  data-tooltip="Help & Reference"
                >
                  <span className="fa-solid fa-book" aria-hidden="true" />
                </div>
                {HELP_GUIDE_CHAPTER_IDS.map(({ noteId }) => {
                  const note = guideNotes.find((entry) => entry.id === noteId)
                  const isActive = noteId === guideActiveNoteId
                  return (
                    <div
                      key={noteId}
                      className={`tag-pill note-tab-pill chapter-pill${isActive ? ' is-active' : ''}`}
                      onClick={() => setGuideActiveNoteId(noteId)}
                      data-tooltip={note?.title ?? 'Untitled'}
                    >
                      <span className="tag-pill-label">{note?.title ?? 'Untitled'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
 * global Escape handler for how a single tap closes it.
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
 * note.
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
    <div className="editor-help-mode-overlay" role="region" aria-label="User Guide">
      <div className="chapter-bar-row help-mode-chapter-bar">
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

      <div className="render-container help-mode-render-container">
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
  )
}

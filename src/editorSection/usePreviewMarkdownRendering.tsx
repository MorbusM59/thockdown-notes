import { useCallback, useMemo } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { DocumentFindDirective } from '../editor/FindReplaceEngine'
import {
  type ParsedInternalPreviewLink,
  normalizeInternalIdForLookup,
  noteContainsAnchorDefinition,
  createPreviewNoteAnchorMarkerRehypePlugin,
  createPreviewMarkdownComponents,
  createPreviewSearchHighlightRehypePlugin,
  createPreviewSourceAnchorRehypePlugin,
  PREVIEW_MARKDOWN_REMARK_PLUGINS,
} from '../editor/PreviewMarkdown'

export interface UsePreviewMarkdownRenderingOptions {
  notes: NoteSummary[]
  activeNoteId: string | null
  activeNoteText: string
  latestEditorTextRef: MutableRefObject<string>
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  documentFindDirective: DocumentFindDirective
  isDocumentFindCaseSensitive: boolean
  renderedDisplayText: string
}

export interface UsePreviewMarkdownRenderingResult {
  previewMarkdownElement: ReactNode
}

/**
 * Renders the current note's markdown into the preview pane -- anchor
 * markers, search-hit highlighting, source-line anchors for scroll sync,
 * and `$id`/`~anchor` internal link navigation -- extracted verbatim from
 * App.tsx with zero behavior change. Depends on the pure preview-markdown
 * primitives in src/editor/PreviewMarkdown.tsx (extracted just before this),
 * which are also shared with the PDF/MD export path.
 */
export function usePreviewMarkdownRendering({
  notes,
  activeNoteId,
  activeNoteText,
  latestEditorTextRef,
  activateNote,
  previewScrollRef,
  documentFindDirective,
  isDocumentFindCaseSensitive,
  renderedDisplayText,
}: UsePreviewMarkdownRenderingOptions): UsePreviewMarkdownRenderingResult {
  const previewNoteAnchorMarkerPlugin = useMemo(
    () => createPreviewNoteAnchorMarkerRehypePlugin(),
    [],
  )

  // Scrolls the currently rendered preview to a `[~name]`/`[~name#uid]`
  // marker, if present. `waitForNoteSwitch` retries across a few animation
  // frames since switching notes re-renders ReactMarkdown asynchronously —
  // the target span may not exist in the DOM yet on the frame this fires.
  const scrollToAnchorInPreview = useCallback((name: string, uid: string | null, waitForNoteSwitch: boolean) => {
    const attemptScroll = (attemptsLeft: number) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('.note-anchor-marker'))
      const target = candidates.find((el) => (
        el.dataset.noteAnchorName === name && (el.dataset.noteAnchorUid ?? '') === (uid ?? '')
      ))

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('note-anchor-marker-flash')
        window.setTimeout(() => target.classList.remove('note-anchor-marker-flash'), 1200)
        return
      }

      if (attemptsLeft <= 0) return
      window.requestAnimationFrame(() => attemptScroll(attemptsLeft - 1))
    }

    if (waitForNoteSwitch) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => attemptScroll(30)))
    } else {
      attemptScroll(5)
    }
  }, [])

  // Scrolls the preview pane to the top of the document. Used for cross-note
  // links with no `~anchor` — deferred a couple of frames past the note
  // switch so it wins over whatever scroll position the new note's own
  // render-view restore might otherwise land on.
  const scrollPreviewToTop = useCallback((waitForNoteSwitch: boolean) => {
    const reset = () => {
      previewScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }

    if (waitForNoteSwitch) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(reset))
    } else {
      reset()
    }
  }, [])

  // Resolves and follows a `$id`, `~anchor[#uid]`, or `$id~anchor[#uid]`
  // preview link. Broken destinations (unknown note ID, missing anchor) are
  // silently ignored rather than partially navigating.
  const navigateToInternalPreviewLink = useCallback((target: ParsedInternalPreviewLink) => {
    if (target.noteIdRaw !== null) {
      const normalizedTarget = normalizeInternalIdForLookup(target.noteIdRaw)
      const targetNote = notes.find((note) => note.assignedId && normalizeInternalIdForLookup(note.assignedId) === normalizedTarget)
      if (!targetNote) return

      if (target.anchorName !== null && !noteContainsAnchorDefinition(targetNote.contentText ?? '', target.anchorName, target.anchorUid)) {
        return
      }

      const isAlreadyActive = targetNote.id === activeNoteId
      const followUp = () => {
        if (target.anchorName !== null) {
          scrollToAnchorInPreview(target.anchorName, target.anchorUid, !isAlreadyActive)
        } else if (!isAlreadyActive) {
          // Already-active notes stay wherever the reader currently is —
          // only a genuine note switch resets to the top.
          scrollPreviewToTop(true)
        }
      }

      if (isAlreadyActive) {
        followUp()
      } else {
        void activateNote(targetNote.id).then(followUp)
      }
      return
    }

    if (target.anchorName === null || !activeNoteId) return
    const currentText = latestEditorTextRef.current || activeNoteText
    if (!noteContainsAnchorDefinition(currentText, target.anchorName, target.anchorUid)) return
    scrollToAnchorInPreview(target.anchorName, target.anchorUid, false)
  }, [notes, activeNoteId, activateNote, activeNoteText, scrollToAnchorInPreview, scrollPreviewToTop])

  const previewMarkdownComponents = useMemo(
    () => createPreviewMarkdownComponents(navigateToInternalPreviewLink),
    [navigateToInternalPreviewLink],
  )

  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(documentFindDirective.findText, isDocumentFindCaseSensitive),
    [documentFindDirective.findText, isDocumentFindCaseSensitive],
  )

  const previewSourceAnchorPlugin = useMemo(
    () => createPreviewSourceAnchorRehypePlugin(),
    [],
  )

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) do not
  // trigger a full ReactMarkdown reconciliation of long notes. That heavy
  // reconciliation was stalling the main thread and freezing rAF mid-scroll.
  const previewMarkdownElement = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={[previewNoteAnchorMarkerPlugin, previewSearchHighlightPlugin, previewSourceAnchorPlugin]}
      components={previewMarkdownComponents}
    >
      {renderedDisplayText}
    </ReactMarkdown>
  ), [renderedDisplayText, previewNoteAnchorMarkerPlugin, previewSearchHighlightPlugin, previewSourceAnchorPlugin, previewMarkdownComponents])

  return { previewMarkdownElement }
}

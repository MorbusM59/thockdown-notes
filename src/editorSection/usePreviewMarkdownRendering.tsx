/* eslint-disable react-refresh/only-export-components -- this hook module
   also defines PreviewMarkdownBlock, a small internal presentational
   component memoized for the preview pane's per-block rendering (see its
   own comment below); it isn't part of this module's public API, so
   there's nothing here for Fast Refresh to preserve identity of. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { DocumentFindDirective } from '../editor/FindReplaceEngine'
import {
  type ParsedInternalPreviewLink,
  normalizeInternalIdForLookup,
  noteContainsAnchorDefinition,
  createPreviewMarkdownComponents,
  createPreviewSearchHighlightRehypePlugin,
  createPreviewSourceAnchorRehypePlugin,
  PREVIEW_MARKDOWN_REMARK_PLUGINS,
} from '../editor/PreviewMarkdown'
import { splitMarkdownIntoPreviewBlocksIncremental, type PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'

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

interface PreviewMarkdownBlockProps {
  text: string
  lineOffset: number
  searchHighlightPlugin: ReturnType<typeof createPreviewSearchHighlightRehypePlugin>
  components: ReturnType<typeof createPreviewMarkdownComponents>
}

// Memoized on (text, lineOffset, searchHighlightPlugin, components) -- all
// either primitives or stable-until-actually-different references -- so a
// block whose own source text and position are unchanged skips
// ReactMarkdown's parse + hast-to-react conversion entirely, even though
// the parent recomputes the full block list on every keystroke. This is
// the actual perf win: editing inside one paragraph no longer reparses/
// reconciles the whole note. See PreviewBlockSplit.ts for the split itself.
const PreviewMarkdownBlock = memo(function PreviewMarkdownBlock({
  text,
  lineOffset,
  searchHighlightPlugin,
  components,
}: PreviewMarkdownBlockProps) {
  const sourceAnchorPlugin = useMemo(
    () => createPreviewSourceAnchorRehypePlugin(lineOffset),
    [lineOffset],
  )
  const rehypePlugins = useMemo(
    () => [searchHighlightPlugin, sourceAnchorPlugin],
    [searchHighlightPlugin, sourceAnchorPlugin],
  )

  return (
    <ReactMarkdown
      remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  )
})

/**
 * Renders the current note's markdown into the preview pane -- anchor
 * definitions, search-hit highlighting, source-line anchors for scroll sync,
 * and `$`/`$NOTE-ID`/`#anchor-id` internal link navigation -- extracted
 * verbatim from App.tsx with zero behavior change. Depends on the pure
 * preview-markdown primitives in src/editor/PreviewMarkdown.tsx (extracted
 * just before this), which are also shared with the PDF/MD export path.
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
  // Mirrors `notes`/`activeNoteText` for navigateToInternalPreviewLink's
  // call-time-only reads below, so that callback's identity -- and in turn
  // previewMarkdownComponents' -- stays stable across every keystroke. Both
  // props otherwise change on every keystroke (title-preview and
  // save-queue bookkeeping touch `notes`; typing itself touches
  // `activeNoteText`), which would force every PreviewMarkdownBlock to
  // treat `components` as "changed" and re-render, defeating the whole
  // point of splitting the preview into independently memoized blocks.
  const notesRef = useRef(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  const activeNoteTextRef = useRef(activeNoteText)
  useEffect(() => {
    activeNoteTextRef.current = activeNoteText
  }, [activeNoteText])

  // Scrolls the currently rendered preview to a `[Anchor Text](#anchor-id)`
  // definition, if present. `waitForNoteSwitch` retries across a few
  // animation frames since switching notes re-renders ReactMarkdown
  // asynchronously -- the target span may not exist in the DOM yet on the
  // frame this fires.
  const scrollToAnchorInPreview = useCallback((anchorId: string, waitForNoteSwitch: boolean) => {
    const attemptScroll = (attemptsLeft: number) => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('.note-anchor-marker'))
      const target = candidates.find((el) => el.dataset.anchorId === anchorId)

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
  // links with no `#anchor-id` — deferred a couple of frames past the note
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
  }, [previewScrollRef])

  // Resolves and follows a `$`, `$#anchor-id`, `$NOTE-ID`, or
  // `$NOTE-ID#anchor-id` preview link. Broken destinations (unknown note ID,
  // missing anchor) are silently ignored rather than partially navigating.
  const navigateToInternalPreviewLink = useCallback((target: ParsedInternalPreviewLink) => {
    if (target.noteIdRaw !== null) {
      const normalizedTarget = normalizeInternalIdForLookup(target.noteIdRaw)
      const targetNote = notesRef.current.find((note) => note.assignedId && normalizeInternalIdForLookup(note.assignedId) === normalizedTarget)
      if (!targetNote) return

      if (target.anchorId !== null && !noteContainsAnchorDefinition(targetNote.contentText ?? '', target.anchorId)) {
        return
      }

      const isAlreadyActive = targetNote.id === activeNoteId
      const followUp = () => {
        if (target.anchorId !== null) {
          scrollToAnchorInPreview(target.anchorId, !isAlreadyActive)
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

    // No noteIdRaw means "this note" (a bare `$` or `$#anchor-id`).
    if (target.anchorId === null || !activeNoteId) return
    const currentText = latestEditorTextRef.current || activeNoteTextRef.current
    if (!noteContainsAnchorDefinition(currentText, target.anchorId)) return
    scrollToAnchorInPreview(target.anchorId, false)
  }, [activeNoteId, activateNote, scrollToAnchorInPreview, scrollPreviewToTop, latestEditorTextRef])

  // navigateToInternalPreviewLink itself still isn't fully keystroke-stable
  // -- it depends (transitively, via `activateNote`) on other callbacks
  // elsewhere in the section that legitimately need the latest
  // activeNoteText for THEIR OWN purposes (persisting edit-UI state on
  // note switch) and so recreate on every keystroke regardless of anything
  // this hook does. Forwarding through a ref, and building `components`
  // exactly once, fully decouples its identity from that upstream churn --
  // clicks still always run the latest navigation logic, since the
  // forwarding wrapper reads the ref at call time, not at creation time.
  const navigateToInternalPreviewLinkRef = useRef(navigateToInternalPreviewLink)
  useEffect(() => {
    navigateToInternalPreviewLinkRef.current = navigateToInternalPreviewLink
  }, [navigateToInternalPreviewLink])

  const previewMarkdownComponents = useMemo(
    () => createPreviewMarkdownComponents((target) => navigateToInternalPreviewLinkRef.current(target)),
    [],
  )

  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(documentFindDirective.findText, isDocumentFindCaseSensitive),
    [documentFindDirective.findText, isDocumentFindCaseSensitive],
  )

  // Recomputed on every renderedDisplayText change to learn the current
  // block boundaries. The actual, expensive ReactMarkdown parse+render per
  // block is gated by PreviewMarkdownBlock's own memo, not by this -- but
  // the boundary recompute itself is a full remark parse of the whole
  // document if done naively, which is *not* cheap on a large note
  // (measured: seconds per keystroke on a ~12,000-line note). The
  // incremental split reuses the previous call's boundaries for whatever
  // span of the document the edit didn't touch, keyed on this hook's own
  // instance via splitCacheRef so concurrent panes/sections never share
  // state. See PreviewBlockSplit.ts for the reuse strategy and its safety
  // argument.
  const splitCacheRef = useRef<PreviewBlockSplitCache | null>(null)
  const splitResult = useMemo(
    () => splitMarkdownIntoPreviewBlocksIncremental(renderedDisplayText, splitCacheRef.current),
    [renderedDisplayText],
  )
  // Committed in an effect, not during the useMemo above, so this cache
  // update never happens during a render React might discard (Strict Mode's
  // double-invoke, an interrupted concurrent render) -- only once this
  // result has actually become what's on screen.
  useLayoutEffect(() => {
    splitCacheRef.current = splitResult
  }, [splitResult])
  const previewBlocks = splitResult.blocks

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) do not
  // even walk the block list. That heavy reconciliation was stalling the
  // main thread and freezing rAF mid-scroll.
  const previewMarkdownElement = useMemo(() => (
    <>
      {previewBlocks.map((block, index) => (
        <PreviewMarkdownBlock
          key={index}
          text={block.text}
          lineOffset={block.startLine}
          searchHighlightPlugin={previewSearchHighlightPlugin}
          components={previewMarkdownComponents}
        />
      ))}
    </>
  ), [previewBlocks, previewSearchHighlightPlugin, previewMarkdownComponents])

  return { previewMarkdownElement }
}

/* eslint-disable react-refresh/only-export-components -- this hook module
   also defines PreviewMarkdownBlock, a small internal presentational
   component memoized for the preview pane's per-block rendering (see its
   own comment below); it isn't part of this module's public API, so
   there's nothing here for Fast Refresh to preserve identity of. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { DocumentFindDirective } from '../editor/FindReplaceEngine'
import {
  type ParsedInternalPreviewLink,
  normalizeInternalIdForLookup,
  noteContainsAnchorDefinition,
  findAnchorDefinitionLine,
  createPreviewMarkdownComponents,
  createPreviewSearchHighlightRehypePlugin,
  createPreviewSourceAnchorRehypePlugin,
  PREVIEW_MARKDOWN_REMARK_PLUGINS,
} from '../editor/PreviewMarkdown'
import { findHeadingAnchorLine, parseHeadingAnchorFragment } from '../shared/tableOfContentsText'
import type { ParsedInternalNoteLink } from '../shared/internalNoteLinks'
import { splitMarkdownIntoPreviewBlocksIncremental, type PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'
import { resolvePreviewBlockIndexForSourceLine } from '../editor/PreviewBlockIndex'
import { scrollToNonQuantizedSmooth } from '../editor/NonQuantizedSmoothScroll'

// Initial guess only -- corrected as soon as each block actually mounts and
// reports its real height (react-virtual's estimate-then-correct model, via
// ResizeObserver under the hood). Precision doesn't matter here, it only
// needs to be in the right order of magnitude so the first layout pass
// isn't wildly wrong before real measurements start arriving.
const PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX = 56

// A modest buffer of blocks mounted above/below the visible window so
// scrolling doesn't visibly pop content in at the viewport edge.
const PREVIEW_BLOCK_OVERSCAN = 6

interface OpenItemsToggleStore {
  isChecked: (sourceLine: number) => boolean
  subscribeToLine: (sourceLine: number, listener: () => void) => () => void
  toggle: (sourceLine: number) => void
  reset: () => void
}

/**
 * Per-line checked/unchecked state for the Open Items chapter's own
 * checkboxes, with per-line subscriptions -- an external store consumed via
 * useSyncExternalStore in PreviewMarkdown.tsx's OpenItemCheckbox, not React
 * state, specifically so toggling one checkbox only re-renders that one
 * checkbox instead of forcing previewMarkdownComponents' memo (shared by
 * every mounted block) to change identity. See this store's own call site
 * below for the full rationale.
 */
function createOpenItemsToggleStore(): OpenItemsToggleStore {
  const checkedLines = new Set<number>()
  const listenersByLine = new Map<number, Set<() => void>>()

  const notify = (sourceLine: number) => {
    listenersByLine.get(sourceLine)?.forEach((listener) => listener())
  }

  return {
    isChecked: (sourceLine) => checkedLines.has(sourceLine),
    subscribeToLine: (sourceLine, listener) => {
      let listeners = listenersByLine.get(sourceLine)
      if (!listeners) {
        listeners = new Set()
        listenersByLine.set(sourceLine, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) listenersByLine.delete(sourceLine)
      }
    },
    toggle: (sourceLine) => {
      if (checkedLines.has(sourceLine)) {
        checkedLines.delete(sourceLine)
      } else {
        checkedLines.add(sourceLine)
      }
      notify(sourceLine)
    },
    reset: () => {
      const affected = Array.from(checkedLines)
      checkedLines.clear()
      affected.forEach(notify)
    },
  }
}

/**
 * Scrolls the preview pane so the block covering `sourceLine` is mounted and
 * visible. Returns false only when there are no blocks to target at all
 * (e.g. an empty note) -- `opts.behavior` follows react-virtual's own
 * `ScrollBehavior` union ('auto'/instant by default, or 'smooth' to route
 * through this app's curve-based scroll engine -- see this hook's internal
 * `scrollToFn`).
 */
export type PreviewScrollToSourceLineFn = (
  sourceLine: number,
  opts?: { align?: 'start' | 'center'; behavior?: 'auto' | 'smooth' },
) => boolean

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
  /**
   * Written (not read) by this hook so `useEditorSectionMount`'s scroll-
   * restore logic -- which mounts earlier in the same component and so
   * can't call this hook's own virtualizer directly -- can still force a
   * virtualized-out target block to mount before querying for it. See
   * `applyPreviewSourceAnchor` in useEditorSectionMount.ts.
   */
  previewScrollToSourceLineRef: MutableRefObject<PreviewScrollToSourceLineFn | null>
  /**
   * Optional warm-start cache from useEditorSectionMount's background parse.
   * When present and text matches, the preview pane skips its own expensive
   * first full remark parse and reuses the already-computed blocks + ranges.
   */
  previewBlockSplitCacheRef?: MutableRefObject<PreviewBlockSplitCache | null>
  /**
   * Whether the note currently being rendered is the auto-Open-Items
   * chapter -- computed once in EditorSection.tsx off the same
   * activeNoteSummary every other per-render fact about the active note
   * goes through, rather than this hook deriving its own copy via a fresh
   * notes.find(...) on every render (see EditorSection.tsx's own comment on
   * why that's the single source of truth). Only ever true does its
   * checkbox glyphs become genuinely clickable -- see
   * createPreviewMarkdownComponents' openItemsToggle param and
   * PreviewMarkdown.tsx's OpenItemCheckbox.
   */
  isViewingAutoOpenItemsChapter: boolean
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
  previewScrollToSourceLineRef,
  previewBlockSplitCacheRef,
  isViewingAutoOpenItemsChapter,
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

  // Which of the Open Items chapter's own checkboxes (keyed by their own
  // line within its CURRENT text -- see toggleOpenItemCheckedState) have
  // been toggled this viewing session. An external store (subscribe/
  // getSnapshot, consumed via useSyncExternalStore in OpenItemCheckbox),
  // not React state: a plain useState<Set<number>> here would mean every
  // toggle produces a new Set reference, which -- once fed into
  // previewMarkdownComponents' memo below -- forces every currently-
  // mounted/overscanned PreviewMarkdownBlock to treat `components` as
  // changed and fully re-parse+re-render, not just the one checkbox that
  // actually changed (and tears down/rebuilds focused DOM mid-keyboard-
  // toggle in the process). Individual checkboxes subscribing directly to
  // just their own line's changes avoids that entirely -- the store's own
  // reference stays perfectly stable across toggles.
  //
  // Deliberately owned HERE, not inside OpenItemCheckbox's own component
  // state, for the same virtualization reason as before: PreviewMarkdownBlock
  // is virtualized (react-virtual unmounts blocks once they scroll far
  // enough out of view, per PREVIEW_BLOCK_OVERSCAN), so a checkbox's own
  // local state would silently reset to unchecked the moment it scrolled
  // back into view again, even though the real edit had already gone
  // through on the source note -- this store lives above the virtualized
  // block tree, so it survives that.
  //
  // Reset whenever `renderedDisplayText` itself changes, not just on note
  // switch: a manual refresh (the present-state circle's regenerateAllOpenItems)
  // rewrites this very note's own text WITHOUT switching notes, dropping
  // whatever lines got checked off -- but every OTHER line's own line
  // number shifts up to fill the gap. Stale line-number entries left over
  // from before the rewrite would then point at the *next* item down,
  // making it look checked even though nobody touched it. A line number
  // only ever means anything against the specific text it was resolved
  // from, so any text change invalidates every entry wholesale, not just
  // whichever one the change would find.
  const openItemsToggleStoreRef = useRef<OpenItemsToggleStore | null>(null)
  if (openItemsToggleStoreRef.current === null) {
    openItemsToggleStoreRef.current = createOpenItemsToggleStore()
  }
  useEffect(() => {
    openItemsToggleStoreRef.current?.reset()
  }, [activeNoteId, renderedDisplayText])

  // Fires the actual checkbox-click side effect -- see
  // noteLifecycleService.ts's toggleOpenItemCheckedState for what this does
  // and why it never touches what's currently on screen. Awaited (not a
  // bare `void` fire-and-forget) so a stale click -- the backend resolving
  // `false` because the matching item text no longer exists, or the IPC
  // call rejecting outright -- rolls the optimistic store flip back instead
  // of leaving the checkbox looking checked for something that was never
  // actually written.
  const handleToggleOpenItem = useCallback((sourceLine: number) => {
    if (!activeNoteId || !window.thockdownChapters) return
    const store = openItemsToggleStoreRef.current
    if (!store) return
    store.toggle(sourceLine)
    void window.thockdownChapters.toggleOpenItem(activeNoteId, sourceLine)
      .then((succeeded) => {
        if (!succeeded) store.toggle(sourceLine)
      })
      .catch((error) => {
        console.error('[open-items] failed to toggle checklist item', error)
        store.toggle(sourceLine)
      })
  }, [activeNoteId])

  const activeNoteTextRef = useRef(activeNoteText)
  useEffect(() => {
    activeNoteTextRef.current = activeNoteText
  }, [activeNoteText])

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
  const ownSplitCacheRef = useRef<PreviewBlockSplitCache | null>(null)
  const splitCacheRef = previewBlockSplitCacheRef ?? ownSplitCacheRef
  // Warm-start from useEditorSectionMount's background prewarm if the text
  // matches. This avoids a second full remark parse on the first preview
  // render after edit mode had already parsed the document in the background.
  const splitResult = useMemo(
    () => {
      const cache = splitCacheRef.current
      const hasMatchingCache = cache && cache.text === renderedDisplayText
      const start = typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1' ? performance.now() : 0
      const result = splitMarkdownIntoPreviewBlocksIncremental(renderedDisplayText, cache)
      if (typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
        const elapsed = Number((performance.now() - start).toFixed(2))
        console.log('[preview-block-cache] usePreviewMarkdownRendering split', {
          renderedLength: renderedDisplayText.length,
          hasMatchingCache: !!hasMatchingCache,
          cacheTextLength: cache?.text.length,
          ranges: cache?.ranges.length,
          resultRanges: result.ranges.length,
          elapsedMs: elapsed,
        })
      }
      return result
    },
    [renderedDisplayText, splitCacheRef],
  )
  // Committed in an effect, not during the useMemo above, so this cache
  // update never happens during a render React might discard (Strict Mode's
  // double-invoke, an interrupted concurrent render) -- only once this
  // result has actually become what's on screen.
  useLayoutEffect(() => {
    splitCacheRef.current = splitResult
  }, [splitResult, splitCacheRef])
  const previewBlocks = splitResult.blocks

  // Mirrors `previewBlocks` for callbacks below that resolve a block index
  // from a source line asynchronously (after a note switch, or an anchor
  // click) -- their own identity is kept stable across keystrokes (see
  // scrollToAnchorInPreview's deps), so they must read the *latest* blocks
  // through a ref rather than closing over a value from whenever they were
  // created.
  const previewBlocksRef = useRef(previewBlocks)
  useEffect(() => {
    previewBlocksRef.current = previewBlocks
  }, [previewBlocks])

  // react-virtual's own scroll-correction loop (`reconcileScroll`)
  // re-invokes this whenever a target block's real, measured height
  // replaces its initial estimate mid-scroll -- both branches below must
  // stay correct when called repeatedly, with an updated offset, for what
  // is logically still the same scroll operation.
  const scrollToFn = useCallback<VirtualizerOptions<HTMLDivElement, HTMLDivElement>['scrollToFn']>((offset, { adjustments = 0, behavior }, instance) => {
    const scroller = instance.scrollElement
    if (!scroller) return
    const target = offset + adjustments

    if (behavior === 'smooth') {
      // This app's own curve-based motion (see NonQuantizedSmoothScroll.ts),
      // not native smooth-scroll -- it supports being re-invoked mid-flight
      // (replans smoothly from wherever the animation currently is), which
      // is exactly what's needed as react-virtual corrects the destination
      // once the target block's real height is measured.
      scrollToNonQuantizedSmooth(scroller, target)
      return
    }

    // Deterministic, instant snap -- used for scroll *restoration* (note
    // open, edit/preview mode-switch), where an animated correction after
    // landing would read as jank, not polish. `.markdown-preview` has
    // `scroll-behavior: smooth` in CSS, so this must force `auto` itself or
    // the browser would animate this write too.
    const previousScrollBehavior = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollTop = target
    scroller.style.scrollBehavior = previousScrollBehavior
  }, [])

  const virtualizer = useVirtualizer({
    count: previewBlocks.length,
    getScrollElement: () => previewScrollRef.current,
    estimateSize: () => PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX,
    overscan: PREVIEW_BLOCK_OVERSCAN,
    scrollToFn,
  })

  const scrollPreviewToSourceLine = useCallback<PreviewScrollToSourceLineFn>((sourceLine, opts) => {
    const index = resolvePreviewBlockIndexForSourceLine(previewBlocksRef.current, sourceLine)
    if (index < 0) return false
    virtualizer.scrollToIndex(index, { align: opts?.align ?? 'start', behavior: opts?.behavior })
    return true
  }, [virtualizer])

  // See UsePreviewMarkdownRenderingOptions.previewScrollToSourceLineRef --
  // useEditorSectionMount's scroll-restore effect calls this via the ref, at
  // a point where it's already guaranteed to run after this hook's own
  // commit (it's deferred into requestAnimationFrame there).
  useLayoutEffect(() => {
    previewScrollToSourceLineRef.current = scrollPreviewToSourceLine
  }, [previewScrollToSourceLineRef, scrollPreviewToSourceLine])

  // Scrolls the currently rendered preview to a specific rendered element
  // (resolved lazily by `findTargetElement`, re-tried across animation
  // frames since switching notes re-renders ReactMarkdown asynchronously --
  // the target may not exist in the DOM yet on the frame this fires) and
  // flashes it. `sourceLine`, when known, is used to virtualizer-scroll to
  // the target's own block *before* the DOM query -- without this, a jump
  // into a block outside the currently-mounted window would silently find
  // nothing, since every block used to always be real DOM. Shared by both of
  // the app's two independent anchor mechanisms -- a manual
  // `[Anchor Text](#id)` definition (an inert `.note-anchor-marker` span)
  // and an automatic, on-the-fly heading anchor (the heading element itself,
  // via `data-source-line-start`) -- see scrollToAnchorInPreview/
  // scrollToHeadingAnchorInPreview below.
  const scrollToRenderedElement = useCallback((findTargetElement: () => HTMLElement | null, sourceLine: number | null, waitForNoteSwitch: boolean) => {
    const attemptScroll = (attemptsLeft: number) => {
      const target = findTargetElement()

      if (target) {
        // Instant, not smooth -- the virtualizer scroll below already did
        // the (smooth) traveling; this is just a small, exact centering
        // correction within the target's own block, not a second hop.
        target.scrollIntoView({ block: 'center', inline: 'nearest' })
        target.classList.add('note-anchor-marker-flash')
        window.setTimeout(() => target.classList.remove('note-anchor-marker-flash'), 1200)
        return
      }

      if (attemptsLeft <= 0) return
      window.requestAnimationFrame(() => attemptScroll(attemptsLeft - 1))
    }

    const beginScroll = (attempts: number) => {
      if (sourceLine !== null) {
        const index = resolvePreviewBlockIndexForSourceLine(previewBlocksRef.current, sourceLine)
        if (index >= 0) {
          virtualizer.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
        }
      }
      attemptScroll(attempts)
    }

    if (waitForNoteSwitch) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => beginScroll(30)))
    } else {
      beginScroll(5)
    }
  }, [virtualizer])

  // Scrolls to a manual `[Anchor Text](#anchor-id)` definition, rendered as
  // an inert `.note-anchor-marker` span carrying the id verbatim.
  const scrollToAnchorInPreview = useCallback((anchorId: string, sourceLine: number | null, waitForNoteSwitch: boolean) => {
    scrollToRenderedElement(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('.note-anchor-marker'))
      return candidates.find((el) => el.dataset.anchorId === anchorId) ?? null
    }, sourceLine, waitForNoteSwitch)
  }, [scrollToRenderedElement])

  // Scrolls to an automatic, on-the-fly heading anchor -- there's no literal
  // DOM marker to search for (the heading's own source was never rewritten),
  // so the target is the heading element itself, found via the
  // `data-source-line-start` attribute createPreviewSourceAnchorRehypePlugin
  // already stamps on every heading.
  const scrollToHeadingAnchorInPreview = useCallback((sourceLine: number, waitForNoteSwitch: boolean) => {
    const selector = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      .map((tag) => `${tag}[data-source-line-start="${sourceLine}"]`)
      .join(', ')
    scrollToRenderedElement(() => document.querySelector<HTMLElement>(selector), sourceLine, waitForNoteSwitch)
  }, [scrollToRenderedElement])

  // Resolves a raw href anchor fragment to whichever of the app's two
  // independent anchor mechanisms it belongs to: an automatic, on-the-fly
  // heading anchor (`heading:`-prefixed, per parseHeadingAnchorFragment --
  // resolved by re-deriving the target note's headings fresh each time,
  // never by scanning for literal markup) or a manual `[Anchor Text](#id)`
  // definition (resolved the original way, by scanning for that literal
  // markup). Both resolve to the same shape -- "given some text, which
  // source line (if any) does this anchor land on" plus "how to scroll/flash
  // that target once found" -- so every navigation call site below can stay
  // anchor-mechanism-agnostic.
  const resolveAnchorTarget = useCallback((anchorId: string) => {
    const headingSlug = parseHeadingAnchorFragment(anchorId)
    if (headingSlug !== null) {
      return {
        resolveLine: (text: string) => findHeadingAnchorLine(text, headingSlug),
        scrollTo: (sourceLine: number, waitForNoteSwitch: boolean) => scrollToHeadingAnchorInPreview(sourceLine, waitForNoteSwitch),
      }
    }
    return {
      resolveLine: (text: string) => (noteContainsAnchorDefinition(text, anchorId) ? findAnchorDefinitionLine(text, anchorId) : null),
      scrollTo: (sourceLine: number, waitForNoteSwitch: boolean) => scrollToAnchorInPreview(anchorId, sourceLine, waitForNoteSwitch),
    }
  }, [scrollToHeadingAnchorInPreview, scrollToAnchorInPreview])

  // Shared by both the direct-note and chapter branches of
  // navigateToInternalPreviewLink below: activates `targetNoteId` (unless
  // already active) then either scrolls to `anchorId` within it or, on a
  // genuine note switch with no anchor, resets to the top.
  const activateAndScroll = useCallback((targetNoteId: string, contentTextForExistenceCheck: string, anchorId: string | null) => {
    const isAlreadyActive = targetNoteId === activeNoteId
    const anchorTarget = anchorId !== null ? resolveAnchorTarget(anchorId) : null
    const followUp = () => {
      if (anchorTarget !== null) {
        // Once the target note is active, its own live text is what
        // previewBlocks actually reflects -- not the (possibly stale)
        // stored contentText used for the existence check at the call site.
        const anchorSourceText = isAlreadyActive
          ? (latestEditorTextRef.current || activeNoteTextRef.current)
          : contentTextForExistenceCheck
        const sourceLine = anchorTarget.resolveLine(anchorSourceText)
        if (sourceLine !== null) anchorTarget.scrollTo(sourceLine, !isAlreadyActive)
      } else if (!isAlreadyActive) {
        // Already-active notes stay wherever the reader currently is —
        // only a genuine note switch resets to the top.
        scrollPreviewToTop(true)
      }
    }

    if (isAlreadyActive) {
      followUp()
    } else {
      void activateNote(targetNoteId, undefined).then(followUp)
    }
  }, [activeNoteId, activateNote, resolveAnchorTarget, scrollPreviewToTop, latestEditorTextRef])

  // Resolves and follows a `$`, `$#anchor-id`, `$NOTE-ID`,
  // `$NOTE-ID#anchor-id`, `$NOTE-ID§CHAPTER-ID`, or
  // `$NOTE-ID§CHAPTER-ID#anchor-id` preview link (also `$§CHAPTER-ID...`, a
  // chapter of "this note"). Broken destinations (unknown note/chapter ID,
  // missing anchor) are silently ignored rather than partially navigating.
  const navigateToInternalPreviewLink = useCallback((target: ParsedInternalPreviewLink) => {
    // `contextNote` is the note a `§CHAPTER-ID` segment (if present) is
    // scoped to, or the direct navigation target if there's no chapter
    // segment -- explicit via noteIdRaw, or "this note" when it's null.
    // "This note" means the *parent* when the active note is itself a
    // chapter (chapterParentId), not the literal activeNoteId -- a chapter
    // can never have chapters of its own, so resolving `$§CHAPTER-ID` while
    // viewing one against its own id would always look up an empty chapter
    // list. Matches menuIdentityNoteId's own derivation in EditorSection.tsx.
    let contextNote: NoteSummary | undefined
    if (target.noteIdRaw !== null) {
      const normalizedTarget = normalizeInternalIdForLookup(target.noteIdRaw)
      contextNote = notesRef.current.find((note) => note.assignedId && normalizeInternalIdForLookup(note.assignedId) === normalizedTarget)
      if (!contextNote) return
    } else if (activeNoteId) {
      const activeNote = notesRef.current.find((note) => note.id === activeNoteId)
      const contextNoteId = activeNote?.chapterOnly && activeNote.chapterParentId ? activeNote.chapterParentId : activeNoteId
      contextNote = notesRef.current.find((note) => note.id === contextNoteId)
    }

    if (target.chapterIdRaw !== null) {
      if (!contextNote || !window.thockdownChapters) return
      const parentNoteId = contextNote.id
      const normalizedChapterTarget = normalizeInternalIdForLookup(target.chapterIdRaw)
      void window.thockdownChapters.listChapters(parentNoteId).then((chapters) => {
        // This `$NOTE-ID§CHAPTER-ID` scheme is purely for hand-typed,
        // user-facing links -- matches only an explicitly user-assigned
        // chapterId (setChapterId). The auto-generated TOC/Open Items
        // chapters never produce one of these at all; they use the
        // separate, internal-only `@noteId` scheme instead (see
        // internalNoteLinks.ts and navigateToInternalNoteLink below), which
        // needs no assigned id and so has no business here.
        const chapterEntry = chapters.find((entry) => entry.chapterId && normalizeInternalIdForLookup(entry.chapterId) === normalizedChapterTarget)
        if (!chapterEntry) return
        const chapterContentText = notesRef.current.find((note) => note.id === chapterEntry.chapterNoteId)?.contentText ?? ''
        if (target.anchorId !== null && resolveAnchorTarget(target.anchorId).resolveLine(chapterContentText) === null) return
        activateAndScroll(chapterEntry.chapterNoteId, chapterContentText, target.anchorId)
      })
      return
    }

    if (target.noteIdRaw !== null) {
      if (!contextNote) return
      const targetContentText = contextNote.contentText ?? ''
      if (target.anchorId !== null && resolveAnchorTarget(target.anchorId).resolveLine(targetContentText) === null) return
      activateAndScroll(contextNote.id, targetContentText, target.anchorId)
      return
    }

    // No noteIdRaw and no chapterIdRaw means "this note" (a bare `$` or `$#anchor-id`).
    if (target.anchorId === null || !activeNoteId) return
    const currentText = latestEditorTextRef.current || activeNoteTextRef.current
    const anchorTarget = resolveAnchorTarget(target.anchorId)
    const sourceLine = anchorTarget.resolveLine(currentText)
    if (sourceLine === null) return
    anchorTarget.scrollTo(sourceLine, false)
  }, [activeNoteId, activateAndScroll, resolveAnchorTarget, latestEditorTextRef])

  // Resolves and follows an `@noteId[#fragment]` internal-only link -- the
  // auto-generated TOC/Open Items chapters' own addressing scheme
  // (internalNoteLinks.ts), entirely separate from navigateToInternalPreviewLink
  // above: the target note is identified directly by its own real,
  // permanent id, no assignedId/chapterId lookup involved at all, so it
  // never fails just because the user hasn't assigned one. A fragment, if
  // present, is always a heading-derived anchor -- this scheme has no
  // manual-anchor equivalent, since a manual anchor is something a user
  // types, and nothing produced here is ever user-typed.
  const navigateToInternalNoteLink = useCallback((target: ParsedInternalNoteLink) => {
    const targetContentText = notesRef.current.find((note) => note.id === target.noteId)?.contentText ?? ''
    if (target.fragment === null) {
      activateAndScroll(target.noteId, targetContentText, null)
      return
    }
    const headingSlug = parseHeadingAnchorFragment(target.fragment)
    if (headingSlug === null || findHeadingAnchorLine(targetContentText, headingSlug) === null) return
    activateAndScroll(target.noteId, targetContentText, target.fragment)
  }, [activateAndScroll])

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

  const navigateToInternalNoteLinkRef = useRef(navigateToInternalNoteLink)
  useEffect(() => {
    navigateToInternalNoteLinkRef.current = navigateToInternalNoteLink
  }, [navigateToInternalNoteLink])

  // Recomputes only when isViewingAutoOpenItemsChapter flips or the active
  // note switches (handleToggleOpenItem's own identity only changes with
  // activeNoteId) -- never on an individual checkbox toggle, since the
  // toggle store's own reference never changes and its per-line
  // subscriptions (see OpenItemCheckbox) are what actually propagate a
  // toggle to the screen. No ref-forwarding needed for handleToggleOpenItem
  // the way the navigation callbacks above need it: that pattern exists
  // specifically to keep a memo stable across per-keystroke churn, and
  // nothing here changes on a keystroke.
  const previewMarkdownComponents = useMemo(
    () => createPreviewMarkdownComponents(
      (target) => navigateToInternalPreviewLinkRef.current(target),
      (target) => navigateToInternalNoteLinkRef.current(target),
      isViewingAutoOpenItemsChapter ? {
        isChecked: openItemsToggleStoreRef.current!.isChecked,
        subscribe: openItemsToggleStoreRef.current!.subscribeToLine,
        onToggle: handleToggleOpenItem,
      } : undefined,
    ),
    [isViewingAutoOpenItemsChapter, handleToggleOpenItem],
  )

  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(documentFindDirective.findText, isDocumentFindCaseSensitive),
    [documentFindDirective.findText, isDocumentFindCaseSensitive],
  )

  const virtualItems = virtualizer.getVirtualItems()

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) don't
  // even walk the visible-block list unless something that actually affects
  // its output changed. `virtualItems` is itself stable (same array
  // reference) whenever react-virtual's own visible range/measurements
  // haven't changed, so this reproduces the gating this memo always had --
  // just scoped to the *visible* subset now, which is all this loop ever
  // builds regardless.
  const previewMarkdownElement = useMemo(() => (
    <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
      {virtualItems.map((virtualItem) => {
        const block = previewBlocks[virtualItem.index]
        if (!block) return null
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <PreviewMarkdownBlock
              text={block.text}
              lineOffset={block.startLine}
              searchHighlightPlugin={previewSearchHighlightPlugin}
              components={previewMarkdownComponents}
            />
          </div>
        )
      })}
    </div>
  ), [virtualizer, virtualItems, previewBlocks, previewSearchHighlightPlugin, previewMarkdownComponents])

  return { previewMarkdownElement }
}

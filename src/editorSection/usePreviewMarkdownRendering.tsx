/* eslint-disable react-refresh/only-export-components -- this hook module
   also defines PreviewMarkdownBlock, a small internal presentational
   component memoized for the preview pane's per-block rendering (see its
   own comment below); it isn't part of this module's public API, so
   there's nothing here for Fast Refresh to preserve identity of. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MutableRefObject, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual'
import type { NoteSummary } from '../shared/noteLifecycle'
import { resolveLinkedChapterId, resolveLinkedNoteId } from '../shared/assignedIds'
import type { EditorAdapter } from '../editor/EditorContract'
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
import { resolveMarkdownChecklistLineToggleTransform } from '../editor/ChecklistCaretClickTogglePolicy'
import { normalizeInternalText } from '../editor/TextPolicy'
import { findHeadingAnchorLine, parseHeadingAnchorFragment } from '../shared/tableOfContentsText'
import type { ParsedInternalNoteLink } from '../shared/internalNoteLinks'
import { splitMarkdownIntoPreviewBlocksIncremental, type PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'
import { resolvePreviewBlockIndexForSourceLine } from '../editor/PreviewBlockIndex'
import { isNonQuantizedSmoothScrollActive, scrollToNonQuantizedSmooth } from '../editor/NonQuantizedSmoothScroll'
import {
  PREVIEW_PREWARM_INITIAL_BATCH,
  PREVIEW_PREWARM_RESIZE_SETTLE_MS,
  PREVIEW_PREWARM_SCROLL_QUIET_MS,
  PREVIEW_PREWARM_SLICE_BUDGET_MS,
  planNextPrewarmBatch,
  resolveNextPrewarmBatchSize,
} from './previewMeasurementPrewarm'

// Initial guess only -- corrected as soon as each block actually mounts and
// reports its real height (react-virtual's estimate-then-correct model, via
// ResizeObserver under the hood). Precision doesn't matter here, it only
// needs to be in the right order of magnitude so the first layout pass
// isn't wildly wrong before real measurements start arriving.
const PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX = 56

// A modest buffer of blocks mounted above/below the visible window so
// scrolling doesn't visibly pop content in at the viewport edge.
const PREVIEW_BLOCK_OVERSCAN = 6

/** Progress of the background block survey -- see previewMeasurementPrewarm.ts. */
export interface PreviewDiscoveryState {
  isSurveying: boolean
  /** 0-100, whole numbers. */
  percent: number
  measured: number
  total: number
}

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
  activateNote: (noteId: string, overrideCursorPos?: number, overrideSourceAnchorLine?: number) => Promise<void>
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  /**
   * Whether the section is currently showing the rendered pane. Anchor
   * navigation (`$#anchor`, and every auto-TOC entry) has to land in
   * whichever pane the reader is actually looking at -- see
   * scrollEditorToAnchor for why targeting only the preview pane meant a
   * TOC link opened the note and then left the editor wherever its own
   * restore had put it.
   */
  isPreviewMode: boolean
  /** The section's editor, for the edit-mode half of anchor navigation. */
  adapterRef: MutableRefObject<EditorAdapter | null>
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
  /**
   * Whether the note currently being rendered is directly editable --
   * mirrors SectionEditorArea.tsx's own `editorReadOnly` expression
   * (excludes a debug-tagged note, a Time Machine snapshot preview, the
   * auto-TOC/auto-Open-Items chapters, and a timeless/frozen note). Gates
   * the regular-preview checkbox-click mechanism below: a checkbox stays a
   * plain, non-interactive glyph everywhere the real editor would also
   * refuse to let you type.
   */
  isActiveNoteEditable: boolean
  /**
   * Pushes a text change into the editor programmatically, keeping edit
   * mode's own live text in sync -- see useEditorSectionMount.ts's own doc
   * comment on this callback (Time Machine restore, find & replace are its
   * other callers). Used here so clicking a checkbox in regular preview
   * writes straight to the one real note, identically to toggling it in
   * edit mode -- unlike the auto-Open-Items chapter's own toggle (which
   * intentionally writes to a *different* note and never touches what's on
   * screen), a regular note's preview has no such indirection: this is the
   * note itself.
   */
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
  /** Called in the layout phase after every commit of the preview block subtree, before paint. The settle gate uses it as its "the DOM may have moved" signal -- both to re-evaluate its own geometry fixed point and to let the scroll restore re-attempt its anchor lookup at exactly the moments the element could have appeared, instead of polling animation frames. */
  onPreviewCommitted?: () => void
}

export interface UsePreviewMarkdownRenderingResult {
  previewMarkdownElement: ReactNode
  previewDiscovery: PreviewDiscoveryState
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
  isPreviewMode,
  adapterRef,
  documentFindDirective,
  isDocumentFindCaseSensitive,
  renderedDisplayText,
  previewScrollToSourceLineRef,
  previewBlockSplitCacheRef,
  isViewingAutoOpenItemsChapter,
  isActiveNoteEditable,
  applyProgrammaticEditorText,
  onPreviewCommitted,
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

  // The regular-preview counterpart of handleToggleOpenItem above: writes
  // straight to the active note's own live text via applyProgrammaticEditorText
  // (the same mechanism the formatting toolbar and find & replace already
  // use to push a transform into the editor programmatically), so the edit
  // pane picks up the flip too -- single source of truth, unlike Open
  // Items' own out-of-band write to a different note. Reuses
  // resolveMarkdownChecklistLineToggleTransform, the exact same toggle
  // primitive edit mode's own caret-click-on-a-checkbox shortcut is built
  // on (ChecklistCaretClickTogglePolicy.ts), so a click means the same
  // thing in both modes.
  const handleToggleChecklistAtLine = useCallback((sourceLine: number) => {
    const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteTextRef.current)
    const next = resolveMarkdownChecklistLineToggleTransform(currentText, sourceLine)
    if (!next) return
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, latestEditorTextRef])

  // Mirrors `isPreviewMode` for the navigation callbacks below, which are
  // deliberately identity-stable across renders but have to read the
  // *current* mode at click time -- and, on a note switch, a couple of
  // frames later still: leaving the auto-TOC chapter (always forced into
  // preview) for a note the reader keeps in edit mode flips this after the
  // click that started the navigation. See scrollToAnchorTarget.
  const isPreviewModeRef = useRef(isPreviewMode)
  useEffect(() => {
    isPreviewModeRef.current = isPreviewMode
  }, [isPreviewMode])

  // Mirrors `activeNoteId` for the same reason, and for one more: the
  // edit-mode anchor jump has to know when the note switch it was queued
  // behind has actually landed in this section. See scrollEditorToAnchor.
  const activeNoteIdRef = useRef(activeNoteId)
  useEffect(() => {
    activeNoteIdRef.current = activeNoteId
  }, [activeNoteId])

  /** Character offset of a 0-indexed source line's first character, clamped into `text`. */
  const resolveOffsetForSourceLine = (text: string, sourceLine: number): number => {
    if (sourceLine <= 0) return 0
    let line = 0
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) === 10) {
        line += 1
        if (line === sourceLine) return index + 1
      }
    }
    return text.length
  }

  /**
   * The edit-mode half of anchor navigation: puts the caret on the anchor's
   * own line and lets the editor scroll it into view.
   *
   * Everything else in this hook scrolls the *preview* pane, which is the
   * only pane an anchor could ever land in -- so following an auto-TOC entry
   * while the section is in edit mode used to activate the target note and
   * then do nothing at all to the editor, leaving it whereverits own restore
   * had put it (the top of the note, give or take a line). The link looked
   * like it did nothing but switch notes.
   *
   * `resolveLine` is re-run against the editor's own current text on every
   * attempt rather than being given a line resolved up front: on a note
   * switch the adapter still holds the *previous* note's document for a few
   * frames, and a line number resolved against the target note's text means
   * nothing in that one. Re-resolving makes the answer and the document it
   * addresses always come from the same text.
   *
   * `expectedNoteId` is what says the switch has actually landed. It is
   * deliberately not "the editor's text changed": the auto-TOC chapter is
   * forced-preview and never loads into the editor at all, so following one
   * of its links leaves the adapter holding the *target* note's text the
   * whole way through -- a text-change gate waits forever on exactly the
   * navigation this exists to serve.
   */
  const scrollEditorToAnchor = useCallback((
    resolveLine: (text: string) => number | null,
    expectedNoteId: string | null,
    instant: boolean,
    align: 'center' | 'top' = 'center',
  ) => {
    const attempt = (attemptsLeft: number) => {
      const adapter = adapterRef.current
      const text = adapter?.getSnapshot()?.text
      const isTargetActive = expectedNoteId === null || activeNoteIdRef.current === expectedNoteId
      if (adapter && typeof text === 'string' && isTargetActive) {
        const sourceLine = resolveLine(text)
        if (sourceLine !== null) {
          const offset = resolveOffsetForSourceLine(text, sourceLine)
          adapter.applySnapshot({
            selection: { anchor: offset, focus: offset, start: offset, end: offset, isCollapsed: true },
            // Animated only within the note the reader is already in -- see
            // EditorSelectionScrollBehavior. Arriving from another note is
            // instant, and normally lands on a position the note was already
            // opened at (activateNote's overrideSourceAnchorLine), leaving
            // this as a no-op correction rather than a visible second hop.
            selectionScrollBehavior: align === 'top'
              ? 'top-caged-instant'
              : (instant ? 'center-caged-instant' : 'center-caged'),
          })
          return
        }
      }

      if (attemptsLeft <= 0) return
      window.requestAnimationFrame(() => attempt(attemptsLeft - 1))
    }

    attempt(30)
  }, [adapterRef])

  // Scrolls the preview pane to the top of the document. Used for cross-note
  // links with no `#anchor-id` — deferred a couple of frames past the note
  // switch so it wins over whatever scroll position the new note's own
  // render-view restore might otherwise land on.
  const scrollPreviewToTop = useCallback((waitForNoteSwitch: boolean, expectedNoteId: string | null = null) => {
    const reset = () => {
      // Instant whenever this is a note switch (which it always is today):
      // there is no position worth travelling from -- the reader never chose
      // where the note being opened was last left, and mostly never saw it.
      // Same pane-awareness the anchor branch needs: in edit mode there is
      // no preview pane to scroll, and "go to this note" should still land
      // at its start rather than silently leaving the editor wherever the
      // note's own restore put it.
      if (!isPreviewModeRef.current) {
        // Waits for the switch the same way the anchor branch does --
        // landing on offset 0 before it completes would put the caret at the
        // top of the note being *left*, not the one being opened.
        scrollEditorToAnchor(() => 0, expectedNoteId, waitForNoteSwitch)
        return
      }
      const scroller = previewScrollRef.current
      if (!scroller) return
      if (!waitForNoteSwitch) {
        scroller.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      // `.markdown-preview` carries `scroll-behavior: smooth` in CSS, so an
      // instant write has to force `auto` itself or the browser animates it.
      const previousScrollBehavior = scroller.style.scrollBehavior
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = 0
      scroller.style.scrollBehavior = previousScrollBehavior
    }

    if (waitForNoteSwitch) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(reset))
    } else {
      reset()
    }
  }, [previewScrollRef, scrollEditorToAnchor])

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
  const scrollToRenderedElement = useCallback((findTargetElement: () => HTMLElement | null, sourceLine: number | null, waitForNoteSwitch: boolean, instant: boolean, align: 'center' | 'start' = 'center') => {
    // On a note switch, previewBlocksRef.current can still hold the
    // *previous* note's (much shorter) block list for a few frames after
    // activateNote's promise resolves -- its own effect only commits once
    // React has actually re-rendered with the new note's text. The old code
    // resolved the block index exactly once, before the retry loop below,
    // so a resolution against a still-stale ref was never retried -- only
    // the DOM-element lookup was. Recomputing the index on every attempt
    // (cheap -- a binary search) closes that race: once the ref catches up,
    // the index changes and scrollToIndex finally targets the right block.
    let lastScrolledIndex = -1
    const attemptScroll = (attemptsLeft: number) => {
      if (sourceLine !== null) {
        const index = resolvePreviewBlockIndexForSourceLine(previewBlocksRef.current, sourceLine)
        if (index >= 0 && index !== lastScrolledIndex) {
          lastScrolledIndex = index
          // Animated only within the note the reader is already in. Coming
          // from another note there is nothing to orient -- and the pane has
          // normally already been restored straight onto this block anyway
          // (activateNote's overrideSourceAnchorLine), so this resolves to no
          // movement at all rather than a travel across the document.
          virtualizer.scrollToIndex(index, { align, behavior: instant ? 'auto' : 'smooth' })
        }
      }

      const target = findTargetElement()

      // The correction below is a plain scroll write, and the travel above
      // is a curve animation that recomputes scrollTop from its own captured
      // start/target on every frame -- so correcting while it's still in
      // flight is erased on the animation's next frame, and it lands on the
      // *estimated* block offset it planned for instead of on the element.
      // That estimate is `estimateSize` x block count for anything the
      // virtualizer hasn't measured yet, i.e. arbitrarily wrong on a large
      // document, which is exactly what made anchor and TOC links land in
      // the wrong place -- worst of all *when the element was found*, since
      // that is the case whose correction got thrown away. Waiting for the
      // travel to settle is not a failed attempt, so it doesn't consume the
      // retry budget either; only a genuinely missing element does.
      const scroller = previewScrollRef.current
      const isTravelling = scroller !== null && isNonQuantizedSmoothScrollActive(scroller)

      if (target && !isTravelling) {
        // Instant, not smooth -- the virtualizer scroll above already did
        // the (smooth) traveling; this is just a small, exact centering
        // correction within the target's own block, not a second hop.
        target.scrollIntoView({ block: align, inline: 'nearest' })
        // The flash is a find-hit device: it marks one match inside prose the
        // reader is scanning. A heading landing at the top of the viewport
        // already says where you are, so flashing it only adds motion to an
        // arrival that should feel settled. Manual anchors into mid-prose keep
        // it -- there the target really is one point among others.
        if (align !== 'start') {
          target.classList.add('note-anchor-marker-flash')
          window.setTimeout(() => target.classList.remove('note-anchor-marker-flash'), 1200)
        }
        return
      }

      if (isTravelling) {
        window.requestAnimationFrame(() => attemptScroll(attemptsLeft))
        return
      }

      if (attemptsLeft <= 0) return
      window.requestAnimationFrame(() => attemptScroll(attemptsLeft - 1))
    }

    // Same budget either way. The two cases used to differ (30 vs. 5)
    // because only a note switch was expected to need time -- but the
    // retried work is a DOM query plus a binary search, and an
    // already-active note still has to wait for a virtualized-out block to
    // mount and measure, which a five-frame budget routinely lost.
    if (waitForNoteSwitch) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => attemptScroll(30)))
    } else {
      attemptScroll(30)
    }
  }, [virtualizer, previewScrollRef])

  // Scrolls to a manual `[Anchor Text](#anchor-id)` definition, rendered as
  // an inert `.note-anchor-marker` span carrying the id verbatim.
  const scrollToAnchorInPreview = useCallback((anchorId: string, sourceLine: number | null, waitForNoteSwitch: boolean, instant: boolean) => {
    scrollToRenderedElement(() => {
      const scoped = previewScrollRef.current
      if (!scoped) return null
      const candidates = Array.from(scoped.querySelectorAll<HTMLElement>('.note-anchor-marker'))
      return candidates.find((el) => el.dataset.anchorId === anchorId) ?? null
    }, sourceLine, waitForNoteSwitch, instant)
  }, [scrollToRenderedElement, previewScrollRef])

  // Scrolls to an automatic, on-the-fly heading anchor -- there's no literal
  // DOM marker to search for (the heading's own source was never rewritten),
  // so the target is the heading element itself, found via the
  // `data-source-line-start` attribute createPreviewSourceAnchorRehypePlugin
  // already stamps on every heading.
  const scrollToHeadingAnchorInPreview = useCallback((sourceLine: number, waitForNoteSwitch: boolean, instant: boolean) => {
    const selector = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      .map((tag) => `${tag}[data-source-line-start="${sourceLine}"]`)
      .join(', ')
    // Top-aligned, never centred: the heading is the start of what the reader
    // asked for, so centring spends the upper half of the viewport on the
    // section they were leaving.
    scrollToRenderedElement(() => previewScrollRef.current?.querySelector<HTMLElement>(selector) ?? null, sourceLine, waitForNoteSwitch, instant, 'start')
  }, [scrollToRenderedElement, previewScrollRef])

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
    const resolveLine = headingSlug !== null
      ? (text: string) => findHeadingAnchorLine(text, headingSlug)
      : (text: string) => (noteContainsAnchorDefinition(text, anchorId) ? findAnchorDefinitionLine(text, anchorId) : null)

    // Which pane to land in is decided at scroll time, not at click time --
    // and, on a note switch, two frames later still. Following a link out of
    // the auto-TOC chapter is exactly the case that needs this: that chapter
    // is always forced into preview, so the mode this hook rendered with is
    // "preview" no matter what mode the target note will actually open in,
    // and the flip back to the reader's own mode has to have committed
    // before the branch is taken.
    // A note switch is exactly the case with nothing to orient, so it is
    // also exactly the case that must not animate: smooth scrolling is what
    // shows a reader how the place they were relates to the place they asked
    // for, which only means anything inside one document. `waitForNoteSwitch`
    // already is "this activated a different note", so it doubles as the
    // instant flag.
    const scrollTo = (sourceLine: number, waitForNoteSwitch: boolean, expectedNoteId: string | null = null) => {
      // A heading jump never animates, even inside the note the reader is
      // already in. The orientation argument for animating a same-note jump is
      // about landing on a point in prose -- watching the travel relates where
      // you were to where you asked to go. A heading is not a point in prose:
      // it is a labelled destination, and a table of contents is a menu of
      // them, so the useful thing is simply to arrive.
      const instant = waitForNoteSwitch || headingSlug !== null
      const dispatch = () => {
        if (!isPreviewModeRef.current) {
          scrollEditorToAnchor(resolveLine, expectedNoteId, instant, headingSlug !== null ? 'top' : 'center')
          return
        }
        if (headingSlug !== null) {
          scrollToHeadingAnchorInPreview(sourceLine, waitForNoteSwitch, instant)
          return
        }
        scrollToAnchorInPreview(anchorId, sourceLine, waitForNoteSwitch, instant)
      }

      if (waitForNoteSwitch) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(dispatch))
      } else {
        dispatch()
      }
    }

    return { resolveLine, scrollTo }
  }, [scrollToHeadingAnchorInPreview, scrollToAnchorInPreview, scrollEditorToAnchor])

  // Shared by both the direct-note and chapter branches of
  // navigateToInternalPreviewLink below: activates `targetNoteId` (unless
  // already active) then either scrolls to `anchorId` within it or, on a
  // genuine note switch with no anchor, resets to the top.
  const activateAndScroll = useCallback((targetNoteId: string, contentTextForExistenceCheck: string, anchorId: string | null) => {
    const isAlreadyActive = targetNoteId === activeNoteId
    const anchorTarget = anchorId !== null ? resolveAnchorTarget(anchorId) : null

    // Resolved *before* activation, not after, so the note can be opened
    // already sitting on it -- see activateNote's overrideSourceAnchorLine.
    // Resolving after (which is all the follow-up below can do) means the
    // note first restores wherever it was last left, and only then moves.
    const preResolvedLandingLine = !isAlreadyActive && anchorTarget !== null
      ? anchorTarget.resolveLine(contentTextForExistenceCheck)
      : null
    const preResolvedLandingOffset = preResolvedLandingLine !== null
      ? resolveOffsetForSourceLine(normalizeInternalText(contentTextForExistenceCheck), preResolvedLandingLine)
      : undefined
    const followUp = () => {
      if (anchorTarget !== null) {
        // Once the target note is active, its own live text is what
        // previewBlocks actually reflects -- not the (possibly stale)
        // stored contentText used for the existence check at the call site.
        const anchorSourceText = isAlreadyActive
          ? (latestEditorTextRef.current || activeNoteTextRef.current)
          : contentTextForExistenceCheck
        const sourceLine = anchorTarget.resolveLine(anchorSourceText)
        if (sourceLine !== null) anchorTarget.scrollTo(sourceLine, !isAlreadyActive, targetNoteId)
      } else if (!isAlreadyActive) {
        // Already-active notes stay wherever the reader currently is —
        // only a genuine note switch resets to the top.
        scrollPreviewToTop(true, targetNoteId)
      }
    }

    if (isAlreadyActive) {
      followUp()
    } else {
      void activateNote(
        targetNoteId,
        preResolvedLandingOffset,
        preResolvedLandingLine ?? undefined,
      ).then(followUp)
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
      // `$12` means the auto id `$12`: the link's own sigil doubles as the
      // id's first character, so the raw text after it has to be resolved back
      // to the stored form before lookup (shared/assignedIds.ts).
      const normalizedTarget = normalizeInternalIdForLookup(resolveLinkedNoteId(target.noteIdRaw))
      contextNote = notesRef.current.find((note) => note.assignedId && normalizeInternalIdForLookup(note.assignedId) === normalizedTarget)
      if (!contextNote) return
    } else if (activeNoteId) {
      const activeNote = notesRef.current.find((note) => note.id === activeNoteId)
      // chapterParentId is null for a chapter currently detached (Trash, or
      // an Archive fold-out row) -- see NoteSummary.detachedChapterParentId's
      // own doc comment -- so it isn't enough alone to resolve one opened
      // directly from one of those rows back to its real parent.
      const resolvedChapterParentId = activeNote?.chapterParentId ?? activeNote?.detachedChapterParentId
      const contextNoteId = activeNote?.chapterOnly && resolvedChapterParentId ? resolvedChapterParentId : activeNoteId
      contextNote = notesRef.current.find((note) => note.id === contextNoteId)
    }

    if (target.chapterIdRaw !== null) {
      if (!contextNote || !window.thockdownChapters) return
      const parentNoteId = contextNote.id
      const normalizedChapterTarget = normalizeInternalIdForLookup(resolveLinkedChapterId(target.chapterIdRaw))
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

  // Same ref-forwarding reason as the two navigation callbacks above:
  // applyProgrammaticEditorText (and so handleToggleChecklistAtLine, which
  // closes over it) isn't keystroke-stable, so forwarding through a ref
  // keeps previewMarkdownComponents' own memo -- and every currently-
  // mounted PreviewMarkdownBlock -- from treating it as "changed" on every
  // keystroke.
  const handleToggleChecklistAtLineRef = useRef(handleToggleChecklistAtLine)
  useEffect(() => {
    handleToggleChecklistAtLineRef.current = handleToggleChecklistAtLine
  }, [handleToggleChecklistAtLine])

  // Recomputes only when isViewingAutoOpenItemsChapter/isActiveNoteEditable
  // flip or the active note switches (handleToggleOpenItem's own identity
  // only changes with activeNoteId) -- never on an individual checkbox
  // toggle, since the toggle store's own reference never changes and its
  // per-line subscriptions (see OpenItemCheckbox) are what actually
  // propagate an Open-Items toggle to the screen; a regular-preview toggle
  // instead changes the block's own `text` (see handleToggleChecklistAtLine),
  // which is what re-renders that one block. No ref-forwarding needed for
  // handleToggleOpenItem the way the navigation callbacks (and
  // handleToggleChecklistAtLine) above need it: that pattern exists
  // specifically to keep a memo stable across per-keystroke churn, and
  // handleToggleOpenItem doesn't change on a keystroke.
  const previewMarkdownComponents = useMemo(
    () => createPreviewMarkdownComponents(
      (target) => navigateToInternalPreviewLinkRef.current(target),
      (target) => navigateToInternalNoteLinkRef.current(target),
      isViewingAutoOpenItemsChapter ? {
        isChecked: openItemsToggleStoreRef.current!.isChecked,
        subscribe: openItemsToggleStoreRef.current!.subscribeToLine,
        onToggle: handleToggleOpenItem,
      } : undefined,
      (!isViewingAutoOpenItemsChapter && isActiveNoteEditable)
        ? (sourceLine) => handleToggleChecklistAtLineRef.current(sourceLine)
        : undefined,
    ),
    [isViewingAutoOpenItemsChapter, handleToggleOpenItem, isActiveNoteEditable],
  )

  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(documentFindDirective.findText, isDocumentFindCaseSensitive),
    [documentFindDirective.findText, isDocumentFindCaseSensitive],
  )

  // ---------------------------------------------------------------------
  // Background measurement prewarm -- see previewMeasurementPrewarm.ts for
  // why this exists and what makes it fragile. In short: without it every
  // unvisited block is a flat 56px guess, so the scrollbar is wrong by ~71%
  // of the document height on a large note and churns as real heights land.
  // ---------------------------------------------------------------------
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const [spacerReady, setSpacerReady] = useState(false)
  const prewarmHostRef = useRef<HTMLDivElement | null>(null)
  const prewarmProbeRef = useRef<HTMLDivElement | null>(null)
  const [probeReady, setProbeReady] = useState(false)
  const [prewarmBatch, setPrewarmBatch] = useState<readonly number[]>([])
  const prewarmedRef = useRef<Set<number>>(new Set())
  const prewarmBufferRef = useRef<Map<number, number>>(new Map())
  const prewarmBatchSizeRef = useRef(PREVIEW_PREWARM_INITIAL_BATCH)
  const prewarmStartedAtRef = useRef(0)
  const prewarmScheduleRef = useRef<number | null>(null)
  const prewarmDoneRef = useRef(false)
  const lastPreviewScrollAtRef = useRef(0)
  const prewarmBatchRef = useRef<readonly number[]>([])
  // Reported out so the UI can be honest about the wait -- see the discovery
  // bar in SectionEditorArea. Updated only when the whole integer percent
  // moves, so a thousand-block survey costs at most a hundred re-renders of
  // the section rather than one per batch.
  const [previewDiscovery, setPreviewDiscovery] = useState<PreviewDiscoveryState>({ isSurveying: false, percent: 0, measured: 0, total: 0 })
  const discoveryPercentRef = useRef(-1)

  const reportDiscovery = useCallback((measured: number, total: number, isSurveying: boolean) => {
    const percent = total > 0 ? Math.min(100, Math.floor((measured / total) * 100)) : 0
    if (isSurveying && percent === discoveryPercentRef.current) return
    discoveryPercentRef.current = isSurveying ? percent : -1
    setPreviewDiscovery({ isSurveying, percent, measured, total })
  }, [])

  const cancelPrewarmSchedule = useCallback(() => {
    if (prewarmScheduleRef.current === null) return
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    cancel(prewarmScheduleRef.current)
    prewarmScheduleRef.current = null
  }, [])

  // requestIdleCallback is the right primitive here -- the whole point is to
  // use time the main thread isn't using. It is NOT universally available
  // (Safari shipped it only recently), so fall back to a timeout; the slice
  // budget below bounds the damage either way.
  const schedulePrewarmSlice = useCallback((run: () => void) => {
    cancelPrewarmSchedule()
    if (typeof window.requestIdleCallback === 'function') {
      prewarmScheduleRef.current = window.requestIdleCallback(() => { run() }, { timeout: 500 })
      return
    }
    prewarmScheduleRef.current = window.setTimeout(run, 16)
  }, [cancelPrewarmSchedule])

  /**
   * Hands every buffered height to the virtualizer at once, when the survey is
   * complete.
   *
   * One commit, not a stream of them: this is the difference between a
   * scrollbar that crawls for the whole survey and one that sits still and
   * then corrects once. react-virtual compensates scrollTop per item for
   * anything above the fold, so the reader's content stays where it is -- what
   * moves is the thumb, once, which is honest and is what the discovery
   * progress bar has been explaining while this ran.
   */
  const commitPrewarmedSizes = useCallback(() => {
    const buffered = prewarmBufferRef.current
    if (buffered.size === 0) return
    prewarmBufferRef.current = new Map()

    // Ascending, so react-virtual's own above-the-fold compensation sees each
    // item in document order rather than jumping around the offset map.
    for (const index of [...buffered.keys()].sort((a, b) => a - b)) {
      virtualizer.resizeItem(index, buffered.get(index)!)
    }
  }, [virtualizer])

  const queueNextPrewarmBatch = useCallback(() => {
    schedulePrewarmSlice(() => {
      const blockCount = previewBlocksRef.current.length
      if (blockCount === 0 || prewarmDoneRef.current) return

      // Never compete with the reader. Two separate cases, both measured:
      // an animated scroll in flight (the app's own travel), and the reader
      // simply scrolling by hand -- requestIdleCallback's timeout means a
      // batch runs eventually whether the thread is idle or not, so without
      // this the survey works straight through a scroll. At 6x CPU throttle
      // that cost ~36% median frame time while reading. The survey has no
      // deadline; the reader does.
      const scroller = previewScrollRef.current
      const scrolledRecently = performance.now() - lastPreviewScrollAtRef.current < PREVIEW_PREWARM_SCROLL_QUIET_MS
      if (scrolledRecently || (scroller && isNonQuantizedSmoothScrollActive(scroller))) {
        // Yielding means unmounting, not just declining to start a new batch.
        // The previous batch's blocks are real rendered markdown; left in the
        // DOM they keep costing layout on every frame of the reader's scroll.
        // Measured: without this the host was present on 253 of 253 frames
        // during a continuous scroll, i.e. the "pause" paused nothing the
        // reader could feel.
        if (prewarmBatchRef.current.length > 0) {
          prewarmBatchRef.current = []
          setPrewarmBatch([])
        }
        queueNextPrewarmBatch()
        return
      }

      const cursorIndex = virtualizer.getVirtualItems().at(-1)?.index ?? 0
      const next = planNextPrewarmBatch({
        blockCount,
        isMeasured: (index) => prewarmedRef.current.has(index),
        cursorIndex,
        batchSize: prewarmBatchSizeRef.current,
      })

      if (next.length === 0) {
        prewarmDoneRef.current = true
        prewarmBatchRef.current = []
        setPrewarmBatch([])
        commitPrewarmedSizes()
        reportDiscovery(blockCount, blockCount, false)
        return
      }

      prewarmStartedAtRef.current = performance.now()
      prewarmBatchRef.current = next
      setPrewarmBatch(next)
    })
  }, [schedulePrewarmSlice, virtualizer, previewBlocksRef, previewScrollRef, commitPrewarmedSizes, reportDiscovery])

  // Measure whatever the host just rendered and hand the real heights to the
  // virtualizer. useLayoutEffect so this reads geometry in the same frame the
  // batch was committed, before the browser paints -- the host is hidden, so
  // there is nothing to see, but measuring after a paint would let an
  // interleaved style change land between render and read.
  useLayoutEffect(() => {
    if (prewarmBatch.length === 0) return
    const host = prewarmHostRef.current
    if (!host) return

    for (const index of prewarmBatch) {
      const el = host.querySelector<HTMLElement>(`[data-prewarm-index="${index}"]`)
      if (!el) continue
      const height = el.getBoundingClientRect().height
      prewarmedRef.current.add(index)
      // BUFFERED, not applied. Handing each height to the virtualizer as it is
      // measured is what made this feature miserable on slow hardware: every
      // resizeItem changes the total size (the thumb crawls) and, for any block
      // above the fold, compensates scrollTop (the text vibrates). Measured at
      // 6x CPU throttle, parked mid-document with no input: 115 size changes
      // and 96 scrollTop moves totalling 25,280px of drag over 12 seconds,
      // against 1 change and 0 moves with the sweep disabled entirely. On a
      // fast machine the same churn is over in ~1.3s and reads as a settle,
      // which is exactly why it survived review here. See the single commit in
      // commitPrewarmedSizes below.
      if (height > 0) prewarmBufferRef.current.set(index, height)
    }

    reportDiscovery(prewarmedRef.current.size, previewBlocksRef.current.length, true)

    prewarmBatchSizeRef.current = resolveNextPrewarmBatchSize(
      prewarmBatch.length,
      performance.now() - prewarmStartedAtRef.current,
      PREVIEW_PREWARM_SLICE_BUDGET_MS,
    )
    queueNextPrewarmBatch()
  }, [prewarmBatch, virtualizer, queueNextPrewarmBatch, reportDiscovery, previewBlocksRef])

  const restartPrewarm = useCallback(() => {
    prewarmedRef.current = new Set()
    prewarmBufferRef.current = new Map()
    prewarmDoneRef.current = false
    prewarmBatchSizeRef.current = PREVIEW_PREWARM_INITIAL_BATCH
    prewarmBatchRef.current = []
    setPrewarmBatch([])
    discoveryPercentRef.current = -1
    reportDiscovery(0, previewBlocksRef.current.length, true)
    queueNextPrewarmBatch()
  }, [queueNextPrewarmBatch, reportDiscovery, previewBlocksRef])

  // Start over whenever the cached heights could no longer be true.
  //
  // A new note (a new block list) is the obvious trigger. The subtle one is
  // TYPOGRAPHY: preview font size, line height, letter spacing and edge padding
  // all arrive as inline styles on the scroller, set by SectionEditorArea from
  // the reader's own view settings. None of them changes this hook's inputs,
  // and none of them changes the scroller's clientWidth either -- padding lives
  // *inside* clientWidth -- so an earlier version of this effect that watched
  // the scroller's width missed every one of them. Measured cost of that miss:
  // after a font-size change, jumping to the bottom of the scrollbar landed
  // 2,590px short; after a line-height change, 2,014px. Confidently wrong,
  // which is worse than the flat estimate this feature replaced.
  //
  // Rather than enumerate the settings -- a list that would silently rot the
  // first time a new one is added -- this watches a PROBE: a hidden element
  // inside the spacer holding fixed text, inheriting exactly what the real
  // blocks inherit. Anything that would re-wrap or re-space a block changes the
  // probe's own box, and a ResizeObserver on it restarts the sweep. That also
  // catches changes driven from an ancestor (double-size mode, a root font
  // scale) which no observer on the scroller's own attributes would see.
  useEffect(() => {
    restartPrewarm()
  }, [previewBlocks, restartPrewarm])

  useEffect(() => {
    const probe = prewarmProbeRef.current
    if (!probe) return undefined

    let last = `${probe.offsetWidth}x${probe.offsetHeight}`
    let settleTimer: number | null = null

    const observer = new ResizeObserver(() => {
      const next = `${probe.offsetWidth}x${probe.offsetHeight}`
      if (next === last) return
      last = next
      // Debounced, because a window or split-view drag fires this on every
      // frame of the drag. Restarting per frame means a survey that never
      // finishes while the reader is still dragging, on exactly the hardware
      // where it is already slowest. Wait for the geometry to hold still, then
      // survey once against the size it actually settled on.
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = null
        restartPrewarm()
      }, PREVIEW_PREWARM_RESIZE_SETTLE_MS)
    })
    observer.observe(probe)

    return () => {
      observer.disconnect()
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [probeReady, restartPrewarm])

  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!scroller) return undefined
    const onScroll = () => { lastPreviewScrollAtRef.current = performance.now() }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [previewScrollRef, spacerReady])

  useEffect(() => cancelPrewarmSchedule, [cancelPrewarmSchedule])

  const virtualItems = virtualizer.getVirtualItems()

  // Memoized so per-frame App re-renders (scroll thumb state, etc.) don't
  // even walk the visible-block list unless something that actually affects
  // its output changed. `virtualItems` is itself stable (same array
  // reference) whenever react-virtual's own visible range/measurements
  // haven't changed, so this reproduces the gating this memo always had --
  // just scoped to the *visible* subset now, which is all this loop ever
  // builds regardless.
  const previewMarkdownElement = useMemo(() => (
    <div
      ref={(node) => { spacerRef.current = node; if (node) setSpacerReady(true) }}
      style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}
    >
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

  // Portalled into the spacer rather than rendered inside the memo above, for
  // two independent reasons. Correctness: the spacer is the in-flow box the
  // real blocks are positioned against, and measuring anywhere else resolves
  // width:100% against a box 36px wider (see previewMeasurementPrewarm.ts).
  // Cost: a batch lands every few milliseconds, and rendering it inside the
  // memo would re-render every visible block along with it.
  const prewarmHostElement = useMemo(() => {
    if (!spacerReady || !spacerRef.current) return null
    return createPortal(
      <div
        ref={prewarmHostRef}
        aria-hidden="true"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}
      >
        {/* The typography probe -- always mounted, never measured into the
            cache. Its only job is to change size when anything that would
            re-wrap a real block changes, so the ResizeObserver above can
            invalidate the sweep. The text is deliberately long enough to wrap
            at any sane width: that makes letter-spacing and content-width
            changes move its HEIGHT, not just its width, so a single observer
            catches every case. Never shorten it to a single line. */}
        <div
          ref={(node) => { prewarmProbeRef.current = node; if (node) setProbeReady(true) }}
          data-prewarm-probe=""
          style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
        >
          The quick brown fox jumps over the lazy dog, and keeps on jumping for
          long enough that this sentence has to wrap onto a second line at any
          reasonable width, which is the entire point of it being this long.
        </div>
        {prewarmBatch.map((index) => {
          const block = previewBlocks[index]
          if (!block) return null
          return (
            <div
              key={index}
              data-prewarm-index={index}
              // Absolutely positioned exactly like a real block wrapper.
              // Normal flow would let adjacent blocks collapse margins with
              // each other, which the real list never does.
              className={index === 0 ? 'preview-prewarm-first-block' : undefined}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
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
      </div>,
      spacerRef.current,
    )
  }, [spacerReady, prewarmBatch, previewBlocks, previewSearchHighlightPlugin, previewMarkdownComponents])

  // Deliberately dependency-free: this must fire after EVERY commit of this
  // hook's output, not only when some tracked value changed -- react-virtual
  // corrects block offsets through its own state updates, and those commits
  // are exactly the ones the settle gate needs to hear about. useLayoutEffect
  // (not useEffect) so the notification lands before paint, keeping the gate's
  // reveal decision in the same frame as the geometry it just observed.
  useLayoutEffect(() => {
    onPreviewCommitted?.()
  })

  return {
    previewMarkdownElement: (
      <>
        {previewMarkdownElement}
        {prewarmHostElement}
      </>
    ),
    previewDiscovery,
  }
}

/* eslint-disable react-refresh/only-export-components -- this hook module
   also defines PreviewMarkdownBlock, a small internal presentational
   component memoized for the preview pane's per-block rendering (see its
   own comment below); it isn't part of this module's public API, so
   there's nothing here for Fast Refresh to preserve identity of. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
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
import { splitPreviewBlocksWithoutFullParse, type PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'
import { requestFullBlockSplit } from '../editor/documentFactsClient'
import { resolvePreviewBlockIndexForSourceLine } from '../editor/PreviewBlockIndex'
import { isNonQuantizedSmoothScrollActive, scrollToNonQuantizedSmooth } from '../editor/NonQuantizedSmoothScroll'
import { traceScroll } from '../editor/scrollTrace'
import {
  isContinuousDocument,
  resolveChunkedCharTarget,
  resolveChunkedScrollRatio,
  resolveChunkedThumbRatio,
  resolveViewportCharCapacity,
  resolveContinuousRatios,
  type DocumentPosition,
} from '../editor/documentPosition'
import { noteFrameCostScroll } from './previewFrameCostTrace'
import { usePreviewWindow, type PreviewWindowApi } from './usePreviewWindow'
import {
  buildBlockCharOffsets,
  resolveVisibleBlockIndexRange,
  resolveLastScreenChars,
  resolvePreviewCharScrollOffset,
  resolvePreviewCharViewport,
} from './previewCharPosition'
import type { PreviewBlockMeasurement, PreviewCharViewport } from './previewCharPosition'
import {
  measurePreviewBlockGeometry,
  readPreviewEdgePaddingPx,
  resolvePreviewEdgeBlockClass,
} from './previewBlockGeometry'
import { resolvePreviewLandingScrollTop } from './previewLanding'

/**
 * The preview's position in character space, published for the scrollbar.
 *
 * Deliberately three small functions rather than a value: the scrollbar reads
 * this on every scroll event, and anything that had to be recomputed into
 * React state per frame would re-render the section instead.
 */
/**
 * What the preview hands the scrollbar.
 *
 * Deliberately nothing but `DocumentPosition` -- four methods, all in ratios.
 * The scrollbar is not told whether this document is being measured or
 * modelled, because a caller that could ask would eventually branch on the
 * answer, and then there would be two scrollbars again. See
 * editor/documentPosition.ts.
 */
export type PreviewDocumentPositionApi = DocumentPosition



/**
 * What the character ruler measures.
 *
 * Ordinary prose rather than a repeated glyph: the quantity wanted is the
 * average advance of a character in this document's alphabet, and 'M' repeated
 * would answer a question nobody asked. Long enough that one glyph's rounding
 * cannot move the average.
 */
const PREVIEW_CHAR_RULER_TEXT = 'the quick brown fox jumps over the lazy dog and then keeps going for a while longer so that one glyph cannot move the average'



/** Progress of the background block survey -- see previewMeasurementPrewarm.ts. */
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
  opts?: {
    align?: 'start' | 'center'
    behavior?: 'auto' | 'smooth'
    /**
     * How far below the pane's top edge to leave the block, in pixels.
     *
     * Omitted means flush at the top. A restore passes
     * `RESTORE_OFFSET_LINES` worth of the RENDER view's line height -- the
     * convention that a restored anchor sits one line below the border rather
     * than jammed against it. The offset is honoured against the DOCUMENT's
     * content, never against its page margin; see previewLanding.ts.
     */
    offsetPx?: number
  },
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
  /**
   * Whether the find panel is actually on screen (sidebar visible, showing
   * find). Render view highlights EVERY hit, so a query left behind in a
   * closed or switched-away find panel would otherwise keep marking up the
   * reader's text with nothing on screen to explain it. The query itself is
   * kept -- reopening the panel brings the highlights straight back. Edit
   * view needs no such gate: it only ever selects the hit you click.
   */
  isSearchHighlightActive: boolean
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
   * Filled in by this hook with the preview's position in CHARACTER space, for
   * the custom scrollbar to drive its thumb from -- see previewCharPosition.ts
   * for why the thumb is not a pixel quantity. Optional: without it the
   * scrollbar falls back to the pixel mapping it always used.
   */
  previewDocumentPositionRef?: MutableRefObject<PreviewDocumentPositionApi | null>
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
  /**
   * Two-way channel for the persisted block-height survey (see
   * shared/noteLifecycle.ts's PersistedPreviewBlockHeights).
   *
   * `read` is populated here with the survey this pane has completed, if any,
   * so the component can write it out when the note is left. `pending` is the
   * one restored from the database on the way in, which this hook consumes
   * once -- and only if its geometry still matches what the pane is actually
   * laid out at now.
   *
   * A ref rather than props for the same reason previewScrollToSourceLineRef
   * is one: the survey completes long after any render, and the component
   * that persists it is not the one that produced it.
   */
  previewBlockHeightsRef?: MutableRefObject<{
    read: (() => { signature: string; heights: number[] } | null) | null
    pending: { signature: string; heights: number[] } | null
  } | null>
  /** Where the reader has put the line between a pixel-measured scrollbar and a character-counting one, in BLOCKS -- shown to them as paragraphs (Options > Performance). See editor/documentPosition.ts for why blocks are the unit. */
  noteSizeThresholdBlocks: number
  /** Put every note on the character-counting side, whatever its size -- the reader's standing preference, which overrides the threshold rather than moving it. */
  forceCharacterScrollbarThumb: boolean
  /** Whether the settle gate is currently holding the preview hidden for a note load. The measurement survey's "stand aside for the reader" rule consults it, because a scroll fired while the pane is hidden is the restore's, not the reader's -- see the scroll listener below, and previewSettleGate.ts's isHolding. */
  isPreviewSettleHolding?: () => boolean
  /** Populated here with "the survey still has heights to commit for the document on screen", which the settle gate reads as geometry that has not finished moving. See useEditorSectionMount's own declaration of this ref. */
  previewMeasurementPendingRef?: MutableRefObject<(() => boolean) | null>
}

export interface UsePreviewMarkdownRenderingResult {
  previewMarkdownElement: ReactNode
  /**
   * How many blocks the pane currently has -- see the return statement's own
   * note. Zero is an ordinary early state, not an error: the split arrives
   * progressively.
   */
  previewBlockCount: number
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
  isSearchHighlightActive,
  renderedDisplayText,
  previewScrollToSourceLineRef,
  previewDocumentPositionRef,
  previewBlockSplitCacheRef,
  isViewingAutoOpenItemsChapter,
  isActiveNoteEditable,
  applyProgrammaticEditorText,
  noteSizeThresholdBlocks,
  forceCharacterScrollbarThumb,
  onPreviewCommitted,
  isPreviewSettleHolding,
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

  /**
   * The text the block split actually runs on.
   *
   * In RENDER VIEW it is the live text: the reader is looking at these blocks,
   * so they must be current, and this takes the live value in the SAME render
   * the mode flips in -- never a frame later, so the toggle cannot show a
   * stale pane.
   *
   * While the pane is HIDDEN the split does not run at all -- with one
   * exception worth naming, since the sentence above read as absolute and is
   * not: `hiddenSplitText` is SEEDED with the text present at mount, so the
   * first note a freshly-mounted section shows does get split even in edit
   * mode. That is not waste (the map is wanted anyway -- for the anchor, for
   * the toggle, and to persist) and it is not on the main thread, but it is
   * why a cold start requests a split the phrasing here would not lead you
   * to expect. Every note switch AFTER that leaves this text alone, which is
   * the part that matters: nothing on screen derives from these blocks in
   * edit mode, and the split is the single most expensive thing a keystroke
   * can trigger.
   *
   * It was first tried as a short settle (recompute ~180ms after typing
   * stops), on the reasoning that the incremental split is only cheap because
   * each call diffs against the previous one, so letting it fall far behind
   * would trade a per-keystroke cost for one big parse at the toggle. The
   * measurement said otherwise, and it is worth recording because the
   * reasoning was sound and wrong:
   *
   *   On LIST-structured markdown the split is pathologically slow whatever
   *   the delta. A 300,000-character document of list items produced a ~1
   *   SECOND task per Enter (`parseStructuralRanges`, CDP profile), and it
   *   made no difference whether the items formed one list node or were
   *   separated into thousands of individual blocks -- both ~950-1000ms. The
   *   settle therefore did not buy a cheap catch-up, it just moved a full
   *   second off the keystroke's own task and onto the next idle moment,
   *   where it still blocked the main thread. That is audible as an irregular
   *   gap in the typing sound at every line break, which is exactly how it
   *   was reported. Prose of five times the size produces no such task at all.
   *
   * So: pay it once, when the pane is actually about to be looked at. The
   * cost that remains is a real one and is the next thing to fix -- see the
   * handover doc -- but it belongs at a mode toggle, not between keystrokes.
   */
  const [hiddenSplitText, setHiddenSplitText] = useState(renderedDisplayText)
  useEffect(() => {
    if (!isPreviewMode) return
    setHiddenSplitText(renderedDisplayText)
  }, [renderedDisplayText, isPreviewMode])
  const splitSourceText = isPreviewMode ? renderedDisplayText : hiddenSplitText
  // Warm-start from useEditorSectionMount's background prewarm if the text
  // matches. This avoids a second full remark parse on the first preview
  // render after edit mode had already parsed the document in the background.
  /**
   * The split, which this render DERIVES only when it can do so without a
   * full remark parse, and otherwise WAITS for.
   *
   * This used to call the total split here, in render. On a 2MB note that is
   * a 16-second remark parse inside a `useMemo`, on the main thread, inside
   * React's render phase -- the whole of a 26-second first open, measured in
   * a packaged build (scripts/perf/measureLargeNoteFirstOpen.mjs --mode=tree).
   * A worker had already been built for exactly this parse and could never
   * win, because a synchronous reader upstream of it always forced the answer
   * first. Moving work off the main thread cannot help while something in
   * render still demands it synchronously; the demand is the defect.
   *
   * So there are now three outcomes, and "not yet" is one of them:
   *   - the incremental path applies (a keystroke against a warm cache):
   *     sub-millisecond, stays here, because a worker round trip would be
   *     slower than the work.
   *   - the worker has already answered for this exact text: use it.
   *   - neither: PENDING. The pane renders no blocks, which is a real state
   *     and not a placeholder -- the editor chrome is its normal self and
   *     the text simply arrives, rather than appearing as raw source and
   *     then reflowing into formatted blocks.
   */
  const [workerSplit, setWorkerSplit] = useState<{ cache: PreviewBlockSplitCache; isComplete: boolean } | null>(null)
  const splitState = useMemo(
    () => {
      const cache = splitCacheRef.current
      const start = typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1' ? performance.now() : 0
      const incremental = splitPreviewBlocksWithoutFullParse(splitSourceText, cache)
      const fromWorker = workerSplit?.cache.text === splitSourceText ? workerSplit : null
      const resolved = incremental ? { cache: incremental, isComplete: true } : fromWorker
      if (typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
        console.log('[preview-block-cache] usePreviewMarkdownRendering split', {
          renderedLength: splitSourceText.length,
          hasMatchingCache: cache?.text === splitSourceText,
          cacheTextLength: cache?.text.length,
          ranges: cache?.ranges.length,
          source: incremental ? 'incremental' : fromWorker ? (fromWorker.isComplete ? 'worker' : 'worker-partial') : 'pending',
          resultRanges: resolved?.cache.ranges.length ?? 0,
          elapsedMs: Number((performance.now() - start).toFixed(2)),
        })
      }
      if (resolved) return resolved
      return { cache: { text: splitSourceText, ranges: [], blocks: [] } as PreviewBlockSplitCache, isComplete: false }
    },
    [splitSourceText, splitCacheRef, workerSplit],
  )
  const splitResult = splitState.cache

  /**
   * The only producer of a full split, and the thing that keeps a partial one
   * arriving.
   *
   * `isComplete` is the dependency rather than "is there anything yet",
   * deliberately: an instalment must not tear this effect down and restart
   * it, or the second instalment would arrive to a cancelled listener and the
   * document would stop filling in halfway. It re-runs exactly twice per
   * text -- once to ask, once when the answer is whole.
   */
  useEffect(() => {
    if (splitState.isComplete) return
    let cancelled = false
    void requestFullBlockSplit(splitSourceText, (partial) => {
      if (!cancelled) setWorkerSplit({ cache: partial, isComplete: false })
    }).then((cache) => {
      if (!cancelled) setWorkerSplit({ cache, isComplete: true })
    })
    return () => { cancelled = true }
  }, [splitState.isComplete, splitSourceText])

  // Committed in an effect, not during the useMemo above, so this cache
  // update never happens during a render React might discard (Strict Mode's
  // double-invoke, an interrupted concurrent render) -- only once this
  // result has actually become what's on screen.
  //
  // An INCOMPLETE result is never committed. It describes the top of the
  // document and nothing below it, so the incremental path would diff the
  // next keystroke against a document it believes ends early, and
  // buildPersistedBlockMap would write that truncation to the database as if
  // it were the note's map.
  useLayoutEffect(() => {
    if (!splitState.isComplete) return
    splitCacheRef.current = splitResult
  }, [splitState.isComplete, splitResult, splitCacheRef])
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
  /**
   * The one place this hook moves the continuous pane.
   *
   * Was react-virtual's `scrollToFn`, which received the scroller from the
   * virtualizer; it now takes it directly, because there is no virtualizer to
   * receive it from. Everything below the signature is unchanged, including
   * the reason it exists at all: both branches are things the browser's own
   * scrolling would do differently.
   */
  const scrollPreviewTo = useCallback((offset: number, behavior?: 'auto' | 'smooth') => {
    const scroller = previewScrollRef.current
    if (!scroller) return
    const target = offset

    if (behavior === 'smooth') {
      // This app's own curve-based motion (see NonQuantizedSmoothScroll.ts),
      // not native smooth-scroll.
      //
      // CAUTION: re-invoking this mid-flight is NOT free and NOT smooth. It
      // cancels the running animation and builds a fresh bell curve from the
      // current position, and a bell starts at zero velocity -- so a re-invoke
      // brings the scroll to a standstill and re-accelerates. It preserves
      // position, not velocity. (An earlier comment here claimed it "replans
      // smoothly from wherever the animation currently is"; that half-truth
      // cost this file a re-aiming loop that fired every frame.)
      //
      // react-virtual does re-invoke it while correcting a destination whose
      // target block has just been measured. That is tolerated because it is
      // rare and self-limiting -- a correction or two on arrival -- not
      // because it is smooth. If a caller needs to change a destination
      // mid-flight and keep the derivatives continuous, the tool for that is
      // buildContinuationPlan in ScrollCurvePlan.ts, which picks up from the
      // current velocity; this function is not it.
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
  }, [previewScrollRef])



  // The windowed preview is created further down (it needs refs declared
  // between here and there), so callers up here reach it through a ref -- the
  // same reason readLineMetricsRef exists, and the same temporal dead zone
  // that forbids a direct reference. Null on a continuous document.
  const previewWindowApiRef = useRef<PreviewWindowApi | null>(null)

  const scrollPreviewToSourceLine = useCallback<PreviewScrollToSourceLineFn>((sourceLine, opts) => {
    const index = resolvePreviewBlockIndexForSourceLine(previewBlocksRef.current, sourceLine)
    if (index < 0) return false

    const scrollerForLanding = previewScrollRef.current
    if (!scrollerForLanding) return false

    /**
     * The one landing arithmetic, applied to whichever pane found the block --
     * see previewLanding.ts for the rule and what it replaced.
     *
     * `offsetPx` is the caller's, not this function's: putting a block at the
     * top of the pane and putting it one line below the top are two different
     * intents, and only the restore has the second one. Find navigation asks
     * for a plain top-aligned travel and then does its own centering.
     */
    const land = (blockTopPx: number, contentAbovePx: number) => {
      const landing = resolvePreviewLandingScrollTop({
        blockTopPx,
        contentAbovePx,
        offsetPx: opts?.offsetPx ?? 0,
        maxScrollTopPx: scrollerForLanding.scrollHeight - scrollerForLanding.clientHeight,
      })
      scrollPreviewTo(landing, opts?.behavior === 'smooth' ? 'smooth' : 'auto')
    }

    // Windowed: there is no document-wide pixel space to scroll into, so the
    // block is mounted and landed on directly. No estimates to populate, no
    // measurement cache to invalidate, and no retry -- the answer is exact on
    // the first attempt, which is what the whole rest of this function is
    // trying and failing to be.
    const windowApi = previewWindowApiRef.current
    if (windowApi) {
      const offsets = blockCharOffsetsRef.current
      if (!offsets || index + 1 >= offsets.length) return false
      // landOnChar, not scrollToChar, AND its answer is used rather than
      // discarded -- both halves are load-bearing.
      //
      // scrollToChar alone leaves the very next adjustment pass free to
      // re-anchor the window and compensate scrollTop. That compensation
      // keeps the READER still, which is right when they are reading and
      // wrong here, because the reader is not where they are supposed to end
      // up yet -- so the target slid out from under the landing.
      //
      // landOnChar runs those passes to a standstill first and then REPORTS
      // the pixel the target ended up at; it does not go there. Ignoring that
      // report left the pane wherever the compensation had put it, which is
      // the note walking eight paragraphs on every switch. One write, to the
      // settled answer, is the landing.
      const landedPx = windowApi.landOnChar(offsets[index])
      if (landedPx === null) return false
      // How much document sits above the block: the run's own top pixel is the
      // page margin only while the run starts at block 0. Anywhere else there
      // is at least a window of document above it, which no one-line offset can
      // exhaust -- so say so rather than measuring a number that would be a
      // statement about the window instead of about the document.
      const contentAbovePx = windowApi.isRunAtDocumentStart()
        ? landedPx - readPreviewEdgePaddingPx(scrollerForLanding)
        : Number.POSITIVE_INFINITY
      land(landedPx, contentAbovePx)
      return true
    }

    // Continuous: every block is mounted, so the block IS in the DOM and its
    // offset is a fact rather than a projection. One read, one write, no
    // retry -- the same shape the windowed branch above has always had.
    const measurement = continuousMeasurementsRef.current.find((entry) => entry.index === index)
    if (!measurement) return false
    // The whole document is in this scroller, so the content above the block is
    // simply everything between the page margin and it.
    land(measurement.start, measurement.start - readPreviewEdgePaddingPx(scrollerForLanding))
    return true
  // blockCharOffsetsRef is deliberately absent from the deps: it is declared
  // further down the file, so naming it here would be a temporal dead zone
  // error, even though it is a stable ref the body may freely read at call
  // time. exhaustive-deps exempts refs, so this needs no suppression -- an
  // eslint-disable that sat here was reported as unused by the project's own
  // --report-unused-disable-directives lint run.
  }, [scrollPreviewTo, previewScrollRef])

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
          const measurement = continuousMeasurementsRef.current.find((entry) => entry.index === index)
          if (measurement) scrollPreviewTo(measurement.start, instant ? 'auto' : 'smooth')
        }
      }

      const target = findTargetElement()

      // The correction below is a plain scroll write, and the travel above
      // is a curve animation that recomputes scrollTop from its own captured
      // start/target on every frame -- so correcting while it's still in
      // flight is erased on the animation's next frame, and it lands on the
      // block offset it planned for instead of on the element. Waiting for the
      // travel to settle is not a failed attempt, so it doesn't consume the
      // retry budget either; only a genuinely missing element does.
      const scroller = previewScrollRef.current
      const isTravelling = scroller !== null && isNonQuantizedSmoothScrollActive(scroller)

      if (target && !isTravelling) {
        // Instant, not smooth -- the travel above already did
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
  }, [scrollPreviewTo, previewScrollRef])

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

  // An empty needle is the plugin's own "highlight nothing" -- see
  // isSearchHighlightActive for why a hidden find panel highlights nothing.
  const highlightFindText = isSearchHighlightActive ? documentFindDirective.findText : ''
  const previewSearchHighlightPlugin = useMemo(
    () => createPreviewSearchHighlightRehypePlugin(highlightFindText, isDocumentFindCaseSensitive),
    [highlightFindText, isDocumentFindCaseSensitive],
  )

  // ---------------------------------------------------------------------
  // Background measurement prewarm -- see previewMeasurementPrewarm.ts for
  // why this exists and what makes it fragile.
  //
  // CONTINUOUS DOCUMENTS ONLY. Under CONTINUOUS_DOCUMENT_MAX_CHARS every block
  // is measured outright, which is what turns `scrollHeight` into a true total
  // and lets the scrollbar use the plain pixel identity (editor/
  // documentPosition.ts). Over that threshold the document is windowed
  // (previewWindow.ts): its scroller holds only the mounted run, so there is no
  // whole-document height for a survey to be right about and none runs.
  // ---------------------------------------------------------------------
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const [spacerReady, setSpacerReady] = useState(false)
  const charRulerRef = useRef<HTMLDivElement | null>(null)

  // ---------------------------------------------------------------------
  // Position in character space -- see previewCharPosition.ts.
  // ---------------------------------------------------------------------
  const blockCharOffsetsRef = useRef<Float64Array | null>(null)
  useLayoutEffect(() => {
    blockCharOffsetsRef.current = buildBlockCharOffsets(previewBlocks)
  }, [previewBlocks])

  // Which of the two strategies this document gets, decided by its length and
  // nothing else -- the same boundary editor/documentPosition.ts draws, and the
  // same one the scrollbar's own two answers are chosen by. Under it the
  // document is measured outright and scrolled as one piece; over it the pane
  // holds a moving window and never has a whole-document height at all. No
  // switch, no flag: a chunked document is always windowed.
  const isWindowed = forceCharacterScrollbarThumb
    || !isContinuousDocument(previewBlocks.length, noteSizeThresholdBlocks)

  /**
   * The one place the answer lives once it has been decided for this commit.
   *
   * `isWindowed` above is resolved during render; the document-position API
   * below is called long afterwards, from scroll handlers and the scrollbar.
   * If that second reader recomputed the answer for itself, the two could
   * disagree -- the setting can move between them, and so can the document's
   * own length -- and a document rendered one way while being described the
   * other is exactly the scrollbar that lies which documentPosition.ts warns
   * about. So it is computed once and read from here.
   */
  const isWindowedRef = useRef(isWindowed)
  isWindowedRef.current = isWindowed

  const renderPreviewBlock = useCallback((block: { text: string; startLine: number }, index: number) => (
    <PreviewMarkdownBlock
      key={index}
      text={block.text}
      lineOffset={block.startLine}
      searchHighlightPlugin={previewSearchHighlightPlugin}
      components={previewMarkdownComponents}
    />
  ), [previewSearchHighlightPlugin, previewMarkdownComponents])

  // The typography host, for the windowed path.
  //
  // It carries two things, and only the second is still needed here. The PROBE
  // -- the wrapping sentence -- belongs to readLineMetrics, which a windowed
  // pane no longer calls at all; it is kept because the same element is what
  // the virtualized path measures, and one definition is better than two that
  // can drift. The RULER is the live one: `readViewportCharCapacity` divides
  // the pane's width by its measured character advance to size the thumb, and
  // usePreviewWindow watches its box as the signal that the geometry behind
  // `lastScreenChars` has moved.
  const typographyProbeElement = useMemo(() => (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}
    >
      {/* The character ruler.
          A fixed string that is not allowed to wrap, so its width divided by
          its length is the average advance of a character at this font, size
          and letter spacing -- MEASURED, in one read, with no inference.
          The probe above cannot answer this: it reports where a particular
          sentence happened to break, which gives an average of 102.5
          characters a line against a real capacity of at least 127, and always
          in the direction of over-counting lines. */}
      <div
        ref={charRulerRef}
        data-preview-char-ruler=""
        style={{ position: 'absolute', top: 0, left: 0, whiteSpace: 'pre', display: 'inline-block', width: 'max-content' }}
      >
        {PREVIEW_CHAR_RULER_TEXT}
      </div>
    </div>
  ), [])

  /**
   * The windowed preview -- see previewWindow.ts and usePreviewWindow.tsx.
   *
   * Called unconditionally and inert on a continuous document, so the two
   * strategies never become a conditional hook. When it is live, the four
   * primitives below (measurements, char viewport, and the two scroll-to-
   * character calls) are redirected to it and EVERYTHING ELSE -- every ratio,
   * the thumb, the source-line mapping -- runs unchanged, because all of that
   * was already expressed in character space.
   */
  const previewWindow = usePreviewWindow({
    enabled: isWindowed,
    isPaneVisible: isPreviewMode,
    previewScrollRef,
    previewBlocks,
    blockCharOffsetsRef,
    renderBlock: renderPreviewBlock,
    overlay: isWindowed ? typographyProbeElement : null,
    geometryProbeRef: charRulerRef,
    renderedDisplayText,
    activeNoteId,
  })
  previewWindowApiRef.current = isWindowed ? previewWindow.api : null

  /**
   * The virtualizer's current block geometry.
   *
   * `getMeasurements()` is private; `measurementsCache` is the public array it
   * writes its result into, and it is current as of the last time the memo
   * chain ran. `getVirtualItems()` is what runs that chain (it is memoized, so
   * calling it here is a cache read on all but the first call after an
   * invalidation), which is why it is called first and its result discarded.
   */
  /**
   * The continuous pane's block geometry, read from the DOM.
   *
   * A continuous document mounts every block, so its geometry is not modelled
   * anywhere -- it is simply what the browser laid out, and this reads it.
   * That is the whole reason the estimate/survey apparatus is gone: there is
   * no block whose height has to be guessed, because there is no block that
   * is not there.
   *
   * Literally the same read the windowed pane does, now that it IS the same
   * read: measurePreviewBlockGeometry, which carries the offsetParent/padding
   * correction both panes need -- see its own doc comment for what that
   * correction is and what it cost to have written twice.
   *
   * Cached rather than read per call: `readCharViewport` runs on scroll, and
   * a forced layout per scroll event is exactly the cost this pane cannot
   * afford. Rebuilt when the blocks change or the container resizes, which is
   * when it can actually be wrong.
   */
  const continuousMeasurementsRef = useRef<readonly PreviewBlockMeasurement[]>([])
  const rebuildContinuousMeasurements = useCallback(() => {
    const container = spacerRef.current
    if (!container) {
      continuousMeasurementsRef.current = []
      return
    }
    continuousMeasurementsRef.current = measurePreviewBlockGeometry(container).measurements
  }, [])

  const readBlockMeasurements = useCallback(() => {
    if (isWindowed) return previewWindow.api.readMeasurements()
    return continuousMeasurementsRef.current
  }, [isWindowed, previewWindow.api])

  /**
   * Rebuilt when the layout can actually have changed: a different block
   * list, or the container's own box moving under a resize or a typography
   * change. In the layout phase, before paint, so nothing ever reads the
   * previous document's geometry against this document's DOM.
   */
  useLayoutEffect(() => {
    if (isWindowed) return undefined
    rebuildContinuousMeasurements()

    const container = spacerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return undefined
    // On the container rather than the scroller: a font or spacing change
    // re-wraps the text and moves every block without the scroller's own box
    // changing at all, and that is the case a scroller-width observer misses.
    const observer = new ResizeObserver(() => rebuildContinuousMeasurements())
    observer.observe(container)
    return () => observer.disconnect()
  }, [isWindowed, previewBlocks, rebuildContinuousMeasurements, spacerReady])

  const readCharViewport = useCallback((): PreviewCharViewport | null => {
    if (isWindowed) return previewWindow.api.readCharViewport()
    const scroller = previewScrollRef.current
    if (!scroller) return null
    return resolvePreviewCharViewport({
      offsets: blockCharOffsetsRef.current,
      measurements: readBlockMeasurements(),
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
    })
  }, [readBlockMeasurements, previewScrollRef, isWindowed, previewWindow.api])

  const scrollToChar = useCallback((charOffset: number) => {
    if (isWindowed) { previewWindow.api.scrollToChar(charOffset); return }
    const offset = resolvePreviewCharScrollOffset({
      offsets: blockCharOffsetsRef.current,
      measurements: readBlockMeasurements(),
      charOffset,
    })
    if (offset === null) return
    // Through scrollPreviewTo rather than straight onto scrollTop, so this
    // gets the same instant snap with native smooth-scroll suppressed that
    // every other programmatic scroll in this hook does.
    scrollPreviewTo(offset)
  }, [scrollPreviewTo, readBlockMeasurements, isWindowed, previewWindow.api])

  /**
   * Travels to a character position, re-aiming as the document's geometry
   * changes underneath the animation.
   *
   * A pixel target fixed at click time is a promise the app cannot keep. Click
   * the track at 30% the moment a large note opens and that target is 30% of
   * whatever the heights are currently believed to be -- before the model
   * lands, a flat 56px a block, which on a real document is ~70% short.
   * Measured: the same click landed 13% into the document instead of 30%, and
   * the travel animation is long enough (18s for 100,000px on this hardware)
   * that the model lands, blocks are measured, and the total size moves
   * repeatedly WHILE it is in flight -- each change quietly redefining what
   * the fixed pixel target meant.
   *
   * So the target is held in character space, which does not move, and
   * re-projected into pixels every frame. `scrollToNonQuantizedSmooth`
   * re-plans smoothly from wherever the animation currently is, and no-ops on
   * an unchanged target, so this costs nothing until the geometry actually
   * moves. The threshold keeps a few pixels of measurement noise from
   * re-planning (and so restarting the easing) on every frame.
   */
  /**
   * How long this document is, in lines, and how tall a line is.
   *
   * Both come off the typography probe that already lives in the measurement
   * host: its text is fixed and known, so the number of lines it wraps onto
   * gives characters-per-line directly, and its computed style gives the line
   * height. No layout of the document itself is consulted, which is the whole
   * point -- the thumb must not resize because the app finished measuring
   * something.
   *
   * Counted over the BLOCKS rather than the raw source, so the blank lines
   * that separate blocks (and render as nothing) are not counted as lines.
   * Cached against the block list's own identity, which changes only when the
   * text does.
   */

  /**
   * Travels to a character position. Plans once; never re-aims.
   *
   * The curve this rides on is a physics model whose whole value is continuous
   * derivatives -- no jump in position, velocity or acceleration. Re-targeting
   * it mid-flight does NOT preserve that: `scrollToNonQuantizedSmooth` cancels
   * the running animation and builds a fresh bell curve from the current
   * position, and a bell starts at zero velocity. So every re-aim drops the
   * scroll to a standstill and re-accelerates.
   *
   * An earlier version of this function re-aimed every frame the target moved
   * more than 24px, to chase a destination whose pixel address kept changing
   * while the height model settled. It was defending against a real error --
   * the flat 56px estimate put a click at 30% nearer 13% -- but it paid for it
   * with the one property the animation exists to have, and it fired
   * repeatedly per travel. The estimate is now within a fraction of a percent
   * within a third of a second, so the error it defended against is gone and
   * the cure is worse than the disease.
   *
   * The rule this leaves: a travel is planned once, against the geometry as it
   * stands, and plays to completion untouched. If the document's pixel
   * geometry shifts underneath it, we land slightly off -- nobody knows where
   * 60% of a document "should" have been, and everybody feels a velocity jump.
   * The only thing allowed to interrupt a travel is the reader.
   */
  const smoothScrollToChar = useCallback((charOffset: number) => {
    const scroller = previewScrollRef.current
    if (!scroller) return null
    if (isWindowed) {
      // A destination the scroller can actually reach is an ordinary curve
      // over measured pixels. Anything else is planned from the CHARACTER
      // distance and the window is re-anchored at the cut, under the curtain
      // -- see the onBridgeCut option in NonQuantizedSmoothScroll.ts.
      //
      // MOUNTED IS NOT REACHABLE, and conflating the two is what sent most
      // scrollbar clicks in a large note nowhere. A block can be inside the
      // window and still sit past `maxScrollTop`: the window's last screenful
      // cannot be brought to the top of the pane, because nothing is mounted
      // below it to scroll into. Asking for that pixel clamps, so the travel
      // lands short of where the reader clicked -- and no curtain is raised,
      // because this branch has already decided none is needed. The question
      // is not "is it mounted" but "can a plain scroll get there", and only
      // the second one is a question about `scrollTop`.
      const mounted = previewWindow.api.resolveCharOffsetPx(charOffset)
      const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const reachable = mounted !== null && mounted >= 0 && mounted <= maxScrollTopPx
      traceScroll(() => `route   char=${charOffset}`
        + ` mounted=${mounted === null ? 'not in window' : Math.round(mounted)}`
        + ` max=${Math.round(maxScrollTopPx)}`
        + ` -> ${reachable ? 'plain scroll' : 'BRIDGE'}`)
      if (reachable) return scrollToNonQuantizedSmooth(scroller, mounted)

      const viewport = previewWindow.api.readCharViewport()
      const startChar = viewport?.startChar ?? 0
      const visibleChars = Math.max(1, viewport?.visibleChars ?? 1)
      // Characters converted to pixels ONLY to choose the journey's shape and
      // its duration -- never to place anything. The exchange rate is the
      // reader's own screenful, which is the one it is safe to be wrong about:
      // the ramps are relative distances and the landing comes from the cut.
      const plannedDistancePx = ((charOffset - startChar) / visibleChars) * scroller.clientHeight
      return scrollToNonQuantizedSmooth(scroller, scroller.scrollTop + plannedDistancePx, {
        journeyDistancePx: plannedDistancePx,
        // Land AND settle the window before reporting a pixel back. The
        // ramp-down aims at whatever this returns and then plays for a couple
        // of hundred milliseconds, so it has to be a number that will still
        // mean the same thing when the animation arrives -- see landOnChar.
        onBridgeCut: () => previewWindow.api.landOnChar(charOffset),
      })
    }
    const offset = resolvePreviewCharScrollOffset({
      offsets: blockCharOffsetsRef.current,
      measurements: readBlockMeasurements(),
      charOffset,
    })
    if (offset === null) return null
    return scrollToNonQuantizedSmooth(scroller, offset)
  }, [previewScrollRef, readBlockMeasurements, isWindowed, previewWindow.api])

  /**
   * The two answers to "where are we", behind one interface.
   *
   * Which one this document gets is decided by its length alone, and the
   * scrollbar never learns which it got -- see editor/documentPosition.ts for
   * why the boundary is drawn there and why everything crossing it is a ratio.
   *
   * The decision is re-read on every call rather than latched, so a document
   * that grows past the threshold is described the new way from then on. That
   * can only happen at a note switch or on the way back from edit mode --
   * nobody types into the render view -- so there is no risk of the semantics
   * flickering under a reader's hand.
   */
  const documentPosition = useMemo<DocumentPosition>(() => {
    // Reads the answer the renderer already committed to, rather than asking
    // the question again -- see isWindowedRef.
    const isContinuous = () => !isWindowedRef.current

    const readContinuousRatios = () => {
      const scroller = previewScrollRef.current
      if (!scroller) return null
      return resolveContinuousRatios({
        scrollTopPx: scroller.scrollTop,
        clientHeightPx: scroller.clientHeight,
        scrollHeightPx: scroller.scrollHeight,
      })
    }

    /**
     * How many characters this pane's viewport holds, from its character grid.
     *
     * Columns x rows / 2 -- see resolveViewportCharCapacity. Every term is
     * geometry: the column width from the ruler's measured character advance,
     * the row height from the line height, the content width from the pane.
     * None of it depends on the text currently on screen, so the same document
     * at the same settings gets the same thumb every time it is opened.
     */
    const readViewportCharCapacity = () => {
      const scroller = previewScrollRef.current
      const ruler = charRulerRef.current
      if (!scroller || !ruler) return null
      const rulerWidthPx = ruler.getBoundingClientRect().width
      if (!(rulerWidthPx > 0)) return null
      const style = window.getComputedStyle(ruler)
      const lineHeightPx = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.5)
      return resolveViewportCharCapacity({
        // clientWidth excludes the scrollbar but INCLUDES the pane's padding,
        // which no text is set in -- the ruler sits inside the same content
        // box the blocks do, so its own width is the column width.
        contentWidthPx: ruler.parentElement?.getBoundingClientRect().width ?? scroller.clientWidth,
        viewportHeightPx: scroller.clientHeight,
        charWidthPx: rulerWidthPx / PREVIEW_CHAR_RULER_TEXT.length,
        lineHeightPx,
      })
    }

    /**
     * How many characters the document's last screenful holds.
     *
     * The single number the scrollbar's span is built from, and the same
     * quantity however the pane is rendering:
     *
     *  - WINDOWED, from the tail probe (usePreviewWindow.tsx) -- a hidden,
     *    bounded render of the document's final blocks, measured once per
     *    document and geometry.
     *  - CONTINUOUS, straight from the virtualizer's measurements, which
     *    already cover every block including the last ones.
     *
     * Null until whichever of those can answer does. The caller stands in the
     * grid capacity for the frame or two that takes, which is close enough that
     * the correction is invisible and honest enough that it is never mistaken
     * for the measurement.
     */
    const readLastScreenChars = () => {
      const scroller = previewScrollRef.current
      if (!scroller) return null
      const measured = isWindowed
        ? previewWindowApiRef.current?.readLastScreenChars() ?? null
        : resolveLastScreenChars({
          offsets: blockCharOffsetsRef.current,
          measurements: readBlockMeasurements(),
          blockCount: previewBlocksRef.current.length,
          clientHeightPx: scroller.clientHeight,
        })
      return measured ?? readViewportCharCapacity()
    }

    // The chunked thumb's size is a question about the TEXT -- how much of the
    // document one screen holds -- answered in CHARACTERS.
    //
    // Information is characters, not lines: two screenfuls with the same line
    // count can hold very different amounts of document, and the thumb's whole
    // job is to say how much is left to read. Characters are also what the
    // thumb's POSITION is measured in, so size and position speak one unit.
    const readChunkedThumbRatio = () => {
      const charsPerScreen = readViewportCharCapacity()
      const offsets = blockCharOffsetsRef.current
      const totalChars = offsets && offsets.length > 1 ? offsets[offsets.length - 1] : 0
      if (charsPerScreen === null) return null
      return resolveChunkedThumbRatio({ charsPerScreen, totalChars })
    }

    const readThumbRatio = () => (
      isContinuous() ? readContinuousRatios()?.thumbRatio ?? null : readChunkedThumbRatio()
    )

    /**
     * A source line's position in the block/character space everything else
     * here speaks, interpolated through the block that owns it.
     *
     * Block granularity alone is not enough: a hit two thirds of the way down
     * a long paragraph would be aimed at that paragraph's first line, and on
     * a tall block that is most of a screen out. The fraction is taken in
     * lines rather than characters because a source line is what the caller
     * has and what the block records.
     */
    const charForSourceLine = (sourceLine: number): number | null => {
      const blocks = previewBlocksRef.current
      const offsets = blockCharOffsetsRef.current
      if (!offsets || offsets.length < 2 || blocks.length === 0) return null

      const index = resolvePreviewBlockIndexForSourceLine(blocks, sourceLine)
      if (index < 0 || index + 1 >= offsets.length) return null

      const block = blocks[index]
      const blockChars = offsets[index + 1] - offsets[index]
      const blockLines = block.text.split('\n').length
      const linesIn = Math.max(0, sourceLine - block.startLine)
      const fraction = blockLines > 0 ? Math.min(1, linesIn / blockLines) : 0
      return offsets[index] + (blockChars * fraction)
    }

    const ratioForSourceLine = (sourceLine: number, leadViewportFraction = 0): number | null => {
      const scroller = previewScrollRef.current
      const charOffset = charForSourceLine(sourceLine)
      if (!scroller || charOffset === null) return null

      // Nothing to prepare any more. This used to populate estimates and make
      // the virtualizer re-ask for them, because the offsets read below were
      // only as good as whichever estimate tier happened to be in force --
      // and entering render view was precisely the moment the good tiers were
      // empty. A continuous pane now mounts every block, so the offsets are
      // read from the DOM and are simply true on the first attempt.

      // Both strategies back the target off by the same fraction of a screen,
      // each in its own units -- the whole point of doing it here rather than
      // correcting the pixels afterwards is that the arrival is already right
      // and there is nothing left to nudge.
      if (isContinuous()) {
        const offset = resolvePreviewCharScrollOffset({
          offsets: blockCharOffsetsRef.current,
          measurements: readBlockMeasurements(),
          charOffset,
        })
        if (offset === null) return null
        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        if (!(maxScrollTopPx > 0)) return 0
        const lead = scroller.clientHeight * leadViewportFraction
        return Math.min(1, Math.max(0, (offset - lead) / maxScrollTopPx))
      }

      const viewport = readCharViewport()
      if (!viewport) return null
      const lastScreenChars = readLastScreenChars()
      if (lastScreenChars === null) return null
      return resolveChunkedScrollRatio({
        startChar: Math.max(0, charOffset - (viewport.visibleChars * leadViewportFraction)),
        totalChars: viewport.totalChars,
        lastScreenChars,
      })
    }

    const readVisibleSourceLineRange = (): { fromLine: number; toLine: number } | null => {
      const scroller = previewScrollRef.current
      const blocks = previewBlocksRef.current
      if (!scroller || blocks.length === 0) return null

      // Through resolveVisibleBlockIndexRange, which translates a measurement
      // POSITION into a document block INDEX. This used to call
      // findBlockAtPixel and use its answer directly, which is the same
      // number only while the pane mounts every block -- see that function's
      // own note on what the windowed pane made of it.
      const visible = resolveVisibleBlockIndexRange(readBlockMeasurements(), scroller.scrollTop, scroller.clientHeight)
      if (!visible) return null

      const clampIndex = (index: number) => Math.min(blocks.length - 1, Math.max(0, index))
      const firstIndex = clampIndex(visible.firstIndex)
      const lastIndex = clampIndex(visible.lastIndex)

      const lastBlock = blocks[lastIndex]
      const lastBlockLines = lastBlock.text.split('\n').length
      return {
        fromLine: blocks[firstIndex].startLine,
        toLine: lastBlock.startLine + Math.max(0, lastBlockLines - 1),
      }
    }

    const ratioForScrollOffsetPx = (offsetPx: number): number | null => {
      const scroller = previewScrollRef.current
      if (!scroller) return null

      if (isContinuous()) {
        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        if (!(maxScrollTopPx > 0)) return 0
        return Math.min(1, Math.max(0, offsetPx / maxScrollTopPx))
      }

      // Through resolvePreviewCharViewport rather than a conversion of its
      // own: it is the same pixel-to-character mapping the live reading uses,
      // so this stays the inverse of resolveChunkedTarget by construction
      // instead of by two functions agreeing to stay in step.
      const at = resolvePreviewCharViewport({
        offsets: blockCharOffsetsRef.current,
        measurements: readBlockMeasurements(),
        scrollTop: offsetPx,
        clientHeight: scroller.clientHeight,
      })
      const lastScreenChars = readLastScreenChars()
      if (!at || lastScreenChars === null) return null
      return resolveChunkedScrollRatio({
        startChar: at.startChar,
        totalChars: at.totalChars,
        lastScreenChars,
      })
    }

    const resolveChunkedTarget = (ratio: number) => {
      const viewport = readCharViewport()
      if (!viewport) return null
      // The tail probe measures how many characters the last screen holds, so
      // that the bottom of the track means the end of the document rather
      // than a screen short of it. It restarts on every change of document,
      // typography or pane width, and until it answers this used to return
      // null -- which made `travelToRatio` return null, which made the click
      // do NOTHING AT ALL. A click that is silently dropped is far worse than
      // one that lands slightly low at the very bottom of the track, and the
      // scroller clamps that overshoot itself, so zero is the honest stand-in
      // while the real answer is still being measured.
      const lastScreenChars = readLastScreenChars()
      if (lastScreenChars === null) {
        traceScroll(() => `route   ratio=${ratio.toFixed(4)} tail probe not ready,`
          + ` mapping straight through the document`)
      }
      return resolveChunkedCharTarget({
        ratio,
        totalChars: viewport.totalChars,
        lastScreenChars: lastScreenChars ?? 0,
      })
    }

    return {
      readScrollRatio: () => {
        if (isContinuous()) return readContinuousRatios()?.scrollRatio ?? null
        const viewport = readCharViewport()
        const lastScreenChars = readLastScreenChars()
        if (!viewport || lastScreenChars === null) return null
        return resolveChunkedScrollRatio({
          startChar: viewport.startChar,
          totalChars: viewport.totalChars,
          lastScreenChars,
        })
      },

      readThumbRatio,

      ratioForSourceLine,

      readVisibleSourceLineRange,

      ratioForScrollOffsetPx,

      // Both strategies are final from their first answer now: a chunked
      // ratio is line-based, and a continuous one is read off a scrollHeight
      // that is true the moment the pane has laid out, because every block
      // that contributes to it is mounted. Kept on the interface because the
      // scrollbar still asks, and the honest answer is "yes, always".
      isThumbRatioSettled: () => true,

      // Only a windowed pane has an end that is not the document's, and only a
      // windowed pane's scrollTop stops counting at a window boundary.
      isAtDocumentEdge: isWindowed ? previewWindowApiRef.current?.isAtDocumentEdge : undefined,

      readContinuousScrollOffsetPx: isWindowed ? previewWindowApiRef.current?.readContinuousScrollOffsetPx : undefined,

      jumpToRatio: (ratio) => {
        const scroller = previewScrollRef.current
        if (!scroller) return
        if (isContinuous()) {
          const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          scrollPreviewTo(ratio * maxScrollTopPx)
          return
        }
        const charTarget = resolveChunkedTarget(ratio)
        if (charTarget !== null) scrollToChar(charTarget)
      },

      travelToRatio: (ratio) => {
        const scroller = previewScrollRef.current
        if (!scroller) return null
        if (isContinuous()) {
          const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          return scrollToNonQuantizedSmooth(scroller, ratio * maxScrollTopPx)
        }
        const charTarget = resolveChunkedTarget(ratio)
        return charTarget !== null ? smoothScrollToChar(charTarget) : null
      },
    }
  }, [
    previewScrollRef,
    readBlockMeasurements,
    readCharViewport,
    scrollToChar,
    smoothScrollToChar,
    scrollPreviewTo,
    previewBlocksRef,
    isWindowed,
  ])

  useLayoutEffect(() => {
    if (!previewDocumentPositionRef) return undefined
    previewDocumentPositionRef.current = documentPosition
    return () => { previewDocumentPositionRef.current = null }
  }, [previewDocumentPositionRef, documentPosition])

  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!scroller) return undefined
    // Frame timings are recorded only for scrolls the READER made: one fired
    // while the settle gate has the pane hidden is the restore's, and timing
    // frames nobody saw would describe a scroll nobody performed.
    const onScroll = () => {
      if (isPreviewSettleHolding?.()) return
      noteFrameCostScroll(() => ({
        blocks: previewBlocksRef.current.length,
        // The cumulative block offsets already end at the document's own
        // length, so this costs a read rather than a pass over the text.
        chars: blockCharOffsetsRef.current?.at(-1) ?? 0,
      }))
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [previewScrollRef, spacerReady, isPreviewSettleHolding, previewBlocksRef, blockCharOffsetsRef])




  /**
   * The continuous pane: every block, in normal flow.
   *
   * Nothing here is positioned, offset or sized by this code. The document is
   * small enough to mount outright -- that is what the reader's paragraph
   * threshold guarantees -- so the browser lays it out and the layout IS the
   * geometry. There is no total size to compute, no estimate to correct, and
   * no measurement to survey; `scrollHeight` is true from the first frame
   * because every block that contributes to it is present.
   *
   * `display: flow-root` on each wrapper, exactly as the windowed pane does
   * it, and it is load-bearing rather than cosmetic: in plain normal flow
   * adjacent block margins COLLAPSE into each other, which the previous
   * absolutely-positioned rendering never did. Without it the whole document
   * would re-space itself the moment this changed.
   *
   * Memoized so that per-frame App re-renders (scroll thumb state and the
   * like) don't walk the block list unless something that affects its output
   * actually changed.
   */
  const previewMarkdownElement = useMemo(() => (
    <div ref={(node) => { spacerRef.current = node; if (node) setSpacerReady(true) }}>
      {previewBlocks.map((block, index) => (
        <div
          key={index}
          data-index={index}
          // Marks the document's own edge blocks for the page-margin rule in
          // markdown.css -- by class rather than by DOM position, kept from
          // the virtualized rendering where the two could differ. They cannot
          // any more, but naming the thing you mean still beats relying on
          // where it happens to sit, and the windowed pane next door still
          // needs the class for real.
          className={resolvePreviewEdgeBlockClass(index, previewBlocks.length)}
          style={{ display: 'flow-root' }}
        >
          <PreviewMarkdownBlock
            text={block.text}
            lineOffset={block.startLine}
            searchHighlightPlugin={previewSearchHighlightPlugin}
            components={previewMarkdownComponents}
          />
        </div>
      ))}
    </div>
  ), [previewBlocks, previewSearchHighlightPlugin, previewMarkdownComponents])


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
    // Two renderings of the same document, chosen by size: the windowed pane
    // mounts a moving run of it, the continuous pane mounts all of it. Neither
    // estimates anything.
    previewMarkdownElement: isWindowed ? previewWindow.element : previewMarkdownElement,
    /**
     * How many blocks this pane currently has, which is the one fact that
     * decides whether it can answer a question about itself at all --
     * `readVisibleSourceLineRange` returns null at zero, and the split now
     * arrives progressively, so zero is an ordinary early state rather than
     * an error.
     *
     * Exposed as a VALUE, not a readiness boolean or a callback, so a
     * consumer can simply depend on it: an effect that needs the pane to be
     * able to answer re-runs when that changes, instead of asking early,
     * failing, and retrying on a timer until it gives up. One consumer did
     * exactly that and went silently blind on large notes once the split
     * stopped being synchronous.
     */
    previewBlockCount: previewBlocks.length,
  }
}

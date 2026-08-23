import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { EditorAdapter } from '../editor/EditorContract'
import { normalizeInternalText } from '../editor/TextPolicy'
import {
  resolveDocumentFindDirective,
  buildDocumentFindHits,
  applyPreserveCase,
  type DocumentFindDirective,
  type DocumentFindHit,
} from '../editor/FindReplaceEngine'
import { isNonQuantizedSmoothScrollActive, scrollToNonQuantizedSmooth } from '../editor/NonQuantizedSmoothScroll'
import { resolvePreviewHitRange, resolveSourceLineForOffset } from './PreviewFindHitLocator'
import type { PreviewScrollToSourceLineFn } from './usePreviewMarkdownRendering'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface UseDocumentFindNavigationOptions {
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  /**
   * Forces the preview pane's virtualizer to mount the block covering a
   * given source line. Needed for jumping, not just for anchors: the
   * rendered pane only keeps the visible window (plus a small overscan) in
   * the DOM, so a hit further down the document has no element to measure
   * until its own block is scrolled into range.
   */
  previewScrollToSourceLineRef: MutableRefObject<PreviewScrollToSourceLineFn | null>
  documentFindDirective: DocumentFindDirective
  documentFindHits: DocumentFindHit[]
  effectiveCaseSensitive: boolean
  preserveCase: boolean
  currentEditorText: string
  syncPreviewCustomScrollbar: () => void
  isPreviewMode: boolean
  adapterRef: MutableRefObject<EditorAdapter | null>
  latestEditorTextRef: MutableRefObject<string>
  activeNoteText: string
  documentFindQuery: string
  documentReplaceQuery: string
  isDocumentReplaceMode: boolean
  applyProgrammaticEditorText: (nextText: string, selectionStart: number, selectionEnd: number) => void
}

export interface UseDocumentFindNavigationResult {
  handleJumpToDocumentFindHit: (hit: DocumentFindHit) => void
  replaceDocumentFindHit: (hit: DocumentFindHit) => void
  replaceAllDocumentFindHits: () => void
}

/**
 * Jump-to-hit scrolling (preview pane vs. edit-mode selection) and single/
 * all replace actions for the document-find bar.
 */
export function useDocumentFindNavigation({
  previewScrollRef,
  previewScrollToSourceLineRef,
  documentFindDirective,
  documentFindHits,
  effectiveCaseSensitive,
  preserveCase,
  currentEditorText,
  syncPreviewCustomScrollbar,
  isPreviewMode,
  adapterRef,
  latestEditorTextRef,
  activeNoteText,
  documentFindQuery,
  documentReplaceQuery,
  isDocumentReplaceMode,
  applyProgrammaticEditorText,
}: UseDocumentFindNavigationOptions): UseDocumentFindNavigationResult {
  /**
   * Scrolls the rendered pane to a hit.
   *
   * Anchored on the hit's own *source line*, not on "the Nth occurrence of
   * the needle in the pane's text" -- which is what this used to do, and
   * why clicking a card could land on a different match. That ordinal was
   * wrong twice over: the hit list was built from the markdown source,
   * where invisible syntax (`[anchor](#anchor)`) contributes matches the
   * rendered text doesn't have, so every later hit's ordinal was shifted;
   * and the pane is virtualized, so a DOM walk only ever sees the mounted
   * window, making "the Nth match in the DOM" a different match from "the
   * Nth match in the document" for anything below the fold. Hits now come
   * from the visible-text projection (fixing the first half), and this
   * resolves position through the block owning the hit's source line
   * (fixing the second), using an occurrence ordinal that is local to that
   * one block.
   */
  /**
   * Scrolls the rendered pane to a hit: travel to the owning block through
   * the virtualizer, then correct onto the exact match inside it. See
   * PreviewFindHitLocator.resolvePreviewHitRange for why the match is
   * resolved through the hit's source line rather than through its ordinal
   * among the needle's occurrences in the pane.
   */
  const jumpToPreviewDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    const normalizedNeedle = normalizeInternalText(documentFindDirective.findText)
    if (!normalizedNeedle) return

    const sourceText = normalizeInternalText(currentEditorText)
    const sourceLine = resolveSourceLineForOffset(sourceText, hit.index)

    const scrollToFallback = () => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = maxScrollTop <= 0
        ? 0
        : clamp(hit.index / Math.max(1, sourceText.length), 0, 1) * maxScrollTop
      scrollToNonQuantizedSmooth(scroller, target, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
    }

    // Instant, not animated: the virtualizer-driven block scroll below has
    // already done the traveling, and this is only the small correction
    // that centers the match within its own block -- the same split
    // usePreviewMarkdownRendering's scrollToRenderedElement uses for anchor
    // navigation. Animating it would race the block scroll still in flight.
    const scrollToMatch = (): boolean => {
      const range = resolvePreviewHitRange({
        scroller,
        sourceText,
        hit,
        hits: documentFindHits,
        needle: normalizedNeedle,
        caseSensitive: effectiveCaseSensitive,
      })
      if (!range) return false

      const rect = range.getBoundingClientRect()
      if (rect.height <= 0 && rect.width <= 0) return false

      const scrollerRect = scroller.getBoundingClientRect()
      const absoluteTop = scroller.scrollTop + (rect.top - scrollerRect.top)
      const previousScrollBehavior = scroller.style.scrollBehavior
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = absoluteTop - (scroller.clientHeight * 0.35)
      scroller.style.scrollBehavior = previousScrollBehavior
      syncPreviewCustomScrollbar()
      return true
    }

    // Travel through the virtualizer first, always -- even when the hit's
    // block happens to be mounted already. Writing `scrollTop` directly
    // moves the pane without the virtualizer's own offset bookkeeping
    // following, so the mounted window stays where it was and the landing
    // spot is whatever blank space that stale window leaves behind; only
    // scrollToIndex both mounts the target block and keeps the two in step.
    // This mirrors what usePreviewMarkdownRendering's anchor navigation
    // (scrollToRenderedElement) already does, for the same reason.
    const didScroll = previewScrollToSourceLineRef.current?.(sourceLine, { align: 'center', behavior: 'smooth' }) ?? false
    if (!didScroll) {
      scrollToFallback()
      return
    }

    // The target block mounts (and measures) asynchronously, so the exact
    // in-block correction is retried across a few frames rather than given
    // up on after one -- same retry shape, and same attempt budget, as
    // scrollToRenderedElement's own. Landing on the block without the
    // correction is already a correct-enough result, which is what happens
    // when every attempt is used up.
    const refine = (attemptsLeft: number) => {
      // Never correct while the block-scroll animation is still travelling:
      // it recomputes scrollTop from its own captured start/target every
      // frame, so a correction landing mid-flight is erased on the next one
      // (see isNonQuantizedSmoothScrollActive). Waiting isn't a failed
      // attempt, so it doesn't consume the budget.
      if (isNonQuantizedSmoothScrollActive(scroller)) {
        requestAnimationFrame(() => refine(attemptsLeft))
        return
      }
      if (scrollToMatch()) return
      if (attemptsLeft <= 0) {
        syncPreviewCustomScrollbar()
        return
      }
      requestAnimationFrame(() => refine(attemptsLeft - 1))
    }
    requestAnimationFrame(() => refine(30))
  }, [
    currentEditorText,
    documentFindDirective.findText,
    documentFindHits,
    effectiveCaseSensitive,
    syncPreviewCustomScrollbar,
    previewScrollRef,
    previewScrollToSourceLineRef,
  ])

  const handleJumpToDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    if (isPreviewMode) {
      jumpToPreviewDocumentFindHit(hit)
      return
    }

    const adapter = adapterRef.current
    if (!adapter) return

    adapter.applySnapshot({
      selection: {
        anchor: hit.index,
        focus: hit.index + hit.matchLength,
        start: hit.index,
        end: hit.index + hit.matchLength,
        isCollapsed: false,
      },
      selectionScrollBehavior: 'center-caged',
    })
  }, [isPreviewMode, jumpToPreviewDocumentFindHit, adapterRef])

  const replaceDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, documentReplaceQuery, isDocumentReplaceMode)

    // Right-click should still behave like a normal jump when replace mode is not active.
    if (!directive.isReplaceMode || !directive.findText) {
      handleJumpToDocumentFindHit(hit)
      return
    }

    const selectedText = sourceText.slice(hit.index, hit.index + hit.matchLength)
    const selectedComparable = effectiveCaseSensitive ? selectedText : selectedText.toLowerCase()
    const findComparable = effectiveCaseSensitive ? directive.findText : directive.findText.toLowerCase()
    if (selectedComparable !== findComparable) {
      // If content shifted since hit computation, just jump to keep behavior predictable.
      handleJumpToDocumentFindHit(hit)
      return
    }

    const replacementText = preserveCase ? applyPreserveCase(selectedText, directive.replaceText) : directive.replaceText
    const nextText = `${sourceText.slice(0, hit.index)}${replacementText}${sourceText.slice(hit.index + hit.matchLength)}`
    const replacementEnd = hit.index + replacementText.length
    applyProgrammaticEditorText(nextText, hit.index, replacementEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, documentReplaceQuery, effectiveCaseSensitive, handleJumpToDocumentFindHit, isDocumentReplaceMode, preserveCase, latestEditorTextRef])

  const replaceAllDocumentFindHits = useCallback(() => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, documentReplaceQuery, isDocumentReplaceMode)
    if (!directive.isReplaceMode || !directive.findText) {
      return
    }

    const hits = buildDocumentFindHits(sourceText, directive.findText, effectiveCaseSensitive)
    if (hits.length === 0) {
      return
    }

    let cursor = 0
    let nextText = ''
    let firstReplacementLength = directive.replaceText.length
    hits.forEach((hit, hitIndex) => {
      nextText += sourceText.slice(cursor, hit.index)
      const matchedText = sourceText.slice(hit.index, hit.index + hit.matchLength)
      const replacementText = preserveCase ? applyPreserveCase(matchedText, directive.replaceText) : directive.replaceText
      if (hitIndex === 0) {
        firstReplacementLength = replacementText.length
      }
      nextText += replacementText
      cursor = hit.index + hit.matchLength
    })
    nextText += sourceText.slice(cursor)

    const firstHitStart = hits[0]?.index ?? 0
    const firstHitEnd = firstHitStart + firstReplacementLength
    applyProgrammaticEditorText(nextText, firstHitStart, firstHitEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, documentReplaceQuery, effectiveCaseSensitive, isDocumentReplaceMode, preserveCase, latestEditorTextRef])

  return { handleJumpToDocumentFindHit, replaceDocumentFindHit, replaceAllDocumentFindHits }
}

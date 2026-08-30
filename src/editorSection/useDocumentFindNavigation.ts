import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { PreviewDocumentPositionApi, PreviewScrollToSourceLineFn } from './usePreviewMarkdownRendering'

/**
 * How much of a screen is left above a hit on arrival.
 *
 * A hit landed flush against the top edge is correct and unreadable -- the
 * sentence it belongs to starts off-screen. This is the same third-of-a-screen
 * the old post-arrival correction used, applied to the aim instead.
 */
const FIND_HIT_LEAD_VIEWPORT_FRACTION = 0.35

/** Marks the one match the reader picked from a card. See markPreviewHitInPlace. */
const PREVIEW_HIT_MARK_CLASS = 'search-hit-picked'

/**
 * How far off the ideal position a landing is allowed to be before the
 * correction bothers to move it. A couple of pixels is under one line's
 * leading -- invisible to read, and cheaper to leave than to snap.
 */
const FIND_HIT_CORRECTION_DEADBAND_PX = 2

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
  /** The pane's position in ratios -- see editor/documentPosition.ts. */
  previewDocumentPositionRef: MutableRefObject<PreviewDocumentPositionApi | null>
  /**
   * The scrollbar's own journey, published by usePreviewScrollbar. A hit
   * further down the document is a long jump like any other, and gets the
   * bridge and the stretched thumb every other long jump gets.
   */
  travelPreviewToRatio: (ratio: number) => boolean
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
  /**
   * The hits the reader can currently see in the rendered pane, as an index
   * range into `documentFindHits` (`to` exclusive), or null when none are.
   *
   * A range rather than a set of ids because hits are in document order and
   * the viewport is one contiguous stretch of the document, so the visible
   * ones are always contiguous too -- two numbers instead of a per-hit lookup
   * on a list that can run to thousands of cards.
   */
  visibleDocumentFindHitRange: { from: number; to: number } | null
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
  previewDocumentPositionRef,
  travelPreviewToRatio,
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
   * Every hit's source line, in one pass over the text.
   *
   * Resolved here rather than per hit at the moment it is needed: working out
   * a line by counting newlines is linear in the offset, so asking it of a
   * thousand cards on every scroll frame is quadratic in the document. The
   * hits arrive in document order, so one walk of the text answers all of
   * them, and the result stays sorted -- which is what lets the visible span
   * below be found with two binary searches instead of a scan.
   */
  const hitSourceLines = useMemo(() => {
    const sourceText = normalizeInternalText(currentEditorText)
    const lines = new Int32Array(documentFindHits.length)
    let line = 0
    let cursor = 0
    for (let hitIndex = 0; hitIndex < documentFindHits.length; hitIndex += 1) {
      const target = Math.min(Math.max(0, documentFindHits[hitIndex].index), sourceText.length)
      while (cursor < target) {
        if (sourceText.charCodeAt(cursor) === 10) line += 1
        cursor += 1
      }
      lines[hitIndex] = line
    }
    return lines
  }, [currentEditorText, documentFindHits])

  const [visibleDocumentFindHitRange, setVisibleDocumentFindHitRange] = useState<{ from: number; to: number } | null>(null)

  /** First index whose line is >= `line`, over the sorted line array. */
  const lowerBound = useCallback((line: number) => {
    let low = 0
    let high = hitSourceLines.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (hitSourceLines[mid] < line) low = mid + 1
      else high = mid
    }
    return low
  }, [hitSourceLines])

  /**
   * Which cards to light up: the hits whose source line falls inside the
   * lines the pane is currently showing.
   *
   * Recomputed on the pane's own scroll events, coalesced to one animation
   * frame -- a scroll fires far more often than the answer changes. The state
   * is only written when the range actually moves, so an ordinary scroll
   * through a stretch with no hits in it re-renders nothing at all.
   */
  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!isPreviewMode || !scroller || documentFindHits.length === 0) {
      setVisibleDocumentFindHitRange(null)
      return undefined
    }

    let frameId: number | null = null
    // Opening find can beat the pane's own first measurement, and nothing
    // would mark until the reader happened to scroll. A short retry covers
    // that one frame or two without polling for the rest of the session.
    let attemptsLeft = 30

    const recompute = () => {
      frameId = null
      const lines = previewDocumentPositionRef.current?.readVisibleSourceLineRange() ?? null
      if (lines === null && attemptsLeft > 0) {
        attemptsLeft -= 1
        frameId = requestAnimationFrame(recompute)
        return
      }
      const next = lines === null
        ? null
        : (() => {
          const from = lowerBound(lines.fromLine)
          const to = lowerBound(lines.toLine + 1)
          return to > from ? { from, to } : null
        })()

      setVisibleDocumentFindHitRange((current) => {
        if (current === null && next === null) return current
        if (current !== null && next !== null && current.from === next.from && current.to === next.to) return current
        return next
      })
    }

    const schedule = () => {
      if (frameId !== null) return
      attemptsLeft = 30
      frameId = requestAnimationFrame(recompute)
    }

    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', schedule)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
    // documentFindHits is a dependency because a new hit list re-indexes
    // everything; currentEditorText reaches this through hitSourceLines.
  }, [isPreviewMode, documentFindHits, lowerBound, previewScrollRef, previewDocumentPositionRef])

  /**
   * The match this card refers to, set in small caps where it stands.
   *
   * For a hit already on screen there is nowhere to travel, and scrolling the
   * pane anyway to say "this one" would move the very text the reader is
   * looking at. Marking it in place answers the question without taking the
   * page away from them.
   *
   * Written straight onto the DOM rather than through the markdown render:
   * the mark belongs to one span for as long as that span is on screen, and
   * routing it through React would re-render the block -- and every block --
   * on a click whose whole point is that nothing moves. The two ways it can
   * lapse both come for free: a changed query re-renders the highlights, and
   * a block scrolled out of the virtualized window is unmounted. Only a
   * second pick has to be cleared by hand.
   */
  /**
   * The hit's own range in the mounted DOM, or null when its block is not
   * currently rendered. One resolution shared by everything below, so the
   * decision to mark, the aim of a jump and the correction after it can never
   * be talking about different matches.
   */
  const resolveHitRange = useCallback((hit: DocumentFindHit): Range | null => {
    const scroller = previewScrollRef.current
    const normalizedNeedle = normalizeInternalText(documentFindDirective.findText)
    if (!scroller || !normalizedNeedle) return null
    return resolvePreviewHitRange({
      scroller,
      sourceText: normalizeInternalText(currentEditorText),
      hit,
      hits: documentFindHits,
      needle: normalizedNeedle,
      caseSensitive: effectiveCaseSensitive,
    })
  }, [currentEditorText, documentFindDirective.findText, documentFindHits, effectiveCaseSensitive, previewScrollRef])

  /**
   * The `.search-hit` span a hit is rendered as.
   *
   * The highlight plugin wraps every match in one, so the range the locator
   * returns always sits inside one -- and it is the only element in the pane
   * safe to restyle: a match can be part of a word inside a link, a heading
   * or a table cell, and any of those would be the wrong thing to change.
   */
  const resolveMarkTarget = useCallback((hit: DocumentFindHit): HTMLElement | null => {
    const range = resolveHitRange(hit)
    if (!range) return null
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement
    return startElement?.closest<HTMLElement>('.search-hit') ?? null
  }, [resolveHitRange])

  const markedPreviewHitRef = useRef<HTMLElement | null>(null)
  const markPreviewHitInPlace = useCallback((hit: DocumentFindHit): boolean => {
    const scroller = previewScrollRef.current
    if (!scroller) return false

    const range = resolveHitRange(hit)
    if (!range) return false

    // Whether it is on screen is asked of the match itself, not of the card's
    // highlight state. The highlight is block-granular and refreshed a frame
    // behind the scroll; this is the actual rectangle, and it is the thing the
    // reader is looking at when they decide the match is one they can see.
    const rect = range.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) return false
    const scrollerRect = scroller.getBoundingClientRect()
    if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) return false

    const marked = resolveMarkTarget(hit)
    if (!marked) return false

    markedPreviewHitRef.current?.classList.remove(PREVIEW_HIT_MARK_CLASS)
    marked.classList.add(PREVIEW_HIT_MARK_CLASS)
    markedPreviewHitRef.current = marked

    // A class written onto the DOM does not survive that DOM being rebuilt,
    // and a click is exactly the kind of event that can commit a render
    // elsewhere in the app. So the mark is put back once, on the next frame,
    // if the element it was written to is no longer in the document -- enough
    // to outlive a synchronous re-render, and nothing at all when there isn't
    // one, which is the ordinary case.
    requestAnimationFrame(() => {
      const current = markedPreviewHitRef.current
      if (current !== marked || marked.isConnected) return
      const replacement = resolveMarkTarget(hit)
      if (!replacement) return
      replacement.classList.add(PREVIEW_HIT_MARK_CLASS)
      markedPreviewHitRef.current = replacement
    })
    return true
  }, [previewScrollRef, resolveHitRange, resolveMarkTarget])

  /**
   * Scrolls the rendered pane to a hit, on the scrollbar's own journey.
   *
   * A hit in another part of the document is a long jump, and this app already
   * has one: the bridged journey the scrollbar's track click runs, with the
   * curtain over the cut and the thumb stretched across it. This used to
   * reinvent it -- `virtualizer.scrollToIndex(..., 'smooth')` to the owning
   * block, then a correction onto the match, each with its own retry loop --
   * and the reader saw the two halves as the pane arriving twice.
   *
   * So the hit is turned into a ratio and handed to that journey. The aim
   * already includes the third of a screen the correction used to add
   * afterwards, which leaves the correction below with nothing to do but
   * absorb the difference between modelled and real block heights.
   */
  const jumpToPreviewDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    const normalizedNeedle = normalizeInternalText(documentFindDirective.findText)
    if (!normalizedNeedle) return

    const sourceText = normalizeInternalText(currentEditorText)
    const sourceLine = resolveSourceLineForOffset(sourceText, hit.index)

    /** Where the pane has to sit for this hit to read comfortably, in pixels. */
    const resolveTargetPxFromRange = (range: Range): number | null => {
      const rect = range.getBoundingClientRect()
      if (rect.height <= 0 && rect.width <= 0) return null
      const scrollerRect = scroller.getBoundingClientRect()
      const absoluteTop = scroller.scrollTop + (rect.top - scrollerRect.top)
      return absoluteTop - (scroller.clientHeight * FIND_HIT_LEAD_VIEWPORT_FRACTION)
    }

    const scrollToFallback = () => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = maxScrollTop <= 0
        ? 0
        : clamp(hit.index / Math.max(1, sourceText.length), 0, 1) * maxScrollTop
      scrollToNonQuantizedSmooth(scroller, target, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
    }

    // The correction that finishes the job when the aim could only be
    // modelled. Instant, because by then the reader has already arrived and an
    // animation would be a second journey.
    //
    // Held to a deadband, which is the whole difference between a correction
    // and a lurch: below a couple of pixels there is nothing to see and the
    // write is skipped entirely. Without it every jump ended with a hard snap
    // -- unnoticeable after a long journey, and on a short one the most
    // visible thing that happened.
    const scrollToMatch = (): boolean => {
      const range = resolveHitRange(hit)
      if (!range) return false
      const targetPx = resolveTargetPxFromRange(range)
      if (targetPx === null) return false

      if (Math.abs(targetPx - scroller.scrollTop) > FIND_HIT_CORRECTION_DEADBAND_PX) {
        const previousScrollBehavior = scroller.style.scrollBehavior
        scroller.style.scrollBehavior = 'auto'
        scroller.scrollTop = targetPx
        scroller.style.scrollBehavior = previousScrollBehavior
      }
      syncPreviewCustomScrollbar()
      return true
    }

    // Aim at the match itself whenever its block is already mounted -- which
    // is every short jump, and any long one into the overscan. A measured
    // rectangle is not an estimate, so converting it back into a ratio aims
    // the journey at the exact pixel it will land on and leaves the correction
    // above with nothing to do.
    //
    // The modelled aim below is for a hit whose block is not rendered yet: it
    // places the owning block by its character position, which is as good as
    // the height model, and the correction pays off the difference on arrival.
    const position = previewDocumentPositionRef.current ?? null
    const mountedRange = resolveHitRange(hit)
    const mountedTargetPx = mountedRange === null ? null : resolveTargetPxFromRange(mountedRange)
    const ratio = (mountedTargetPx !== null
      ? position?.ratioForScrollOffsetPx(mountedTargetPx)
      : position?.ratioForSourceLine(sourceLine, FIND_HIT_LEAD_VIEWPORT_FRACTION)) ?? null
    const didTravel = ratio !== null && travelPreviewToRatio(ratio)

    if (!didTravel) {
      // Through the virtualizer, not a raw scrollTop write: this path exists
      // for the frames before the document can answer in ratios, and
      // scrollToIndex is what both mounts the target block and keeps the
      // virtualizer's own offset bookkeeping in step.
      const didScroll = previewScrollToSourceLineRef.current?.(sourceLine, { align: 'center', behavior: 'smooth' }) ?? false
      if (!didScroll) {
        scrollToFallback()
        return
      }
    }

    // The target block mounts (and measures) asynchronously, so the exact
    // in-block correction is retried across a few frames rather than given
    // up on after one -- same retry shape, and same attempt budget, as
    // scrollToRenderedElement's own. Landing on the block without the
    // correction is already a correct-enough result, which is what happens
    // when every attempt is used up.
    //
    // With the journey aiming at the hit itself this is no longer how the
    // reader gets there, only how the last few pixels of modelling error are
    // paid off -- and when the aim was measured rather than modelled, the
    // deadband means it does nothing at all.
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
    syncPreviewCustomScrollbar,
    previewScrollRef,
    previewScrollToSourceLineRef,
    previewDocumentPositionRef,
    travelPreviewToRatio,
    resolveHitRange,
  ])

  const handleJumpToDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    if (isPreviewMode) {
      // A hit the reader can already see is not a journey. Travelling to it
      // would move the page under the very words they are reading to put them
      // somewhere marginally different; marking it says which match the card
      // meant and leaves everything where it is.
      //
      // The question is put to the match's own rectangle rather than to the
      // card's highlight: the highlight is block-granular and a frame behind
      // the scroll, so gating the behaviour on it would have made a click do
      // one thing while the card said the other.
      if (markPreviewHitInPlace(hit)) return

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
  }, [isPreviewMode, jumpToPreviewDocumentFindHit, adapterRef, markPreviewHitInPlace])

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

  return {
    visibleDocumentFindHitRange,
    handleJumpToDocumentFindHit,
    replaceDocumentFindHit,
    replaceAllDocumentFindHits,
  }
}

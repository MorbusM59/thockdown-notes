import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { EditorAdapter } from '../editor/EditorContract'
import { normalizeInternalText } from '../editor/TextPolicy'
import {
  resolveDocumentFindDirective,
  buildDocumentFindHits,
  type DocumentFindDirective,
  type DocumentFindHit,
} from '../editor/FindReplaceEngine'
import { scrollToNonQuantizedSmooth } from '../editor/NonQuantizedSmoothScroll'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface UseDocumentFindNavigationOptions {
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  documentFindDirective: DocumentFindDirective
  documentFindHits: DocumentFindHit[]
  isDocumentFindCaseSensitive: boolean
  currentEditorText: string
  syncPreviewCustomScrollbar: () => void
  isPreviewMode: boolean
  adapterRef: MutableRefObject<EditorAdapter | null>
  latestEditorTextRef: MutableRefObject<string>
  activeNoteText: string
  documentFindQuery: string
  applyProgrammaticEditorText: (nextText: string, selectionStart: number, selectionEnd: number) => void
}

export interface UseDocumentFindNavigationResult {
  handleJumpToDocumentFindHit: (hit: DocumentFindHit) => void
  replaceDocumentFindHit: (hit: DocumentFindHit) => void
  replaceAllDocumentFindHits: () => void
}

/**
 * Jump-to-hit scrolling (preview pane vs. edit-mode selection) and single/
 * all replace actions for the document-find bar -- extracted verbatim from
 * App.tsx with zero behavior change.
 */
export function useDocumentFindNavigation({
  previewScrollRef,
  documentFindDirective,
  documentFindHits,
  isDocumentFindCaseSensitive,
  currentEditorText,
  syncPreviewCustomScrollbar,
  isPreviewMode,
  adapterRef,
  latestEditorTextRef,
  activeNoteText,
  documentFindQuery,
  applyProgrammaticEditorText,
}: UseDocumentFindNavigationOptions): UseDocumentFindNavigationResult {
  const jumpToPreviewDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    const normalizedNeedle = normalizeInternalText(documentFindDirective.findText)
    if (!normalizedNeedle) return

    const hitOrdinal = documentFindHits.findIndex((candidate) => candidate.id === hit.id)
    const compareNeedle = isDocumentFindCaseSensitive ? normalizedNeedle : normalizedNeedle.toLocaleLowerCase()

    type TextSegment = {
      node: Text
      start: number
      end: number
    }

    const segments: TextSegment[] = []
    let aggregateText = ''
    const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node instanceof Text && node.nodeValue && node.nodeValue.length > 0) {
        const value = node.nodeValue
        const start = aggregateText.length
        aggregateText += value
        segments.push({
          node,
          start,
          end: aggregateText.length,
        })
      }
      node = walker.nextNode()
    }

    const haystack = isDocumentFindCaseSensitive ? aggregateText : aggregateText.toLocaleLowerCase()
    const resolvedOrdinal = hitOrdinal >= 0 ? hitOrdinal : 0

    let occurrence = -1
    let cursor = 0
    for (let index = 0; index <= resolvedOrdinal; index += 1) {
      const foundIndex = haystack.indexOf(compareNeedle, cursor)
      if (foundIndex < 0) {
        occurrence = -1
        break
      }
      occurrence = foundIndex
      cursor = foundIndex + Math.max(1, compareNeedle.length)
    }

    const fallbackTarget = (() => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      if (maxScrollTop <= 0) return 0
      const ratio = clamp(hit.index / Math.max(1, currentEditorText.length), 0, 1)
      return ratio * maxScrollTop
    })()

    if (occurrence < 0 || segments.length === 0) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const startSegment = segments.find((segment) => occurrence >= segment.start && occurrence < segment.end)
    if (!startSegment) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const endOffsetGlobal = occurrence + Math.max(1, hit.matchLength)
    const endSegment = segments.find((segment) => endOffsetGlobal > segment.start && endOffsetGlobal <= segment.end) ?? startSegment

    const startOffsetInNode = Math.max(0, Math.min(startSegment.node.nodeValue?.length ?? 0, occurrence - startSegment.start))
    const endOffsetInNode = Math.max(
      startOffsetInNode,
      Math.min(endSegment.node.nodeValue?.length ?? 0, endOffsetGlobal - endSegment.start),
    )

    const range = document.createRange()
    range.setStart(startSegment.node, startOffsetInNode)
    range.setEnd(endSegment.node, endOffsetInNode)

    const rect = range.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) {
      scrollToNonQuantizedSmooth(scroller, fallbackTarget, {
        onStep: () => syncPreviewCustomScrollbar(),
      })
      return
    }

    const scrollerRect = scroller.getBoundingClientRect()
    const absoluteTop = scroller.scrollTop + (rect.top - scrollerRect.top)
    const targetScrollTop = absoluteTop - (scroller.clientHeight * 0.35)
    scrollToNonQuantizedSmooth(scroller, targetScrollTop, {
      onStep: () => syncPreviewCustomScrollbar(),
    })
  }, [
    currentEditorText.length,
    documentFindDirective.findText,
    documentFindHits,
    isDocumentFindCaseSensitive,
    syncPreviewCustomScrollbar,
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
    })
  }, [isPreviewMode, jumpToPreviewDocumentFindHit])

  const replaceDocumentFindHit = useCallback((hit: DocumentFindHit) => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, sourceText, isDocumentFindCaseSensitive)

    // Right-click should still behave like a normal jump when replace mode is not active.
    if (!directive.isReplaceMode || !directive.findText) {
      handleJumpToDocumentFindHit(hit)
      return
    }

    const selectedText = sourceText.slice(hit.index, hit.index + hit.matchLength)
    const selectedComparable = isDocumentFindCaseSensitive ? selectedText : selectedText.toLowerCase()
    const findComparable = isDocumentFindCaseSensitive ? directive.findText : directive.findText.toLowerCase()
    if (selectedComparable !== findComparable) {
      // If content shifted since hit computation, just jump to keep behavior predictable.
      handleJumpToDocumentFindHit(hit)
      return
    }

    const nextText = `${sourceText.slice(0, hit.index)}${directive.replaceText}${sourceText.slice(hit.index + hit.matchLength)}`
    const replacementEnd = hit.index + directive.replaceText.length
    applyProgrammaticEditorText(nextText, hit.index, replacementEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, handleJumpToDocumentFindHit, isDocumentFindCaseSensitive])

  const replaceAllDocumentFindHits = useCallback(() => {
    const sourceText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const directive = resolveDocumentFindDirective(documentFindQuery, sourceText, isDocumentFindCaseSensitive)
    if (!directive.isReplaceMode || !directive.findText) {
      return
    }

    const hits = buildDocumentFindHits(sourceText, directive.findText, isDocumentFindCaseSensitive)
    if (hits.length === 0) {
      return
    }

    let cursor = 0
    let nextText = ''
    for (const hit of hits) {
      nextText += sourceText.slice(cursor, hit.index)
      nextText += directive.replaceText
      cursor = hit.index + hit.matchLength
    }
    nextText += sourceText.slice(cursor)

    const firstHitStart = hits[0]?.index ?? 0
    const firstHitEnd = firstHitStart + directive.replaceText.length
    applyProgrammaticEditorText(nextText, firstHitStart, firstHitEnd)
  }, [activeNoteText, applyProgrammaticEditorText, documentFindQuery, isDocumentFindCaseSensitive])

  return { handleJumpToDocumentFindHit, replaceDocumentFindHit, replaceAllDocumentFindHits }
}

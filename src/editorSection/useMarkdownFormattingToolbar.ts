import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { resolveMarkdownSelectionContext } from '../editor/MarkdownContext'
import { normalizeInternalText } from '../editor/TextPolicy'
import type { EditorSelectionState } from '../editor/EditorContract'

export type TextDecorationFormat = 'bold' | 'italic' | 'strikethrough'

const TEXT_DECORATION_MARKERS: Record<TextDecorationFormat, { open: string; close: string }> = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  strikethrough: { open: '~~', close: '~~' },
}

export interface UseMarkdownFormattingToolbarOptions {
  activeNoteId: string | null
  currentEditorText: string
  editorSelection: EditorSelectionState
  latestEditorTextRef: MutableRefObject<string>
  latestEditorSelectionRef: MutableRefObject<EditorSelectionState>
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
  /** Consumed by useEditorSectionMount, which is called earlier than these builders are defined -- see the handover doc's Gotcha #2. This hook keeps the refs current via a plain assignment, same as before the relocation. */
  buildTextDecorationTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState, format: TextDecorationFormat) => { text: string; selection: EditorSelectionState } | null>
  buildToggleCurrentLineHeadingTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
  buildToggleBulletedListTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
  buildToggleNumberedListTransformRef: MutableRefObject<(text: string, selection: EditorSelectionState) => { text: string; selection: EditorSelectionState } | null>
}

export interface UseMarkdownFormattingToolbarResult {
  activeDecorationFormats: Set<TextDecorationFormat>
  activeHeadingLevel: number
  isChecklistActive: boolean
  isBulletedListActive: boolean
  isNumberedListActive: boolean
  isBlockquoteActive: boolean
  isCodeBlockActive: boolean
  isInlineCodeActive: boolean
  applyTextDecoration: (format: TextDecorationFormat) => void
  applyHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void
  toggleCurrentLineHeading: () => void
  toggleBulletedList: () => void
  toggleNumberedList: () => void
  toggleChecklistList: () => void
  toggleBlockquote: () => void
  applyLink: () => void
  applyInlineCode: () => void
  applyCodeBlock: () => void
  insertHorizontalRule: () => void
}

/**
 * The markdown formatting toolbar's logic (bold/italic/strikethrough,
 * headings, lists, checklist, blockquote, code, link, horizontal rule) --
 * extracted verbatim from App.tsx with zero behavior change, as the first
 * of several remaining section-scoped clusters identified during the
 * split-view effort's reconnaissance pass. Pure text/selection transforms
 * with no DOM or timing dependencies, which is what makes this the
 * lowest-risk cluster to relocate first.
 */
export function useMarkdownFormattingToolbar({
  activeNoteId,
  currentEditorText,
  editorSelection,
  latestEditorTextRef,
  latestEditorSelectionRef,
  applyProgrammaticEditorText,
  buildTextDecorationTransformRef,
  buildToggleCurrentLineHeadingTransformRef,
  buildToggleBulletedListTransformRef,
  buildToggleNumberedListTransformRef,
}: UseMarkdownFormattingToolbarOptions): UseMarkdownFormattingToolbarResult {
  const lastHeadlineLevelRef = useRef<1 | 2 | 3 | 4 | 5 | 6>(1)

  const isSelectionWrappedBy = useCallback((text: string, selection: EditorSelectionState, open: string, close: string) => {
    const start = Math.max(0, Math.min(selection.start, text.length))
    const end = Math.max(start, Math.min(selection.end, text.length))

    return (
      start >= open.length &&
      text.slice(start - open.length, start) === open &&
      text.slice(end, end + close.length) === close
    )
  }, [])

  const markdownSelectionContext = useMemo(
    () => resolveMarkdownSelectionContext(currentEditorText, editorSelection),
    [currentEditorText, editorSelection],
  )

  const activeDecorationFormats = useMemo(() => {
    const active = new Set<TextDecorationFormat>()

    if (markdownSelectionContext.inline.inBold) {
      active.add('bold')
    }
    if (markdownSelectionContext.inline.inItalic) {
      active.add('italic')
    }
    if (markdownSelectionContext.inline.inStrikethrough) {
      active.add('strikethrough')
    }

    return active
  }, [markdownSelectionContext])

  const activeHeadingLevel = markdownSelectionContext.line.headingLevel
  const isChecklistActive = /^\s*(?:>\s*)*[-*+]\s+\[[ xX]\]\s+/.test(markdownSelectionContext.line.lineText)
  const isBulletedListActive = markdownSelectionContext.line.listKind === 'unordered' && !isChecklistActive
  const isNumberedListActive = markdownSelectionContext.line.listKind === 'ordered'
  const isBlockquoteActive = markdownSelectionContext.line.blockquoteDepth > 0
  const isCodeBlockActive = markdownSelectionContext.inline.inFencedCodeBlock
  const isInlineCodeActive = markdownSelectionContext.inline.inInlineCode

  useEffect(() => {
    if (activeHeadingLevel > 0) {
      lastHeadlineLevelRef.current = activeHeadingLevel as 1 | 2 | 3 | 4 | 5 | 6
    }
  }, [activeHeadingLevel])

  const buildTextDecorationTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
    format: TextDecorationFormat,
  ): { text: string; selection: EditorSelectionState } | null => {
    const marker = TEXT_DECORATION_MARKERS[format]
    const selectionStart = Math.max(0, Math.min(baseSelection.start, sourceText.length))
    const selectionEnd = Math.max(selectionStart, Math.min(baseSelection.end, sourceText.length))

    const isWordChar = (char: string) => /[A-Za-z0-9_]/.test(char)
    let start = selectionStart
    let end = selectionEnd

    if (baseSelection.isCollapsed) {
      let left = selectionStart
      let right = selectionStart

      while (left > 0 && isWordChar(sourceText[left - 1])) {
        left -= 1
      }
      while (right < sourceText.length && isWordChar(sourceText[right])) {
        right += 1
      }

      if (right > left) {
        start = left
        end = right
      }
    }

    const selectionForOperation: EditorSelectionState = {
      anchor: start,
      focus: end,
      start,
      end,
      isCollapsed: start === end,
    }

    const inlineContext = resolveMarkdownSelectionContext(sourceText, selectionForOperation).inline
    const isFormatActive = (
      (format === 'bold' && inlineContext.inBold)
      || (format === 'italic' && inlineContext.inItalic)
      || (format === 'strikethrough' && inlineContext.inStrikethrough)
    )
    const hasWrapping = isSelectionWrappedBy(sourceText, selectionForOperation, marker.open, marker.close)

    if (isFormatActive && hasWrapping) {
      const unwrapped = `${sourceText.slice(0, start - marker.open.length)}${sourceText.slice(start, end)}${sourceText.slice(end + marker.close.length)}`
      const nextStart = start - marker.open.length
      const nextEnd = nextStart + (end - start)
      return {
        text: unwrapped,
        selection: {
          anchor: nextStart,
          focus: nextEnd,
          start: nextStart,
          end: nextEnd,
          isCollapsed: nextStart === nextEnd,
        },
      }
    }

    const nextText = `${sourceText.slice(0, start)}${marker.open}${sourceText.slice(start, end)}${marker.close}${sourceText.slice(end)}`
    if (selectionForOperation.isCollapsed) {
      const cursor = start + marker.open.length
      return {
        text: nextText,
        selection: {
          anchor: cursor,
          focus: cursor,
          start: cursor,
          end: cursor,
          isCollapsed: true,
        },
      }
    }

    const nextStart = start + marker.open.length
    const nextEnd = nextStart + (end - start)
    return {
      text: nextText,
      selection: {
        anchor: nextStart,
        focus: nextEnd,
        start: nextStart,
        end: nextEnd,
        isCollapsed: false,
      },
    }
  }, [isSelectionWrappedBy])
  buildTextDecorationTransformRef.current = buildTextDecorationTransform

  const applyTextDecoration = useCallback((format: TextDecorationFormat) => {
    if (!activeNoteId) return

    const next = buildTextDecorationTransform(currentEditorText, editorSelection, format)
    if (!next) return

    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [activeNoteId, applyProgrammaticEditorText, buildTextDecorationTransform, currentEditorText, editorSelection])

  const resolveSelectionBoundsFromSelection = useCallback((text: string, selection: EditorSelectionState) => {
    const start = Math.max(0, Math.min(selection.start, text.length))
    const end = Math.max(start, Math.min(selection.end, text.length))
    return { start, end }
  }, [])

  const resolveSelectionBounds = useCallback((text: string) => {
    return resolveSelectionBoundsFromSelection(text, editorSelection)
  }, [editorSelection, resolveSelectionBoundsFromSelection])

  const applyWrappedMarker = useCallback((open: string, close: string, collapsedPlaceholder = '') => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const hasWrapping = isSelectionWrappedBy(sourceText, editorSelection, open, close)

    if (hasWrapping) {
      const unwrapped = `${sourceText.slice(0, start - open.length)}${sourceText.slice(start, end)}${sourceText.slice(end + close.length)}`
      const nextStart = start - open.length
      const nextEnd = nextStart + (end - start)
      applyProgrammaticEditorText(unwrapped, nextStart, nextEnd)
      return
    }

    if (editorSelection.isCollapsed && collapsedPlaceholder.length > 0) {
      const nextText = `${sourceText.slice(0, start)}${open}${collapsedPlaceholder}${close}${sourceText.slice(end)}`
      const nextStart = start + open.length
      const nextEnd = nextStart + collapsedPlaceholder.length
      applyProgrammaticEditorText(nextText, nextStart, nextEnd)
      return
    }

    const nextText = `${sourceText.slice(0, start)}${open}${sourceText.slice(start, end)}${close}${sourceText.slice(end)}`
    if (editorSelection.isCollapsed) {
      const cursor = start + open.length
      applyProgrammaticEditorText(nextText, cursor, cursor)
      return
    }

    const nextStart = start + open.length
    const nextEnd = nextStart + (end - start)
    applyProgrammaticEditorText(nextText, nextStart, nextEnd)
  }, [activeNoteId, applyProgrammaticEditorText, currentEditorText, editorSelection, isSelectionWrappedBy, resolveSelectionBounds])

  const resolveLineRange = useCallback((text: string, start: number, end: number) => {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const endProbe = end > start ? end - 1 : end
    const lineEndNewline = text.indexOf('\n', endProbe)
    const lineEndExclusive = lineEndNewline === -1 ? text.length : lineEndNewline
    return { lineStart, lineEndExclusive }
  }, [])

  const transformSelectedLinesForSelection = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
    transform: (line: string, index: number) => string,
    remapLocalOffsetInLine?: (params: {
      lineIndex: number
      oldLine: string
      newLine: string
      localOffsetInLine: number
    }) => number,
  ): { text: string; selection: EditorSelectionState } => {
    const start = Math.max(0, Math.min(baseSelection.start, sourceText.length))
    const end = Math.max(start, Math.min(baseSelection.end, sourceText.length))
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
    const lines = selectedBlock.split('\n')
    const nextLines = lines.map((line, index) => transform(line, index))
    const nextBlock = nextLines.join('\n')
    const nextText = `${sourceText.slice(0, lineStart)}${nextBlock}${sourceText.slice(lineEndExclusive)}`

    const lengthDelta = nextBlock.length - selectedBlock.length
    const remapOffset = (offset: number) => {
      if (offset <= lineStart) {
        return offset
      }
      if (offset >= lineEndExclusive) {
        return offset + lengthDelta
      }

      const localOffset = offset - lineStart
      let oldCursor = 0
      let newCursor = 0

      for (let index = 0; index < lines.length; index += 1) {
        const oldLineLength = lines[index].length
        const newLineLength = nextLines[index].length
        const oldLineEnd = oldCursor + oldLineLength
        const isLastLine = index === lines.length - 1

        if (localOffset < oldLineEnd) {
          const localOffsetInLine = localOffset - oldCursor
          const remappedLocalOffset = remapLocalOffsetInLine
            ? remapLocalOffsetInLine({
                lineIndex: index,
                oldLine: lines[index],
                newLine: nextLines[index],
                localOffsetInLine,
              })
            : localOffsetInLine
          return lineStart + newCursor + Math.min(Math.max(0, remappedLocalOffset), newLineLength)
        }

        if (localOffset === oldLineEnd) {
          return lineStart + newCursor + newLineLength
        }

        if (!isLastLine) {
          const oldNewlineOffset = oldLineEnd + 1
          const newNewlineOffset = newCursor + newLineLength + 1
          if (localOffset === oldNewlineOffset) {
            return lineStart + newNewlineOffset
          }

          oldCursor = oldNewlineOffset
          newCursor = newNewlineOffset
          continue
        }

        return lineStart + newCursor + newLineLength
      }

      return lineStart + nextBlock.length
    }

    const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
    const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
    return {
      text: nextText,
      selection: {
        anchor: nextAnchor,
        focus: nextFocus,
        start: Math.min(nextAnchor, nextFocus),
        end: Math.max(nextAnchor, nextFocus),
        isCollapsed: nextAnchor === nextFocus,
      },
    }
  }, [resolveLineRange])

  const transformSelectedLines = useCallback((transform: (line: string, index: number) => string) => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const next = transformSelectedLinesForSelection(sourceText, latestEditorSelectionRef.current, transform)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [
    activeNoteId,
    applyProgrammaticEditorText,
    currentEditorText,
    latestEditorSelectionRef,
    transformSelectedLinesForSelection,
  ])

  const applyHeading = useCallback((level: 1 | 2 | 3 | 4 | 5 | 6) => {
    lastHeadlineLevelRef.current = level
    const headingPrefix = `${'#'.repeat(level)} `

    transformSelectedLines((line) => {
      const withoutAnyHeading = line.replace(/^#{1,6}\s+/, '')
      const alreadyAtLevel = line.startsWith(headingPrefix)
      return alreadyAtLevel ? withoutAnyHeading : `${headingPrefix}${withoutAnyHeading}`
    })
  }, [transformSelectedLines])

  const buildToggleCurrentLineHeadingTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } | null => {
    const clampOffset = (offset: number) => Math.max(0, Math.min(offset, sourceText.length))
    const caret = clampOffset(baseSelection.focus)
    const lineStart = sourceText.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const lineEndNewline = sourceText.indexOf('\n', caret)
    const lineEndExclusive = lineEndNewline === -1 ? sourceText.length : lineEndNewline
    const lineText = sourceText.slice(lineStart, lineEndExclusive)

    const currentHeadingPrefixMatch = lineText.match(/^(#{1,6}\s*)/)
    if (currentHeadingPrefixMatch) {
      const removedPrefix = currentHeadingPrefixMatch[1]
      const removedLength = removedPrefix.length
      const nextLineText = lineText.slice(removedLength)
      const nextText = `${sourceText.slice(0, lineStart)}${nextLineText}${sourceText.slice(lineEndExclusive)}`

      const remapOffset = (offset: number) => {
        const safeOffset = clampOffset(offset)
        if (safeOffset <= lineStart) return safeOffset
        if (safeOffset <= lineStart + removedLength) return lineStart
        return safeOffset - removedLength
      }

      const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
      const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
      return {
        text: nextText,
        selection: {
          anchor: nextAnchor,
          focus: nextFocus,
          start: Math.min(nextAnchor, nextFocus),
          end: Math.max(nextAnchor, nextFocus),
          isCollapsed: nextAnchor === nextFocus,
        },
      }
    }

    let searchLineEnd = lineStart > 0 ? lineStart - 1 : -1
    let inheritedPrefix: string | null = null

    while (searchLineEnd >= 0) {
      const searchLineStart = sourceText.lastIndexOf('\n', Math.max(0, searchLineEnd - 1)) + 1
      const previousLine = sourceText.slice(searchLineStart, searchLineEnd + 1)
      const previousHeadingPrefixMatch = previousLine.match(/^(#{1,6}\s*)/)
      if (previousHeadingPrefixMatch) {
        inheritedPrefix = previousHeadingPrefixMatch[1]
        break
      }

      if (searchLineStart === 0) {
        break
      }
      searchLineEnd = searchLineStart - 2
    }

    if (!inheritedPrefix) {
      inheritedPrefix = `${'#'.repeat(lastHeadlineLevelRef.current)} `
    }

    const addedLength = inheritedPrefix.length
    const nextLineText = `${inheritedPrefix}${lineText}`
    const nextText = `${sourceText.slice(0, lineStart)}${nextLineText}${sourceText.slice(lineEndExclusive)}`

    const remapOffset = (offset: number) => {
      const safeOffset = clampOffset(offset)
      if (safeOffset <= lineStart) return safeOffset
      return safeOffset + addedLength
    }

    const nextAnchor = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.anchor)))
    const nextFocus = Math.max(0, Math.min(nextText.length, remapOffset(baseSelection.focus)))
    return {
      text: nextText,
      selection: {
        anchor: nextAnchor,
        focus: nextFocus,
        start: Math.min(nextAnchor, nextFocus),
        end: Math.max(nextAnchor, nextFocus),
        isCollapsed: nextAnchor === nextFocus,
      },
    }
  }, [])
  buildToggleCurrentLineHeadingTransformRef.current = buildToggleCurrentLineHeadingTransform

  const toggleCurrentLineHeading = useCallback(() => {
    if (!activeNoteId) return

    const sourceText = normalizeInternalText(latestEditorTextRef.current || currentEditorText)
    const next = buildToggleCurrentLineHeadingTransform(sourceText, latestEditorSelectionRef.current)
    if (!next) return
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [
    activeNoteId,
    applyProgrammaticEditorText,
    buildToggleCurrentLineHeadingTransform,
    currentEditorText,
    latestEditorSelectionRef,
    latestEditorTextRef,
  ])

  const buildToggleBulletedListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const bulletPattern = /^(\s*(?:>\s*)*)([-*+])\s+/
    const numberedPattern = /^(\s*(?:>\s*)*)(\d+[.)])\s+/

    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      return { quotePrefix, withoutListMarker }
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allBulleted = lines.every((line) => line.trim().length === 0 || bulletPattern.test(line))

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]|\d+[.)])\s+/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line) => {
      if (line.trim().length === 0) return line
      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      if (allBulleted) {
        return bulletPattern.test(line) ? `${quotePrefix}${withoutListMarker}` : line
      }

      const hadNumberedMarker = numberedPattern.test(line)
      const hadBulletedMarker = bulletPattern.test(line)
      if (hadBulletedMarker || hadNumberedMarker) {
        return `${quotePrefix}- ${withoutListMarker}`
      }

      return `${quotePrefix}- ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }

      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])
  buildToggleBulletedListTransformRef.current = buildToggleBulletedListTransform

  const buildToggleNumberedListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const numberedPattern = /^(\s*(?:>\s*)*)(\d+[.)])\s+/
    const bulletPattern = /^(\s*(?:>\s*)*)([-*+])\s+/

    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      return { quotePrefix, withoutListMarker }
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allNumbered = lines.every((line) => line.trim().length === 0 || numberedPattern.test(line))

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]|\d+[.)])\s+/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line, index) => {
      if (line.trim().length === 0) return line
      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      if (allNumbered) {
        return numberedPattern.test(line) ? `${quotePrefix}${withoutListMarker}` : line
      }

      const hadNumberedMarker = numberedPattern.test(line)
      const hadBulletedMarker = bulletPattern.test(line)
      if (hadNumberedMarker || hadBulletedMarker) {
        return `${quotePrefix}${index + 1}. ${withoutListMarker}`
      }

      return `${quotePrefix}${index + 1}. ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }

      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])
  buildToggleNumberedListTransformRef.current = buildToggleNumberedListTransform

  const toggleBulletedList = useCallback(() => {
    const next = buildToggleBulletedListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleBulletedListTransform, currentEditorText, latestEditorSelectionRef])

  const toggleNumberedList = useCallback(() => {
    const next = buildToggleNumberedListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleNumberedListTransform, currentEditorText, latestEditorSelectionRef])

  const buildToggleChecklistListTransform = useCallback((
    sourceText: string,
    baseSelection: EditorSelectionState,
  ): { text: string; selection: EditorSelectionState } => {
    const checklistPattern = /^(\s*(?:>\s*)*)(?:[-*+])\s+\[[ xX]\]\s+/;
    const splitListPrefix = (line: string) => {
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : ''
      const remainder = line.slice(quotePrefix.length)
      const withoutListMarker = remainder.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '')
      return { quotePrefix, withoutListMarker }
    }

    const resolveContentStart = (line: string) => {
      const match = line.match(/^(\s*(?:>\s*)*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/)
      if (match) return match[0].length
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)*)/)
      return quotePrefixMatch ? quotePrefixMatch[0].length : 0
    }

    const { start, end } = resolveSelectionBoundsFromSelection(sourceText, baseSelection)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
    const lines = selectedBlock.split('\n')
    const allChecklist = lines.every((line) => line.trim().length === 0 || checklistPattern.test(line))

    return transformSelectedLinesForSelection(sourceText, baseSelection, (line) => {
      if (line.trim().length === 0) return line
      const checklistMatch = line.match(checklistPattern)
      if (allChecklist && checklistMatch) {
        return `${checklistMatch[1]}${line.slice(checklistMatch[0].length)}`
      }

      const { quotePrefix, withoutListMarker } = splitListPrefix(line)
      return `${quotePrefix}- [ ] ${withoutListMarker}`
    }, ({ oldLine, newLine, localOffsetInLine }) => {
      const oldContentStart = resolveContentStart(oldLine)
      const newContentStart = resolveContentStart(newLine)

      if (oldLine.match(/^(\s*(?:>\s*)*[-*+]\s+)\[[ xX]\]\s+/)) {
        const checkboxPrefixLength = oldLine.match(/^(\s*(?:>\s*)*[-*+]\s+\[[ xX]\]\s+)/)![1].length
        if (localOffsetInLine <= checkboxPrefixLength) {
          return Math.min(localOffsetInLine, newContentStart)
        }
      }

      if (localOffsetInLine <= oldContentStart) {
        return Math.min(localOffsetInLine, newContentStart)
      }
      return localOffsetInLine + (newContentStart - oldContentStart)
    })
  }, [resolveLineRange, resolveSelectionBoundsFromSelection, transformSelectedLinesForSelection])

  const toggleChecklistList = useCallback(() => {
    const next = buildToggleChecklistListTransform(currentEditorText, latestEditorSelectionRef.current)
    applyProgrammaticEditorText(next.text, next.selection.anchor, next.selection.focus)
  }, [applyProgrammaticEditorText, buildToggleChecklistListTransform, currentEditorText, latestEditorSelectionRef])

  const toggleBlockquote = useCallback(() => {
    const quotePattern = /^>\s?/
    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const { lineStart, lineEndExclusive } = resolveLineRange(sourceText, start, end)
    const lines = sourceText.slice(lineStart, lineEndExclusive).split('\n')
    const allQuoted = lines.every((line) => line.trim().length === 0 || quotePattern.test(line))

    transformSelectedLines((line) => {
      if (line.trim().length === 0) return line
      return allQuoted ? line.replace(quotePattern, '') : `> ${line}`
    })
  }, [currentEditorText, resolveLineRange, resolveSelectionBounds, transformSelectedLines])

  const applyLink = useCallback(() => {
    applyWrappedMarker('[', '](url)', 'link')
  }, [applyWrappedMarker])

  const applyInlineCode = useCallback(() => {
    applyWrappedMarker('`', '`', 'code')
  }, [applyWrappedMarker])

  const applyCodeBlock = useCallback(() => {
    applyWrappedMarker('```\n', '\n```', 'code')
  }, [applyWrappedMarker])

  const insertHorizontalRule = useCallback(() => {
    if (!activeNoteId) return

    const sourceText = currentEditorText
    const { start, end } = resolveSelectionBounds(sourceText)
    const needsLeadingNewline = start > 0 && sourceText[start - 1] !== '\n'
    const needsTrailingNewline = end < sourceText.length && sourceText[end] !== '\n'
    const inserted = `${needsLeadingNewline ? '\n' : ''}---${needsTrailingNewline ? '\n' : ''}`
    const nextText = `${sourceText.slice(0, start)}${inserted}${sourceText.slice(end)}`
    const cursor = start + inserted.length
    applyProgrammaticEditorText(nextText, cursor, cursor)
  }, [activeNoteId, applyProgrammaticEditorText, currentEditorText, resolveSelectionBounds])

  return {
    activeDecorationFormats,
    activeHeadingLevel,
    isChecklistActive,
    isBulletedListActive,
    isNumberedListActive,
    isBlockquoteActive,
    isCodeBlockActive,
    isInlineCodeActive,
    applyTextDecoration,
    applyHeading,
    toggleCurrentLineHeading,
    toggleBulletedList,
    toggleNumberedList,
    toggleChecklistList,
    toggleBlockquote,
    applyLink,
    applyInlineCode,
    applyCodeBlock,
    insertHorizontalRule,
  }
}

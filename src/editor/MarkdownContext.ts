import type { EditorSelectionState } from './EditorContract'

export type MarkdownListKind = 'ordered' | 'unordered' | null

export type MarkdownInlineState = {
  inBold: boolean
  inItalic: boolean
  inStrikethrough: boolean
  inInlineCode: boolean
  inFencedCodeBlock: boolean
}

export type MarkdownLineContext = {
  lineStart: number
  lineEndExclusive: number
  lineText: string
  lineIndex: number
  column: number
  leadingWhitespaceCount: number
  blockquoteDepth: number
  headingLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6
  listKind: MarkdownListKind
  listIndentLevel: number
  listMarker: string | null
  orderedListNumber: number | null
}

export type MarkdownSelectionContext = {
  caretOffset: number
  line: MarkdownLineContext
  inline: MarkdownInlineState
}

export type IndentDirection = 'indent' | 'outdent'

export type IndentationTransformResult = {
  text: string
  selection: EditorSelectionState
}

export type EnterKeyTransformResult = {
  text: string
  selection: EditorSelectionState
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function countLeadingSpaces(line: string): number {
  let count = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line.charCodeAt(index) !== 32) break
    count += 1
  }
  return count
}

function countLineIndex(text: string, offset: number): number {
  if (offset <= 0) return 0
  let count = 0
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1
  }
  return count
}

function resolveLineBounds(text: string, start: number, end: number): { lineStart: number; lineEndExclusive: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const endProbe = end > start ? end - 1 : end
  const lineEndNewline = text.indexOf('\n', endProbe)
  const lineEndExclusive = lineEndNewline === -1 ? text.length : lineEndNewline
  return { lineStart, lineEndExclusive }
}

function resolveHeadingLevel(lineText: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const match = lineText.match(/^\s*(?:>\s*)*(#{1,6})(?:\s|$)/)
  if (!match) return 0
  return match[1].length as 1 | 2 | 3 | 4 | 5 | 6
}

function resolveBlockquoteDepth(lineText: string): number {
  const match = lineText.match(/^\s*((?:>\s*)+)/)
  if (!match) return 0
  const markers = match[1].match(/>/g)
  return markers ? markers.length : 0
}

function resolveListMeta(lineText: string): {
  listKind: MarkdownListKind
  listIndentLevel: number
  listMarker: string | null
  orderedListNumber: number | null
} {
  const unorderedMatch = lineText.match(/^(\s*)(?:> ?)*(\s*)([-*+])\s+/)
  if (unorderedMatch) {
    const indent = unorderedMatch[1].length + unorderedMatch[2].length
    return {
      listKind: 'unordered',
      listIndentLevel: Math.floor(indent / 3),
      listMarker: unorderedMatch[3],
      orderedListNumber: null,
    }
  }

  const orderedMatch = lineText.match(/^(\s*)(?:> ?)*(\s*)(\d+)([.)])\s+/)
  if (orderedMatch) {
    const indent = orderedMatch[1].length + orderedMatch[2].length
    return {
      listKind: 'ordered',
      listIndentLevel: Math.floor(indent / 3),
      listMarker: `${orderedMatch[3]}${orderedMatch[4]}`,
      orderedListNumber: Number.parseInt(orderedMatch[3], 10),
    }
  }

  return {
    listKind: null,
    listIndentLevel: 0,
    listMarker: null,
    orderedListNumber: null,
  }
}

function readDelimiterRun(text: string, from: number, charCode: number): number {
  let index = from
  while (index < text.length && text.charCodeAt(index) === charCode) {
    index += 1
  }
  return index - from
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0
  let cursor = index - 1
  while (cursor >= 0 && text.charCodeAt(cursor) === 92) {
    slashCount += 1
    cursor -= 1
  }
  return slashCount % 2 === 1
}

function computeInlineStateAtOffset(text: string, offset: number): MarkdownInlineState {
  const safeOffset = clamp(offset, 0, text.length)
  let inBold = false
  let inItalic = false
  let inStrikethrough = false
  let activeCodeFence: '`' | '~' | null = null
  let activeCodeFenceLen = 0
  let activeInlineCodeLen = 0

  let cursor = 0
  while (cursor < safeOffset) {
    const lineStart = cursor
    let lineEnd = text.indexOf('\n', lineStart)
    if (lineEnd === -1 || lineEnd > safeOffset) lineEnd = safeOffset
    const line = text.slice(lineStart, lineEnd)

    const fenceMatch = line.match(/^\s*(```+|~~~+)/)
    if (fenceMatch && !activeInlineCodeLen) {
      const fenceToken = fenceMatch[1]
      const fenceChar = fenceToken.charCodeAt(0) === 96 ? '`' : '~'
      const fenceLen = fenceToken.length

      if (!activeCodeFence) {
        activeCodeFence = fenceChar
        activeCodeFenceLen = fenceLen
        cursor = lineEnd + 1
        continue
      }

      if (activeCodeFence === fenceChar && fenceLen >= activeCodeFenceLen) {
        activeCodeFence = null
        activeCodeFenceLen = 0
        cursor = lineEnd + 1
        continue
      }
    }

    if (activeCodeFence) {
      cursor = lineEnd + 1
      continue
    }

    let index = lineStart
    while (index < lineEnd) {
      const charCode = text.charCodeAt(index)

      if (charCode === 96 && !isEscaped(text, index)) {
        const runLen = readDelimiterRun(text, index, 96)
        if (activeInlineCodeLen === 0) {
          activeInlineCodeLen = runLen
          index += runLen
          continue
        }
        if (runLen >= activeInlineCodeLen) {
          activeInlineCodeLen = 0
        }
        index += runLen
        continue
      }

      if (activeInlineCodeLen > 0) {
        index += 1
        continue
      }

      if (charCode === 126 && !isEscaped(text, index)) {
        const runLen = readDelimiterRun(text, index, 126)
        if (runLen >= 2) {
          inStrikethrough = !inStrikethrough
          index += 2
          continue
        }
      }

      if ((charCode === 42 || charCode === 95) && !isEscaped(text, index)) {
        let runLen = readDelimiterRun(text, index, charCode)

        while (runLen >= 2) {
          inBold = !inBold
          runLen -= 2
          index += 2
        }

        if (runLen === 1) {
          inItalic = !inItalic
          index += 1
          continue
        }

        continue
      }

      index += 1
    }

    cursor = lineEnd + 1
  }

  return {
    inBold,
    inItalic,
    inStrikethrough,
    inInlineCode: activeInlineCodeLen > 0,
    inFencedCodeBlock: activeCodeFence !== null,
  }
}

export function resolveMarkdownSelectionContext(text: string, selection: EditorSelectionState): MarkdownSelectionContext {
  const safeText = text ?? ''
  const caretOffset = clamp(selection.focus, 0, safeText.length)
  const { lineStart, lineEndExclusive } = resolveLineBounds(safeText, caretOffset, caretOffset)
  const lineText = safeText.slice(lineStart, lineEndExclusive)
  const blockquoteDepth = resolveBlockquoteDepth(lineText)
  const headingLevel = resolveHeadingLevel(lineText)
  const listMeta = resolveListMeta(lineText)

  return {
    caretOffset,
    line: {
      lineStart,
      lineEndExclusive,
      lineText,
      lineIndex: countLineIndex(safeText, lineStart),
      column: caretOffset - lineStart,
      leadingWhitespaceCount: countLeadingSpaces(lineText),
      blockquoteDepth,
      headingLevel,
      listKind: listMeta.listKind,
      listIndentLevel: listMeta.listIndentLevel,
      listMarker: listMeta.listMarker,
      orderedListNumber: listMeta.orderedListNumber,
    },
    inline: computeInlineStateAtOffset(safeText, caretOffset),
  }
}

function resolveNextIndentCount(currentCount: number, direction: IndentDirection, step: number): number {
  const safeStep = Math.max(1, step)
  if (direction === 'indent') {
    return Math.ceil((currentCount + 1) / safeStep) * safeStep
  }
  if (currentCount <= 0) return 0
  return Math.floor((currentCount - 1) / safeStep) * safeStep
}

function mapOffsetWithinLine(
  localOffset: number,
  oldIndent: number,
  newIndent: number,
): number {
  const delta = newIndent - oldIndent
  if (localOffset <= oldIndent) {
    return clamp(localOffset + delta, 0, newIndent)
  }
  return Math.max(0, localOffset + delta)
}

export function indentSelectionByStep(
  text: string,
  selection: EditorSelectionState,
  direction: IndentDirection,
  step = 3,
): IndentationTransformResult {
  const sourceText = text ?? ''
  const safeAnchor = clamp(selection.anchor, 0, sourceText.length)
  const safeFocus = clamp(selection.focus, 0, sourceText.length)
  const safeStart = Math.min(safeAnchor, safeFocus)
  const safeEnd = Math.max(safeAnchor, safeFocus)
  const { lineStart, lineEndExclusive } = resolveLineBounds(sourceText, safeStart, safeEnd)

  const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
  const lines = selectedBlock.split('\n')

  const lineStartsInBlock: number[] = []
  let runningOffset = 0
  for (const line of lines) {
    lineStartsInBlock.push(runningOffset)
    runningOffset += line.length + 1
  }

  const transformedLines: string[] = []
  const indentDeltas: number[] = []

  for (const line of lines) {
    const oldIndent = countLeadingSpaces(line)
    const newIndent = resolveNextIndentCount(oldIndent, direction, step)
    const nextLine = `${' '.repeat(newIndent)}${line.slice(oldIndent)}`
    transformedLines.push(nextLine)
    indentDeltas.push(newIndent - oldIndent)
  }

  const nextBlock = transformedLines.join('\n')
  const nextText = `${sourceText.slice(0, lineStart)}${nextBlock}${sourceText.slice(lineEndExclusive)}`

  const mapGlobalOffset = (globalOffset: number): number => {
    if (globalOffset < lineStart) return globalOffset
    if (globalOffset > lineEndExclusive) {
      return globalOffset + (nextBlock.length - selectedBlock.length)
    }

    const offsetInBlock = globalOffset - lineStart
    let lineIndex = lines.length - 1
    for (let index = 0; index < lineStartsInBlock.length; index += 1) {
      const lineLocalStart = lineStartsInBlock[index]
      const nextLineStart = index + 1 < lineStartsInBlock.length ? lineStartsInBlock[index + 1] : Number.POSITIVE_INFINITY
      if (offsetInBlock >= lineLocalStart && offsetInBlock < nextLineStart) {
        lineIndex = index
        break
      }
    }

    const oldLineStart = lineStartsInBlock[lineIndex]
    const oldIndent = countLeadingSpaces(lines[lineIndex])
    const newIndent = oldIndent + indentDeltas[lineIndex]

    const localOffset = offsetInBlock - oldLineStart
    const mappedLocalOffset = mapOffsetWithinLine(localOffset, oldIndent, newIndent)

    let newLineStart = 0
    for (let index = 0; index < lineIndex; index += 1) {
      newLineStart += transformedLines[index].length + 1
    }

    return lineStart + newLineStart + mappedLocalOffset
  }

  const nextAnchor = clamp(mapGlobalOffset(safeAnchor), 0, nextText.length)
  const nextFocus = clamp(mapGlobalOffset(safeFocus), 0, nextText.length)

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

type ParsedLineStructure = {
  leadingSpaces: string
  quotePrefix: string
  postQuoteIndent: string
  listPrefix: string | null
  listKind: MarkdownListKind
  unorderedMarker: '-' | '*' | '+' | null
  checklistPrefix: string | null
  listNumber: number | null
  listDelimiter: '.' | ')' | null
  contentAfterPrefixes: string
}

function parseLineStructure(lineText: string): ParsedLineStructure {
  const leadingSpacesMatch = lineText.match(/^(\s*)/)
  const leadingSpaces = leadingSpacesMatch ? leadingSpacesMatch[1] : ''
  let remainder = lineText.slice(leadingSpaces.length)

  let quotePrefix = ''
  while (remainder.startsWith('>')) {
    quotePrefix += '>'
    remainder = remainder.slice(1)
    if (remainder.startsWith(' ')) {
      quotePrefix += ' '
      remainder = remainder.slice(1)
    }
  }

  const postQuoteIndentMatch = remainder.match(/^(\s*)/)
  const postQuoteIndent = postQuoteIndentMatch ? postQuoteIndentMatch[1] : ''
  remainder = remainder.slice(postQuoteIndent.length)

  const unorderedMatch = remainder.match(/^([-*+])\s+/)
  if (unorderedMatch) {
    const afterListPrefix = remainder.slice(unorderedMatch[0].length)
    const checklistMatch = afterListPrefix.match(/^(\[ \])\s+/)
    const checklistPrefix = checklistMatch ? `${checklistMatch[1]} ` : null

    return {
      leadingSpaces,
      quotePrefix,
      postQuoteIndent,
      listPrefix: unorderedMatch[0],
      listKind: 'unordered',
      unorderedMarker: unorderedMatch[1] as '-' | '*' | '+',
      checklistPrefix,
      listNumber: null,
      listDelimiter: null,
      contentAfterPrefixes: checklistMatch
        ? afterListPrefix.slice(checklistMatch[0].length)
        : afterListPrefix,
    }
  }

  const orderedMatch = remainder.match(/^(\d+)([.)])\s+/)
  if (orderedMatch) {
    return {
      leadingSpaces,
      quotePrefix,
      postQuoteIndent,
      listPrefix: orderedMatch[0],
      listKind: 'ordered',
      unorderedMarker: null,
      checklistPrefix: null,
      listNumber: Number.parseInt(orderedMatch[1], 10),
      listDelimiter: orderedMatch[2] as '.' | ')',
      contentAfterPrefixes: remainder.slice(orderedMatch[0].length),
    }
  }

  return {
    leadingSpaces,
    quotePrefix,
    postQuoteIndent,
    listPrefix: null,
    listKind: null,
    unorderedMarker: null,
    checklistPrefix: null,
    listNumber: null,
    listDelimiter: null,
    contentAfterPrefixes: `${postQuoteIndent}${remainder}`,
  }
}

export function applyMarkdownEnter(
  text: string,
  selection: EditorSelectionState,
): EnterKeyTransformResult | null {
  if (!selection.isCollapsed) return null

  const sourceText = text ?? ''
  const caretOffset = clamp(selection.focus, 0, sourceText.length)
  const context = resolveMarkdownSelectionContext(sourceText, selection)

  if (context.inline.inFencedCodeBlock) {
    return null
  }

  const lineText = context.line.lineText
  const lineStructure = parseLineStructure(lineText)
  const basePrefix = `${lineStructure.leadingSpaces}${lineStructure.quotePrefix}${lineStructure.postQuoteIndent}`

  const isEmptyListItem =
    lineStructure.listKind !== null &&
    lineStructure.contentAfterPrefixes.trim().length === 0

  if (isEmptyListItem) {
    const nextText = `${sourceText.slice(0, context.line.lineStart)}${sourceText.slice(context.line.lineEndExclusive)}`
    const nextCaret = context.line.lineStart
    return {
      text: nextText,
      selection: {
        anchor: nextCaret,
        focus: nextCaret,
        start: nextCaret,
        end: nextCaret,
        isCollapsed: true,
      },
    }
  }

  let inserted = '\n'

  if (lineStructure.listKind === 'unordered') {
    const marker = lineStructure.unorderedMarker ?? '-'
    const checklistPrefix = lineStructure.checklistPrefix ?? ''
    inserted = `\n${basePrefix}${marker} ${checklistPrefix}`
  } else if (
    lineStructure.listKind === 'ordered' &&
    lineStructure.listNumber !== null &&
    lineStructure.listDelimiter !== null
  ) {
    inserted = `\n${basePrefix}${lineStructure.listNumber + 1}${lineStructure.listDelimiter} `
  } else if (lineStructure.quotePrefix.length > 0) {
    inserted = `\n${basePrefix}`
  } else if (lineStructure.leadingSpaces.length > 0) {
    const linePrefixBeforeCaret = sourceText.slice(context.line.lineStart, caretOffset)
    const newLineIndent = lineText.trim().length === 0
      ? ' '.repeat(countLeadingSpaces(linePrefixBeforeCaret))
      : lineStructure.leadingSpaces

    inserted = `\n${newLineIndent}`
  }
  // else: plain line with no list/quote/indent — plain newline insert.
  // We handle this ourselves rather than returning null and falling through to Lexical's
  // native paragraph-split. Lexical's native Enter at the start of a paragraph places
  // the caret on the newly-created empty paragraph before the content, whereas our
  // canonical model inserts '\n' and advances the caret past it, keeping it at the
  // start of the content line. The difference is only observable at column 0, which is
  // exactly the case that causes the delete→enter bug: after deleting an empty line the
  // caret sits at column 0 of the following line, and native Enter re-creates the empty
  // line with the caret on it instead of keeping the caret on the content line.

  const nextText = `${sourceText.slice(0, caretOffset)}${inserted}${sourceText.slice(caretOffset)}`
  const nextCaret = caretOffset + inserted.length

  return {
    text: nextText,
    selection: {
      anchor: nextCaret,
      focus: nextCaret,
      start: nextCaret,
      end: nextCaret,
      isCollapsed: true,
    },
  }
}

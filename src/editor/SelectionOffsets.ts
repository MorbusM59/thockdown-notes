import type { EditorSelectionState } from './EditorContract';
import { normalizeInternalText } from './TextPolicy';

export const EMPTY_SELECTION: EditorSelectionState = {
  anchor: 0,
  focus: 0,
  start: 0,
  end: 0,
  isCollapsed: true,
};

export function normalizePlainText(input: string): string {
  return normalizeInternalText(input);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compareDomPoints(
  aNode: Node,
  aOffset: number,
  bNode: Node,
  bOffset: number,
): number {
  const aRange = document.createRange();
  aRange.setStart(aNode, aOffset);
  aRange.collapse(true);

  const bRange = document.createRange();
  bRange.setStart(bNode, bOffset);
  bRange.collapse(true);

  return aRange.compareBoundaryPoints(Range.START_TO_START, bRange);
}

function collectTextNodes(container: Node): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current instanceof Text) {
      nodes.push(current);
    }
  }
  return nodes;
}

function getOffsetWithinContainer(container: Node, node: Node, offset: number): number {
  const textNodes = collectTextNodes(container);
  if (textNodes.length === 0) {
    return 0;
  }

  let accumulated = 0;

  for (const textNode of textNodes) {
    const textLength = normalizePlainText(textNode.data).length;

    if (textNode === node) {
      const safeRawOffset = clamp(offset, 0, textNode.data.length);
      return accumulated + normalizePlainText(textNode.data.slice(0, safeRawOffset)).length;
    }

    try {
      const beforeOrAtTextStart = compareDomPoints(node, offset, textNode, 0) <= 0;
      if (beforeOrAtTextStart) {
        return accumulated;
      }

      const beforeOrAtTextEnd = compareDomPoints(node, offset, textNode, textNode.data.length) <= 0;
      if (beforeOrAtTextEnd) {
        return accumulated + textLength;
      }
    } catch {
      return accumulated;
    }

    accumulated += textLength;
  }

  return accumulated;
}

function getOffsetWithinParagraph(paragraphEl: HTMLElement, node: Node, offset: number): number {
  const paragraphText = normalizePlainText(paragraphEl.textContent ?? '');
  if (paragraphText.length === 0) {
    return 0;
  }

  const textNodes = collectTextNodes(paragraphEl);
  if (textNodes.length === 0) {
    return 0;
  }

  let accumulated = 0;
  for (const textNode of textNodes) {
    const textLength = normalizePlainText(textNode.data).length;
    if (textNode === node) {
      const safeRawOffset = clamp(offset, 0, textNode.data.length);
      return accumulated + normalizePlainText(textNode.data.slice(0, safeRawOffset)).length;
    }

    try {
      const beforeOrAtTextStart = compareDomPoints(node, offset, textNode, 0) <= 0;
      if (beforeOrAtTextStart) {
        return accumulated;
      }

      const beforeOrAtTextEnd = compareDomPoints(node, offset, textNode, textNode.data.length) <= 0;
      if (beforeOrAtTextEnd) {
        return accumulated + textLength;
      }
    } catch {
      return accumulated;
    }

    accumulated += textLength;
  }

  return accumulated;
}

function getOffsetWithinRoot(rootEl: HTMLElement, node: Node, offset: number): number {
  const paragraphs = Array.from(rootEl.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  if (paragraphs.length === 0) {
    return getOffsetWithinContainer(rootEl, node, offset);
  }

  if (node === rootEl) {
    const safeBoundary = clamp(offset, 0, paragraphs.length);
    let accumulated = 0;
    for (let index = 0; index < safeBoundary; index += 1) {
      const paragraph = paragraphs[index];
      accumulated += normalizePlainText(paragraph.textContent ?? '').length;
      if (index < paragraphs.length - 1) {
        accumulated += 1;
      }
    }
    return accumulated;
  }

  let accumulated = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph.contains(node) || paragraph === node) {
      const innerOffset = getOffsetWithinParagraph(paragraph, node, offset);
      const paraTextLength = normalizePlainText(paragraph.textContent ?? '').length;
      const hasNextParagraph = index < paragraphs.length - 1;

      // Disambiguate the inter-paragraph boundary: when the anchor/focus node is the
      // paragraph element itself (not a text node inside it) and its DOM offset points
      // past its last child, Lexical places the cursor at the "end of this paragraph".
      // Visually that position is indistinguishable from "start of next paragraph", but
      // after a delete/merge operation Lexical consistently produces this form.
      // Treating it as end-of-line means the caret appears on the wrong logical line,
      // so Enter re-inserts the removed blank line instead of splitting the next one.
      // The canonical offset for this position is start-of-next-paragraph, i.e.
      // accumulated + paraTextLength + 1 (the LF separator). We only apply this when
      // the paragraph actually has text (empty paragraphs represent blank lines and
      // their past-end position is genuinely on that blank line, not the next one).
      const nodeIsElement = !(node instanceof Text);
      if (nodeIsElement && hasNextParagraph && paraTextLength > 0 && innerOffset >= paraTextLength) {
        return accumulated + paraTextLength + 1;
      }

      return accumulated + innerOffset;
    }

    accumulated += normalizePlainText(paragraph.textContent ?? '').length;
    if (index < paragraphs.length - 1) {
      // Canonical model inserts a single LF between root paragraphs.
      accumulated += 1;
    }
  }

  // Invalid DOM positions can happen briefly during editor updates.
  return 0;
}

export function readSelectionOffsetFromDomPoint(
  rootEl: HTMLElement,
  node: Node,
  offset: number,
  textLength: number,
): number {
  const safeTextLength = Math.max(0, textLength);
  if (!rootEl.contains(node) && node !== rootEl) {
    return 0;
  }

  const rawOffset = getOffsetWithinRoot(rootEl, node, offset);
  return clamp(rawOffset, 0, safeTextLength);
}

export function readSelectionOffsetFromClientPoint(
  rootEl: HTMLElement,
  clientX: number,
  clientY: number,
  textLength: number,
  fallbackOffset: number,
): number {
  const safeTextLength = Math.max(0, textLength);
  const safeFallback = clamp(fallbackOffset, 0, safeTextLength);

  const docWithCaretApi = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  if (typeof docWithCaretApi.caretPositionFromPoint === 'function') {
    const caretPosition = docWithCaretApi.caretPositionFromPoint(clientX, clientY);
    if (caretPosition && caretPosition.offsetNode) {
      return readSelectionOffsetFromDomPoint(
        rootEl,
        caretPosition.offsetNode,
        caretPosition.offset,
        safeTextLength,
      );
    }
  }

  if (typeof docWithCaretApi.caretRangeFromPoint === 'function') {
    const caretRange = docWithCaretApi.caretRangeFromPoint(clientX, clientY);
    if (caretRange && caretRange.startContainer) {
      return readSelectionOffsetFromDomPoint(
        rootEl,
        caretRange.startContainer,
        caretRange.startOffset,
        safeTextLength,
      );
    }
  }

  return safeFallback;
}

type DomPoint = {
  node: Node;
  offset: number;
};

function collectParagraphTextNodes(paragraphEl: HTMLElement): Text[] {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current instanceof Text) {
      nodes.push(current);
    }
  }
  return nodes;
}

function paragraphStartPoint(paragraphEl: HTMLElement, textNodes: Text[]): DomPoint {
  if (textNodes.length > 0) {
    return { node: textNodes[0], offset: 0 };
  }

  return { node: paragraphEl, offset: 0 };
}

function paragraphEndPoint(paragraphEl: HTMLElement, textNodes: Text[]): DomPoint {
  if (textNodes.length > 0) {
    const last = textNodes[textNodes.length - 1];
    return { node: last, offset: last.data.length };
  }

  return { node: paragraphEl, offset: paragraphEl.childNodes.length };
}

function resolveDomPointForTextOffset(rootEl: HTMLElement, canonicalText: string, targetOffset: number): DomPoint | null {
  const safeTargetOffset = clamp(targetOffset, 0, canonicalText.length);
  const paragraphs = Array.from(rootEl.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

  if (paragraphs.length === 0) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let fallback: DomPoint | null = null;
    let traversed = 0;

    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (!(current instanceof Text)) continue;

      const length = current.data.length;
      fallback = { node: current, offset: length };
      if (safeTargetOffset <= traversed + length) {
        return { node: current, offset: clamp(safeTargetOffset - traversed, 0, length) };
      }
      traversed += length;
    }

    return fallback;
  }

  const prefix = canonicalText.slice(0, safeTargetOffset);
  const lineBreaks = prefix.match(/\n/g);
  const lineIndex = lineBreaks ? lineBreaks.length : 0;
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const column = safeTargetOffset - lineStart;

  const paragraphIndex = clamp(lineIndex, 0, paragraphs.length - 1);
  const paragraph = paragraphs[paragraphIndex];
  const textNodes = collectParagraphTextNodes(paragraph);

  if (textNodes.length === 0) {
    return paragraphStartPoint(paragraph, textNodes);
  }

  let remaining = Math.max(0, column);
  for (const node of textNodes) {
    const length = node.data.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }

  return paragraphEndPoint(paragraph, textNodes);
}

function isTrimmedSelectionEqual(a: EditorSelectionState, b: EditorSelectionState): boolean {
  return a.anchor === b.anchor &&
    a.focus === b.focus &&
    a.start === b.start &&
    a.end === b.end &&
    a.isCollapsed === b.isCollapsed;
}

export function trimSelectionTrailingSpaces(selection: EditorSelectionState, text: string): EditorSelectionState {
  if (selection.isCollapsed) {
    return selection;
  }

  const safeLength = Math.max(0, text.length);
  const safeStart = clamp(selection.start, 0, safeLength);
  const safeEnd = clamp(selection.end, 0, safeLength);
  if (safeEnd <= safeStart) {
    return {
      anchor: safeStart,
      focus: safeStart,
      start: safeStart,
      end: safeStart,
      isCollapsed: true,
    };
  }

  const selectedText = text.slice(safeStart, safeEnd);
  const trailingSpaces = selectedText.length - selectedText.replace(/ +$/u, '').length;
  if (trailingSpaces <= 0) {
    return selection;
  }

  const trimmedEnd = Math.max(safeStart, safeEnd - trailingSpaces);
  if (trimmedEnd === safeEnd) {
    return selection;
  }

  const isForward = selection.anchor <= selection.focus;
  const anchor = isForward ? safeStart : trimmedEnd;
  const focus = isForward ? trimmedEnd : safeStart;

  return {
    anchor,
    focus,
    start: safeStart,
    end: trimmedEnd,
    isCollapsed: safeStart === trimmedEnd,
  };
}

export function applySelectionStateToDom(rootEl: HTMLElement, canonicalText: string, selection: EditorSelectionState): boolean {
  const anchorPoint = resolveDomPointForTextOffset(rootEl, canonicalText, selection.anchor);
  const focusPoint = resolveDomPointForTextOffset(rootEl, canonicalText, selection.focus);
  if (!anchorPoint || !focusPoint) {
    return false;
  }

  const domSelection = window.getSelection();
  if (!domSelection) {
    return false;
  }

  const range = document.createRange();
  range.setStart(anchorPoint.node, anchorPoint.offset);
  range.setEnd(focusPoint.node, focusPoint.offset);

  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return true;
}

export function readSelectionStateFromDom(
  rootEl: HTMLElement,
  domSelection: Selection | null,
  textLength: number,
): EditorSelectionState {
  if (!domSelection || domSelection.rangeCount === 0) return EMPTY_SELECTION;

  const anchorNode = domSelection.anchorNode;
  const focusNode = domSelection.focusNode;
  if (!anchorNode || !focusNode) return EMPTY_SELECTION;

  if (!rootEl.contains(anchorNode) || !rootEl.contains(focusNode)) return EMPTY_SELECTION;

  const safeTextLength = Math.max(0, textLength);
  const anchorRaw = getOffsetWithinRoot(rootEl, anchorNode, domSelection.anchorOffset);
  const focusRaw = getOffsetWithinRoot(rootEl, focusNode, domSelection.focusOffset);
  const anchor = clamp(anchorRaw, 0, safeTextLength);
  const focus = clamp(focusRaw, 0, safeTextLength);
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);

  return {
    anchor,
    focus,
    start,
    end,
    isCollapsed: start === end,
  };
}

export function trimSelectionStateForText(
  selection: EditorSelectionState,
  text: string,
): EditorSelectionState {
  const trimmed = trimSelectionTrailingSpaces(selection, text);
  return isTrimmedSelectionEqual(trimmed, selection) ? selection : trimmed;
}

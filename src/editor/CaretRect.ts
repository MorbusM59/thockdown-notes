export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  // Tracks which geometry source produced the rect for downstream policy decisions.
  source: 'primary' | 'client-rect' | 'adjacent-probe' | 'anchor-fallback' | 'wrap-boundary-downstream';
}

function rectFromDomRect(
  rect: DOMRect | ClientRect,
  source: SelectionRect['source'],
): SelectionRect {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    source,
  };
}

function isUsableRect(rect: SelectionRect): boolean {
  return Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && (rect.bottom - rect.top) > 0;
}

function pointAtRectEdge(rect: SelectionRect, edge: 'left' | 'right'): SelectionRect {
  const x = edge === 'right' ? rect.right : rect.left;
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: x,
    right: x,
    source: 'adjacent-probe',
  };
}

function tryProbeRangeRect(probe: Range): SelectionRect | null {
  const rect = rectFromDomRect(probe.getBoundingClientRect(), 'adjacent-probe');
  return isUsableRect(rect) ? rect : null;
}

function readCollapsedCaretFromAdjacentContent(range: Range): SelectionRect | null {
  // Browser range rects can be zero-sized at collapsed caret positions in trailing empty lines.
  // Probe adjacent rendered content to recover row-aligned geometry without mutating DOM.
  // Downstream (the character after the caret) is tried first, matching the policy that a
  // caret at an ambiguous line-join boundary always renders on the new line, not the old one.
  const container = range.startContainer;
  const offset = range.startOffset;

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container as Text;
    const len = text.data.length;

    if (offset < len) {
      const probe = range.cloneRange();
      probe.setStart(text, offset);
      probe.setEnd(text, offset + 1);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'left');
    }

    if (offset > 0) {
      const probe = range.cloneRange();
      probe.setStart(text, offset - 1);
      probe.setEnd(text, offset);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'right');
    }
  }

  if (container.nodeType === Node.ELEMENT_NODE) {
    const element = container as Element;
    const childCount = element.childNodes.length;

    if (offset < childCount) {
      const after = element.childNodes[offset];
      const probe = range.cloneRange();
      probe.selectNode(after);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'left');
    }

    if (offset > 0 && offset - 1 < childCount) {
      const before = element.childNodes[offset - 1];
      const probe = range.cloneRange();
      probe.selectNode(before);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'right');
    }
  }

  return null;
}

// Walks up from `node` to the paragraph element (a direct child of rootEl)
// that contains it -- mirrors the same "top-level child" notion used for
// selection/offset mapping elsewhere (see BlockSelectionPlugin's
// findTopLevelChild and SelectionOffsets' paragraph walking).
function findParagraphElement(rootEl: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current.parentElement !== rootEl) {
    current = current.parentElement;
  }
  return current instanceof HTMLElement ? current : null;
}

// Finds a single-character Range immediately before/after (node, offset),
// searching across sibling text nodes and through wrapper elements (e.g. the
// <span> Lexical's TextNode/ThockdownTokenNode wrap each text run in) when the
// current text node is exhausted. Stops at a childless leaf element -- e.g. a
// <br> inserted by shift+Enter -- rather than tunnel through it: that boundary
// is a real, unambiguous hard line break, not a soft-wrap join, and treating
// it as one would move an already-correct caret to the wrong row.
function adjacentCharacterRange(
  paragraphEl: HTMLElement,
  node: Node,
  offset: number,
  direction: 'forward' | 'backward',
): Range | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (direction === 'forward' && offset < text.data.length) {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range;
    }
    if (direction === 'backward' && offset > 0) {
      const range = document.createRange();
      range.setStart(text, offset - 1);
      range.setEnd(text, offset);
      return range;
    }
  }

  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  walker.currentNode = node;

  for (;;) {
    const next = direction === 'forward' ? walker.nextNode() : walker.previousNode();
    if (!next) return null;

    if (next.nodeType === Node.TEXT_NODE) {
      const text = next as Text;
      if (text.data.length === 0) continue;

      const range = document.createRange();
      if (direction === 'forward') {
        range.setStart(text, 0);
        range.setEnd(text, 1);
      } else {
        range.setStart(text, text.data.length - 1);
        range.setEnd(text, text.data.length);
      }
      return range;
    }

    // Wrapper elements (e.g. a TextNode's <span>) have children and get
    // tunneled through automatically as the walker descends on the next
    // iteration; a childless element is real, leaf content -- stop.
    if (next.childNodes.length === 0) {
      return null;
    }
  }
}

function rowIndexOf(top: number, lineHeightPx: number): number {
  return Math.round(top / lineHeightPx);
}

function rectFromCharacterRange(range: Range): SelectionRect | null {
  const rect = rectFromDomRect(range.getBoundingClientRect(), 'wrap-boundary-downstream');
  return isUsableRect(rect) ? rect : null;
}

// A collapsed caret at a soft-wrap boundary is simultaneously "end of the
// previous visual line" and "start of the new one" -- the same text offset,
// two different rows. Chromium resolves this internally (with no API to
// query or override which side it picked) and range.getBoundingClientRect()
// for the collapsed caret can come back as a perfectly valid rect that is
// simply on the wrong (previous) row. Since the actual next character must
// render somewhere real and unambiguous, comparing its row against the
// caret's own gives an authoritative answer: if they disagree, the caret
// belongs on the new line (the always-downstream policy), not the old one.
function resolveCollapsedCaretRect(
  range: Range,
  rootEl: HTMLElement | null | undefined,
  primary: SelectionRect,
  lineHeightPx: number,
): SelectionRect {
  if (!rootEl || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return primary;
  }

  const paragraphEl = findParagraphElement(rootEl, range.startContainer);
  if (!paragraphEl) return primary;

  const nextRange = adjacentCharacterRange(paragraphEl, range.startContainer, range.startOffset, 'forward');
  if (!nextRange) return primary;

  const nextRect = rectFromCharacterRange(nextRange);
  if (!nextRect) return primary;

  if (rowIndexOf(primary.top, lineHeightPx) === rowIndexOf(nextRect.top, lineHeightPx)) {
    return primary;
  }

  // Self-consistency check: confirm the character immediately behind the
  // caret still agrees with the primary rect's row. If it doesn't, the
  // disagreement isn't the "parked upstream of a wrap" pattern this is meant
  // to catch, so leave the geometry alone rather than guess.
  const prevRange = adjacentCharacterRange(paragraphEl, range.startContainer, range.startOffset, 'backward');
  if (prevRange) {
    const prevRect = rectFromCharacterRange(prevRange);
    if (prevRect && rowIndexOf(prevRect.top, lineHeightPx) !== rowIndexOf(primary.top, lineHeightPx)) {
      return primary;
    }
  }

  return {
    top: nextRect.top,
    bottom: nextRect.bottom,
    left: nextRect.left,
    right: nextRect.left,
    source: 'wrap-boundary-downstream',
  };
}

export function readSelectionRect(
  selection: Selection,
  fallbackLineHeightPx: number,
  rootEl?: HTMLElement | null,
): SelectionRect | null {
  if (selection.rangeCount === 0) return null;

  // Fallback order is intentionally non-mutating:
  // 1) range rect, 2) client rect list, 3) adjacent content probes, 4) anchor element box.
  const range = selection.getRangeAt(0);
  const primary = rectFromDomRect(range.getBoundingClientRect(), 'primary');
  if (isUsableRect(primary)) {
    if (range.collapsed) {
      return resolveCollapsedCaretRect(range, rootEl, primary, fallbackLineHeightPx);
    }
    return primary;
  }

  const rectList = range.getClientRects();
  if (rectList.length > 0) {
    const lastRect = rectFromDomRect(rectList[rectList.length - 1], 'client-rect');
    if (isUsableRect(lastRect)) return lastRect;
  }

  if (range.collapsed) {
    const adjacent = readCollapsedCaretFromAdjacentContent(range);
    if (adjacent) return adjacent;
  }

  // Last resort: use anchor element box with line-height-sized caret box.
  const anchorNode = selection.anchorNode;
  const element = anchorNode?.nodeType === Node.ELEMENT_NODE
    ? (anchorNode as Element)
    : anchorNode?.parentElement;
  if (!element) return null;

  const fallback = element.getBoundingClientRect();
  if (!Number.isFinite(fallback.top) || !Number.isFinite(fallback.left)) return null;

  return {
    top: fallback.top,
    bottom: fallback.top + fallbackLineHeightPx,
    left: fallback.left,
    right: fallback.left,
    source: 'anchor-fallback',
  };
}

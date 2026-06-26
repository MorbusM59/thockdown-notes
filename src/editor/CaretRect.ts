export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  // Tracks which geometry source produced the rect for downstream policy decisions.
  source: 'primary' | 'client-rect' | 'adjacent-probe' | 'anchor-fallback';
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
  const container = range.startContainer;
  const offset = range.startOffset;

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container as Text;
    const len = text.data.length;

    if (offset > 0) {
      const probe = range.cloneRange();
      probe.setStart(text, offset - 1);
      probe.setEnd(text, offset);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'right');
    }

    if (offset < len) {
      const probe = range.cloneRange();
      probe.setStart(text, offset);
      probe.setEnd(text, offset + 1);
      const rect = tryProbeRangeRect(probe);
      if (rect) return pointAtRectEdge(rect, 'left');
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

export function readSelectionRect(selection: Selection, fallbackLineHeightPx: number): SelectionRect | null {
  if (selection.rangeCount === 0) return null;

  // Fallback order is intentionally non-mutating:
  // 1) range rect, 2) client rect list, 3) adjacent content probes, 4) anchor element box.
  const range = selection.getRangeAt(0);
  const primary = rectFromDomRect(range.getBoundingClientRect(), 'primary');
  if (isUsableRect(primary)) return primary;

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

export interface SelectionLineRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const SAME_LINE_TOLERANCE_PX = 2;

/**
 * One rect per visual line covering exactly the CHARACTERS the range selects.
 *
 * Measured from the text nodes inside the range, never from the range as a
 * whole: `Range.getClientRects()` also returns the border box of every
 * element the range contains completely, and a fully-selected line element
 * is a block as wide as the editor. That painted every line strictly inside
 * a selection edge to edge, empty space included, while the first and last
 * lines (only partly contained, so contributing text rects alone) stopped at
 * their characters. A space is a character and is covered like any other;
 * the space after a line's last character is not, and neither is an empty
 * line, which has no text node at all.
 *
 * A selection crossing syntax-highlighted spans yields several rects per
 * line; they are collapsed to the outer left/right bound per line.
 */
export function readSelectionLineRects(range: Range): SelectionLineRect[] {
  const lines: SelectionLineRect[] = [];

  for (const rect of readCharacterRects(range)) {
    if (!(Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.width > 0 && rect.height > 0)) continue;
    const existing = lines.find((line) => Math.abs(line.top - rect.top) < SAME_LINE_TOLERANCE_PX);
    if (existing) {
      existing.left = Math.min(existing.left, rect.left);
      existing.right = Math.max(existing.right, rect.right);
      existing.top = Math.min(existing.top, rect.top);
      existing.bottom = Math.max(existing.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }

  return lines;
}

/** The client rects of the selected part of every text node the range touches. */
function readCharacterRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const rects: DOMRect[] = [];
  const measure = (node: Text) => {
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (to <= from) return;
    const piece = document.createRange();
    piece.setStart(node, from);
    piece.setEnd(node, to);
    rects.push(...Array.from(piece.getClientRects()));
  };

  if (root.nodeType === Node.TEXT_NODE) {
    measure(root as Text);
    return rects;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) measure(node as Text);
  }
  return rects;
}

export interface SelectionLineRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const SAME_LINE_TOLERANCE_PX = 2;

/**
 * Groups a Range's client rects into one rect per visual line. A selection
 * crossing syntax-highlighted spans yields multiple (sometimes duplicate)
 * rects per line -- collapse them to the outer left/right bound per line.
 */
export function readSelectionLineRects(range: Range): SelectionLineRect[] {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.width > 0 && rect.height > 0,
  );

  const lines: SelectionLineRect[] = [];

  for (const rect of rects) {
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

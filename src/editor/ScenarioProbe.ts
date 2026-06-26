import { readSelectionRect } from './CaretRect';
import { LINE_HEIGHT_PX } from './LayoutConstants';

export interface CaretGeometry {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function readCaretGeometry(): CaretGeometry | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = readSelectionRect(selection, LINE_HEIGHT_PX);
  if (!rect) return null;

  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

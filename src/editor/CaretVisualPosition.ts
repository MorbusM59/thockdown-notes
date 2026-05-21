import type { SelectionRect } from './CaretRect';
import { getTerminalTrailingVisualOffsetPx } from './CaretTerminalOffset';

interface CaretTopInScrollInput {
  caretRect: SelectionRect;
  scrollerRectTop: number;
  scrollerScrollTop: number;
  rootEl: HTMLElement | null;
  domSelection: Selection | null;
  rawText: string;
  lineHeightPx: number;
}

export function resolveCaretTopInScroll(input: CaretTopInScrollInput): number {
  const {
    caretRect,
    scrollerRectTop,
    scrollerScrollTop,
    rootEl,
    domSelection,
    rawText,
    lineHeightPx,
  } = input;

  const terminalVisualOffsetPx = getTerminalTrailingVisualOffsetPx({
    caretRect,
    rootEl,
    domSelection,
    rawText,
    lineHeightPx,
  });

  return (caretRect.top - scrollerRectTop) + scrollerScrollTop + terminalVisualOffsetPx;
}

import type { SelectionRect } from './CaretRect';
import { normalizePlainText, readSelectionStateFromDom } from './SelectionOffsets';

interface TerminalOffsetInput {
  caretRect: SelectionRect;
  rootEl: HTMLElement | null;
  domSelection: Selection | null;
  rawText: string;
  lineHeightPx: number;
}

export function getTerminalTrailingVisualOffsetPx(input: TerminalOffsetInput): number {
  const { caretRect, rootEl, domSelection, rawText, lineHeightPx } = input;

  if (!rootEl || !domSelection) return 0;
  // Apply only when caret geometry came from fallback sources; primary rects are authoritative.
  if (caretRect.source !== 'adjacent-probe' && caretRect.source !== 'anchor-fallback') return 0;

  const normalizedText = normalizePlainText(rawText);
  const selectionState = readSelectionStateFromDom(rootEl, domSelection, normalizedText.length);
  const trailingNewlines = normalizedText.match(/\n+$/)?.[0].length ?? 0;
  const trailingExtraRows = Math.max(0, trailingNewlines - 1);

  if (!selectionState.isCollapsed) return 0;
  if (selectionState.anchor !== normalizedText.length) return 0;
  if (trailingExtraRows === 0) return 0;

  // Keep selection untouched; this is visual-position compensation only.
  return trailingExtraRows * lineHeightPx;
}

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

function getOffsetWithinRoot(rootEl: HTMLElement, node: Node, offset: number): number {
  try {
    const range = document.createRange();
    range.setStart(rootEl, 0);
    range.setEnd(node, offset);
    return normalizePlainText(range.toString()).length;
  } catch {
    // Invalid DOM positions can happen briefly during editor updates.
    return 0;
  }
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

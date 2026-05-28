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

function getOffsetWithinContainer(container: Node, node: Node, offset: number): number {
  try {
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(node, offset);
    return normalizePlainText(range.toString()).length;
  } catch {
    return 0;
  }
}

function getOffsetWithinRoot(rootEl: HTMLElement, node: Node, offset: number): number {
  const paragraphs = Array.from(rootEl.children);
  if (paragraphs.length === 0) {
    return getOffsetWithinContainer(rootEl, node, offset);
  }

  let accumulated = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph.contains(node) || paragraph === node) {
      return accumulated + getOffsetWithinContainer(paragraph, node, offset);
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

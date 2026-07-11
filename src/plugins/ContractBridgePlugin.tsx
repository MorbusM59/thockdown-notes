import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useRef } from 'react';
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  SELECTION_CHANGE_COMMAND,
  SKIP_SELECTION_FOCUS_TAG,
} from 'lexical';
import type {
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorTextChangeEvent,
} from '../editor/EditorContract';
import { canonicalizeParagraphSegments } from '../editor/TextPolicy';
import {
  applySelectionStateToDom,
  EMPTY_SELECTION,
  readSelectionOffsetFromClientPoint,
  readSelectionStateFromDom,
} from '../editor/SelectionOffsets';

interface ContractBridgePluginProps {
  onTextChange: (event: EditorTextChangeEvent) => void;
  onSelectionChange: (event: EditorSelectionChangeEvent) => void;
  onTabIndent?: (event: { shiftKey: boolean }) => void;
  onTabIndentTransform?: (event: {
    shiftKey: boolean;
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
  onMarkdownShortcutTransform?: (event: {
    shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list';
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
  onCharacterInsertTransform?: (event: {
    char: string;
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
  onEnterTransform?: (event: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
}

const SENTENCE_ENDING_PUNCTUATION = new Set(['.', '!', '?', ':']);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const isWhitespace = (char: string) => /\s/u.test(char);

const isSentenceBoundary = (char: string) => char === '\n' || SENTENCE_ENDING_PUNCTUATION.has(char);

const trimWhitespaceRange = (text: string, start: number, end: number) => {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && isWhitespace(text[nextStart])) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && isWhitespace(text[nextEnd - 1])) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
};

const trimMatchingAsteriskPairs = (text: string, start: number, end: number) => {
  let nextStart = start;
  let nextEnd = end;

  while (
    nextEnd - nextStart >= 3 &&
    text[nextStart] === '*' &&
    text[nextEnd - 1] === '*'
  ) {
    nextStart += 1;
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
};

const isPairOpener = (char: string) => PAIR_OPENERS[char] !== undefined;
const isPairCloser = (char: string) => REVERSE_PAIR_OPENERS[char] !== undefined;

const isAdjacentPairBoundary = (text: string, index: number) => {
  return index > 0 && index < text.length
    && isPairCloser(text[index - 1])
    && isPairOpener(text[index]);
};

const PAIR_OPENERS: Record<string, string> = {
  '[': ']',
  '(': ')',
  '{': '}',
  '<': '>',
  '"': '"',
  "'": "'",
};

const findMatchingCloser = (
  text: string,
  openerIndex: number,
  closer: string,
): number | null => {
  let balance = 0;
  for (let index = openerIndex + 1; index < text.length; index += 1) {
    const current = text[index];
    if (current === text[openerIndex] && current !== closer) {
      balance += 1;
      continue;
    }
    if (current === closer) {
      if (balance === 0) {
        return index;
      }
      balance -= 1;
    }
  }
  return null;
};

const REVERSE_PAIR_OPENERS: Record<string, string> = Object.entries(PAIR_OPENERS).reduce(
  (accumulator, [pairOpener, pairCloser]) => {
    accumulator[pairCloser] = pairOpener;
    return accumulator;
  },
  {} as Record<string, string>,
);

const findMatchingOpener = (
  text: string,
  closerIndex: number,
  opener: string,
): number | null => {
  const closer = text[closerIndex];
  let balance = 0;
  for (let index = closerIndex - 1; index >= 0; index -= 1) {
    const current = text[index];
    if (current === closer && current !== opener) {
      balance += 1;
      continue;
    }
    if (current === opener) {
      if (balance === 0) {
        return index;
      }
      balance -= 1;
    }
  }
  return null;
};

// Strips a single leading/trailing bounding character that doesn't pair up within
// [start, end) — e.g. a word range that grabbed an adjacent "[" whose matching "]"
// lives outside the current range. Matching is checked across the full text: a
// character with no partner anywhere is left alone (it's not a stray pair edge,
// just an unbalanced character), only one that closes/opens *outside* the range
// gets trimmed. This gives us the intersection of the regular expansion and the
// pair-aware expansion instead of blindly keeping the dangling character.
const trimStrayBoundingCharacters = (
  text: string,
  start: number,
  end: number,
) => {
  let nextStart = start;
  let nextEnd = end;

  if (nextEnd - nextStart > 0) {
    const firstChar = text[nextStart];
    const expectedCloser = PAIR_OPENERS[firstChar];
    if (expectedCloser) {
      const matchIndex = findMatchingCloser(text, nextStart, expectedCloser);
      if (matchIndex !== null && matchIndex >= nextEnd) {
        if (matchIndex !== nextEnd || text[nextEnd] !== expectedCloser) {
          nextStart += 1;
        }
      }
    }
  }

  if (nextEnd - nextStart > 0) {
    const lastChar = text[nextEnd - 1];
    const expectedOpener = REVERSE_PAIR_OPENERS[lastChar];
    if (expectedOpener) {
      const matchIndex = findMatchingOpener(text, nextEnd - 1, expectedOpener);
      if (matchIndex !== null && matchIndex < nextStart) {
        if (matchIndex !== nextStart - 1 || text[nextStart - 1] !== expectedOpener) {
          nextEnd -= 1;
        }
      }
    }
  }

  return { start: nextStart, end: nextEnd };
};

export const resolvePairAwareRange = (
  text: string,
  regularRange: { start: number; end: number },
  currentSelection?: EditorSelectionState,
) => {
  const { start: rangeStart, end: rangeEnd } = regularRange;
  if (rangeStart + 1 >= rangeEnd) {
    return null;
  }

  const opener = text[rangeStart];
  const closer = text[rangeEnd - 1];
  const expectedCloser = PAIR_OPENERS[opener];
  if (expectedCloser && expectedCloser === closer) {
    const secondary = { start: rangeStart + 1, end: rangeEnd - 1 };

    if (
      currentSelection &&
      !currentSelection.isCollapsed &&
      currentSelection.start === secondary.start &&
      currentSelection.end === secondary.end
    ) {
      return regularRange;
    }

    return secondary;
  }

  // Neither end is a fully-balanced pair. Before falling back to the raw range,
  // check whether one end is a lone bounding character whose partner exists but
  // lies outside this range — if so, exclude it rather than dragging it along.
  const strayTrimmed = trimStrayBoundingCharacters(text, rangeStart, rangeEnd);
  if (strayTrimmed.start !== rangeStart || strayTrimmed.end !== rangeEnd) {
    return strayTrimmed;
  }

  if (!currentSelection || currentSelection.isCollapsed) {
    return null;
  }

  const searchStart = Math.min(currentSelection.start - 1, rangeEnd - 2);

  // If the regular range is bounded immediately by a matching pair, and the
  // current selection already covers the full inner content, allow the next
  // expansion to wrap out to the enclosing pair.
  if (rangeStart > 0 && rangeEnd < text.length) {
    const enclosingOpener = text[rangeStart - 1];
    const enclosingCloser = text[rangeEnd];
    const expectedCloser = PAIR_OPENERS[enclosingOpener];
    if (expectedCloser && expectedCloser === enclosingCloser) {
      const inner = { start: rangeStart, end: rangeEnd };
      if (
        currentSelection.start === inner.start &&
        currentSelection.end === inner.end
      ) {
        return { start: rangeStart - 1, end: rangeEnd + 1 };
      }
    }
  }
  for (let openerIndex = searchStart; openerIndex >= rangeStart; openerIndex -= 1) {
    const openerChar = text[openerIndex];
    const closerChar = PAIR_OPENERS[openerChar];
    if (!closerChar) {
      continue;
    }

    const closerIndex = findMatchingCloser(text, openerIndex, closerChar);
    if (closerIndex === null) {
      continue;
    }
    if (closerIndex < currentSelection.end || closerIndex > rangeEnd) {
      continue;
    }

    const inner = { start: openerIndex + 1, end: closerIndex };
    if (inner.start >= rangeStart && inner.end <= rangeEnd) {
      if (
        currentSelection.start === inner.start &&
        currentSelection.end === inner.end
      ) {
        const outer = { start: openerIndex, end: closerIndex + 1 };
        return outer;
      }
      return inner;
    }
  }

  return null;
};

const normalizeAnchor = (
  text: string,
  offset: number,
  predicate: (char: string) => boolean,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return 0;
  }

  const initial = clamp(offset, 0, safeLength - 1);
  if (!predicate(text[initial])) {
    return initial;
  }

  let right = initial;
  while (right < safeLength && predicate(text[right])) {
    right += 1;
  }
  if (right < safeLength) {
    return right;
  }

  let left = initial - 1;
  while (left >= 0 && predicate(text[left])) {
    left -= 1;
  }
  if (left >= 0) {
    return left;
  }

  return clamp(offset, 0, safeLength);
};


export const resolveWordRange = (
  text: string,
  offset: number,
  currentSelection?: EditorSelectionState,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const boundary = (char: string) => isWhitespace(char) || isSentenceBoundary(char);
  const anchor = normalizeAnchor(text, offset, boundary);
  if (anchor >= safeLength) {
    return { start: safeLength, end: safeLength };
  }

  let start = anchor;
  while (start > 0 && !boundary(text[start - 1]) && !isAdjacentPairBoundary(text, start)) {
    start -= 1;
  }

  let end = anchor + 1;
  while (end < safeLength && !boundary(text[end])) {
    if (end + 1 < safeLength && isAdjacentPairBoundary(text, end + 1)) {
      end += 1;
      break;
    }
    end += 1;
  }

  const whitespaceTrimmed = trimWhitespaceRange(text, start, end);
  const regularRange = trimMatchingAsteriskPairs(
    text,
    whitespaceTrimmed.start,
    whitespaceTrimmed.end,
  );

  const pairAware = resolvePairAwareRange(text, regularRange, currentSelection);
  if (pairAware !== null) {
    return pairAware;
  }

  return regularRange;
};

export type SelectionScope = 'word' | 'sentence' | 'line' | 'block';

const resolveSentenceRange = (
  text: string,
  offset: number,
  currentSelection?: EditorSelectionState,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const anchor = normalizeAnchor(text, offset, isWhitespace);
  const safeAnchor = clamp(anchor, 0, Math.max(0, safeLength - 1));

  let guardOpener = -1;
  let guardCloser = safeLength;
  for (let index = safeAnchor - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (!isPairOpener(char)) {
      continue;
    }

    const closerIndex = findMatchingCloser(text, index, PAIR_OPENERS[char]);
    if (closerIndex !== null && closerIndex > safeAnchor) {
      guardOpener = index;
      guardCloser = closerIndex;
      break;
    }
  }

  if (
    guardOpener >= 0 &&
    currentSelection &&
    !currentSelection.isCollapsed &&
    currentSelection.start === guardOpener + 1 &&
    currentSelection.end === guardCloser
  ) {
    return { start: guardOpener, end: guardCloser + 1 };
  }

  let startBoundary = -1;
  let rightGuard = safeLength;
  for (let index = safeAnchor - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (isSentenceBoundary(char)) {
      startBoundary = index;
      break;
    }

    if (index === guardOpener) {
      startBoundary = index;
      rightGuard = guardCloser;
      break;
    }
  }

  let endBoundary = -1;
  let endBoundaryIsGuard = false;
  for (let index = safeAnchor; index < safeLength; index += 1) {
    if (index >= rightGuard) {
      endBoundary = rightGuard;
      endBoundaryIsGuard = true;
      break;
    }

    const char = text[index];
    if (isSentenceBoundary(char)) {
      endBoundary = index;
      endBoundaryIsGuard = false;
      break;
    }

    if (isPairCloser(char)) {
      const openerIndex = findMatchingOpener(text, index, REVERSE_PAIR_OPENERS[char]);
      if (openerIndex !== null && openerIndex < safeAnchor) {
        endBoundary = index;
        endBoundaryIsGuard = false;
        if (openerIndex > startBoundary) {
          startBoundary = openerIndex;
        }
        break;
      }
    }
  }

  const start = startBoundary + 1;
  const end = endBoundary >= 0
    ? (endBoundaryIsGuard ? endBoundary : endBoundary + 1)
    : rightGuard;
  return trimWhitespaceRange(text, start, end);
};

const resolveLineRange = (text: string, offset: number) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const safeOffset = clamp(offset, 0, safeLength);
  const start = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const endBoundary = text.indexOf('\n', safeOffset);
  const end = endBoundary >= 0 ? endBoundary : safeLength;
  return { start, end };
};

const resolveLineIndexForOffset = (lineStarts: number[], offset: number, textLength: number) => {
  const safeOffset = clamp(offset, 0, textLength);
  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] <= safeOffset) {
      lineIndex = index;
    } else {
      break;
    }
  }
  return lineIndex;
};

const resolveBlockRange = (text: string, offset: number) => {
  const lines = text.split('\n');
  if (lines.length === 0) {
    return { start: 0, end: 0 };
  }

  const lineStarts: number[] = [];
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineStarts.push(cursor);
    cursor += lines[index].length;
    if (index < lines.length - 1) {
      cursor += 1;
    }
  }

  const currentLineIndex = resolveLineIndexForOffset(lineStarts, offset, text.length);

  let startLine = currentLineIndex;
  while (startLine > 0 && lines[startLine - 1].trim().length > 0) {
    startLine -= 1;
  }

  let endLine = currentLineIndex;
  while (endLine < lines.length - 1 && lines[endLine + 1].trim().length > 0) {
    endLine += 1;
  }

  const start = lineStarts[startLine];
  const end = lineStarts[endLine] + lines[endLine].length;
  return { start, end };
};

export const isSameRange = (
  left: { start: number; end: number },
  right: { start: number; end: number },
) => left.start === right.start && left.end === right.end;

const isPairAwareRewrap = (
  text: string,
  regularRange: { start: number; end: number },
  currentSelection: EditorSelectionState | null,
) => {
  if (!currentSelection || currentSelection.isCollapsed) {
    return false;
  }

  const opener = text[regularRange.start];
  const closer = text[regularRange.end - 1];
  const expectedCloser = PAIR_OPENERS[opener];
  if (!expectedCloser || expectedCloser !== closer) {
    return false;
  }

  const secondary = { start: regularRange.start + 1, end: regularRange.end - 1 };
  return currentSelection.start === secondary.start && currentSelection.end === secondary.end;
};

export const resolveScopeRange = (
  scope: SelectionScope,
  text: string,
  offset: number,
  currentSelection: EditorSelectionState | null,
) => {
  let regularRange;
  if (scope === 'word') {
    regularRange = resolveWordRange(text, offset, currentSelection ?? undefined);
  } else if (scope === 'sentence') {
    regularRange = resolveSentenceRange(text, offset, currentSelection ?? undefined);
  } else if (scope === 'line') {
    regularRange = resolveLineRange(text, offset);
  } else {
    regularRange = resolveBlockRange(text, offset);
  }

  const pairAware = resolvePairAwareRange(text, regularRange, currentSelection ?? undefined);
  const range = pairAware ?? regularRange;
  const isPairAwareAdjustment = pairAware !== null && (
    !isSameRange(pairAware, regularRange) || isPairAwareRewrap(text, regularRange, currentSelection)
  );
  return { range, isPairAwareAdjustment };
};

function resolveChangeSource(tags: Set<string>): EditorTextChangeEvent['source'] {
  if (tags.has('restore')) return 'programmatic';
  if (tags.has('history-redo')) return 'history-redo';
  if (tags.has('historic')) return 'history-undo';
  return 'user-input';
}

function readCanonicalRootText(): string {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length === 0) {
    return '';
  }

  // Canonical model: one LF separator between logical paragraphs.
  return canonicalizeParagraphSegments(
    children.map((child) => child.getTextContent()),
  );
}

function replaceEditorTextFromCanonical(nextText: string): void {
  $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
  const root = $getRoot();
  root.clear();

  const lines = nextText.split('\n');
  if (lines.length === 0) {
    root.append($createParagraphNode());
    return;
  }

  for (const line of lines) {
    const paragraph = $createParagraphNode();
    if (line.length > 0) {
      paragraph.append($createTextNode(line));
    }
    root.append(paragraph);
  }
}

export function ContractBridgePlugin({
  onTextChange,
  onSelectionChange,
  onTabIndent,
  onTabIndentTransform,
  onMarkdownShortcutTransform,
  onCharacterInsertTransform,
  onEnterTransform,
}: ContractBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>(EMPTY_SELECTION);
  const selectionRafRef = useRef<number | null>(null);
  const selectionRefreshRafRef = useRef<number | null>(null);
  const pendingSelectionSourceRef = useRef<EditorTextChangeEvent['source']>('user-input');
  const rightClickCycleRef = useRef<{
    scope: SelectionScope;
    start: number;
    end: number;
    retrySameScope: boolean;
  } | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onTabIndentRef = useRef(onTabIndent);
  const onTabIndentTransformRef = useRef(onTabIndentTransform);
  const onMarkdownShortcutTransformRef = useRef(onMarkdownShortcutTransform);
  const onCharacterInsertTransformRef = useRef(onCharacterInsertTransform);
  const onEnterTransformRef = useRef(onEnterTransform);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
    onSelectionChangeRef.current = onSelectionChange;
    onTabIndentRef.current = onTabIndent;
    onTabIndentTransformRef.current = onTabIndentTransform;
    onMarkdownShortcutTransformRef.current = onMarkdownShortcutTransform;
    onCharacterInsertTransformRef.current = onCharacterInsertTransform;
    onEnterTransformRef.current = onEnterTransform;
  }, [onTextChange, onSelectionChange, onTabIndent, onTabIndentTransform, onMarkdownShortcutTransform, onCharacterInsertTransform, onEnterTransform]);

  useEffect(() => {
    // Emit stable initial state from current editor content.
    let initialText = '';
    let initialSelection = EMPTY_SELECTION;
    editor.getEditorState().read(() => {
      const normalizedText = readCanonicalRootText();
      initialText = normalizedText;

      const rootEl = editor.getRootElement();
      const lexicalSelection = $getSelection();
      if (rootEl && $isRangeSelection(lexicalSelection)) {
        initialSelection = readSelectionStateFromDom(rootEl, window.getSelection(), normalizedText.length);
      }
    });

    onTextChangeRef.current({
      source: 'initial-load',
      text: initialText,
      previousText: '',
      selection: initialSelection,
    });
    onSelectionChangeRef.current({ source: 'initial-load', selection: initialSelection });
    previousTextRef.current = initialText;
    previousSelectionRef.current = initialSelection;
  }, [editor]);

  useEffect(() => {
    const rootEl = editor.getRootElement();
    if (!rootEl) return;


    const toSelectionState = (start: number, end: number): EditorSelectionState => ({
      anchor: start,
      focus: end,
      start,
      end,
      isCollapsed: start === end,
    });

    const resolveRangeForScope = (
      scope: SelectionScope,
      text: string,
      offset: number,
      currentSelection: EditorSelectionState | null,
    ) => resolveScopeRange(scope, text, offset, currentSelection);

    const resolveNextScope = (current: SelectionScope): SelectionScope => {
      if (current === 'word') return 'sentence';
      if (current === 'sentence') return 'line';
      if (current === 'line') return 'block';
      return 'block';
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();

      let nextSelection = previousSelectionRef.current;

      editor.getEditorState().read(() => {
        const editableRoot = editor.getRootElement();
        if (!editableRoot) {
          return;
        }

        const canonicalText = readCanonicalRootText();
        const currentSelection = readSelectionStateFromDom(
          editableRoot,
          window.getSelection(),
          canonicalText.length,
        );
        const clickOffset = readSelectionOffsetFromClientPoint(
          editableRoot,
          event.clientX,
          event.clientY,
          canonicalText.length,
          currentSelection.end,
        );

        const priorCycle = rightClickCycleRef.current;
        const clickedInsideCurrentSelection = !currentSelection.isCollapsed
          && clickOffset >= currentSelection.start
          && clickOffset < currentSelection.end;
        const canAdvanceScope = priorCycle !== null
          && clickedInsideCurrentSelection
          && priorCycle.start === currentSelection.start
          && priorCycle.end === currentSelection.end;

        const scope = canAdvanceScope && priorCycle !== null
          ? (priorCycle.retrySameScope ? priorCycle.scope : resolveNextScope(priorCycle.scope))
          : 'word';

        let resolvedScope = scope;
        let nextRangeResult = resolveRangeForScope(resolvedScope, canonicalText, clickOffset, currentSelection);
        let nextRange = nextRangeResult.range;
        let nextRangeIsPairAwareAdjusted = nextRangeResult.isPairAwareAdjustment;

        // Avoid consuming clicks on no-op intermediate levels, e.g. sentence == line.
        if (canAdvanceScope) {
          const currentRange = {
            start: currentSelection.start,
            end: currentSelection.end,
          };

          while (isSameRange(nextRange, currentRange) && resolvedScope !== 'block') {
            if (nextRangeResult.isPairAwareAdjustment) {
              break;
            }

            resolvedScope = resolveNextScope(resolvedScope);
            nextRangeResult = resolveRangeForScope(resolvedScope, canonicalText, clickOffset, currentSelection);
            nextRange = nextRangeResult.range;
            nextRangeIsPairAwareAdjusted = nextRangeResult.isPairAwareAdjustment;
          }
        }

        nextSelection = toSelectionState(nextRange.start, nextRange.end);
        const applied = applySelectionStateToDom(editableRoot, canonicalText, nextSelection);
        if (!applied) {
          return;
        }

        rightClickCycleRef.current = {
          scope: resolvedScope,
          start: nextSelection.start,
          end: nextSelection.end,
          retrySameScope: nextRangeIsPairAwareAdjusted,
        };
      });

      previousSelectionRef.current = nextSelection;
      onSelectionChangeRef.current({ source: 'user-input', selection: nextSelection });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0 && event.detail >= 2) {
        // Disable native multi-click expansion. Single-click behavior remains untouched.
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.button === 0) {
        rightClickCycleRef.current = null;
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };

    rootEl.addEventListener('contextmenu', handleContextMenu);
    rootEl.addEventListener('mousedown', handleMouseDown, true);
    rootEl.addEventListener('dblclick', handleDoubleClick, true);

    return () => {
      rootEl.removeEventListener('contextmenu', handleContextMenu);
      rootEl.removeEventListener('mousedown', handleMouseDown, true);
      rootEl.removeEventListener('dblclick', handleDoubleClick, true);
      rightClickCycleRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    const isSameSelection = (a: EditorSelectionState, b: EditorSelectionState) => (
      a.anchor === b.anchor &&
      a.focus === b.focus &&
      a.start === b.start &&
      a.end === b.end &&
      a.isCollapsed === b.isCollapsed
    );

    const emitSelectionIfChanged = (source: EditorTextChangeEvent['source']) => {
      let nextSelection = previousSelectionRef.current;

      editor.getEditorState().read(() => {
        const rootEl = editor.getRootElement();
        const lexicalSelection = $getSelection();
        if (!rootEl || !$isRangeSelection(lexicalSelection)) {
          return;
        }

        const canonicalText = readCanonicalRootText();
        nextSelection = readSelectionStateFromDom(
          rootEl,
          window.getSelection(),
          canonicalText.length,
        );
      });

      const previousSelection = previousSelectionRef.current;
      if (isSameSelection(nextSelection, previousSelection)) {
        return;
      }

      onSelectionChangeRef.current({ source, selection: nextSelection });
      previousSelectionRef.current = nextSelection;
    };

    const scheduleSelectionEmit = (source: EditorTextChangeEvent['source']) => {
      pendingSelectionSourceRef.current = source;
      if (selectionRafRef.current !== null) {
        return;
      }

      selectionRafRef.current = requestAnimationFrame(() => {
        selectionRafRef.current = null;
        emitSelectionIfChanged(pendingSelectionSourceRef.current);
      });
    };

    const refreshSelectionModelFromDom = (source: EditorTextChangeEvent['source']) => {
      if (selectionRefreshRafRef.current !== null) {
        cancelAnimationFrame(selectionRefreshRafRef.current);
      }

      selectionRefreshRafRef.current = requestAnimationFrame(() => {
        selectionRefreshRafRef.current = null;

        let nextSelection = previousSelectionRef.current;
        editor.getEditorState().read(() => {
          const rootEl = editor.getRootElement();
          const lexicalSelection = $getSelection();
          const canonicalText = readCanonicalRootText();
          if (!rootEl || !$isRangeSelection(lexicalSelection)) {
            return;
          }

          nextSelection = readSelectionStateFromDom(rootEl, window.getSelection(), canonicalText.length);
        });

        if (nextSelection.anchor === previousSelectionRef.current.anchor &&
          nextSelection.focus === previousSelectionRef.current.focus &&
          nextSelection.start === previousSelectionRef.current.start &&
          nextSelection.end === previousSelectionRef.current.end &&
          nextSelection.isCollapsed === previousSelectionRef.current.isCollapsed) {
          return;
        }

        previousSelectionRef.current = nextSelection;
        onSelectionChangeRef.current({ source, selection: nextSelection });
      });
    };

    const removeListener = editor.registerUpdateListener(({ editorState, tags }) => {
      editorState.read(() => {
        const normalizedText = readCanonicalRootText();
        const rootEl = editor.getRootElement();
        const lexicalSelection = $getSelection();

        let nextSelection = previousSelectionRef.current;
        if (rootEl && $isRangeSelection(lexicalSelection)) {
          nextSelection = readSelectionStateFromDom(rootEl, window.getSelection(), normalizedText.length);
        }

        const previousText = previousTextRef.current;
        const previousSelection = previousSelectionRef.current;

        const isTransformCommit =
          tags.has('enter-transform') ||
          tags.has('tab-indent') ||
          tags.has('shortcut-transform') ||
          tags.has('character-transform');

        if (normalizedText !== previousText) {
          const source = resolveChangeSource(tags);
          const emittedSelection = isTransformCommit ? previousSelection : nextSelection;

          onTextChangeRef.current({
            source,
            text: normalizedText,
            previousText,
            // Transform commits own their own selection via scheduleTransformSelectionReplay.
            // The DOM selection immediately post-commit is unreliable (Lexical default placement),
            // so report the pre-transform position to avoid poisoning latestEditorSelectionRef.
            selection: emittedSelection,
          });
          previousTextRef.current = normalizedText;
          previousSelectionRef.current = emittedSelection;

          if (!isTransformCommit) {
            refreshSelectionModelFromDom(source);
          }
        }

        if (
          !isTransformCommit && (
            nextSelection.anchor !== previousSelection.anchor ||
            nextSelection.focus !== previousSelection.focus ||
            nextSelection.start !== previousSelection.start ||
            nextSelection.end !== previousSelection.end ||
            nextSelection.isCollapsed !== previousSelection.isCollapsed
          )
        ) {
          scheduleSelectionEmit(resolveChangeSource(tags));
        }
      });
    });

    const removeSelectionCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        scheduleSelectionEmit('user-input');
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    const applyTransformSelectionPreservingScroll = (
      nextText: string,
      nextSelection: EditorSelectionState,
      preservedScrollTopOverride?: number | null,
    ) => {
      const rootEl = editor.getRootElement();
      if (!rootEl) return;

      const scroller = rootEl.closest('.measly-custom-scrollbar');
      const scrollerEl = scroller instanceof HTMLElement ? scroller : null;
      const preservedScrollTop = preservedScrollTopOverride ?? (scrollerEl ? scrollerEl.scrollTop : null);

      const applied = applySelectionStateToDom(rootEl, nextText, nextSelection);
      if (scrollerEl && preservedScrollTop !== null) {
        scrollerEl.scrollTop = preservedScrollTop;
        requestAnimationFrame(() => {
          scrollerEl.scrollTop = preservedScrollTop;
        });
      }

      if (!applied) return;

      previousSelectionRef.current = nextSelection;
      onSelectionChangeRef.current({ source: 'user-input', selection: nextSelection });
    };

    const scheduleTransformSelectionReplay = (
      nextText: string,
      nextSelection: EditorSelectionState,
      preservedScrollTopOverride?: number | null,
    ) => {
      // Commands can run before the editor tree commit is reflected in the DOM.
      // Defer one frame so replay offsets always map against post-transform text.
      requestAnimationFrame(() => {
        applyTransformSelectionPreservingScroll(nextText, nextSelection, preservedScrollTopOverride);
      });
    };

    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        // Never allow Tab/Shift+Tab to escape the editor and trigger focus/menu navigation.
        event.preventDefault();
        event.stopPropagation();

        const transformCallback = onTabIndentTransformRef.current;
        if (transformCallback) {
          let canonicalText = '';
          let currentSelection = previousSelectionRef.current;

          editor.getEditorState().read(() => {
            canonicalText = readCanonicalRootText();
            const rootEl = editor.getRootElement();
            const lexicalSelection = $getSelection();
            if (rootEl && $isRangeSelection(lexicalSelection)) {
              currentSelection = readSelectionStateFromDom(rootEl, window.getSelection(), canonicalText.length);
            }
          });

          const next = transformCallback({
            shiftKey: event.shiftKey,
            text: canonicalText,
            selection: currentSelection,
          });
          if (!next) return true;

          const rootEl = editor.getRootElement();
          const scroller = rootEl?.closest('.measly-custom-scrollbar');
          const scrollerEl = scroller instanceof HTMLElement ? scroller : null;
          const preservedScrollTopAtCommand = scrollerEl ? scrollerEl.scrollTop : null;

          editor.update(() => {
            replaceEditorTextFromCanonical(next.text);
          }, { tag: 'tab-indent' });

          scheduleTransformSelectionReplay(next.text, next.selection, preservedScrollTopAtCommand);

          return true;
        }

        const callback = onTabIndentRef.current;
        if (callback) {
          callback({ shiftKey: event.shiftKey });
        }
        return true;
      },
      COMMAND_PRIORITY_BEFORE_EDITOR,
    );

    const removeMarkdownShortcutCommand = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const characterTransformCallback = onCharacterInsertTransformRef.current;
        const isPlainCharacterInsert =
          !!characterTransformCallback &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing &&
          event.key.length === 1;

        if (isPlainCharacterInsert) {
          let canonicalText = '';
          let currentSelection = previousSelectionRef.current;

          editor.getEditorState().read(() => {
            canonicalText = readCanonicalRootText();
            const rootEl = editor.getRootElement();
            const lexicalSelection = $getSelection();
            if (rootEl && $isRangeSelection(lexicalSelection)) {
              currentSelection = readSelectionStateFromDom(rootEl, window.getSelection(), canonicalText.length);
            }
          });

          const next = characterTransformCallback({
            char: event.key,
            text: canonicalText,
            selection: currentSelection,
          });

          if (next) {
            event.preventDefault();

            const rootEl = editor.getRootElement();
            const scroller = rootEl?.closest('.measly-custom-scrollbar');
            const scrollerEl = scroller instanceof HTMLElement ? scroller : null;
            const preservedScrollTopAtCommand = scrollerEl ? scrollerEl.scrollTop : null;

            editor.update(() => {
              replaceEditorTextFromCanonical(next.text);
            }, { tag: 'character-transform' });

            scheduleTransformSelectionReplay(next.text, next.selection, preservedScrollTopAtCommand);
            return true;
          }
        }

        const callback = onMarkdownShortcutTransformRef.current;
        if (!callback) return false;

        if (!event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }

        let shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list' | null = null;
        const key = event.key.toLowerCase();
        if (!event.shiftKey && key === 'b') {
          shortcut = 'bold';
        } else if (!event.shiftKey && key === 'i') {
          shortcut = 'italic';
        } else if (!event.shiftKey && key === 'j') {
          shortcut = 'strikethrough';
        } else if (!event.shiftKey && key === 'h') {
          shortcut = 'heading-toggle';
        } else if (!event.shiftKey && event.key === '-') {
          shortcut = 'unordered-list';
        } else if ((event.shiftKey && event.key === '3') || event.key === '#') {
          shortcut = 'ordered-list';
        }

        if (!shortcut) return false;

        let canonicalText = '';
        let currentSelection = previousSelectionRef.current;

        editor.getEditorState().read(() => {
          canonicalText = readCanonicalRootText();
          const rootEl = editor.getRootElement();
          const lexicalSelection = $getSelection();
          if (rootEl && $isRangeSelection(lexicalSelection)) {
            currentSelection = readSelectionStateFromDom(rootEl, window.getSelection(), canonicalText.length);
          }
        });

        const next = callback({
          shortcut,
          text: canonicalText,
          selection: currentSelection,
        });

        if (!next) return false;

        event.preventDefault();

        editor.update(() => {
          replaceEditorTextFromCanonical(next.text);
        }, { tag: 'shortcut-transform' });

        scheduleTransformSelectionReplay(next.text, next.selection);

        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        const callback = onEnterTransformRef.current;
        if (!callback) return false;

        let canonicalText = '';
        let currentSelection = previousSelectionRef.current;

        editor.getEditorState().read(() => {
          canonicalText = readCanonicalRootText();
          const rootEl = editor.getRootElement();
          const lexicalSelection = $getSelection();
          if (rootEl && $isRangeSelection(lexicalSelection)) {
            currentSelection = readSelectionStateFromDom(rootEl, window.getSelection(), canonicalText.length);
          }
        });

        const next = callback({
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          text: canonicalText,
          selection: currentSelection,
        });


        if (!next) return false;

        event.preventDefault();

        editor.update(() => {
          replaceEditorTextFromCanonical(next.text);
        }, {
          tag: 'enter-transform',
          onUpdate: () => {
            // Apply DOM selection synchronously post-commit so CagedScrollPlugin's
            // microtask reads the correct caret position for its boundary scroll step.
            // Preserve scrollTop across addRange — the browser natively scrolls the
            // caret into view on addRange, which would stomp CagedScrollPlugin's
            // deterministic scroll step. Re-pinning scrollTop after addRange prevents that.
            const rootEl = editor.getRootElement();
            if (rootEl) {
              const scroller = rootEl.closest('.measly-custom-scrollbar');
              const scrollerEl = scroller instanceof HTMLElement ? scroller : null;
              const scrollTopBefore = scrollerEl ? scrollerEl.scrollTop : null;
              const applied = applySelectionStateToDom(rootEl, next.text, next.selection);
              if (scrollerEl && scrollTopBefore !== null) {
                scrollerEl.scrollTop = scrollTopBefore;
              }
              if (applied) {
                previousSelectionRef.current = next.selection;
                onSelectionChangeRef.current({ source: 'user-input', selection: next.selection });
              }
            }
          },
        });

        return true;
      },
      COMMAND_PRIORITY_BEFORE_EDITOR,
    );

    return () => {
      if (selectionRafRef.current !== null) {
        cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
      }
      if (selectionRefreshRafRef.current !== null) {
        cancelAnimationFrame(selectionRefreshRafRef.current);
        selectionRefreshRafRef.current = null;
      }
      removeListener();
      removeSelectionCommand();
      removeTabCommand();
      removeMarkdownShortcutCommand();
      removeEnterCommand();
    };
  }, [editor]);

  return null;
}

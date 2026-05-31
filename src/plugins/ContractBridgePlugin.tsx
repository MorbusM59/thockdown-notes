import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useRef } from 'react';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  SELECTION_CHANGE_COMMAND,
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
  onEnterKey?: (event: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }) => boolean;
}

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

export function ContractBridgePlugin({ onTextChange, onSelectionChange, onTabIndent, onEnterKey }: ContractBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>(EMPTY_SELECTION);
  const selectionRafRef = useRef<number | null>(null);
  const pendingSelectionSourceRef = useRef<EditorTextChangeEvent['source']>('user-input');
  const rightClickCycleRef = useRef<{
    scope: 'word' | 'sentence' | 'line' | 'block';
    start: number;
    end: number;
  } | null>(null);
  const onTextChangeRef = useRef(onTextChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onTabIndentRef = useRef(onTabIndent);
  const onEnterKeyRef = useRef(onEnterKey);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
    onSelectionChangeRef.current = onSelectionChange;
    onTabIndentRef.current = onTabIndent;
    onEnterKeyRef.current = onEnterKey;
  }, [onTextChange, onSelectionChange, onTabIndent, onEnterKey]);

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

    const normalizeAnchor = (text: string, offset: number, predicate: (char: string) => boolean) => {
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

    const resolveWordRange = (text: string, offset: number) => {
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
      while (start > 0 && !boundary(text[start - 1])) {
        start -= 1;
      }

      let end = anchor + 1;
      while (end < safeLength && !boundary(text[end])) {
        end += 1;
      }

      return trimWhitespaceRange(text, start, end);
    };

    const resolveSentenceRange = (text: string, offset: number) => {
      const safeLength = text.length;
      if (safeLength === 0) {
        return { start: 0, end: 0 };
      }

      const anchor = normalizeAnchor(text, offset, isWhitespace);
      const safeAnchor = clamp(anchor, 0, Math.max(0, safeLength - 1));

      let startBoundary = -1;
      for (let index = safeAnchor - 1; index >= 0; index -= 1) {
        if (isSentenceBoundary(text[index])) {
          startBoundary = index;
          break;
        }
      }

      let endBoundary = -1;
      for (let index = safeAnchor; index < safeLength; index += 1) {
        if (isSentenceBoundary(text[index])) {
          endBoundary = index;
          break;
        }
      }

      const start = startBoundary + 1;
      const end = endBoundary >= 0 ? endBoundary + 1 : safeLength;
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

    const toSelectionState = (start: number, end: number): EditorSelectionState => ({
      anchor: start,
      focus: end,
      start,
      end,
      isCollapsed: start === end,
    });

    const resolveNextScope = (current: 'word' | 'sentence' | 'line' | 'block') => {
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
          && clickOffset <= currentSelection.end;
        const canAdvanceScope = priorCycle !== null
          && clickedInsideCurrentSelection
          && priorCycle.start === currentSelection.start
          && priorCycle.end === currentSelection.end;

        const scope = canAdvanceScope && priorCycle !== null
          ? resolveNextScope(priorCycle.scope)
          : 'word';

        let nextRange = { start: clickOffset, end: clickOffset };
        if (scope === 'word') {
          nextRange = resolveWordRange(canonicalText, clickOffset);
        } else if (scope === 'sentence') {
          nextRange = resolveSentenceRange(canonicalText, clickOffset);
        } else if (scope === 'line') {
          nextRange = resolveLineRange(canonicalText, clickOffset);
        } else {
          nextRange = resolveBlockRange(canonicalText, clickOffset);
        }

        nextSelection = toSelectionState(nextRange.start, nextRange.end);
        const applied = applySelectionStateToDom(editableRoot, canonicalText, nextSelection);
        if (!applied) {
          return;
        }

        rightClickCycleRef.current = {
          scope,
          start: nextSelection.start,
          end: nextSelection.end,
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

        if (normalizedText !== previousText) {
          const source = resolveChangeSource(tags);

          onTextChangeRef.current({
            source,
            text: normalizedText,
            previousText,
            selection: nextSelection,
          });
          previousTextRef.current = normalizedText;
        }

        if (
          nextSelection.anchor !== previousSelection.anchor ||
          nextSelection.focus !== previousSelection.focus ||
          nextSelection.start !== previousSelection.start ||
          nextSelection.end !== previousSelection.end ||
          nextSelection.isCollapsed !== previousSelection.isCollapsed
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

    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const callback = onTabIndentRef.current;
        if (!callback) return false;

        event.preventDefault();
        callback({ shiftKey: event.shiftKey });
        return true;
      },
      COMMAND_PRIORITY_BEFORE_EDITOR,
    );

    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        const callback = onEnterKeyRef.current;
        if (!callback) return false;

        const handled = callback({
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        });

        if (!handled) {
          return false;
        }

        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_BEFORE_EDITOR,
    );

    return () => {
      if (selectionRafRef.current !== null) {
        cancelAnimationFrame(selectionRafRef.current);
        selectionRafRef.current = null;
      }
      removeListener();
      removeSelectionCommand();
      removeTabCommand();
      removeEnterCommand();
    };
  }, [editor]);

  return null;
}

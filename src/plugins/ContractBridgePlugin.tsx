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
  EMPTY_SELECTION,
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
    const emitSelectionIfChanged = (source: EditorTextChangeEvent['source']) => {
      let nextSelection = previousSelectionRef.current;

      editor.getEditorState().read(() => {
        const rootEl = editor.getRootElement();
        const lexicalSelection = $getSelection();
        if (!rootEl || !$isRangeSelection(lexicalSelection)) {
          return;
        }

        nextSelection = readSelectionStateFromDom(
          rootEl,
          window.getSelection(),
          previousTextRef.current.length,
        );
      });

      const previousSelection = previousSelectionRef.current;
      if (
        nextSelection.anchor === previousSelection.anchor &&
        nextSelection.focus === previousSelection.focus &&
        nextSelection.start === previousSelection.start &&
        nextSelection.end === previousSelection.end &&
        nextSelection.isCollapsed === previousSelection.isCollapsed
      ) {
        return;
      }

      onSelectionChangeRef.current({ source, selection: nextSelection });
      previousSelectionRef.current = nextSelection;
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
          onSelectionChangeRef.current({
            source: resolveChangeSource(tags),
            selection: nextSelection,
          });
          previousSelectionRef.current = nextSelection;
        }
      });
    });

    const removeSelectionCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        emitSelectionIfChanged('user-input');
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
      removeListener();
      removeSelectionCommand();
      removeTabCommand();
      removeEnterCommand();
    };
  }, [editor]);

  return null;
}

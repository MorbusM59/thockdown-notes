import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useRef } from 'react';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import type {
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorTextChangeEvent,
} from '../editor/EditorContract';
import {
  EMPTY_SELECTION,
  normalizePlainText,
  readSelectionStateFromDom,
} from '../editor/SelectionOffsets';

interface ContractBridgePluginProps {
  onTextChange: (event: EditorTextChangeEvent) => void;
  onSelectionChange: (event: EditorSelectionChangeEvent) => void;
}

function resolveChangeSource(tags: Set<string>): EditorTextChangeEvent['source'] {
  if (tags.has('restore')) return 'programmatic';
  if (tags.has('history-redo')) return 'history-redo';
  if (tags.has('historic')) return 'history-undo';
  return 'user-input';
}

export function ContractBridgePlugin({ onTextChange, onSelectionChange }: ContractBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>(EMPTY_SELECTION);

  useEffect(() => {
    // Emit stable initial state from current editor content.
    let initialText = '';
    let initialSelection = EMPTY_SELECTION;
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const normalizedText = normalizePlainText(root.getTextContent());
      initialText = normalizedText;

      const rootEl = editor.getRootElement();
      const lexicalSelection = $getSelection();
      if (rootEl && $isRangeSelection(lexicalSelection)) {
        initialSelection = readSelectionStateFromDom(rootEl, window.getSelection(), normalizedText.length);
      }
    });

    onTextChange({
      source: 'initial-load',
      text: initialText,
      previousText: '',
      selection: initialSelection,
    });
    onSelectionChange({ source: 'initial-load', selection: initialSelection });
    previousTextRef.current = initialText;
    previousSelectionRef.current = initialSelection;
  }, [editor, onSelectionChange, onTextChange]);

  useEffect(() => {
    const removeListener = editor.registerUpdateListener(({ editorState, tags }) => {
      editorState.read(() => {
        const root = $getRoot();
        const normalizedText = normalizePlainText(root.getTextContent());
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

          onTextChange({
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
          onSelectionChange({
            source: resolveChangeSource(tags),
            selection: nextSelection,
          });
          previousSelectionRef.current = nextSelection;
        }
      });
    });

    return () => {
      removeListener();
    };
  }, [editor, onSelectionChange, onTextChange]);

  return null;
}

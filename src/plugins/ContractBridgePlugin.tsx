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

export function ContractBridgePlugin({ onTextChange, onSelectionChange }: ContractBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>(EMPTY_SELECTION);

  useEffect(() => {
    // Emit stable initial state for consumers that subscribe before first input.
    onTextChange({
      source: 'initial-load',
      text: '',
      previousText: '',
      selection: EMPTY_SELECTION,
    });
    onSelectionChange({ source: 'initial-load', selection: EMPTY_SELECTION });
  }, [onSelectionChange, onTextChange]);

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
          const source = tags.has('historic')
            ? 'history-undo'
            : tags.has('restore')
              ? 'programmatic'
              : 'user-input';

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
            source: 'user-input',
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

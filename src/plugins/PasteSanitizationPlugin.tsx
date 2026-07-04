import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
} from 'lexical';
import {
  sanitizeDocumentText,
  sanitizeDocumentTextExtended,
} from '../shared/textSanitization';
import { EMPTY_SELECTION, applySelectionStateToDom, readSelectionStateFromDom } from '../editor/SelectionOffsets';
import type { EditorSelectionState } from '../editor/EditorContract';
import { canonicalizeParagraphSegments } from '../editor/TextPolicy';

function readCanonicalRootText(): string {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length === 0) {
    return '';
  }

  return canonicalizeParagraphSegments(children.map((child) => child.getTextContent()));
}

function replaceEditorTextFromCanonical(nextText: string): void {
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

function toCollapsedSelection(offset: number): EditorSelectionState {
  return {
    anchor: offset,
    focus: offset,
    start: offset,
    end: offset,
    isCollapsed: true,
  };
}

export function PasteSanitizationPlugin() {
  const [editor] = useLexicalComposerContext();
  const plainPasteRequestedRef = useRef(false);

  useEffect(() => {
    const removeKeyDownCommand = editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'v'
        ) {
          plainPasteRequestedRef.current = true;
        }

        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    const removePasteCommand = editor.registerCommand<globalThis.ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        if (!event?.clipboardData) {
          plainPasteRequestedRef.current = false;
          return false;
        }

        const plainText = event.clipboardData.getData('text/plain');
        if (typeof plainText !== 'string') {
          plainPasteRequestedRef.current = false;
          return false;
        }

        event.preventDefault();

        const usePlainSanitization = plainPasteRequestedRef.current;
        plainPasteRequestedRef.current = false;

        const sanitized = usePlainSanitization
          ? sanitizeDocumentText(plainText)
          : sanitizeDocumentTextExtended(plainText);

        let currentText = '';
        let currentSelection = EMPTY_SELECTION;

        editor.getEditorState().read(() => {
          currentText = readCanonicalRootText();

          const rootEl = editor.getRootElement();
          if (!rootEl) {
            return;
          }

          currentSelection = readSelectionStateFromDom(
            rootEl,
            window.getSelection(),
            currentText.length,
          );
        });

        const nextText = `${currentText.slice(0, currentSelection.start)}${sanitized}${currentText.slice(currentSelection.end)}`;
        const nextSelection = toCollapsedSelection(currentSelection.start + sanitized.length);

        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            return;
          }

          replaceEditorTextFromCanonical(nextText);
        }, {
          onUpdate: () => {
            const rootEl = editor.getRootElement();
            if (!rootEl) {
              return;
            }

            applySelectionStateToDom(rootEl, nextText, nextSelection);
          },
        });

        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    return () => {
      removeKeyDownCommand();
      removePasteCommand();
    };
  }, [editor]);

  return null;
}
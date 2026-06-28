import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
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

        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(sanitized);
          }
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
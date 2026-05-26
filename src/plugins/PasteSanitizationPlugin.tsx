import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
} from 'lexical';
import { sanitizeDocumentText } from '../shared/textSanitization';

export function PasteSanitizationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removePasteCommand = editor.registerCommand<globalThis.ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        if (!event?.clipboardData) {
          return false;
        }

        const plainText = event.clipboardData.getData('text/plain');
        if (typeof plainText !== 'string') {
          return false;
        }

        event.preventDefault();
        const sanitized = sanitizeDocumentText(plainText);

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
      removePasteCommand();
    };
  }, [editor]);

  return null;
}

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TextNode } from 'lexical';
import { sanitizeTextFragment } from '../shared/textSanitization';

export function TextSanitizationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeTextTransform = editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
      const current = textNode.getTextContent();
      const sanitized = sanitizeTextFragment(current);
      if (sanitized === current) {
        return;
      }

      if (sanitized.length === 0) {
        textNode.remove();
        return;
      }

      textNode.setTextContent(sanitized);
    });

    return () => {
      removeTextTransform();
    };
  }, [editor]);

  return null;
}

import { useLayoutEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TextNode, $createTextNode } from 'lexical';
import { $createMeaslyTokenNode, $isMeaslyTokenNode, MeaslyTokenNode } from '../nodes/MeaslyTokenNode';

export function SyntaxHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    if (!editor.hasNodes([MeaslyTokenNode])) {
      console.error('SyntaxHighlightPlugin: MeaslyTokenNode not registered on editor!');
      return;
    }

    const removeTransformTextNode = editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
      if ($isMeaslyTokenNode(textNode)) return;

      const text = textNode.getTextContent();
      const parent = textNode.getParent();
      const isFirstChild = parent?.getFirstChild() === textNode;

      if (isFirstChild) {
        if (/^(#{1,6})\s+(.*)/.test(text)) {
          textNode.replace($createMeaslyTokenNode(text, 'heading'));
          return;
        }
        if (/^[-*]\s+(.*)/.test(text)) {
          textNode.replace($createMeaslyTokenNode(text, 'list'));
          return;
        }
        if (/^>\s+(.*)/.test(text)) {
          textNode.replace($createMeaslyTokenNode(text, 'quote'));
          return;
        }
      }
    });

    const removeTransformTokenNode = editor.registerNodeTransform(MeaslyTokenNode, (tokenNode: MeaslyTokenNode) => {
      const text = tokenNode.getTextContent();
      const parent = tokenNode.getParent();
      const isFirstChild = parent?.getFirstChild() === tokenNode;
      const type = tokenNode.__tokenType;

      let isValid = false;
      if (isFirstChild) {
        if (type === 'heading' && /^(#{1,6})\s+(.*)/.test(text)) isValid = true;
        else if (type === 'list' && /^[-*]\s+(.*)/.test(text)) isValid = true;
        else if (type === 'quote' && /^>\s+(.*)/.test(text)) isValid = true;
      }

      if (!isValid) {
        // Revert back to plain text
        tokenNode.replace($createTextNode(text));
      }
    });

    return () => {
      removeTransformTextNode();
      removeTransformTokenNode();
    };
  }, [editor]);

  return null;
}

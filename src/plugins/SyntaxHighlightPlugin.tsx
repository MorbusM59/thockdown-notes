import { useLayoutEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TextNode, $createTextNode } from 'lexical';
import { $createThockdownTokenNode, $isThockdownTokenNode, ThockdownTokenNode } from '../nodes/ThockdownTokenNode';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';

const areStringArraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areStringRecordsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export function SyntaxHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    if (!editor.hasNodes([ThockdownTokenNode])) {
      console.error('SyntaxHighlightPlugin: ThockdownTokenNode not registered on editor!');
      return;
    }

    const removeTransformTextNode = editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
      if ($isThockdownTokenNode(textNode)) return;

      const text = textNode.getTextContent();
      const parent = textNode.getParent();
      const isFirstChild = parent?.getFirstChild() === textNode;

      if (isFirstChild) {
        const presentation = buildTokenPresentation(text);
        if (presentation) {
          const tokenNode = $createThockdownTokenNode(
            text,
            presentation.tokenType,
            presentation.classes,
            presentation.data,
          );
          tokenNode.setFormat(textNode.getFormat());
          tokenNode.setDetail(textNode.getDetail());
          tokenNode.setMode(textNode.getMode());
          tokenNode.setStyle(textNode.getStyle());

          textNode.replace(
            tokenNode,
          );
          return;
        }
      }
    });

    const removeTransformTokenNode = editor.registerNodeTransform(ThockdownTokenNode, (tokenNode: ThockdownTokenNode) => {
      const text = tokenNode.getTextContent();
      const parent = tokenNode.getParent();
      const isFirstChild = parent?.getFirstChild() === tokenNode;
      if (!isFirstChild) {
        // Revert back to plain text
        tokenNode.replace($createTextNode(text));
        return;
      }

      const presentation = buildTokenPresentation(text);
      if (!presentation) {
        tokenNode.replace($createTextNode(text));
        return;
      }

      if (
        tokenNode.__tokenType === presentation.tokenType
        && areStringArraysEqual(tokenNode.__tokenClasses, presentation.classes)
        && areStringRecordsEqual(tokenNode.__tokenData, presentation.data)
      ) {
        return;
      }

      tokenNode.setTokenPresentation(
        presentation.tokenType,
        presentation.classes,
        presentation.data,
      );
    });

    return () => {
      removeTransformTextNode();
      removeTransformTokenNode();
    };
  }, [editor]);

  return null;
}

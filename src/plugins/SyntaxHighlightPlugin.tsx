import { useLayoutEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TextNode, $createTextNode } from 'lexical';
import { $createThockdownTokenNode, $isThockdownTokenNode, ThockdownTokenNode } from '../nodes/ThockdownTokenNode';

type TokenPresentation = {
  tokenType: string;
  classes: string[];
  data: Record<string, string>;
};

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

const isMarkdownSetextUnderline = (line: string) => /^\s{0,3}(?:=+|-+)\s*$/.test(line);

const isMarkdownThematicBreak = (line: string) => {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  return /^([*_\-])(?:\s*\1){2,}$/.test(trimmed);
};

const isMarkdownFence = (line: string) => /^\s{0,3}(?:`{3,}|~{3,})/.test(line);

const isMarkdownTableDivider = (line: string) =>
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);

const isMarkdownTableRow = (line: string) => {
  if (isMarkdownTableDivider(line)) return false;
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.includes('|');
};

function buildTokenPresentation(line: string): TokenPresentation | null {
  const raw = line;
  const classes = ['thockdown-md-line'];
  const data: Record<string, string> = {};

  if (raw.length === 0) {
    return {
      tokenType: 'blank',
      classes: [...classes, 'thockdown-md-line--blank'],
      data,
    };
  }

  if (isMarkdownThematicBreak(raw)) {
    return {
      tokenType: 'thematic-break',
      classes: [...classes, 'thockdown-md-line--thematic-break'],
      data,
    };
  }

  if (isMarkdownFence(raw)) {
    return {
      tokenType: 'code-fence',
      classes: [...classes, 'thockdown-md-line--code-fence'],
      data,
    };
  }

  if (isMarkdownTableDivider(raw)) {
    return {
      tokenType: 'table-divider',
      classes: [...classes, 'thockdown-md-line--table-divider'],
      data,
    };
  }

  if (isMarkdownTableRow(raw)) {
    return {
      tokenType: 'table-row',
      classes: [...classes, 'thockdown-md-line--table-row'],
      data,
    };
  }

  if (isMarkdownSetextUnderline(raw)) {
    return {
      tokenType: 'setext-underline',
      classes: [...classes, 'thockdown-md-line--setext-underline'],
      data,
    };
  }

  const leadingSpaceMatch = raw.match(/^(\s*)/);
  const leadingSpaces = leadingSpaceMatch ? leadingSpaceMatch[1].length : 0;
  const indentDepth = Math.floor(leadingSpaces / 2);

  let rest = raw.slice(leadingSpaces);
  let quoteDepth = 0;
  while (rest.startsWith('>')) {
    quoteDepth += 1;
    rest = rest.slice(1);
    if (rest.startsWith(' ')) {
      rest = rest.slice(1);
    }
  }

  if (leadingSpaces > 0) {
    classes.push('thockdown-md-line--indented');
    classes.push(`thockdown-md-indent-depth-${Math.max(0, indentDepth)}`);
    data.indentDepth = String(Math.max(0, indentDepth));
    data.indentSpaces = String(leadingSpaces);
  }

  if (quoteDepth > 0) {
    classes.push('thockdown-md-line--blockquote');
    classes.push(`thockdown-md-quote-depth-${quoteDepth}`);
    data.quoteDepth = String(quoteDepth);
  }

  const headingMatch = rest.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    classes.push('thockdown-md-line--heading');
    classes.push(`thockdown-md-heading-level-${level}`);
    data.headingLevel = String(level);
    return {
      tokenType: 'heading',
      classes,
      data,
    };
  }

  const taskMatch = rest.match(/^([-*+])\s+\[([ xX])\]\s+(.*)$/);
  if (taskMatch) {
    const isChecked = taskMatch[2].toLowerCase() === 'x';
    classes.push('thockdown-md-line--list');
    classes.push('thockdown-md-line--list-task');
    classes.push('thockdown-md-line--list-unordered');
    classes.push(isChecked ? 'thockdown-md-task--checked' : 'thockdown-md-task--unchecked');
    data.listKind = 'task';
    data.listDepth = String(Math.max(0, indentDepth));
    data.listMarker = taskMatch[1];
    data.taskState = isChecked ? 'checked' : 'unchecked';
    classes.push(`thockdown-md-list-depth-${Math.max(0, indentDepth)}`);
    return {
      tokenType: 'task-list-item',
      classes,
      data,
    };
  }

  const unorderedListMatch = rest.match(/^([-*+])\s+(.*)$/);
  if (unorderedListMatch) {
    classes.push('thockdown-md-line--list');
    classes.push('thockdown-md-line--list-unordered');
    classes.push(`thockdown-md-list-depth-${Math.max(0, indentDepth)}`);
    data.listKind = 'unordered';
    data.listDepth = String(Math.max(0, indentDepth));
    data.listMarker = unorderedListMatch[1];
    return {
      tokenType: 'unordered-list-item',
      classes,
      data,
    };
  }

  const orderedListMatch = rest.match(/^(\d+)([.)])\s+(.*)$/);
  if (orderedListMatch) {
    classes.push('thockdown-md-line--list');
    classes.push('thockdown-md-line--list-ordered');
    classes.push(`thockdown-md-list-depth-${Math.max(0, indentDepth)}`);
    data.listKind = 'ordered';
    data.listDepth = String(Math.max(0, indentDepth));
    data.listOrdinal = orderedListMatch[1];
    data.listDelimiter = orderedListMatch[2];
    return {
      tokenType: 'ordered-list-item',
      classes,
      data,
    };
  }

  if (quoteDepth > 0) {
    return {
      tokenType: 'blockquote',
      classes,
      data,
    };
  }

  return null;
}

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

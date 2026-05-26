import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLayoutEffect, useRef } from 'react';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { normalizeInternalText } from '../editor/TextPolicy';
import { sanitizeDocumentText } from '../shared/textSanitization';

interface NoteTextHydrationPluginProps {
  text: string;
}

function replaceEditorText(nextText: string): void {
  const root = $getRoot();
  root.clear();

  const normalized = normalizeInternalText(sanitizeDocumentText(nextText));
  const lines = normalized.split('\n');

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

  // New note template should be title-ready: `# ` with caret after the space.
  if (normalized === '# ') {
    const firstText = root.getFirstDescendant();
    if (firstText) {
      firstText.selectEnd();
    } else {
      root.selectStart();
    }
  }
}

export function NoteTextHydrationPlugin({ text }: NoteTextHydrationPluginProps) {
  const [editor] = useLexicalComposerContext();
  const appliedTextRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (appliedTextRef.current === text) return;

    editor.update(() => {
      replaceEditorText(text);
    }, { tag: 'restore' });

    appliedTextRef.current = text;
  }, [editor, text]);

  return null;
}

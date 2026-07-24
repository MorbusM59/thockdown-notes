import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLayoutEffect, useRef } from 'react';
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SKIP_SELECTION_FOCUS_TAG,
} from 'lexical';
import { canonicalizeParagraphSegments, normalizeInternalText } from '../editor/TextPolicy';
import { sanitizeTextFragment } from '../shared/textSanitization';

interface NoteTextHydrationPluginProps {
  noteId?: string | null;
  text: string;
  scrollerRef?: React.RefObject<HTMLElement>;
}

function replaceEditorText(nextText: string): void {
  const root = $getRoot();
  root.clear();

  const normalized = nextText;
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

function readCanonicalRootText(): string {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length === 0) {
    return '';
  }

  return canonicalizeParagraphSegments(children.map((child) => child.getTextContent()));
}

export function NoteTextHydrationPlugin({ noteId, text, scrollerRef }: NoteTextHydrationPluginProps) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedNoteIdRef = useRef<string | null>(null);
  const hasHydratedRef = useRef(false);

  useLayoutEffect(() => {
    // Must match the editor's own steady-state invariant (TextSanitizationPlugin
    // runs sanitizeTextFragment on every text node). Using a stricter sanitizer
    // here (e.g. HTML-tag stripping) makes the equality check below permanently
    // false for legitimate typed content like "a < b and c > d", which forces a
    // full rebuild on every keystroke and throws the caret to document start.
    const normalizedIncomingText = normalizeInternalText(sanitizeTextFragment(text));
    const currentNoteId = noteId ?? '';
    let shouldHydrate = false;

    editor.getEditorState().read(() => {
      shouldHydrate = readCanonicalRootText() !== normalizedIncomingText;
    });

    if (!shouldHydrate && lastAppliedNoteIdRef.current === currentNoteId) {
      return;
    }

    const isNoteSwitch = lastAppliedNoteIdRef.current !== currentNoteId;
    // On this plugin instance's very first hydration (including every
    // remount -- e.g. the same-note-in-two-sections freeze/thaw cycle,
    // which remounts the whole Editor via a key change) there is no prior
    // on-screen scroll position to preserve: scrollerRef points at a
    // brand-new DOM node whose scrollTop is always 0. Blindly "preserving"
    // that 0 here would stomp whatever real position a restore mechanism
    // (e.g. applyEditRestoreSnapshot, driven by this section's own cached
    // snapshot) is about to apply. Only genuine note switches on an
    // already-mounted instance -- where scrollerEl truly still shows the
    // previous note's content -- need this pixel-preservation trick.
    const isFreshMount = !hasHydratedRef.current;
    lastAppliedNoteIdRef.current = currentNoteId;
    hasHydratedRef.current = true;

    const scrollerEl = (scrollerRef?.current ?? null);
    const preservedScrollTop = scrollerEl ? scrollerEl.scrollTop : null;

    const restoreScroll = () => {
      // Only restore scroll on note switches — typing in the same note must not
      // override CagedScrollPlugin's deterministic boundary scroll step.
      if (!isNoteSwitch || isFreshMount) return;
      if (!scrollerEl || preservedScrollTop === null) return;
      scrollerEl.scrollTop = preservedScrollTop;
      requestAnimationFrame(() => {
        scrollerEl.scrollTop = preservedScrollTop;
      });
    };

    editor.update(() => {
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
      $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
      replaceEditorText(normalizedIncomingText);
    }, { tag: 'restore' });

    restoreScroll();
  }, [editor, noteId, text, scrollerRef]);

  return null;
}

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLayoutEffect, useRef } from 'react';
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
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

function buildParagraph(line: string) {
  const paragraph = $createParagraphNode();
  if (line.length > 0) {
    paragraph.append($createTextNode(line));
  }
  return paragraph;
}

function placeNewNoteCaret(root: ReturnType<typeof $getRoot>): void {
  // New note template should be title-ready: `# ` with caret after the space.
  const firstText = root.getFirstDescendant();
  if (firstText) {
    firstText.selectEnd();
  } else {
    root.selectStart();
  }
}

/**
 * Patches the root's paragraphs to match `nextText`, touching only the lines
 * that actually changed instead of clearing and rebuilding the whole
 * document. Common leading/trailing lines are left completely untouched
 * (same node identity, no re-render, no re-run of node transforms like
 * SyntaxHighlightPlugin's) -- only the differing middle span is replaced.
 * This is the same prefix/suffix-trim diff most line-oriented diff tools use
 * as their fast path; it doesn't find a minimal edit script for reordered
 * blocks, but for the cases that matter here -- typing edits, and switching
 * between two mostly-identical versions of the same note (live vs. a just-
 * taken freeze snapshot, or Time Machine scrubbing to a nearby point in
 * history) -- the changed region is small and contiguous.
 */
function replaceEditorText(nextText: string): void {
  const root = $getRoot();
  const nextLines = nextText.split('\n');
  const existingParagraphs = root.getChildren();

  // Only diff when the document is in the plain "one paragraph per line"
  // shape this plugin itself produces -- if anything else ever restructures
  // the tree, fall back to a full rebuild rather than risk a misaligned patch.
  const canDiff = existingParagraphs.length > 0 && existingParagraphs.every($isParagraphNode);

  if (!canDiff) {
    root.clear();
    for (const line of nextLines) {
      root.append(buildParagraph(line));
    }
    if (nextText === '# ') placeNewNoteCaret(root);
    return;
  }

  const oldLines = existingParagraphs.map((node) => node.getTextContent());

  const maxCommon = Math.min(oldLines.length, nextLines.length);
  let prefixLen = 0;
  while (prefixLen < maxCommon && oldLines[prefixLen] === nextLines[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  const maxSuffix = maxCommon - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixLen] === nextLines[nextLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const oldMiddleStart = prefixLen;
  const oldMiddleEndExclusive = oldLines.length - suffixLen;
  const newMiddleLines = nextLines.slice(prefixLen, nextLines.length - suffixLen);

  const staleParagraphs = existingParagraphs.slice(oldMiddleStart, oldMiddleEndExclusive);
  // The first untouched trailing paragraph -- new middle nodes are inserted
  // right before it so they land exactly where the stale ones are removed
  // from. null means the changed region ran to the end of the document.
  const insertBeforeAnchor = existingParagraphs[oldMiddleEndExclusive] ?? null;

  for (const line of newMiddleLines) {
    const paragraph = buildParagraph(line);
    if (insertBeforeAnchor) {
      insertBeforeAnchor.insertBefore(paragraph);
    } else {
      root.append(paragraph);
    }
  }

  for (const node of staleParagraphs) {
    node.remove();
  }

  if (nextText === '# ') placeNewNoteCaret(root);
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

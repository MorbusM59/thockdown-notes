import { normalizeInternalText } from './TextPolicy';
import { getPreviewVisibleTextProjection, mapVisibleRangeToSourceRange } from './PreviewVisibleText';

const DEFAULT_SNIPPET_RADIUS = 50;

type BuildSnippetResult = {
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
  hasSnippetPrefixEllipsis: boolean;
  hasSnippetSuffixEllipsis: boolean;
};

export type DocumentFindDirective = {
  findText: string;
  replaceText: string;
  isReplaceMode: boolean;
};

export type DocumentFindHit = {
  id: string;
  index: number;
  matchLength: number;
  /**
   * Offset of this match within the *rendered-visible* text projection, set
   * only for preview-mode hits (see buildPreviewVisibleDocumentFindHits).
   * `index` stays a real source offset in both modes -- replace and the
   * edit-mode jump address the document, not the screen -- so this is the
   * extra coordinate the preview jump needs to tell two hits apart when the
   * markdown between them renders to nothing.
   */
  visibleIndex?: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
  hasSnippetPrefixEllipsis: boolean;
  hasSnippetSuffixEllipsis: boolean;
};

export function resolveDocumentFindDirective(
  findQuery: string,
  replaceQuery: string,
  isReplaceMode: boolean,
): DocumentFindDirective {
  return {
    findText: normalizeInternalText(findQuery).trim(),
    replaceText: isReplaceMode ? normalizeInternalText(replaceQuery) : '',
    isReplaceMode,
  };
}

/**
 * VSCode-style "preserve case": the replacement text is re-cased to match
 * the casing pattern of whichever text it's replacing -- all-lower and
 * all-upper matches recase the whole replacement, a single Capitalized
 * word recases just its first letter, anything else (mixed case) is left
 * as the literal replacement text.
 */
export function applyPreserveCase(matchedText: string, replacementText: string): string {
  if (!/[a-zA-Z]/.test(matchedText)) {
    return replacementText;
  }

  const hasLower = /[a-z]/.test(matchedText);
  const hasUpper = /[A-Z]/.test(matchedText);

  if (hasUpper && !hasLower) {
    return replacementText.toUpperCase();
  }

  if (hasLower && !hasUpper) {
    return replacementText.toLowerCase();
  }

  const firstIsUpper = /[A-Z]/.test(matchedText[0]);
  const restIsLower = !/[A-Z]/.test(matchedText.slice(1));
  if (firstIsUpper && restIsLower) {
    return replacementText.charAt(0).toUpperCase() + replacementText.slice(1).toLowerCase();
  }

  return replacementText;
}

export function buildDocumentFindHits(
  text: string,
  query: string,
  caseSensitive: boolean,
  snippetRadius = DEFAULT_SNIPPET_RADIUS,
): DocumentFindHit[] {
  // Check the (short) query before touching `text` -- this recomputes on
  // every keystroke via useDocumentFind's useMemo regardless of whether the
  // find bar is even open, so normalizing the full document here whenever
  // there's no query to search for was a real, avoidable per-keystroke
  // O(document length) cost.
  const normalizedQuery = normalizeInternalText(query).trim();
  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = normalizeInternalText(text);

  const haystack = caseSensitive ? normalizedText : normalizedText.toLocaleLowerCase();
  const needle = caseSensitive ? normalizedQuery : normalizedQuery.toLocaleLowerCase();

  const hits: DocumentFindHit[] = [];
  let searchStart = 0;

  while (searchStart <= haystack.length - needle.length) {
    const foundIndex = haystack.indexOf(needle, searchStart);
    if (foundIndex < 0) {
      break;
    }

    const snippet = buildSnippet(normalizedText, foundIndex, normalizedQuery.length, snippetRadius);
    hits.push({
      id: `${foundIndex}-${hits.length}`,
      index: foundIndex,
      matchLength: normalizedQuery.length,
      ...snippet,
    });

    searchStart = foundIndex + Math.max(1, normalizedQuery.length);
  }

  return hits;
}

/**
 * Preview-mode counterpart to buildDocumentFindHits: searches only what the
 * rendered pane actually shows, so `[anchor](#anchor)` contributes the one
 * match the reader can see rather than two. Hits still carry real source
 * offsets in `index`/`matchLength` (so replace and the edit-mode jump keep
 * working unchanged) plus `visibleIndex` for preview-side positioning, and
 * their snippets are built from the visible text -- the card shows the
 * sentence as rendered, not with its markdown syntax in the way.
 */
export function buildPreviewVisibleDocumentFindHits(
  text: string,
  query: string,
  caseSensitive: boolean,
  snippetRadius = DEFAULT_SNIPPET_RADIUS,
): DocumentFindHit[] {
  // Same query-first ordering as buildDocumentFindHits, and for a stronger
  // reason here: with no query there is nothing to search, and the
  // projection is a full remark parse of the document.
  const normalizedQuery = normalizeInternalText(query).trim();
  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = normalizeInternalText(text);
  const projection = getPreviewVisibleTextProjection(normalizedText);
  const visibleText = projection.visibleText;

  const haystack = caseSensitive ? visibleText : visibleText.toLocaleLowerCase();
  const needle = caseSensitive ? normalizedQuery : normalizedQuery.toLocaleLowerCase();

  const hits: DocumentFindHit[] = [];
  let searchStart = 0;

  while (searchStart <= haystack.length - needle.length) {
    const foundIndex = haystack.indexOf(needle, searchStart);
    if (foundIndex < 0) {
      break;
    }

    const sourceRange = mapVisibleRangeToSourceRange(projection, foundIndex, foundIndex + normalizedQuery.length);
    const snippet = buildSnippet(visibleText, foundIndex, normalizedQuery.length, snippetRadius);
    hits.push({
      id: `${sourceRange.start}-${hits.length}`,
      index: sourceRange.start,
      matchLength: Math.max(1, sourceRange.end - sourceRange.start),
      visibleIndex: foundIndex,
      ...snippet,
    });

    searchStart = foundIndex + Math.max(1, normalizedQuery.length);
  }

  return hits;
}

function buildSnippet(text: string, index: number, matchLength: number, snippetRadius: number): BuildSnippetResult {
  const snippetStart = Math.max(0, index - snippetRadius);
  const snippetEnd = Math.min(text.length, index + matchLength + snippetRadius);

  return {
    snippetBefore: normalizeSnippetText(text.slice(snippetStart, index)),
    snippetMatch: normalizeSnippetText(text.slice(index, index + matchLength)),
    snippetAfter: normalizeSnippetText(text.slice(index + matchLength, snippetEnd)),
    hasSnippetPrefixEllipsis: snippetStart > 0,
    hasSnippetSuffixEllipsis: snippetEnd < text.length,
  };
}

function normalizeSnippetText(value: string): string {
  return value
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ');
}


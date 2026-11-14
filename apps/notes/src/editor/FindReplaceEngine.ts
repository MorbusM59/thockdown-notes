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

/**
 * HOW A FIND MATCHES: the options of the find panel's dock, as one value so
 * every scanner reads them the same way (the edit-mode and reader hit lists,
 * the reader's highlight and the jump to a hit all used to repeat their own
 * indexOf loop with their own case fold).
 */
export type FindMatching = {
  readonly caseSensitive: boolean;
  /** A match must not continue a word on either side: "cat" does not match in "concatenate". */
  readonly wholeWord: boolean;
};

// Letters, digits and underscore, matched per code point. (Combining marks
// never reach here: normalizeInternalText keeps text single-cell.)
const WORD_CHARACTER = /^[\p{L}\p{N}_]$/u;

function isWordCharacter(character: string): boolean {
  return character !== '' && WORD_CHARACTER.test(character);
}

/** The whole code point ending just before `index` (a surrogate pair is one character). */
function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const pair = index >= 2 ? text.slice(index - 2, index) : '';
  return pair.length === 2 && pair.codePointAt(0)! > 0xffff ? pair : text.slice(index - 1, index);
}

/** The whole code point starting at `index`. */
function codePointAt(text: string, index: number): string {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

/**
 * Whether the match of `needle` at `index` in `text` stands as a whole word:
 * where the needle begins with a word character, the character before the
 * match must not be one, and likewise at its end. An edge of the needle that
 * is itself not a word character ("foo." or " bar") is its own boundary.
 */
export function isWholeWordMatch(text: string, index: number, needle: string): boolean {
  const end = index + needle.length;
  if (isWordCharacter(codePointAt(needle, 0)) && isWordCharacter(codePointBefore(text, index))) return false;
  if (isWordCharacter(codePointBefore(needle, needle.length)) && isWordCharacter(codePointAt(text, end))) return false;
  return true;
}

/**
 * THE ONE SCANNER every find path uses. `fold` puts a text into the form the
 * needle is compared in (lower case unless the find is case sensitive), and
 * `next` returns the first match at or after `from` in a text and its folded
 * form, or -1. Folding is left to the caller because the callers fold once
 * and scan many times. Lower-casing is assumed to keep a text's length, as
 * every offset in the find code already does.
 */
export function createFindScanner(needle: string, matching: FindMatching) {
  const fold = (value: string) => (matching.caseSensitive ? value : value.toLocaleLowerCase());
  const foldedNeedle = fold(needle);
  return {
    length: needle.length,
    fold,
    next(text: string, folded: string, from: number): number {
      let cursor = from;
      while (cursor <= folded.length - foldedNeedle.length) {
        const found = folded.indexOf(foldedNeedle, cursor);
        if (found < 0) return -1;
        if (!matching.wholeWord || isWholeWordMatch(text, found, needle)) return found;
        cursor = found + 1;
      }
      return -1;
    },
  };
}

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
  // Both terms are taken raw -- never trimmed. A leading or trailing space is
  // part of what the reader is looking for (a double space, a space before
  // punctuation), and trimming made such searches, and replacing them,
  // impossible. Only an empty term means "nothing to find".
  return {
    findText: normalizeInternalText(findQuery),
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
 *
 * "Capitalized" is judged on the first LETTER, not the first character, on
 * both sides: find and replace terms are taken raw, so a match or a
 * replacement can open with spaces or punctuation (" Foo", "(bar") and must
 * still read, and be written, as Capitalized.
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

  const firstLetterIndex = matchedText.search(/[a-zA-Z]/);
  const firstIsUpper = /[A-Z]/.test(matchedText[firstLetterIndex]);
  const restIsLower = !/[A-Z]/.test(matchedText.slice(firstLetterIndex + 1));
  if (firstIsUpper && restIsLower) {
    return capitalizeFirstLetter(replacementText);
  }

  return replacementText;
}

/** Upper-cases the first letter wherever it sits, lower-cases every letter after it; anything before it (spaces, punctuation) is left as is. */
function capitalizeFirstLetter(text: string): string {
  const firstLetterIndex = text.search(/[a-zA-Z]/);
  if (firstLetterIndex < 0) {
    return text;
  }
  return text.slice(0, firstLetterIndex) + text[firstLetterIndex].toUpperCase() + text.slice(firstLetterIndex + 1).toLowerCase();
}

export function buildDocumentFindHits(
  text: string,
  query: string,
  matching: FindMatching,
  snippetRadius = DEFAULT_SNIPPET_RADIUS,
): DocumentFindHit[] {
  // Check the (short) query before touching `text` -- this recomputes on
  // every keystroke via useDocumentFind's useMemo regardless of whether the
  // find bar is even open, so normalizing the full document here whenever
  // there's no query to search for was a real, avoidable per-keystroke
  // O(document length) cost. The query is taken raw (see
  // resolveDocumentFindDirective): only an empty one means nothing to search.
  const normalizedQuery = normalizeInternalText(query);
  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = normalizeInternalText(text);

  const scanner = createFindScanner(normalizedQuery, matching);
  const haystack = scanner.fold(normalizedText);

  const hits: DocumentFindHit[] = [];
  let searchStart = 0;

  for (;;) {
    const foundIndex = scanner.next(normalizedText, haystack, searchStart);
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
  matching: FindMatching,
  snippetRadius = DEFAULT_SNIPPET_RADIUS,
): DocumentFindHit[] {
  // Same query-first ordering as buildDocumentFindHits, and for a stronger
  // reason here: with no query there is nothing to search, and the
  // projection is a full remark parse of the document. Raw, as above.
  const normalizedQuery = normalizeInternalText(query);
  if (!normalizedQuery) {
    return [];
  }

  const normalizedText = normalizeInternalText(text);
  const projection = getPreviewVisibleTextProjection(normalizedText);
  const visibleText = projection.visibleText;

  const scanner = createFindScanner(normalizedQuery, matching);
  const haystack = scanner.fold(visibleText);

  const hits: DocumentFindHit[] = [];
  let searchStart = 0;

  for (;;) {
    const foundIndex = scanner.next(visibleText, haystack, searchStart);
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


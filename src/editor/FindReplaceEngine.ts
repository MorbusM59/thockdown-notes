import { normalizeInternalText } from './TextPolicy';

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
  const normalizedText = normalizeInternalText(text);
  const normalizedQuery = normalizeInternalText(query).trim();
  if (!normalizedQuery) {
    return [];
  }

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


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
  rawInput: string,
  sourceText: string,
  caseSensitive: boolean,
): DocumentFindDirective {
  const input = normalizeInternalText(rawInput).trim();
  const normalizedSourceText = normalizeInternalText(sourceText);
  if (!input) {
    return {
      findText: '',
      replaceText: '',
      isReplaceMode: false,
    };
  }

  const separatorPositions: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '>') {
      separatorPositions.push(index);
    }
  }

  if (separatorPositions.length === 0) {
    return {
      findText: input,
      replaceText: '',
      isReplaceMode: false,
    };
  }

  let separatorIndex: number | null = null;
  for (const position of separatorPositions) {
    const candidateWithSeparator = input.slice(0, position + 1);
    if (!containsDocumentMatch(normalizedSourceText, candidateWithSeparator, caseSensitive)) {
      separatorIndex = position;
      break;
    }
  }

  if (separatorIndex === null) {
    return {
      findText: input,
      replaceText: '',
      isReplaceMode: false,
    };
  }

  return {
    findText: input.slice(0, separatorIndex),
    replaceText: input.slice(separatorIndex + 1),
    isReplaceMode: true,
  };
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

function containsDocumentMatch(sourceText: string, query: string, caseSensitive: boolean): boolean {
  if (!query) {
    return false;
  }

  if (caseSensitive) {
    return sourceText.includes(query);
  }

  return sourceText.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function normalizeSnippetText(value: string): string {
  return value
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


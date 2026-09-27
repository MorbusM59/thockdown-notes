import { singleCellText } from './singleCellText';

const HTML_TAGS = /<[^>\n]*>/g;
const TAB_CHARACTERS = /\t/g;
const SANITIZED_TAB_SPACES = '   ';

const SENTENCE_ENDINGS = new Set(['.', ':', '!', '?', '…', '。', '！', '？', '：']);
const BULLET_PATTERN = /^(\s*)([-–*+•◦‣▪▫○●■□☐☑✓✔]|\d+[.)]|[A-Za-z][.)]|[ivxlcdmIVXLCDM]+[.)])\s/;
const HORIZONTAL_RULE_PATTERN = /^\s*(?:---|\*\*\*|___)\s*$/;

function normalizeLineSeparators(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
}

function removeSoftHyphenation(input: string): string {
  return input.replace(/([\p{L}\p{N}])-\n([\p{L}\p{N}])/gu, '$1$2');
}

function shouldPreserveLineBreak(previousLine: string, currentLine: string): boolean {
  if (previousLine.trim() === '' || currentLine.trim() === '') {
    return true;
  }

  const previousTrimmedRight = previousLine.replace(/\s+$/, '');
  const currentTrimmedLeft = currentLine.replace(/^\s+/, '');
  const lastPreviousChar = previousTrimmedRight.at(-1) ?? '';

  return (
    SENTENCE_ENDINGS.has(lastPreviousChar) ||
    previousTrimmedRight.startsWith('```') ||
    previousTrimmedRight.startsWith('~~~') ||
    BULLET_PATTERN.test(currentTrimmedLeft) ||
    currentLine.startsWith(SANITIZED_TAB_SPACES) ||
    currentTrimmedLeft.startsWith('#') ||
    currentTrimmedLeft.startsWith('>') ||
    currentTrimmedLeft.startsWith('```') ||
    currentTrimmedLeft.startsWith('~~~') ||
    currentTrimmedLeft.startsWith('|') ||
    HORIZONTAL_RULE_PATTERN.test(currentTrimmedLeft)
  );
}

function reconstructParagraphs(input: string): string {
  const lines = input.split('\n');

  if (lines.length <= 1) {
    return input;
  }

  const result: string[] = [lines[0]];
  let insideCodeFence = lines[0].trimStart().startsWith('```');

  for (let index = 1; index < lines.length; index += 1) {
    const previousLine = result[result.length - 1];
    const currentLine = lines[index];
    const currentTrimmedLeft = currentLine.replace(/^\s+/, '');
    const isCodeFenceLine = currentTrimmedLeft.startsWith('```');

    if (insideCodeFence) {
      result.push(currentLine);

      if (isCodeFenceLine) {
        insideCodeFence = false;
      }

      continue;
    }

    if (isCodeFenceLine) {
      result.push(currentLine);
      insideCodeFence = true;
      continue;
    }

    if (shouldPreserveLineBreak(previousLine, currentLine)) {
      result.push(currentLine);
      continue;
    }

    result[result.length - 1] = `${previousLine.replace(/\s+$/, '')} ${currentLine.replace(/^\s+/, '')}`;
  }

  return result.join('\n');
}

function normalizeBulletMarkers(input: string): string {
  return input.replace(
    /^(\s*)[-–*+•◦‣▪▫○●■□☐☑✓✔](\s+)/gm,
    '$1-$2',
  );
}

/**
 * Line separators to \n, tabs to spaces, then the single-cell rule
 * (shared/singleCellText.ts) -- the same rule the editor's input filter and
 * note loading apply, so what is saved is exactly what the editor shows.
 */
export function sanitizeTextFragment(input: string): string {
  return singleCellText(normalizeLineSeparators(input)
    .replace(TAB_CHARACTERS, SANITIZED_TAB_SPACES));
}

export function sanitizeDocumentText(input: string): string {
  return sanitizeTextFragment(input).replace(HTML_TAGS, '');
}

/**
 * `sanitizeDocumentText(input).split('\n', 1)[0]`, without sanitising the
 * rest of the document.
 *
 * Exact, not an approximation: nothing in sanitizeDocumentText works across
 * a line break (line separators are normalised to \n first, and the HTML tag
 * pattern cannot contain one), so the first line's sanitised form depends on
 * the first line alone -- cut at the same separators normalizeLineSeparators
 * turns into \n. Titles are read on every save; sanitising a multi-megabyte
 * note to read its first line cost tens of milliseconds each time.
 */
export function sanitizedFirstLine(input: string): string {
  const end = input.search(/[\r\n\u2028\u2029]/)
  return sanitizeDocumentText(end === -1 ? input : input.slice(0, end))
}

export function sanitizeDocumentTextExtended(input: string): string {
  return normalizeBulletMarkers(
    reconstructParagraphs(
      removeSoftHyphenation(
        sanitizeDocumentText(input),
      ),
    ),
  );
}

/** Titles are derived from a note's first line, which can be arbitrarily long (e.g. pasted text). */
export const MAX_NOTE_TITLE_LENGTH = 80;

export function truncateTitle(input: string, maxLength: number = MAX_NOTE_TITLE_LENGTH): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.slice(0, maxLength).trimEnd();
}
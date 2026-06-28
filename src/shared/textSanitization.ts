const CONTROL_AND_INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g;
const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g;
const EMOJI_PICTOGRAPHICS = /\p{Extended_Pictographic}/gu;
const HTML_TAGS = /<[^>\n]*>/g;
const TAB_CHARACTERS = /\t/g;
const SANITIZED_TAB_SPACES = '   ';

const SENTENCE_ENDINGS = new Set(['.', ':', '!', '?', '…', '。', '！', '？', '：']);
const BULLET_PATTERN = /^(\s*)([-*+•◦‣▪▫○●■□☐☑✓✔]|\d+[.)]|[A-Za-z][.)]|[ivxlcdmIVXLCDM]+[.)])\s/;
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
    BULLET_PATTERN.test(currentTrimmedLeft) ||
    currentLine.startsWith(SANITIZED_TAB_SPACES) ||
    currentTrimmedLeft.startsWith('#') ||
    currentTrimmedLeft.startsWith('>') ||
    currentTrimmedLeft.startsWith('```') ||
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

export function sanitizeTextFragment(input: string): string {
  return normalizeLineSeparators(input)
    .replace(TAB_CHARACTERS, SANITIZED_TAB_SPACES)
    .replace(EMOJI_PICTOGRAPHICS, '')
    .replace(VARIATION_SELECTORS, '')
    .replace(CONTROL_AND_INVISIBLE_CHARS, '');
}

export function sanitizeDocumentText(input: string): string {
  return sanitizeTextFragment(input).replace(HTML_TAGS, '');
}

export function sanitizeDocumentTextExtended(input: string): string {
  return reconstructParagraphs(removeSoftHyphenation(sanitizeDocumentText(input)));
}
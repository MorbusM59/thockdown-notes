const CONTROL_AND_INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2060\uFEFF]/g;
const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g;
const EMOJI_PICTOGRAPHICS = /\p{Extended_Pictographic}/gu;
const HTML_TAGS = /<[^>\n]*>/g;
const TAB_CHARACTERS = /\t/g;
const SANITIZED_TAB_SPACES = '   ';

function normalizeLineSeparators(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
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

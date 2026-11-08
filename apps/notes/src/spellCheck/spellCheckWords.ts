/*
 * Which stretches of a line of markdown are words to spell-check.
 *
 * A word is a run of letters (any script, with their combining marks), with
 * apostrophes allowed inside it ("don't", "l'été"). Hyphens split words, so
 * "well-known" is checked as two. Everything that is not prose is left out,
 * because flagging it would be noise the reader can do nothing about:
 *   - inline code (`...`), and every line of a fenced code block (the caller
 *     tracks fences, `isFenceLine`);
 *   - URLs, e-mail addresses and the target of a link or image `](...)`;
 *   - a word straight after `#`, `$` or `@` (a tag, a note id, a reference);
 *   - a word touching a digit or an underscore on either side (identifiers,
 *     "3rd", "snake_case");
 *   - HTML tags;
 *   - a single letter.
 */

export type LineWord = { from: number; to: number; word: string };

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

const SKIPPED_SPANS: readonly RegExp[] = [
  /`[^`]*`?/g,                                  // inline code (an unclosed run to the end of the line)
  /\]\([^)]*\)?/g,                              // a link or image target
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,              // a URL with a scheme
  /\bwww\.\S+/gi,                               // a bare www address
  /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/g, // an e-mail address
  /<\/?[a-z][^>]*>/gi,                          // an HTML tag
  /^\s*\[[^\]]+\]:\s*\S+/g,                     // a reference definition's target
];

const NOT_PROSE_BEFORE = /[#$@\p{N}_\\/]/u;
const NOT_PROSE_AFTER = /[\p{N}_]/u;

/** True for a line that opens or closes a fenced code block (``` or ~~~, up to three spaces in). */
export function isFenceLine(text: string): boolean {
  return /^ {0,3}(`{3,}|~{3,})/.test(text);
}

/** Whether the line after `lines` starts inside a fenced code block, given whether the first of them did. */
export function inFenceAfter(startsInFence: boolean, lines: Iterable<string>): boolean {
  let inFence = startsInFence;
  for (const text of lines) {
    if (isFenceLine(text)) inFence = !inFence;
  }
  return inFence;
}

/** The words on one line of prose, with their offsets in the line. */
export function wordsOnLine(text: string): LineWord[] {
  if (text.length === 0) return [];
  let skipped: Array<[number, number]> | null = null;
  for (const pattern of SKIPPED_SPANS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      (skipped ??= []).push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  const words: LineWord[] = [];
  WORD.lastIndex = 0;
  for (let match = WORD.exec(text); match; match = WORD.exec(text)) {
    const from = match.index;
    const to = from + match[0].length;
    if (to - from < 2) continue;
    if (from > 0 && NOT_PROSE_BEFORE.test(text[from - 1])) continue;
    if (to < text.length && NOT_PROSE_AFTER.test(text[to])) continue;
    if (skipped && skipped.some(([start, end]) => from < end && to > start)) continue;
    words.push({ from, to, word: match[0] });
  }
  return words;
}

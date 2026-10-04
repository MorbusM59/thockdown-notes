// Character-level primitives shared by the full-document scans.
//
// Both the word count and the markdown inline-state scan walk an entire
// document a character at a time, and both used to do it by materializing
// what they were about to look at -- `trim().split(/\s+/u)` in one,
// `text.slice(lineStart, lineEnd).match(/^\s*(```+|~~~+)/)` per line in the
// other. On a 2MB note that is hundreds of thousands of short-lived strings
// for questions a few character codes answer, and it showed up in a
// packaged-build first-open profile next to a garbage-collector bucket.
//
// They live together because the whitespace predicate must be ONE
// definition. Two hand-rolled copies of "what counts as whitespace" is the
// drift this codebase keeps paying for, and here the two callers must agree
// exactly with each other and with the regexes they replaced.

/** Exactly the character class JavaScript's `\s` matches. */
const WHITESPACE_RE = /\s/u

/**
 * Whether `text[index]` is whitespace, without slicing it out first.
 *
 * ASCII covers essentially every character in a real document, so only the
 * remainder pays for a regex test.
 */
export function isWhitespaceAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true
  if (code < 0x80) return false
  return WHITESPACE_RE.test(text[index])
}

const BACKTICK = 96
const TILDE = 126

export interface FenceToken {
  char: '`' | '~'
  length: number
}

/**
 * The code-fence opener on the line `[lineStart, lineEnd)`, or null.
 *
 * Equivalent to `/^\s*(```+|~~~+)/` on that line's own text -- leading
 * whitespace, then a run of at least three backticks or three tildes,
 * reported at its full length because a closing fence must be at least as
 * long as the one it closes.
 */
export function readFenceTokenAt(text: string, lineStart: number, lineEnd: number): FenceToken | null {
  let index = lineStart
  while (index < lineEnd && isWhitespaceAt(text, index)) index += 1
  if (index >= lineEnd) return null

  const code = text.charCodeAt(index)
  if (code !== BACKTICK && code !== TILDE) return null

  let length = 0
  while (index + length < lineEnd && text.charCodeAt(index + length) === code) length += 1
  if (length < 3) return null

  return { char: code === BACKTICK ? '`' : '~', length }
}

/**
 * The edit view's speed reading: which words go in the reading row next.
 *
 * A CHUNK is as many whole words as fit in the row, separated by single
 * spaces, read forward from a position in the note's source. Computed one at a
 * time from wherever reading has got to, never for the whole note: a reader
 * who starts at the top of a two-megabyte note and stops after a paragraph has
 * paid for a paragraph.
 *
 * The source is markdown and the row shows words, so what is markup and not a
 * word is left out: a line's block prefix (`#`, `>`, a list marker, a
 * checkbox), the emphasis and code marks around a word, a link's target and
 * an image entirely. A chunk never runs across a line break -- a heading, a
 * list item and a paragraph's end are where a reader's eye would stop too.
 *
 * A word longer than the row is cut: as much of it as fits beside a hyphen,
 * and the next chunk carries on from inside the word.
 */

export interface SpeedReadingChunk {
  /** What the row shows. */
  text: string
  /** Source offsets of the chunk's first and past its last character. */
  start: number
  end: number
  /** Words in it, which is what a chunk's time on screen is worth. */
  words: number
}

const LINE_PREFIX = /^[ \t]*(?:(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+)*(?:\[[ xX]\][ \t]+)?/
const MARKUP_ONLY = /^[*_~`#>|=+\-:]+$/
const EDGE_MARKS = /^[*_~`]+|[*_~`]+$/g
const LINK_TARGET = /\]\([^)]*\)?/g

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/** A source token as the row shows it; empty when it is markup alone. */
export function displayWord(raw: string): string {
  if (raw.startsWith('![')) return ''
  const word = raw.replace(LINK_TARGET, '').replace(/[[\]]/g, '').replace(EDGE_MARKS, '')
  return word === '' || MARKUP_ONLY.test(word) ? '' : word
}

/** Where reading of the line containing `pos` may begin, past its block prefix, if `pos` is still inside that prefix. */
function pastLinePrefix(text: string, pos: number): number {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  for (let i = lineStart; i < pos; i += 1) {
    if (!isSpace(text[i])) return pos
  }
  const lineEnd = text.indexOf('\n', lineStart)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  const match = LINE_PREFIX.exec(line)
  return Math.max(pos, lineStart + (match ? match[0].length : 0))
}

/** The start of the word `pos` is inside, or `pos` itself between words. */
export function wordStartAt(text: string, pos: number): number {
  let start = Math.max(0, Math.min(text.length, pos))
  while (start > 0 && !isSpace(text[start - 1])) start -= 1
  return start
}

/** The chunk that begins at or after `from`, or null when no word is left. */
export function nextChunk(text: string, from: number, width: number): SpeedReadingChunk | null {
  const room = Math.max(2, Math.floor(width))
  const parts: string[] = []
  let length = 0
  let start = -1
  let end = from
  let pos = Math.max(0, from)

  while (pos < text.length) {
    // The whitespace before the next token: a line break in it ends a chunk
    // that already has words, and puts reading at a line's start otherwise.
    let crossedLine = false
    while (pos < text.length && isSpace(text[pos])) {
      if (text[pos] === '\n') crossedLine = true
      pos += 1
    }
    if (pos >= text.length) break
    if (crossedLine && parts.length > 0) break
    pos = pastLinePrefix(text, pos)
    if (pos >= text.length) break
    if (isSpace(text[pos])) continue

    let tokenEnd = pos
    while (tokenEnd < text.length && !isSpace(text[tokenEnd])) tokenEnd += 1
    const word = displayWord(text.slice(pos, tokenEnd))
    if (word === '') {
      pos = tokenEnd
      continue
    }

    if (parts.length === 0 && word.length > room) {
      // Cut on the source, so the next chunk resumes exactly where this one stopped.
      const cut = pos + room - 1
      const piece = displayWord(text.slice(pos, cut)) || text.slice(pos, cut)
      return { text: `${piece}-`, start: pos, end: cut, words: 1 }
    }
    const added = parts.length === 0 ? word.length : length + 1 + word.length
    if (added > room) break

    if (start === -1) start = pos
    parts.push(word)
    length = added
    end = tokenEnd
    pos = tokenEnd
  }

  if (parts.length === 0) return null
  return { text: parts.join(' '), start, end, words: parts.length }
}

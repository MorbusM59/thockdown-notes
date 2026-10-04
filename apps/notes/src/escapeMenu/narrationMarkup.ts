// The narration's own markup, and nothing else.
//
// A mode's narration reads `**[what you did]:** *what happened*`, with any
// NUMBER in the description bold AND italic. That is the whole vocabulary
// for prose: bold for the action, italic for the outcome, both for a figure.
//
// It also carries ICONS, because one of them says what a sentence of prose
// would. A combat pill is `[who] [what] [how much] [to whom]` in glyphs and
// a number -- four symbols the reader learns once, against a line they have
// to re-read every round. Both live in ONE string because narration is
// persisted state (model/gameState.ts) and a structured pill would be a
// second serialisation format for the same sentence.
//
// It is NOT Markdown and must not become one. This text goes in a pill on a
// bar one line high, so a heading or a list would have nowhere to be, and
// reaching for the real renderer would drag a parser onto a path that shows
// twelve words.
//
// The two prose marks NEST, which is the whole reason this is a toggle rather
// than a pair-matcher: a bold-italic figure is `**8**` inside a `*...*` run,
// and a flat scanner reading pairs left to right cannot see the inner pair at
// all -- it closes the outer italic on the first star of the inner mark and
// produces nonsense from there on. A mark only opens if its partner is
// somewhere ahead, so a stray asterisk stays a stray asterisk instead of
// italicising the rest of the line.
//
// AN ICON CARRIES ITS OWN WORD -- `[fa-solid fa-burst|hit]` -- and the parser
// will not open one without the pipe. A glyph is nothing to a screen reader,
// and the alternative to writing the word beside it is a table here mapping
// every icon the game might ever use to a noun: the same hand-maintained
// list, and the same drift, that the icon contract test and `sanitizeMenu`
// are each a standing complaint about. The author of the pill knows the word;
// nobody downstream does.
//
// The word may be EMPTY -- `[fa-solid fa-left-long|]` -- and that is a
// DECISION rather than an omission, in the same spirit as a control declaring
// `data-secondary-press="none"`: the second half of a mirrored pair of arrows
// adds nothing a reader needs to hear, and saying so is not the same as
// forgetting to. A token with no pipe at all is not an icon and stays text,
// so the two cases cannot be confused.

/** One run of the line: either styled text, or one glyph standing in for a word. */
export type NarrationSpan =
  | { kind: 'text'; text: string; bold: boolean; italic: boolean }
  | { kind: 'icon'; icon: string; label: string }

/** `[fa-solid fa-burst|hit]`: Font Awesome classes, a pipe, and what it means. */
const ICON_PATTERN = /^(fa-[a-z0-9- ]+)\|([^\]]*)$/

export function parseNarration(text: string): NarrationSpan[] {
  const spans: NarrationSpan[] = []
  let plain = ''
  let bold = false
  let italic = false
  let index = 0

  const flush = () => {
    if (plain.length > 0) spans.push({ kind: 'text', text: plain, bold, italic })
    plain = ''
  }

  while (index < text.length) {
    if (text[index] === '[') {
      const close = text.indexOf(']', index)
      const token = close === -1 ? null : ICON_PATTERN.exec(text.slice(index + 1, close))
      // A bracket that is not a well-formed icon is a bracket. Same rule as
      // the unmatched asterisk below: markup that cannot be completed is
      // text, so a stray one shows itself rather than eating the line.
      if (token) {
        flush()
        spans.push({ kind: 'icon', icon: token[1], label: token[2] })
        index = close + 1
        continue
      }
      plain += '['
      index += 1
      continue
    }

    if (text[index] !== '*') {
      plain += text[index]
      index += 1
      continue
    }

    const isDouble = text.startsWith('**', index)
    const mark = isDouble ? '**' : '*'
    const open = isDouble ? bold : italic

    // A closer always closes. An opener only opens if it has a partner --
    // otherwise the character is just a character.
    if (!open && text.indexOf(mark, index + mark.length) === -1) {
      plain += mark
      index += mark.length
      continue
    }

    flush()
    if (isDouble) bold = !bold
    else italic = !italic
    index += mark.length
  }

  flush()
  return spans
}

/**
 * The line as WORDS -- what a screen reader is given, and what a tooltip
 * shows. Every icon contributes the word it was written with, so a pill made
 * entirely of glyphs still reads as a sentence rather than as a bare number.
 */
export function narrationText(spans: readonly NarrationSpan[]): string {
  return spans
    .map((span) => (span.kind === 'icon' ? span.label : span.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * AN ENTRY'S TWO HALVES: the pill's own line, and the arithmetic behind it.
 *
 * Everything after the first newline is DETAIL -- what the pill's tooltip
 * says under the words, one line per fact. It rides inside the same string
 * rather than in a richer type on purpose: narration is a `string[]` all the
 * way down, through the director, the save and the sanitizer, and a shape
 * change there would ripple through every one of them to carry something only
 * the renderer reads.
 *
 * A pill with nothing to explain is exactly the string it always was, so
 * every existing entry keeps working without saying so.
 */
export function splitNarration(entry: string): { line: string; detail: string[] } {
  const [line, ...rest] = entry.split('\n')
  return { line, detail: rest.filter((row) => row.trim().length > 0) }
}

/** The inverse: a line and its working, as one entry. */
export function withDetail(line: string, detail: readonly string[]): string {
  const rows = detail.filter((row) => row.trim().length > 0)
  return rows.length > 0 ? [line, ...rows].join('\n') : line
}

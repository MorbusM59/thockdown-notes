// The narration's own markup, and nothing else.
//
// A mode's narration reads `**[what you did]:** *what happened*`, with any
// NUMBER in the description bold AND italic. That is the whole vocabulary:
// bold for the action, italic for the outcome, both for a figure.
//
// It is NOT Markdown and must not become one. This text goes in a pill on a
// bar one line high, so a heading or a list would have nowhere to be, and
// reaching for the real renderer would drag a parser onto a path that shows
// twelve words.
//
// The two marks NEST, which is the whole reason this is a toggle rather than
// a pair-matcher: a bold-italic figure is `**8**` inside a `*...*` run, and a
// flat scanner reading pairs left to right cannot see the inner pair at all
// -- it closes the outer italic on the first star of the inner mark and
// produces nonsense from there on. A mark only opens if its partner is
// somewhere ahead, so a stray asterisk stays a stray asterisk instead of
// italicising the rest of the line.

export interface NarrationSpan {
  text: string
  bold: boolean
  italic: boolean
}

export function parseNarration(text: string): NarrationSpan[] {
  const spans: NarrationSpan[] = []
  let plain = ''
  let bold = false
  let italic = false
  let index = 0

  const flush = () => {
    if (plain.length > 0) spans.push({ text: plain, bold, italic })
    plain = ''
  }

  while (index < text.length) {
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

/**
 * The rule that every character in a note occupies exactly ONE cell of the
 * editor's monospace grid -- stated once, here, and applied wherever text can
 * enter a note: the editor's input filter (CanonicalTextFilter, through
 * TextPolicy), note loading, paste, and the main process's save
 * (sanitizeDocumentText). One definition, so the editor can never show a
 * character the save would remove: that disagreement is how a typed emoji used
 * to appear in the editor and vanish on the next restart.
 *
 * A character breaks the grid in one of three ways, and each is dropped:
 *   - it takes NO cell: control and format characters (zero-width joiners,
 *     direction marks, the soft hyphen, a BOM), combining marks, variation
 *     selectors, emoji modifiers;
 *   - it takes TWO cells: East Asian wide and fullwidth characters, emoji;
 *   - it has no reliable width at all: lone surrogates, private-use and
 *     unassigned code points.
 * A space of any other width (em space, thin space, ...) becomes an ordinary
 * space rather than disappearing, because what it separates should stay
 * separated.
 *
 * Text is first composed to NFC, so an accent typed or pasted in decomposed
 * form (`e` + U+0301) survives as the single character `é` rather than losing
 * its accent to the combining-mark rule.
 *
 * Not covered, deliberately: a character that IS one cell wide by Unicode but
 * missing from the chosen editor font, which the browser then borrows from a
 * font of another width. That depends on the font, not on the text.
 *
 * Newlines are the one control character kept. Tabs never reach this: the
 * canonical text policy turns them into spaces first.
 */

/**
 * East Asian Wide and Fullwidth ranges -- the standard wcwidth table (Markus
 * Kuhn's, as used by terminals), which JavaScript has no Unicode property for.
 * Emoji are covered separately by \p{Extended_Pictographic}.
 */
const WIDE_RANGES = [
  '\\u{1100}-\\u{115F}', // Hangul Jamo initial consonants
  '\\u{2329}-\\u{232A}', // angle brackets
  '\\u{2E80}-\\u{303E}', // CJK radicals, symbols and punctuation
  '\\u{3040}-\\u{A4CF}', // Hiragana through Yi
  '\\u{A960}-\\u{A97F}', // Hangul Jamo Extended-A
  '\\u{AC00}-\\u{D7A3}', // Hangul syllables
  '\\u{F900}-\\u{FAFF}', // CJK compatibility ideographs
  '\\u{FE10}-\\u{FE19}', // vertical forms
  '\\u{FE30}-\\u{FE6F}', // CJK compatibility forms, small form variants
  '\\u{FF00}-\\u{FF60}', // fullwidth forms
  '\\u{FFE0}-\\u{FFE6}', // fullwidth signs
  '\\u{1B000}-\\u{1B2FF}', // Kana supplements
  '\\u{1F200}-\\u{1F2FF}', // enclosed ideographic supplement
  '\\u{20000}-\\u{2FFFD}', // CJK extension B onwards
  '\\u{30000}-\\u{3FFFD}', // CJK extension G onwards
].join('')

/** Every character that does not occupy exactly one cell, except the newline. */
const NOT_SINGLE_CELL = new RegExp(
  '(?!\\n)[\\p{Cc}\\p{Cf}\\p{M}\\p{Cs}\\p{Co}\\p{Cn}\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}'
  + `${WIDE_RANGES}]`,
  'gu',
)

/** Any space character other than the ordinary one. */
const OTHER_SPACES = /[^\S\n\r\t\v\f ]/gu
const OTHER_SPACE_TEST = /[^\S\n\r\t\v\f ]/u

/** True exactly when `singleCellText(text) === text`. One scan, no allocation. */
export function isSingleCellText(text: string): boolean {
  NOT_SINGLE_CELL.lastIndex = 0
  if (NOT_SINGLE_CELL.test(text)) return false
  if (OTHER_SPACE_TEST.test(text)) return false
  // Only text outside ASCII can change under NFC; skip the allocation for it.
  // eslint-disable-next-line no-control-regex -- the ASCII range, not a stray control character
  if (/^[\x00-\x7F]*$/.test(text)) return true
  return text.normalize('NFC') === text
}

/** `text` with every character that does not occupy exactly one cell removed (see the module comment). */
export function singleCellText(text: string): string {
  if (isSingleCellText(text)) return text
  // Removal before the space rule: JavaScript's \s counts U+FEFF (a zero-width
  // BOM) as whitespace, so the other order turns an invisible character into a
  // visible space instead of dropping it.
  return text
    .normalize('NFC')
    .replace(NOT_SINGLE_CELL, '')
    .replace(OTHER_SPACES, ' ')
}

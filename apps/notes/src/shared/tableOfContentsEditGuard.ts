import type { EditorTextEdit } from '../editor/EditorContract'

/** A markdown ATX heading line, at the same up-to-three-spaces tolerance the rest of this codebase's heading parsing uses. */
const HEADING_LINE = /^[ ]{0,3}#{1,6}(?:\s|$)/m

/** Widens `[from, to)` to whole lines, so a `^`-anchored multiline match means what it looks like. */
function readLineSpan(text: string, from: number, to: number): string {
  const safeFrom = Math.max(0, Math.min(text.length, from))
  const safeTo = Math.max(safeFrom, Math.min(text.length, to))
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeFrom - 1)) + 1
  const newlineAfter = text.indexOf('\n', safeTo)
  return text.slice(lineStart, newlineAfter === -1 ? text.length : newlineAfter)
}

/**
 * Whether an edit could have changed the note's table of contents.
 *
 * A table of contents is derived entirely from the note's heading lines --
 * their levels, their text, and the anchor ids slugified from that text. So an
 * edit that leaves every heading line untouched cannot change it. That covers
 * essentially all typing: prose, list items, code, blank lines.
 *
 * Both sides of the edit are checked, which is what makes this a *necessary*
 * condition rather than a guess. Typing `#` at the start of a plain line
 * creates a heading (the new span matches); deleting a `#` destroys one (the
 * old span matches); editing a heading's text changes its entry and its anchor
 * (both spans match). Lines outside the edit are unchanged by definition, so
 * their headings, and the slugs derived from them, are unchanged too.
 *
 * Returns true -- regenerate -- whenever it cannot be sure: no edit available,
 * or an edit that does not line up with the text it is being asked about. The
 * caller must treat true as "no information", not as "something changed".
 *
 * Why this matters: the regeneration effect it guards does three
 * full-document passes (strip, rebuild, compare) and, on a note that has a
 * table of contents, ran on every keystroke. Measured at ~8.9ms per keypress
 * on a 400,000-character note -- and invisible to every performance fixture in
 * this repo until `--shape=realistic-toc` was added, because none of them had
 * a table of contents to trigger it.
 */
export function editCouldChangeTableOfContents(
  previousText: string,
  nextText: string,
  edit: EditorTextEdit,
): boolean {
  const oldSpan = readLineSpan(previousText, edit.from, edit.to)
  const newSpan = readLineSpan(nextText, edit.from, edit.from + edit.insert.length)
  return HEADING_LINE.test(oldSpan) || HEADING_LINE.test(newSpan)
}

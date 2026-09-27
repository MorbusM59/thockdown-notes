import { normalizeInternalText } from '../editor/TextPolicy'
import { truncateTitle } from './textSanitization'
import { detachString } from './detachString'

/**
 * Everything normalizeInternalText turns into a line break. The line and
 * paragraph separators belong here for the same reason `\r` does: after
 * normalization they ARE newlines, so they end the first line.
 */
const LINE_BREAK = /[\n\r\u2028\u2029]/

/**
 * The note's first line, canonicalized -- read without touching the rest of
 * the document.
 *
 * `regex.exec` stops at the first match, and normalization then runs over one
 * line rather than the note. That matters because a note's title is
 * re-derived on **every keystroke** (App.tsx's updateActiveNoteTitlePreview,
 * called from onTextChange and from every transform), and the previous
 * implementation reached the same first line via `text.split('\n')` -- around
 * 30,000 substring allocations per keypress on a 1.5M-character note, of
 * which it read element 0 and discarded the rest.
 */
function readCanonicalFirstLine(text: string): string {
  const match = LINE_BREAK.exec(text)
  return normalizeInternalText(match ? text.slice(0, match.index) : text)
}

/**
 * A note's title is its first line, and only if that line is a `# ` heading.
 *
 * There is deliberately no incremental variant. There used to be
 * (`deriveNoteTitleIncremental`, plus a `NoteTitleCache` and a per-note cache
 * map in App.tsx), written when the rule was "the first heading-shaped line
 * anywhere in the document" and a full scan was genuinely needed. The rule
 * was later narrowed to the first line, which made the whole cache
 * vestigial -- but the scaffolding stayed, and with it the full-document
 * split it existed to avoid repeating. Its own tests only ever passed a null
 * cache, so nothing exercised the incremental path at all.
 *
 * Reading one line is cheaper than maintaining a cache of a document, so the
 * cache is gone rather than fixed. If the rule ever widens again, widen this
 * function first and only add state back if a measurement asks for it.
 */
export function deriveNoteTitleFromText(text: string): string {
  const firstLine = readCanonicalFirstLine(text)
  if (!firstLine.startsWith('# ')) return 'Missing title'
  // Detached because a title is kept (in the notes list, on every keystroke
  // that edits the first line) and a slice of the note would keep the note.
  return detachString(truncateTitle(firstLine.slice(2).trim())) || 'Missing title'
}

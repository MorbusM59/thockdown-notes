import { normalizeInternalText } from '../editor/TextPolicy'
import { truncateTitle } from './textSanitization'

/**
 * O(document length) ground truth: normalizes and splits the whole text,
 * then finds the first `# heading`-shaped line *anywhere in the document*
 * (not just near the top -- `.find()` semantics), falling back to the first
 * non-blank content line if no heading exists at all. Prefer
 * deriveNoteTitleIncremental for the per-keystroke hot path (see its doc
 * comment); this stays around as the correctness fallback it degrades to,
 * and as ground truth for the fuzz test.
 */
export function deriveNoteTitleFromText(text: string): string {
  const firstLine = normalizeInternalText(text).split('\n', 1)[0] ?? ''
  if (firstLine.startsWith('# ')) {
    return truncateTitle(firstLine.slice(2).trim()) || 'Missing title'
  }

  return 'Missing title'
}

interface FirstMatchCache {
  lines: string[]
  /** Index into `lines` of the first line satisfying the predicate, or null if none exists anywhere in the document. */
  index: number | null
}

export interface NoteTitleCache {
  headingMatch: FirstMatchCache
  /**
   * null means "not actually known for the current lines" -- distinct from
   * a real FirstMatchCache with index: null (which means "confirmed no
   * content line exists"). Left null whenever a call finds a heading and so
   * never needs (and must not fabricate) a content-match answer; the next
   * call that actually needs content matching passes this straight to
   * updateFirstMatchIncremental, which treats null as "no cached answer,
   * do a full scan" -- correctness fallback, not a lie about what was
   * checked.
   */
  contentMatch: FirstMatchCache | null
}

/**
 * Incremental counterpart to deriveNoteTitleFromText, for the per-keystroke
 * hot path (App.tsx's updateActiveNoteTitlePreview, called from every
 * character/Enter/Tab/markdown-shortcut transform). Always produces the
 * same result as deriveNoteTitleFromText -- verified by NoteTitle.test.ts's
 * fuzz test -- but for the overwhelmingly common case (an edit that isn't
 * to whichever line currently determines the title) does O(edit size) work
 * instead of an O(document length) scan.
 *
 * `text` is assumed already canonical (LF-only, no tabs/CR/BOM) -- true for
 * every call site this feeds, which all derive `text` from
 * normalizeInternalText's own output earlier in the same transform, the
 * same invariant ContractBridgePlugin.tsx's `previousTextRef` reuse already
 * relies on. Skips deriveNoteTitleFromText's own normalizeInternalText call
 * for that reason, same as that established pattern.
 */
export function deriveNoteTitleIncremental(text: string, previous: NoteTitleCache | null): { title: string; cache: NoteTitleCache } {
  const lines = text.split('\n')
  const firstLine = lines[0] ?? ''

  const headingMatch = firstLine.startsWith('# ')
    ? { lines, index: 0 }
    : { lines, index: null }

  const title = firstLine.startsWith('# ') ? truncateTitle(firstLine.slice(2).trim()) || 'Missing title' : 'Missing title'
  return {
    title,
    cache: { headingMatch, contentMatch: previous?.contentMatch ?? null },
  }
}

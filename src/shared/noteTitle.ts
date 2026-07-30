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
  const lines = normalizeInternalText(text).split('\n')
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2)
  if (heading) {
    return truncateTitle(heading.slice(2).trim())
  }

  const firstContent = lines.find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && trimmed !== '#'
  })

  return truncateTitle(firstContent?.trim() ?? 'Untitled')
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

function isHeadingLine(line: string): boolean {
  return line.startsWith('# ') && line.trim().length > 2
}

function isContentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed !== '#'
}

function findFirstMatchIndex(lines: string[], predicate: (line: string) => boolean, start: number, end: number): number | null {
  for (let i = start; i < end; i += 1) {
    if (predicate(lines[i])) return i
  }
  return null
}

function computeCommonLinePrefixSuffixLen(oldLines: string[], newLines: string[]): { prefixLen: number; suffixLen: number } {
  const maxCommon = Math.min(oldLines.length, newLines.length)
  let prefixLen = 0
  while (prefixLen < maxCommon && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen += 1
  }
  let suffixLen = 0
  const maxSuffix = maxCommon - prefixLen
  while (
    suffixLen < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1
  }
  return { prefixLen, suffixLen }
}

/**
 * Incremental counterpart to "find the first line matching `predicate`,
 * anywhere in the document" (the shape both deriveNoteTitleFromText's
 * heading-search and content-search need). Unlike a simple prefix-reuse
 * scheme, "first match anywhere" has an asymmetry worth spelling out: the
 * region *before* a known match is a genuinely reusable invariant (nothing
 * there can match, or the earlier line would have been the answer instead),
 * but the region *after* a known match was never actually scanned -- `.find`
 * stops at the first hit -- so there is no cached information about it at
 * all.
 *
 * Cases, using the same common-prefix/suffix line diff as
 * MarkdownContext.ts's incremental cache:
 * - Previous match was inside the untouched prefix: still correct verbatim,
 *   O(1) -- nothing before it changed, and it didn't either.
 * - Previous match was null, or inside the edited middle region, or inside
 *   the untouched suffix: the prefix is still confirmed match-free either
 *   way (if the old first match was at or after where the edit starts,
 *   everything before that was already confirmed non-matching), so only the
 *   *edited* middle region needs a fresh scan.
 *   - A match found there wins outright (nothing before it can match).
 *   - If it comes up empty: a previously-null answer stays null (everything
 *     else was already confirmed clean); a previous match sitting in the
 *     untouched suffix is still valid, just shifted by this edit's length
 *     delta; a previous match that was *inside* the now-edited middle
 *     region and didn't survive is the one hazard case with no cached
 *     answer to fall back on (the original scan never looked past it) --
 *     the only case that falls back to rescanning the suffix, always
 *     correct, just not fast for that specific edit (removing/changing
 *     whatever was determining the note's title).
 */
function updateFirstMatchIncremental(
  newLines: string[],
  previous: FirstMatchCache | null,
  predicate: (line: string) => boolean,
): FirstMatchCache {
  if (previous === null) {
    return { lines: newLines, index: findFirstMatchIndex(newLines, predicate, 0, newLines.length) }
  }
  if (newLines === previous.lines) {
    return previous
  }

  const oldLines = previous.lines
  const { prefixLen, suffixLen } = computeCommonLinePrefixSuffixLen(oldLines, newLines)

  if (previous.index !== null && previous.index < prefixLen) {
    return { lines: newLines, index: previous.index }
  }

  const shift = newLines.length - oldLines.length
  const oldMiddleEnd = oldLines.length - suffixLen
  const newMiddleEnd = newLines.length - suffixLen

  const middleMatch = findFirstMatchIndex(newLines, predicate, prefixLen, newMiddleEnd)
  if (middleMatch !== null) {
    return { lines: newLines, index: middleMatch }
  }

  if (previous.index === null) {
    return { lines: newLines, index: null }
  }

  if (previous.index >= oldMiddleEnd) {
    // Previous match was in the untouched suffix -- still valid, just shifted.
    return { lines: newLines, index: previous.index + shift }
  }

  // Previous match was inside the edited middle region and didn't survive --
  // no cached information about the suffix (never scanned past the first
  // hit), so fall back to scanning it now.
  const suffixMatch = findFirstMatchIndex(newLines, predicate, newMiddleEnd, newLines.length)
  return { lines: newLines, index: suffixMatch }
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

  const headingMatch = updateFirstMatchIncremental(lines, previous?.headingMatch ?? null, isHeadingLine)
  if (headingMatch.index !== null) {
    const headingLine = lines[headingMatch.index]
    return {
      title: truncateTitle(headingLine.slice(2).trim()),
      cache: { headingMatch, contentMatch: previous?.contentMatch ?? null },
    }
  }

  const contentMatch = updateFirstMatchIncremental(lines, previous?.contentMatch ?? null, isContentLine)
  const firstContent = contentMatch.index !== null ? lines[contentMatch.index] : undefined

  return {
    title: truncateTitle(firstContent?.trim() ?? 'Untitled'),
    cache: { headingMatch, contentMatch },
  }
}

import { computeMinimalTextReplacement } from './MinimalTextDiff'

// Character count needs no equivalent module: JS strings already track their
// own length in O(1) (`text.length`), so there's nothing to establish or
// track incrementally there -- only word count does real per-call work.

const WHITESPACE_RE = /\s/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && !WHITESPACE_RE.test(ch)
}

/**
 * Ground truth: counts whitespace-separated tokens in `text`. O(text length)
 * -- this is "establishWordCount": the full recompute, meant to run only
 * when there's no usable previous count to track forward from (first
 * render, note switch, or a selection-scoped count, which is already
 * bounded by the selection's own size rather than the document's).
 */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/u).length
}

/**
 * "trackWordCount": given a previous (text, wordCount) pair and a new text,
 * returns the new word count without re-scanning the whole document --
 * O(edit locality), not O(document length).
 *
 * Word count is a genuinely *local* incremental problem, unlike this
 * codebase's markdown-parsing incrementals (PreviewBlockSplit.ts,
 * MarkdownContext.ts): a word boundary only ever depends on whether the
 * character immediately on each side is whitespace, so an edit can only
 * possibly change the words touching its own two ends -- never anything
 * further away, no matter how far a "word" happens to run in either
 * direction (contrast with an unclosed code fence, which can absorb
 * arbitrarily much of the rest of the document). No forward-unbounded
 * hazard class exists here, so no boundary-stability probe or fallback is
 * needed -- this is exact by construction, not a caching heuristic.
 *
 * Method: reduce (oldText, newText) to the minimal single-range replacement
 * via computeMinimalTextReplacement (already used for CM6's same-note
 * hydration path), then widen that range outward -- in lockstep across old
 * and new text, since both share the identical prefix/suffix outside the
 * edit -- until whitespace is hit on both sides. That window contains every
 * old word and every new word whose membership could have changed; the
 * total word count only needs adjusting by the difference between the old
 * and new word counts *within that window*, which is cheap to compute
 * directly (the window is normally a handful of characters).
 */
export function trackWordCount(oldText: string, oldWordCount: number, newText: string): number {
  if (oldText === newText) return oldWordCount

  const { from, to, insert } = computeMinimalTextReplacement(oldText, newText)
  const editEndNew = from + insert.length

  let windowStart = from
  while (windowStart > 0 && isWordChar(oldText[windowStart - 1])) {
    windowStart -= 1
  }

  // oldText and newText share the same suffix starting at `to`/`editEndNew`
  // respectively (that's what computeMinimalTextReplacement guarantees), so
  // walking forward the same number of steps in each stays character-for-
  // character in sync -- one loop, one offset, applied to both.
  let suffixExpand = 0
  while (isWordChar(oldText[to + suffixExpand])) {
    suffixExpand += 1
  }

  const oldWindowWordCount = countWords(oldText.slice(windowStart, to + suffixExpand))
  const newWindowWordCount = countWords(newText.slice(windowStart, editEndNew + suffixExpand))

  return oldWordCount + (newWindowWordCount - oldWindowWordCount)
}

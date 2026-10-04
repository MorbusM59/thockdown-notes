import { parseMarkdownHeading } from './tableOfContentsText'

const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,})/
const ATX_HEADING_LINE = /^#{1,6}(?:\s.*)?$/

/**
 * Shifts every top-level ATX heading (outside fenced code blocks) by
 * `delta` levels, clamped to the valid 1-6 range -- accepts negative deltas
 * (shifting shallower) and arbitrary magnitudes, rewriting the leading `#`
 * run in place while leaving the rest of the line untouched.
 */
function shiftHeadingLevelsBy(text: string, delta: number): string {
  if (delta === 0) return text

  const lines = text.split('\n')
  let inFence = false

  return lines.map((line) => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    if (!ATX_HEADING_LINE.test(line)) return line

    const hashCount = line.match(/^#+/)?.[0].length ?? 0
    const nextCount = Math.min(6, Math.max(1, hashCount + delta))
    if (nextCount === hashCount) return line

    return line.replace(/^#+/, '#'.repeat(nextCount))
  }).join('\n')
}

/**
 * Normalizes a chapter's own heading hierarchy at the moment a note becomes
 * a chapter (extraction, split, clone, or a brand-new blank chapter). Two
 * cases:
 *
 * - The first line is already a heading: force it to level 2, and apply
 *   that same level-shift to every other heading in the text, so the
 *   chapter's own internal hierarchy is preserved relative to its title.
 * - The first line isn't a heading: prepend a new `## Unnamed Chapter`
 *   first line (with exactly one blank line after it), then shift every
 *   heading already in the text so the highest-ranked one (lowest #-count)
 *   becomes level 3 -- one level under the new synthetic title -- keeping
 *   the rest of the text's own internal hierarchy intact relative to that.
 *   Text with no headings at all is left alone apart from the new first
 *   line.
 */
export function normalizeChapterHeadings(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const firstLineHeading = parseMarkdownHeading(firstLine)

  if (firstLineHeading) {
    const delta = 2 - firstLineHeading.level
    return shiftHeadingLevelsBy(text, delta)
  }

  const lines = text.split('\n')
  let inFence = false
  let minLevel: number | null = null
  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = parseMarkdownHeading(line)
    if (heading && (minLevel === null || heading.level < minLevel)) {
      minLevel = heading.level
    }
  }

  const shiftedText = minLevel === null ? text : shiftHeadingLevelsBy(text, 3 - minLevel)
  return `## Unnamed Chapter\n\n${shiftedText}`
}

export interface HeadlineLevelRule {
  /** The level of the first line, if it's a heading. */
  firstLineLevel: number
  /** The shallowest level every other heading is written at. */
  minOtherLevel: number
}

/**
 * The heading levels a real chapter is written in: first line `##`, everything
 * else `###` or deeper. Not enforced on the text -- a note whose first line is
 * not its title shows "Missing title" instead (shared/noteTitle.ts) -- but it
 * is what the app itself writes, e.g. the formatting toolbar's generated headings.
 */
export const CHAPTER_HEADLINE_LEVEL_RULE: HeadlineLevelRule = { firstLineLevel: 2, minOtherLevel: 3 }

/** The same for a regular (non-chapter) note: first line `#`, everything else `##` or deeper. */
export const NOTE_HEADLINE_LEVEL_RULE: HeadlineLevelRule = { firstLineLevel: 1, minOtherLevel: 2 }

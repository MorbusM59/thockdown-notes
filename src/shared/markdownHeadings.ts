import { parseMarkdownHeading } from './tableOfContentsText'

const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,})/
const ATX_HEADING_LINE = /^#{1,6}(?:\s.*)?$/

/**
 * Bumps every top-level ATX heading (`#` through `######`, outside fenced
 * code blocks) down one level -- `#` becomes `##`, `## Title` becomes
 * `### Title`. A heading already at the deepest level (`######`) is left
 * alone, since ATX headings don't go past level 6.
 */
export function increaseHeadingLevels(text: string): string {
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
    if (hashCount >= 6) return line

    return `#${line}`
  }).join('\n')
}

/**
 * Shifts every top-level ATX heading (outside fenced code blocks) by
 * `delta` levels, clamped to the valid 1-6 range -- unlike
 * `increaseHeadingLevels`, this accepts negative deltas (shifting shallower)
 * and arbitrary magnitudes, rewriting the leading `#` run in place while
 * leaving the rest of the line untouched.
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

export interface HeadingLevelEdit {
  /** Offset (in the ORIGINAL text) where the corrected line begins. */
  lineStart: number
  /** Offset (in the ORIGINAL text) where the '#' run itself begins. */
  markerStart: number
  oldLevel: number
  newLevel: number
}

export interface HeadlineLevelRule {
  /** Required level for the first line, if it's a heading. */
  firstLineLevel: number
  /** Minimum level every other heading must be at least as deep as. */
  minOtherLevel: number
}

/** A real chapter's own invariant: first line exactly `##`, everything else `###` or deeper. */
export const CHAPTER_HEADLINE_LEVEL_RULE: HeadlineLevelRule = { firstLineLevel: 2, minOtherLevel: 3 }

/** A regular (non-chapter) note's invariant: first line exactly `#`, everything else `##` or deeper. */
export const NOTE_HEADLINE_LEVEL_RULE: HeadlineLevelRule = { firstLineLevel: 1, minOtherLevel: 2 }

/**
 * Live-editing counterpart to `normalizeChapterHeadings`: clamps (never
 * shifts) heading levels that violate `rule` -- the first line, if it's a
 * heading, must be exactly `rule.firstLineLevel`; every other heading must
 * be `rule.minOtherLevel` or deeper. Unlike `normalizeChapterHeadings`, this
 * never synthesizes a heading where none exists and never touches a heading
 * that already satisfies the rule (a `####` stays `####`) -- it's meant to
 * run on every edit, so it must be a no-op on already-valid text. Used both
 * for a real chapter's own invariant (`CHAPTER_HEADLINE_LEVEL_RULE`) and a
 * regular note's (`NOTE_HEADLINE_LEVEL_RULE`) -- see useHeadlineLevelGuard.ts,
 * which picks the right one per note and runs this on every keystroke.
 *
 * `skipLineIndex` (0-based) exempts one line from correction even if it
 * currently violates the invariant -- the caller uses this for whichever
 * line the caret is still actively editing, so backspacing a heading marker
 * down through the minimum level (or all the way to plain text) isn't fought
 * mid-edit; the exempted line is corrected normally as soon as the caret
 * moves elsewhere.
 */
export function clampHeadlineLevels(text: string, rule: HeadlineLevelRule, skipLineIndex: number | null = null): { text: string; edits: HeadingLevelEdit[] } {
  const lines = text.split('\n')
  let inFence = false
  let offset = 0
  const edits: HeadingLevelEdit[] = []

  const nextLines = lines.map((line, index) => {
    const lineStart = offset
    offset += line.length + 1

    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    if (index === skipLineIndex) return line
    if (!ATX_HEADING_LINE.test(line)) return line

    const oldLevel = line.match(/^#+/)?.[0].length ?? 0
    const newLevel = index === 0 ? rule.firstLineLevel : Math.max(rule.minOtherLevel, oldLevel)
    if (newLevel === oldLevel) return line

    edits.push({ lineStart, markerStart: lineStart, oldLevel, newLevel })
    return line.replace(/^#+/, '#'.repeat(newLevel))
  })

  return { text: nextLines.join('\n'), edits }
}

/**
 * Remaps a single document offset across the corrections
 * `clampHeadlineLevels` made -- an offset before a corrected marker is
 * untouched, one that fell inside the old `#` run clamps to the end of the
 * new one, and one after it shifts by that correction's own level delta,
 * with each earlier correction's delta accumulated first. `edits` must be
 * in ascending `lineStart` order, exactly as `clampHeadlineLevels` already
 * returns them.
 */
export function remapOffsetThroughHeadingLevelEdits(offset: number, edits: HeadingLevelEdit[]): number {
  let result = offset
  let cumulativeDelta = 0

  for (const edit of edits) {
    const delta = edit.newLevel - edit.oldLevel

    if (offset <= edit.markerStart) {
      // Untouched -- still need this edit's delta accumulated for later edits.
    } else if (offset <= edit.markerStart + edit.oldLevel) {
      const relative = offset - edit.markerStart
      result = edit.markerStart + cumulativeDelta + Math.min(relative, edit.newLevel)
    } else {
      result = offset + cumulativeDelta + delta
    }

    cumulativeDelta += delta
  }

  return result
}

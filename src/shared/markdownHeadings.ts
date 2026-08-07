const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,})/
const ATX_HEADING_LINE = /^#{1,6}(?:\s.*)?$/

/**
 * Bumps every top-level ATX heading (`#` through `######`, outside fenced
 * code blocks) down one level -- `#` becomes `##`, `## Title` becomes
 * `### Title`. A heading already at the deepest level (`######`) is left
 * alone, since ATX headings don't go past level 6. Used when cloning a
 * note's content into a chapter (dragging it onto a chapter bar): the
 * clone's headings shift down a level so its own title-heading nests under
 * the parent note's, rather than competing with it.
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

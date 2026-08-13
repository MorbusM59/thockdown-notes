// Pure markdown heading/anchor text transforms, shared between the renderer
// (useMarkdownFormattingToolbar.ts's single-note Table of Contents button)
// and the main process (databaseService.ts's auto-generated cross-chapter
// Table of Contents chapter) -- framework-free, no DOM/React/Node
// dependency, so both sides can import it directly without an IPC round
// trip. Originally lived only inside useMarkdownFormattingToolbar.ts;
// extracted here so the two features can't produce different anchor ids for
// the same heading text.
import { normalizeInternalText } from '../editor/TextPolicy'

export interface ParsedHeading {
  level: number
  text: string
}

export function parseMarkdownHeading(line: string): ParsedHeading | null {
  const match = /^#{1,6}\s+(.*)$/.exec(line.trimStart())
  if (!match) return null
  const level = match[0].match(/^#+/)?.[0].length ?? 0
  if (level < 1 || level > 6) return null
  return { level, text: match[1].trim() }
}

export function stripMarkdownInlineFormatting(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .trim()
}

/**
 * Derives an anchor id from heading/selection text, e.g. "Two Words" ->
 * "two-words". Lowercased, whitespace collapsed to a single `-`, anything
 * else stripped that would break the `[label](#anchor-id)` syntax outright
 * (parens, brackets, `#`) or just be visual noise in an id.
 */
export function slugifyAnchorId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function findTitleLineIndex(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseMarkdownHeading(lines[index])
    if (heading && heading.level === 1) return index
  }
  return -1
}

export interface AnchoredHeading {
  level: number
  label: string
  anchorId: string
}

/**
 * Rewrites every heading in `sourceText` except the first H1 (treated as the
 * note's own title, same convention the single-note TOC button already
 * uses) into a `[Label](#anchor-id)` anchor-definition heading, and returns
 * both the rewritten text and the resulting heading list in document order
 * -- callers building an index elsewhere read anchor ids straight off this
 * return value rather than re-deriving them through a second call, so the
 * two can't drift apart.
 *
 * Deterministic and idempotent: an already-anchored heading's label (once
 * `stripMarkdownInlineFormatting` strips its existing `[Label](#id)` wrapper
 * back to plain text) reslugifies to the same id as before, provided the
 * label text itself hasn't changed -- so callers can always call this
 * unconditionally on any note's current text and just compare the result to
 * the original to know whether a save is actually needed, with no separate
 * "is this already anchorized" detection required. (This mirrors the
 * existing single-note TOC button's own behavior, which has always
 * unconditionally re-anchored every heading on each toggle -- not a new
 * risk introduced here, an existing, already-shipped one this reuses
 * verbatim.)
 */
export function anchorizeHeadings(sourceText: string): { text: string; headings: AnchoredHeading[] } {
  const lines = normalizeInternalText(sourceText).split('\n')
  const titleIndex = findTitleLineIndex(lines)

  const dedupeCounts = new Map<string, number>()
  const headings: AnchoredHeading[] = []
  let inFence = false

  const nextLines = lines.map((line, index) => {
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line

    const heading = parseMarkdownHeading(line)
    if (!heading) return line
    if (index === titleIndex) return line

    const label = stripMarkdownInlineFormatting(heading.text)
    if (!label) return line

    const baseId = slugifyAnchorId(label)
    let anchorId = baseId
    const seenCount = dedupeCounts.get(baseId) ?? 0
    if (seenCount > 0) anchorId = `${baseId}-${seenCount}`
    dedupeCounts.set(baseId, seenCount + 1)

    headings.push({ level: heading.level, label, anchorId })
    return `${'#'.repeat(heading.level)} [${label}](#${anchorId})`
  })

  return { text: nextLines.join('\n'), headings }
}

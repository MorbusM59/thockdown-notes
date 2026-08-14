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
 * Walks `lines` outside fenced code blocks, finds every heading except
 * `titleIndex` (the note's own title, excluded the same way in every
 * caller), and reports each one's derived anchor id -- lowercased,
 * de-duplicated with a `-2`/`-3`/... suffix on repeat labels, in document
 * order. Shared by `anchorizeHeadings` (which also rewrites the source) and
 * `computeHeadingAnchors` (which never does) so the two id-derivation rules
 * can't drift apart from each other.
 */
function scanHeadingAnchors(
  lines: string[],
  titleIndex: number,
  onHeading: (lineIndex: number, level: number, label: string, anchorId: string) => void,
): void {
  const dedupeCounts = new Map<string, number>()
  let inFence = false

  lines.forEach((line, index) => {
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    const heading = parseMarkdownHeading(line)
    if (!heading) return
    if (index === titleIndex) return

    const label = stripMarkdownInlineFormatting(heading.text)
    if (!label) return

    const baseId = slugifyAnchorId(label)
    let anchorId = baseId
    const seenCount = dedupeCounts.get(baseId) ?? 0
    if (seenCount > 0) anchorId = `${baseId}-${seenCount}`
    dedupeCounts.set(baseId, seenCount + 1)

    onHeading(index, heading.level, label, anchorId)
  })
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
 * "is this already anchorized" detection required.
 *
 * This is the MANUAL half of the app's two independent anchor mechanisms --
 * it visibly rewrites the user's own source, so it's only ever invoked by an
 * explicit user action (the single-note Table of Contents toolbar button,
 * the "Set anchor" button). The automatic cross-chapter TOC/Open-Items
 * chapters use `computeHeadingAnchors` instead, which never touches a note's
 * content -- see that function's own doc comment for why the two had to be
 * split apart.
 */
export function anchorizeHeadings(sourceText: string): { text: string; headings: AnchoredHeading[] } {
  const lines = normalizeInternalText(sourceText).split('\n')
  const titleIndex = findTitleLineIndex(lines)

  const headings: AnchoredHeading[] = []
  const editByLine = new Map<number, { level: number; label: string; anchorId: string }>()
  scanHeadingAnchors(lines, titleIndex, (lineIndex, level, label, anchorId) => {
    headings.push({ level, label, anchorId })
    editByLine.set(lineIndex, { level, label, anchorId })
  })

  const nextLines = lines.map((line, index) => {
    const edit = editByLine.get(index)
    if (!edit) return line
    return `${'#'.repeat(edit.level)} [${edit.label}](#${edit.anchorId})`
  })

  return { text: nextLines.join('\n'), headings }
}

export interface HeadingAnchor extends AnchoredHeading {
  /** 0-indexed source line the heading itself sits on. */
  lineIndex: number
}

/**
 * The AUTOMATIC, invisible-to-the-user half of anchor derivation:
 * non-mutating counterpart to `anchorizeHeadings` that computes the exact
 * same {level, label, anchorId} sequence (via the same shared
 * `scanHeadingAnchors` id-derivation rule, so the two can never disagree on
 * what a given heading's anchor id is) plus each heading's own source line
 * -- without ever rewriting the text it reads.
 *
 * The auto-generated cross-chapter Table of Contents and Open Items
 * chapters are built entirely from this: every real chapter and the parent
 * keep their own heading source exactly as the user typed it, forever --
 * creating a second chapter (or checking off a checklist item) never
 * silently rewrites a `## My Heading` into `## [My Heading](#my-heading)`
 * the way the single-note TOC toggle's `anchorizeHeadings` deliberately
 * still does for its own, explicit, user-triggered case. Navigation into a
 * heading-derived anchor is resolved the same way, on the fly, at click
 * time -- see `findHeadingAnchorLine` and usePreviewMarkdownRendering.tsx's
 * heading-anchor branch, which locates the rendered heading element via the
 * source-line data attributes every preview block already carries
 * (createPreviewSourceAnchorRehypePlugin), rather than a literal
 * `[Label](#id)` DOM marker the way a manual anchor does.
 */
export function computeHeadingAnchors(sourceText: string): HeadingAnchor[] {
  const lines = normalizeInternalText(sourceText).split('\n')
  const titleIndex = findTitleLineIndex(lines)

  const headings: HeadingAnchor[] = []
  scanHeadingAnchors(lines, titleIndex, (lineIndex, level, label, anchorId) => {
    headings.push({ level, label, anchorId, lineIndex })
  })

  return headings
}

/** 0-indexed source line of the heading whose derived anchor id matches `anchorId`, or null if none does -- the automatic-anchor counterpart to `findAnchorDefinitionLine`. */
export function findHeadingAnchorLine(sourceText: string, anchorId: string): number | null {
  const heading = computeHeadingAnchors(sourceText).find((candidate) => candidate.anchorId === anchorId)
  return heading?.lineIndex ?? null
}

/**
 * Auto-generated (heading-derived) anchor fragments are marked with this
 * prefix wherever they appear in a generated `#fragment`, so navigation can
 * tell them apart from a manual `[Anchor Text](#id)` definition's id without
 * having to inspect the target note's content first -- `slugifyAnchorId`
 * can never itself produce a `:`, so the two id spaces can't collide.
 */
const HEADING_ANCHOR_PREFIX = 'heading:'

/** Formats a heading-derived anchor id into the `#fragment` auto-generated links use -- the write side of `parseHeadingAnchorFragment`. */
export function formatHeadingAnchorFragment(anchorId: string): string {
  return `${HEADING_ANCHOR_PREFIX}${anchorId}`
}

/** Strips the heading-anchor prefix back off, or returns null if `rawAnchorId` isn't one -- the read side of `formatHeadingAnchorFragment`, used to route navigation to the on-the-fly heading resolver instead of the manual anchor-definition scan. */
export function parseHeadingAnchorFragment(rawAnchorId: string): string | null {
  return rawAnchorId.startsWith(HEADING_ANCHOR_PREFIX) ? rawAnchorId.slice(HEADING_ANCHOR_PREFIX.length) : null
}

/**
 * True if `oldText` and `newText` have a different set of headings (by
 * level + label, in document order) -- used to gate a debounced, best-effort
 * auto-TOC regeneration on save, the same way `checklistStateChanged`
 * (openItemsText.ts) gates the auto-Open-Items regeneration: cheap to run
 * on every save of a chapter-family note, but only actually worth acting on
 * when a heading was added, removed, relabeled, or leveled differently.
 * Reuses `computeHeadingAnchors` rather than a separate heading scan so this
 * can never drift from what the auto-TOC itself considers "a heading"
 * (fenced code blocks excluded, the first H1 excluded as the note's own
 * title) -- and, since `computeHeadingAnchors` never mutates, gating on it
 * doesn't create any risk of this cheap-check-on-every-save path
 * accidentally rewriting note content just by being called.
 */
export function headingsChanged(oldText: string, newText: string): boolean {
  const oldHeadings = computeHeadingAnchors(oldText)
  const newHeadings = computeHeadingAnchors(newText)
  if (oldHeadings.length !== newHeadings.length) return true
  return oldHeadings.some((heading, index) => (
    heading.level !== newHeadings[index].level || heading.label !== newHeadings[index].label
  ))
}

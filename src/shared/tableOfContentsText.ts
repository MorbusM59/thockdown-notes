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

/**
 * Walks `lines` outside fenced code blocks, finds every heading except
 * `titleIndex` (the note's own title, excluded the same way in every
 * caller), and reports each one's derived anchor id -- lowercased,
 * de-duplicated with a `-2`/`-3`/... suffix on repeat labels, in document
 * order.
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

export interface HeadingAnchor {
  level: number
  label: string
  anchorId: string
  /** 0-indexed source line the heading itself sits on. */
  lineIndex: number
}

/**
 * Non-mutating heading/anchor-id derivation: computes each heading's
 * {level, label, anchorId} plus its own source line, without ever rewriting
 * the text it reads.
 *
 * The auto-generated cross-chapter Table of Contents and Open Items
 * chapters are built entirely from this: every real chapter and the parent
 * keep their own heading source exactly as the user typed it, forever --
 * creating a second chapter (or checking off a checklist item) never
 * silently rewrites a `## My Heading` into `## [My Heading](#my-heading)`.
 * Navigation into a heading-derived anchor is resolved the same way, on the
 * fly, at click time -- see `findHeadingAnchorLine` and
 * usePreviewMarkdownRendering.tsx's heading-anchor branch, which locates the
 * rendered heading element via the source-line data attributes every
 * preview block already carries (createPreviewSourceAnchorRehypePlugin),
 * rather than a literal `[Label](#id)` DOM marker the way a manual
 * ("Set anchor" toolbar button) anchor does.
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

// Escapes the two characters that would otherwise break out of a
// `[label](href)` link's own bracket span -- a title/heading is free-form
// user text (unlike `href`, which is always one of this app's own
// internally-built addresses), so an unescaped literal `[` or `]` inside it
// would prematurely close or corrupt the generated link's label the moment
// it's rendered. Nothing else needs escaping here: everything else that can
// appear in `label` is ordinary inline content CommonMark accepts as-is
// inside link text.
function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[[\]]/g, '\\$&')
}

/**
 * One line of an auto-generated outline (the cross-chapter Table of
 * Contents and Open Items chapters share this exact format), indented
 * `depth` levels deep -- a real `[label](href)` link when `href` is
 * available, or plain non-clickable text otherwise. In practice `href` is
 * always a real formatInternalNoteLink address (internalNoteLinks.ts) --
 * every note has a real internal id the instant it's created -- so the
 * plain-text branch is purely a defensive fallback. Shared by
 * noteLifecycleService.ts (the real backend), openItemsText.ts (Open
 * Items' own per-note group), and installBrowserMockBridges.ts (the
 * dev-mode mirror) so the three can't drift into three different outline
 * line formats.
 */
export function formatOutlineEntryLine(depth: number, label: string, href: string | null): string {
  const indent = '  '.repeat(depth)
  return href ? `${indent}- [${escapeMarkdownLinkLabel(label)}](${href})` : `${indent}- ${label}`
}

/**
 * The auto-generated cross-chapter Table of Contents' own opening line: the
 * parent note's own title, bold and flush left, deliberately NOT a bulleted
 * `formatOutlineEntryLine` entry -- it's the root of the outline, not a
 * sibling of the `##` entries under it (every chapter title, plus any of
 * the parent's own `##` headings), so it reads visually distinct from them
 * rather than looking like just the first bullet in the same flat list.
 * Only the auto-TOC chapter uses this; the auto-Open-Items chapter has no
 * single "root" the same way -- each family member (parent or chapter) gets
 * its own independent formatOutlineEntryLine(0, ...) group there, all at the
 * same depth, so this formatter has no equivalent role to play in that file.
 */
export function formatOutlineRootTitleLine(label: string, href: string | null): string {
  return href ? `**[${escapeMarkdownLinkLabel(label)}](${href})**` : `**${label}**`
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

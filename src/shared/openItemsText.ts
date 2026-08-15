// Pure text transforms for the auto-generated Open Items chapter -- shared
// between the main process (noteLifecycleService.ts, where all the
// generation actually happens) and anywhere in the renderer that might want
// to reason about the same format. Framework-free, mirrors
// tableOfContentsText.ts's own "no DOM/React/Node dependency" discipline.
import { normalizeInternalText } from '../editor/TextPolicy'
import { computeHeadingAnchors, formatHeadingAnchorFragment, formatOutlineEntryLine } from './tableOfContentsText'

const CHECKLIST_LINE_RE = /^\s*(?:>\s*)*[-*+]\s+\[([ xX])\]\s+(.*)$/

/**
 * The ordered sequence of checked/unchecked states for every checklist line
 * in `text`, ignoring item text entirely. Two texts with the same sequence
 * are considered to have "no checklist change" for update-triggering
 * purposes, even if the item wording itself changed -- see
 * checklistStateChanged's own doc comment for why that's the deliberate
 * boundary, not an oversight.
 */
export function extractChecklistCheckedStates(text: string): boolean[] {
  const lines = normalizeInternalText(text).split('\n')
  const states: boolean[] = []
  for (const line of lines) {
    const match = CHECKLIST_LINE_RE.exec(line)
    if (match) states.push(match[1].toLowerCase() === 'x')
  }
  return states
}

/**
 * True exactly when a checklist item was created/removed (sequence length
 * differs) or an existing one's checked state flipped (same length, a value
 * differs at some shared position) -- the two triggers the Open Items
 * chapter is meant to update on. Deliberately NOT triggered by pure text
 * edits to an item's own wording that leave its checked state and the total
 * count unchanged: the Open Items list would show that item's old wording
 * until some other change in the same note re-triggers a rescan, which is
 * an accepted tradeoff (event-driven, not a background watcher) rather than
 * a bug -- see the auto-Open-Items chapter's own design notes.
 */
export function checklistStateChanged(oldText: string, newText: string): boolean {
  const oldStates = extractChecklistCheckedStates(oldText)
  const newStates = extractChecklistCheckedStates(newText)
  if (oldStates.length !== newStates.length) return true
  return oldStates.some((state, index) => state !== newStates[index])
}

export interface OpenItemsHeadingBucket {
  /** null for items that appear before any heading in this note -- attributed directly to the note's own top-level link, one indent level shallower than a headed bucket's items. */
  anchorId: string | null
  label: string | null
  /** Unchecked item text, in document order. */
  items: string[]
}

/**
 * Walks `sourceText` -- the note's own, untouched content, heading source
 * exactly as the user typed it -- and groups every *unchecked* checklist
 * item under whichever heading most recently preceded it. Buckets with zero
 * items are dropped -- this is the "skip branches without unchecked
 * checkboxes" pruning the Open Items chapter is built around.
 *
 * Heading anchor ids are derived on the fly via `computeHeadingAnchors`
 * (the same automatic, non-mutating mechanism the auto-TOC chapter uses),
 * never by expecting the text to already be anchor-linkified -- a note's
 * own headings are never rewritten just because this ran.
 */
export function collectUncheckedItemsByHeading(sourceText: string): OpenItemsHeadingBucket[] {
  const lines = normalizeInternalText(sourceText).split('\n')
  const headingAnchorsByLine = new Map(computeHeadingAnchors(sourceText).map((heading) => [heading.lineIndex, heading]))
  const buckets: OpenItemsHeadingBucket[] = [{ anchorId: null, label: null, items: [] }]
  let inFence = false

  lines.forEach((line, index) => {
    if (/^\s{0,3}(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    const heading = headingAnchorsByLine.get(index)
    if (heading) {
      buckets.push({ anchorId: heading.anchorId, label: heading.label, items: [] })
      return
    }

    const checklistMatch = CHECKLIST_LINE_RE.exec(line)
    if (checklistMatch && checklistMatch[1].toLowerCase() !== 'x') {
      buckets[buckets.length - 1].items.push(checklistMatch[2].trim())
    }
  })

  return buckets.filter((bucket) => bucket.items.length > 0)
}

/**
 * Builds one note's own Open Items group -- a top-level link to the note
 * itself (`linkPrefix`, e.g. `@a1b2c3` for the parent or `@d4e5f6` for a
 * chapter -- the internal-only `@noteId` scheme from internalNoteLinks.ts,
 * addressed by real internal note ids, never a user-assigned id; see
 * noteLifecycleService.ts's regenerateAutoTocChapter for the full rationale
 * this mirrors. `linkPrefix` stays nullable defensively, but callers always
 * pass a real link in practice), with unchecked items nested
 * under whichever of its headings they belong to (linking to that heading's
 * own on-the-fly anchor id, never writing one into the note itself), or
 * directly under the top-level link if they appear before any heading.
 * Returns null when this note has no unchecked items at all -- the caller
 * drops the group entirely rather than showing an empty entry, matching the
 * TOC-style "skip branches with nothing in them" rule this whole chapter is
 * built around.
 */
export function buildOpenItemsGroupMarkdown(sourceText: string, linkPrefix: string | null, titleLabel: string): string | null {
  const buckets = collectUncheckedItemsByHeading(sourceText)
  if (buckets.length === 0) return null

  const lines = [formatOutlineEntryLine(0, titleLabel || 'Untitled', linkPrefix)]
  for (const bucket of buckets) {
    if (bucket.anchorId !== null && bucket.label !== null) {
      lines.push(formatOutlineEntryLine(1, bucket.label, linkPrefix ? `${linkPrefix}#${formatHeadingAnchorFragment(bucket.anchorId)}` : null))
      for (const item of bucket.items) lines.push(`    - [ ] ${item}`)
    } else {
      for (const item of bucket.items) lines.push(`  - [ ] ${item}`)
    }
  }
  return lines.join('\n')
}

// Deliberately NOT an HTML comment (`<!-- ... -->`): every save round-trips
// through textSanitization.ts's sanitizeDocumentText, which strips anything
// matching `<[^>\n]*>` to scrub pasted HTML -- an HTML-comment-style marker
// would be silently deleted on the very next save, losing every other
// note's already-correct group the moment a second one was written. This
// bracket form contains no `<`/`>` at all, so it survives untouched.
// Exported so PreviewMarkdown.tsx can recognize and hide these marker lines
// when rendering the Open Items chapter, without duplicating the literal.
export const GROUP_MARKER_PREFIX = '[open-items-group:'
export const GROUP_MARKER_SUFFIX = ']'

function groupMarkerLine(noteId: string): string {
  return `${GROUP_MARKER_PREFIX}${noteId}${GROUP_MARKER_SUFFIX}`
}

export interface OpenItemsGroup {
  noteId: string
  /** This note's own buildOpenItemsGroupMarkdown() output, marker line excluded. */
  markdown: string
}

/**
 * Parses a previously-assembled Open Items chapter's text back into its
 * per-note groups, keyed by the marker comment assembleOpenItemsText wrote
 * ahead of each one -- lets callers patch, reorder, or drop a single note's
 * own group without re-deriving any other note's already-correct markdown.
 */
export function parseOpenItemsGroups(text: string): OpenItemsGroup[] {
  const lines = normalizeInternalText(text).split('\n')
  const groups: OpenItemsGroup[] = []
  let current: { noteId: string; lines: string[] } | null = null

  const flush = () => {
    if (current) groups.push({ noteId: current.noteId, markdown: current.lines.join('\n').trim() })
    current = null
  }

  for (const line of lines) {
    if (line.startsWith(GROUP_MARKER_PREFIX) && line.endsWith(GROUP_MARKER_SUFFIX)) {
      flush()
      current = { noteId: line.slice(GROUP_MARKER_PREFIX.length, -GROUP_MARKER_SUFFIX.length), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  flush()

  return groups
}

/** Reassembles the full Open Items chapter text from an ordered list of groups. Returns null when `groups` is empty -- signals the caller to remove the chapter entirely rather than leave a title with nothing under it. */
export function assembleOpenItemsText(groups: OpenItemsGroup[]): string | null {
  if (groups.length === 0) return null

  const lines = ['# Open Items', '']
  for (const group of groups) {
    lines.push(groupMarkerLine(group.noteId), group.markdown, '')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

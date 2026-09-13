import { describe, expect, it } from 'vitest'

import { parseInternalNoteLink } from '../../src/shared/internalNoteLinks'
import { parseHeadingAnchorFragment, findHeadingAnchorLine } from '../../src/shared/tableOfContentsText'
import { noteContainsAnchorDefinition } from '../../src/editor/PreviewMarkdown'
import { HELP_GUIDE_INTRO_CONTENT, HELP_GUIDE_CHAPTERS, HELP_GUIDE_ROOT_ID } from './helpGuideContent'

// Every note the guide ships, by the id its own cross-references address.
const GUIDE_DOCUMENTS = new Map<string, string>([
  [HELP_GUIDE_ROOT_ID, HELP_GUIDE_INTRO_CONTENT],
  ...HELP_GUIDE_CHAPTERS.map((chapter) => [chapter.noteId, chapter.content] as const),
])

const MARKDOWN_LINK_DESTINATION = /\]\(([^)\s]+)\)/g

/**
 * Code spans and fenced blocks, blanked before the scan.
 *
 * The guide DOCUMENTS the link syntax, so `[text]($NOTE-ID#anchor-id)` appears
 * in its prose as an example inside a code span. That is a string a reader is
 * meant to read, not a destination anything resolves -- counting it as a link
 * would report the one chapter that explains linking as the one chapter full
 * of broken links.
 */
function withoutCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

interface GuideCrossReference {
  /** The guide note the link was written in -- named in the failure message, since that is where the fix goes. */
  source: string
  href: string
}

function collectCrossReferences(): GuideCrossReference[] {
  const found: GuideCrossReference[] = []
  for (const [source, content] of GUIDE_DOCUMENTS) {
    for (const match of withoutCode(content).matchAll(MARKDOWN_LINK_DESTINATION)) {
      found.push({ source, href: match[1] })
    }
  }
  return found
}

/**
 * The guide's own links, resolved the way a click resolves them
 * (usePreviewMarkdownRendering.tsx's navigateToInternalNoteLink) rather than
 * by a second, more forgiving reading of the same strings.
 *
 * The chapter half of a cross-reference is already a compile error when it
 * names a chapter that does not exist (HelpGuideChapterKey). The anchor half
 * cannot be typed -- it names a heading inside prose -- so it is checked here.
 * Both halves shipped broken at least once while the guide used hand-written
 * `$HELP§CHAPTER-ID#anchor-id` links and nothing looked at them.
 */
describe('User Guide cross-references', () => {
  it('addresses only guide notes that exist', () => {
    const broken = collectCrossReferences()
      .map((reference) => ({ ...reference, target: parseInternalNoteLink(reference.href) }))
      .filter((reference) => reference.target !== null && !GUIDE_DOCUMENTS.has(reference.target.noteId))
      .map((reference) => `${reference.source} -> ${reference.href}`)
    expect(broken).toEqual([])
  })

  it('lands on an anchor that exists in the target note', () => {
    const broken: string[] = []
    for (const reference of collectCrossReferences()) {
      const target = parseInternalNoteLink(reference.href)
      if (!target || target.fragment === null) continue
      const targetContent = GUIDE_DOCUMENTS.get(target.noteId)
      if (targetContent === undefined) continue // reported by the test above
      const headingSlug = parseHeadingAnchorFragment(target.fragment)
      const resolved = headingSlug !== null
        ? findHeadingAnchorLine(targetContent, headingSlug) !== null
        : noteContainsAnchorDefinition(targetContent, target.fragment)
      if (!resolved) broken.push(`${reference.source} -> ${reference.href}`)
    }
    expect(broken).toEqual([])
  })

  it('never reaches another note by name', () => {
    // The guide has no assigned id (helpGuideNote.ts) and is excluded from
    // `$`-link resolution outright, so any `$NOTE-ID...` left in this prose is
    // a link that silently does nothing. A bare `$#anchor-id` is a different
    // thing entirely -- a jump inside the note the reader is already in, which
    // names nobody and is exactly what the guide's own chapters use.
    const named = collectCrossReferences()
      .filter((reference) => /^\$[^#]/.test(reference.href))
      .map((reference) => `${reference.source} -> ${reference.href}`)
    expect(named).toEqual([])
  })

  it('is addressable at every link it hands the reader', () => {
    // A cheap floor under the two checks above: they pass vacuously if the
    // extraction regex ever stops matching.
    const internal = collectCrossReferences().filter((reference) => parseInternalNoteLink(reference.href) !== null)
    expect(internal.length).toBeGreaterThan(40)
  })
})

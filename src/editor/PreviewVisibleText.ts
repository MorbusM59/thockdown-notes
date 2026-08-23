import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

// Loose structural shape for mdast nodes -- mirrors PreviewBlockSplit.ts's
// own MdastAstNode rather than pulling in full mdast types, since this only
// ever reads `type`/`value`/`position`/`children`.
interface MdastAstNode {
  type: string
  value?: string
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: MdastAstNode[]
}

// Same parse-only pipeline (and same remark-gfm config) PreviewBlockSplit.ts
// uses, so what this considers "visible" is derived from exactly the tree the
// preview pane itself renders from.
const visibleTextProcessor = unified().use(remarkParse).use(remarkGfm).freeze()

/**
 * Node types whose own `value` is what the reader actually sees. `text` is
 * the ordinary case; `inlineCode`/`code` carry their content as a value with
 * the backticks/fences already stripped by remark -- which is precisely the
 * distinction this module exists to capture.
 */
const VISIBLE_VALUE_NODE_TYPES = new Set(['text', 'inlineCode', 'code'])

/**
 * Never reaches the screen in the preview pane: link/footnote *definitions*
 * are pure addressing, raw `html` is dropped entirely (no rehype-raw in the
 * preview pipeline), `yaml` is front matter, and an image renders as an
 * `<img>` -- its alt text is an attribute, not text the reader can search
 * for by eye.
 */
const INVISIBLE_NODE_TYPES = new Set(['definition', 'html', 'yaml', 'image', 'imageReference'])

/**
 * Nodes rendered as their own block-level box. A separator is emitted at
 * each boundary so a query never matches across two blocks that merely
 * happen to be adjacent in the source -- and so this projection's own
 * occurrence ordinals line up with what a DOM text walk of the rendered
 * output produces (see collectPreviewElementVisibleText's mirror of this
 * set in useDocumentFindNavigation.ts).
 */
const BLOCK_NODE_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'code', 'thematicBreak',
  'listItem', 'table', 'tableRow', 'tableCell', 'footnoteDefinition',
])

/** One run of rendered-visible text and the source span it came from. */
export interface PreviewVisibleTextSegment {
  visibleStart: number
  visibleEnd: number
  sourceStart: number
  sourceEnd: number
}

export interface PreviewVisibleTextProjection {
  /** Everything the preview pane actually shows, in document order. */
  visibleText: string
  /** Ordered, non-overlapping; gaps are markdown syntax that renders to nothing. */
  segments: PreviewVisibleTextSegment[]
}

/**
 * Projects markdown down to just the text the *rendered* view displays --
 * link labels without their `(#anchor)` targets, emphasis without its
 * asterisks, code without its fences -- keeping a source-offset mapping for
 * every run so a hit found in the projection can still be addressed in the
 * real document (jump-to-line in edit mode, replace, scroll targeting).
 *
 * Exists because find-in-document searches the raw markdown, which in
 * preview mode produces hits the reader cannot see: `[anchor](#anchor)`
 * yields two source matches for "anchor" but shows one word. The extra,
 * invisible match doesn't just pad the count -- it shifts every later hit's
 * ordinal, which is what the preview jump used to resolve a card to a
 * position, so clicking a card landed on the wrong occurrence.
 */
export function buildPreviewVisibleTextProjection(markdown: string): PreviewVisibleTextProjection {
  const root = visibleTextProcessor.parse(markdown) as MdastAstNode

  let visibleText = ''
  const segments: PreviewVisibleTextSegment[] = []

  const appendBlockSeparator = () => {
    if (visibleText.length === 0) return
    if (visibleText.endsWith('\n')) return
    visibleText += '\n'
  }

  const walk = (node: MdastAstNode) => {
    if (!node || typeof node !== 'object') return
    if (INVISIBLE_NODE_TYPES.has(node.type)) return

    const isBlock = BLOCK_NODE_TYPES.has(node.type)
    if (isBlock) appendBlockSeparator()

    if (VISIBLE_VALUE_NODE_TYPES.has(node.type) && typeof node.value === 'string') {
      const sourceStart = node.position?.start?.offset
      const sourceEnd = node.position?.end?.offset
      if (typeof sourceStart === 'number' && node.value.length > 0) {
        segments.push({
          visibleStart: visibleText.length,
          visibleEnd: visibleText.length + node.value.length,
          sourceStart,
          sourceEnd: typeof sourceEnd === 'number' ? sourceEnd : sourceStart + node.value.length,
        })
        visibleText += node.value
      }
      if (isBlock) appendBlockSeparator()
      return
    }

    // A hard line break renders as <br>, so it separates words the same way
    // a block boundary does -- without being one.
    if (node.type === 'break') {
      if (!visibleText.endsWith('\n')) visibleText += '\n'
      return
    }

    node.children?.forEach(walk)

    if (isBlock) appendBlockSeparator()
  }

  root.children?.forEach(walk)

  return { visibleText, segments }
}

// Single-entry memo keyed by the exact text. The projection is a full remark
// parse of the whole document -- affordable once per note, not once per
// keystroke -- and every caller here asks for the same document repeatedly
// (hit list, then a jump per clicked card). Preview mode is also the only
// caller, where the text is not being typed into.
let cachedProjectionText: string | null = null
let cachedProjection: PreviewVisibleTextProjection | null = null

export function getPreviewVisibleTextProjection(markdown: string): PreviewVisibleTextProjection {
  if (cachedProjectionText === markdown && cachedProjection) {
    return cachedProjection
  }
  const projection = buildPreviewVisibleTextProjection(markdown)
  cachedProjectionText = markdown
  cachedProjection = projection
  return projection
}

/**
 * Maps an offset in `visibleText` back to the equivalent offset in the
 * markdown source. Within a segment the mapping is 1:1 from its start
 * (clamped to the segment's own source span, since a run's source can be
 * longer than what it renders to -- backslash escapes, entity references);
 * an offset that lands in a gap between segments resolves to the start of
 * the following segment, i.e. the next real character on screen.
 */
export function mapVisibleOffsetToSourceOffset(
  projection: PreviewVisibleTextProjection,
  visibleOffset: number,
): number {
  const { segments } = projection
  if (segments.length === 0) return 0

  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const segment = segments[mid]
    if (visibleOffset < segment.visibleStart) {
      high = mid - 1
    } else if (visibleOffset >= segment.visibleEnd) {
      low = mid + 1
    } else {
      return Math.min(segment.sourceEnd, segment.sourceStart + (visibleOffset - segment.visibleStart))
    }
  }

  // Landed in a gap (or past the end): `low` is the first segment after it.
  if (low < segments.length) return segments[low].sourceStart
  return segments[segments.length - 1].sourceEnd
}

/**
 * Maps a half-open range of visible text onto the source. The end is
 * resolved from the range's *last character*, not from the offset one past
 * it: that offset routinely lands in a gap (the "]" + "(#anchor)" right
 * after a link label is exactly this case), which mapVisibleOffsetToSourceOffset
 * -- correctly, for a caret -- resolves forward to the next visible
 * character, producing a source span that swallowed the whole invisible
 * tail. An empty range collapses to its start.
 */
export function mapVisibleRangeToSourceRange(
  projection: PreviewVisibleTextProjection,
  visibleStart: number,
  visibleEnd: number,
): { start: number; end: number } {
  const start = mapVisibleOffsetToSourceOffset(projection, visibleStart)
  if (visibleEnd <= visibleStart) return { start, end: start }
  const lastCharacterStart = mapVisibleOffsetToSourceOffset(projection, visibleEnd - 1)
  return { start, end: Math.max(start, lastCharacterStart + 1) }
}

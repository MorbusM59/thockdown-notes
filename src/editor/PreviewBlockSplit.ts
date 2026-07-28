import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

// Loose structural shape for mdast nodes -- mirrors the RehypeAstNode
// pattern in PreviewMarkdown.tsx rather than pulling in full mdast types,
// since this only ever reads `type`/`position`/`children`.
interface MdastAstNode {
  type: string
  position?: { start?: { line?: number }; end?: { line?: number } }
  children?: MdastAstNode[]
}

// Parse-only: no remark-rehype/rehype-react in this pipeline, so this never
// does any of the expensive work (hast construction, React element
// creation) -- just enough to learn where remark itself draws top-level
// block boundaries. Uses the same remark-gfm config as the real per-block
// ReactMarkdown calls (PREVIEW_MARKDOWN_REMARK_PLUGINS) so the boundaries
// this derives are guaranteed to match how each slice re-parses in isolation.
const structuralProcessor = unified().use(remarkParse).use(remarkGfm).freeze()

const DEFINITION_NODE_TYPES = new Set(['definition', 'footnoteDefinition'])

export interface PreviewMarkdownBlock {
  text: string
  /** 0-indexed absolute start line within the full document -- same convention createPreviewSourceAnchorRehypePlugin already uses (remark's 1-indexed line minus 1). */
  startLine: number
}

/**
 * Splits markdown source into independently-renderable top-level blocks
 * (paragraphs, headings, lists, tables, code fences, blockquotes, ...) at
 * remark's own block boundaries, so a "loose" list or a multi-line table is
 * never split apart mid-construct.
 *
 * This is the unit of memoization for the preview pane: as long as a
 * block's own text is unchanged, React.memo on PreviewMarkdownBlock skips
 * that block's ReactMarkdown parse + hast-to-react conversion entirely --
 * even though this function itself reruns (cheaply -- parse only, no
 * rehype/react) on every keystroke to recompute fresh boundaries. Editing
 * inside one paragraph (including autorepeat-driven Backspace) then costs
 * O(1) instead of O(document length); only an edit that changes the
 * document's own block count/order (Enter, deleting a whole line) forces
 * the blocks after the edit point to re-render, since their absolute
 * position shifted.
 *
 * Link-reference definitions (`[label]: url`) and footnote definitions
 * (`[^id]: text`) resolve document-wide under CommonMark/GFM, not scoped to
 * whichever block happens to contain them. Every other block gets them
 * appended (a definition unreferenced by that block's own text renders
 * nothing, per GFM's footnote handling only emitting entries that are
 * actually referenced) so cross-block references and footnotes keep
 * working the same as a single whole-document parse would. One visible
 * difference: footnote definitions render immediately after whichever
 * block references them, rather than aggregated once at the document's end.
 */
export function splitMarkdownIntoPreviewBlocks(text: string): PreviewMarkdownBlock[] {
  const root = structuralProcessor.parse(text) as MdastAstNode
  const children = root.children ?? []

  if (children.length <= 1) {
    return [{ text, startLine: 0 }]
  }

  const lines = text.split('\n')

  const ranges = children.map((node, index) => {
    const previousEndLine1 = index === 0 ? 0 : (children[index - 1].position?.end?.line ?? 0)
    const ownEndLine1 = node.position?.end?.line ?? previousEndLine1
    const rangeStartLine1 = Math.max(previousEndLine1 + 1, 1)
    const rangeEndLine1 = Math.max(rangeStartLine1, ownEndLine1)
    return { node, rangeStartLine1, rangeEndLine1 }
  })

  const definitionTextByIndex = new Map<number, string>()
  ranges.forEach(({ node, rangeStartLine1, rangeEndLine1 }, index) => {
    if (DEFINITION_NODE_TYPES.has(node.type)) {
      definitionTextByIndex.set(index, lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n'))
    }
  })

  if (definitionTextByIndex.size === 0) {
    return ranges.map(({ rangeStartLine1, rangeEndLine1 }) => ({
      text: lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n'),
      startLine: rangeStartLine1 - 1,
    }))
  }

  const allDefinitionsText = Array.from(definitionTextByIndex.values()).join('\n\n')

  return ranges.map(({ rangeStartLine1, rangeEndLine1 }, index) => {
    const ownText = lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n')
    const text = definitionTextByIndex.has(index) ? ownText : `${ownText}\n\n${allDefinitionsText}`
    return { text, startLine: rangeStartLine1 - 1 }
  })
}

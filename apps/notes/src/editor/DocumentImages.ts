import type { MdastAstNode } from './mdastShape'
import type { ProgressiveSplitChunk } from './PreviewBlockSplit'

// WHICH IMAGES A NOTE HOLDS, from the Markdown parse rather than a pattern:
// an image inside a code block, or `![x](y)` inside inline code, is not an
// image. Used by the store/restore toggle (SectionEditorArea's image button),
// which rewrites exactly these spans.
//
// Collected from the same parse the block split already runs in the
// document-facts worker (documentFacts.worker.ts), so asking costs a walk of
// a tree that exists anyway; documentImagesIn is the stand-alone form for the
// worker's own cache miss and the client's no-worker fallback.

export interface DocumentImage {
  /** Source offsets of the whole image, `!` through `)`. */
  from: number
  to: number
  /** The destination as parsed (`&LOGO`, a URL, a path). */
  url: string
  title: string | null
}

interface MdastImageNode extends MdastAstNode {
  url?: string
  title?: string | null
}

/** Appends the images among `nodes` (positions relative to a window starting at `sourceOffset`) to `into`. */
export function collectDocumentImages(nodes: MdastAstNode[], sourceOffset: number, into: DocumentImage[]): void {
  const visit = (node: MdastImageNode) => {
    if (node.type === 'image') {
      const from = node.position?.start?.offset
      const to = node.position?.end?.offset
      if (from !== undefined && to !== undefined && typeof node.url === 'string') {
        into.push({ from: sourceOffset + from, to: sourceOffset + to, url: node.url, title: node.title ?? null })
      }
      return
    }
    // A code block's text is a `value`, never children, so nothing in one
    // is visited.
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes) visit(node)
}

/**
 * Every image in `text`, in document order, from the parse `split` runs.
 * The split is passed in rather than imported because it is a whole-document
 * parse, which only the worker and the client's no-worker fallback may run
 * (wholeDocumentParse.contract.test.ts); they pass
 * splitPreviewBlockRangesProgressively.
 */
export function documentImagesIn(text: string, split: (text: string) => Iterable<ProgressiveSplitChunk>): DocumentImage[] {
  const images: DocumentImage[] = []
  if (!text.includes('![')) return images
  for (const chunk of split(text)) collectDocumentImages(chunk.nodes, chunk.sourceOffset, images)
  return images
}

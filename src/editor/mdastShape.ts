/**
 * The bits of an mdast node this codebase actually reads.
 *
 * Loose rather than the full mdast types, for the reason each of its previous
 * copies gave: these walks touch `type`, `value`, `position` and `children`
 * and nothing else, and pulling in the real types buys nothing.
 *
 * It is ONE declaration because two of those copies now have to interoperate.
 * The block split parses a document and the visible-text projection is
 * derived from the same parse (see documentFacts.worker.ts), so the nodes
 * cross from one module to the other. Two structurally-different mirrors of
 * the same shape -- one carrying `position.start.line`, the other
 * `position.start.offset` -- made that a type error, which was the shapes
 * pointing out that they were the same shape.
 */
export interface MdastAstNode {
  type: string
  value?: string
  position?: {
    start?: { line?: number; offset?: number }
    end?: { line?: number; offset?: number }
  }
  children?: MdastAstNode[]
}

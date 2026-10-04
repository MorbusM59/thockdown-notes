import type { PreviewMarkdownBlock } from './PreviewBlockSplit'

/**
 * Which block index a given (0-indexed) source line falls into, for blocks
 * sorted ascending by `startLine`. Returns the last block whose `startLine`
 * is `<= sourceLine` -- i.e. the block that *contains* sourceLine, since a
 * block's own text spans from its startLine up to (but not including) the
 * next block's startLine. Clamped to a valid index for any input, including
 * a sourceLine before the first block's startLine (returns 0) or an empty
 * `blocks` array (returns -1, the only case with no valid block to target).
 */
export function resolvePreviewBlockIndexForSourceLine(
  blocks: Pick<PreviewMarkdownBlock, 'startLine'>[],
  sourceLine: number,
): number {
  if (blocks.length === 0) {
    return -1
  }

  let low = 0
  let high = blocks.length - 1
  let result = 0

  while (low <= high) {
    const mid = (low + high) >> 1
    if (blocks[mid].startLine <= sourceLine) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

/**
 * Restore-side counterpart to resolvePreviewBlockIndexForSourceLine: given a
 * persisted `anchorBlockIndex` (the canonical mode-agnostic BLOCK -- see
 * docs/editor-contract.md's Viewport Model section) and the document's
 * *current* blocks, returns the source line to land on. If the index is out
 * of range for the current blocks (the document shrank since it was saved,
 * or nothing was ever saved) or the document has no blocks at all, falls
 * back to line 0 (top of document) -- deliberately no fuzzy/nearest-block
 * matching, per this project's own scroll-sync policy.
 */
export function resolveSourceLineForAnchorBlockIndex(
  blocks: Pick<PreviewMarkdownBlock, 'startLine'>[],
  anchorBlockIndex: number,
): number {
  if (!Number.isFinite(anchorBlockIndex) || anchorBlockIndex < 0 || anchorBlockIndex >= blocks.length) {
    return 0
  }

  return blocks[anchorBlockIndex].startLine
}

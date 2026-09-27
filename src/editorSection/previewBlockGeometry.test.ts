import { describe, expect, it } from 'vitest'
import { resolvePreviewEdgeBlockClass } from './previewBlockGeometry'

describe('resolvePreviewEdgeBlockClass', () => {
  // The page-margin rule in markdown.css strips the top margin of the first
  // block and the bottom margin of the last. It must follow the block's place
  // in the DOCUMENT, not in the DOM: the windowed pane's first child is
  // whichever block is mounted, and a heading that loses its margin whenever
  // it happens to lead the window changes height for no reason anyone can see.
  it('marks only the document\'s own edges, whatever is mounted', () => {
    const blockCount = 50
    const classes = Array.from({ length: blockCount }, (_, index) => resolvePreviewEdgeBlockClass(index, blockCount))
    expect(classes[0]).toBe('preview-first-block')
    expect(classes[blockCount - 1]).toBe('preview-last-block')
    expect(classes.slice(1, -1).every((value) => value === undefined)).toBe(true)
  })

  it('marks a single block as both edges', () => {
    expect(resolvePreviewEdgeBlockClass(0, 1)).toBe('preview-first-block preview-last-block')
  })
})

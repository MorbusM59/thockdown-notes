import type { PreviewBlockMeasurement } from './previewCharPosition'

export interface PreviewBlockGeometry {
  measurements: PreviewBlockMeasurement[]
  /** Sum of the measured block heights -- the windowed pane's mean-block-height input. */
  totalHeightPx: number
}

/**
 * The browser's own geometry for the block wrappers mounted inside `container`,
 * in the scroller's `scrollTop` space.
 *
 * Both panes read their blocks the same way and always did -- the continuous
 * pane's spacer and the windowed pane's moving run are the same DOM shape, a
 * container of `[data-index]` wrappers -- but each carried its own copy of the
 * read, including its own copy of the correction below. That is the shape rule
 * 4 warns about: the two drifted apart at the one place they were allowed to,
 * and the landings computed from them disagreed by exactly one edge padding.
 *
 * THE CORRECTION: markdown.css gives every direct child of the scroller
 * `position: relative`, so a block wrapper's `offsetParent` may be that
 * container rather than the scroller, and its `offsetTop` is then measured from
 * IT -- short by the scroller's own top padding. `scrollTop` is measured from
 * the padding edge, so without this every landing would sit one
 * `--preview-edge-padding` too far down the block it aimed at.
 */
export function measurePreviewBlockGeometry(container: HTMLElement): PreviewBlockGeometry {
  const base = container.offsetParent !== null ? container.offsetTop : 0
  const nodes = container.querySelectorAll<HTMLElement>(':scope > [data-index]')

  const measurements: PreviewBlockMeasurement[] = []
  let totalHeightPx = 0

  nodes.forEach((node) => {
    const index = Number(node.getAttribute('data-index'))
    if (!Number.isFinite(index)) return
    const size = node.offsetHeight
    measurements.push({
      index,
      start: (node.offsetParent === container ? base : 0) + node.offsetTop,
      size,
    })
    totalHeightPx += size
  })

  return { measurements, totalHeightPx }
}

/**
 * The document's own leading margin, in pixels -- the scroller's top padding.
 *
 * Read from the element rather than recomputed from the typography settings:
 * `--preview-edge-padding` is set as an inline custom property by
 * SectionEditorArea and consumed by markdown.css, so the box itself is the only
 * place the two meet.
 */
export function readPreviewEdgePaddingPx(scroller: HTMLElement): number {
  const value = Number.parseFloat(window.getComputedStyle(scroller).paddingTop)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * One line of the render view's own text, in pixels.
 *
 * The restore offset is "one line below the top border", and in this pane a
 * line is the RENDER view's line height -- its font size and its spacing
 * multiplier, which are independent settings from the edit view's. Both halves
 * of the round trip read it from here: the capture picks the block straddling
 * this distance below the pane's top, the landing puts that block back at it,
 * and if the two ever disagreed the reader would walk a line per note switch.
 */
export function readPreviewLineHeightPx(scroller: HTMLElement): number {
  const style = window.getComputedStyle(scroller)
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight

  // `line-height: normal` has no pixel value of its own; the font size is the
  // closest honest stand-in and is never zero.
  const fontSize = Number.parseFloat(style.fontSize)
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 1
}

/**
 * The class marking a block as one of the document's own edges, if it is one.
 *
 * Both render paths -- the continuous pane and the windowed one -- ask this
 * rather than each writing the index comparison themselves: it is one
 * statement about the document, and the markdown.css rule it feeds is one
 * statement about that document's margins.
 */
export function resolvePreviewEdgeBlockClass(index: number, blockCount: number): string | undefined {
  const isFirst = index === 0
  const isLast = index === blockCount - 1
  if (isFirst && isLast) return 'preview-first-block preview-last-block'
  if (isFirst) return 'preview-first-block'
  if (isLast) return 'preview-last-block'
  return undefined
}

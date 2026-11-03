/**
 * Lines a copy of the editor's box-outline grid up with the real one, for
 * the visualizer's pane block (`.editor-beat-pane`, a sibling of
 * `.editor-beat-edge` in the editor shell).
 *
 * The pane is the grid's copy only while a grid is SHOWN (the edit view,
 * with the grid mounted): `hasGrid` says so, and the section marks the pane
 * with it (`.has-grid`). In any other view (render, an empty slot, a mode
 * that empties it) the pane is a separate flat wash behind the stage
 * (`.editor-beat-wash`), and this copy is hidden with its placement taken
 * back off it.
 *
 * The real grid sits inside the edit pane, between the caret and the text,
 * and giving anything there its own compositor layer pulls the pane's text
 * into a squashed overlap layer (the trap `.thockdown-block-caret`'s note in
 * index.css describes). So the block draws a COPY at shell level, on a
 * layer of its own outside the pane, and this keeps the copy's box, tile size
 * and phase equal to the real grid's: re-read when either box resizes or the
 * grid's inline style (its half-cell phase, or a mask cutting a hole in it)
 * changes, never per frame.
 */

import { useEffect, useState } from 'react'

/** The inline properties `sync` writes, removed again when the grid goes so the flat pane fills the shell. */
const MIRRORED_PROPERTIES = ['left', 'top', 'width', 'height', '--editor-cell-width', '--editor-line-height', 'background-size', 'background-position']

/**
 * A hole in the grid and the ring it closes round the hole with (the
 * visualizer's cutout, `visualizer/cutoutRing.ts`), copied from the grid's
 * inline style. The hole's mask is written to the copy as `--grid-mask-*`,
 * and the copy is marked `data-grid-ring` while there is a ring, which
 * lies inside the hole, so the copy's CSS takes the hole out of its pattern
 * alone and draws the ring beside it.
 */
const HOLE_PROPERTIES: ReadonlyArray<readonly [source: string, target: string]> = [
  ['mask-image', '--grid-mask-image'],
  ['mask-size', '--grid-mask-size'],
  ['mask-position', '--grid-mask-position'],
  ['mask-repeat', '--grid-mask-repeat'],
  ['mask-composite', '--grid-mask-composite'],
  ['--grid-ring-mask', '--grid-ring-mask'],
  ['--grid-ring-left', '--grid-ring-left'],
  ['--grid-ring-top', '--grid-ring-top'],
  ['--grid-ring-size', '--grid-ring-size'],
]

export function useBeatGridMirror(isGridView: boolean): {
  gridRef: (el: HTMLDivElement | null) => void
  mirrorRef: (el: HTMLDivElement | null) => void
  hasGrid: boolean
} {
  const [grid, gridRef] = useState<HTMLDivElement | null>(null)
  const [mirror, mirrorRef] = useState<HTMLDivElement | null>(null)
  const hasGrid = isGridView && grid !== null

  useEffect(() => {
    if (!hasGrid || !grid || !mirror) return
    // The editor shell, which the copy is positioned in. The copy itself is
    // hidden (display: none) until the block is on; observing it too places
    // it the moment it is shown.
    const host = mirror.parentElement
    if (!host) return
    const sync = () => {
      const g = grid.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const style = getComputedStyle(grid)
      mirror.style.left = `${g.left - h.left - host.clientLeft}px`
      mirror.style.top = `${g.top - h.top - host.clientTop}px`
      mirror.style.width = `${g.width}px`
      mirror.style.height = `${g.height}px`
      // The tile IS one cell: its two lengths are the cell's, which the
      // pattern's stops read and which are only defined inside the editor.
      // (Computed as a list, one entry per gradient; both are the same cell.)
      const [cellWidth, lineHeight] = style.backgroundSize.split(',')[0].trim().split(' ')
      mirror.style.setProperty('--editor-cell-width', cellWidth)
      mirror.style.setProperty('--editor-line-height', lineHeight ?? cellWidth)
      mirror.style.backgroundSize = style.backgroundSize
      mirror.style.backgroundPosition = style.backgroundPosition
      // A hole in the grid, and its ring, are in the copy too; a grid
      // without one leaves the copy whole.
      for (const [source, target] of HOLE_PROPERTIES) {
        const value = grid.style.getPropertyValue(source)
        if (value) mirror.style.setProperty(target, value)
        else mirror.style.removeProperty(target)
      }
      mirror.toggleAttribute('data-grid-ring', grid.style.getPropertyValue('--grid-ring-mask') !== '')
    }
    sync()
    const resize = new ResizeObserver(sync)
    resize.observe(grid)
    resize.observe(host)
    resize.observe(mirror)
    const restyle = new MutationObserver(sync)
    restyle.observe(grid, { attributes: true, attributeFilter: ['style'] })
    return () => {
      resize.disconnect()
      restyle.disconnect()
      // Removed property by property: the element's style also carries
      // --beat-pane, written per frame by flowStyle.ts.
      for (const property of MIRRORED_PROPERTIES) mirror.style.removeProperty(property)
      for (const [, target] of HOLE_PROPERTIES) mirror.style.removeProperty(target)
      mirror.removeAttribute('data-grid-ring')
    }
  }, [hasGrid, grid, mirror])

  return { gridRef, mirrorRef, hasGrid }
}

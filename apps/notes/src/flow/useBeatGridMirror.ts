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
 * grid's inline style (its half-cell phase, or a hole cut in its mask)
 * changes, never per frame.
 */

import { useEffect, useState } from 'react'

/** The inline properties `sync` writes, removed again when the grid goes so the flat pane fills the shell. */
const MIRRORED_PROPERTIES = ['left', 'top', 'width', 'height']

/**
 * The grid's mask, read from its COMPUTED style (the outline tile at the
 * grid's cell size and phase, less any hole the visualizer's cutout makes in
 * it, `visualizer/cutoutRing.ts`) and written to the copy as `--grid-mask-*`,
 * so the copy is lit on exactly the pixels the outline covers.
 */
const MASK_PROPERTIES: ReadonlyArray<readonly [source: string, target: string]> = [
  ['mask-image', '--grid-mask-image'],
  ['mask-size', '--grid-mask-size'],
  ['mask-position', '--grid-mask-position'],
  ['mask-repeat', '--grid-mask-repeat'],
  ['mask-composite', '--grid-mask-composite'],
]

/**
 * The ring the grid closes round its hole with, copied from the grid's
 * inline style. The copy is marked `data-grid-ring` while there is one,
 * which lies inside the hole, so the copy's CSS takes the hole out of its
 * pattern alone and draws the ring beside it.
 */
const RING_PROPERTIES: ReadonlyArray<readonly [source: string, target: string]> = [
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
      for (const [source, target] of MASK_PROPERTIES) {
        mirror.style.setProperty(target, style.getPropertyValue(source))
      }
      // A ring is in the copy too; a grid without one leaves it out.
      for (const [source, target] of RING_PROPERTIES) {
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
      for (const [, target] of MASK_PROPERTIES) mirror.style.removeProperty(target)
      for (const [, target] of RING_PROPERTIES) mirror.style.removeProperty(target)
      mirror.removeAttribute('data-grid-ring')
    }
  }, [hasGrid, grid, mirror])

  return { gridRef, mirrorRef, hasGrid }
}

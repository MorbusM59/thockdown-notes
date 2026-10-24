/**
 * Lines a copy of the editor's box-outline grid up with the real one, for
 * the visualizer's outline block (`.editor-beat-outline`, a sibling of
 * `.editor-beat-shade` in the editor shell).
 *
 * The real grid sits inside the edit pane, between the caret and the text,
 * and giving anything there its own compositor layer pulls the pane's text
 * into a squashed overlap layer (the trap `.thockdown-block-caret`'s note in
 * index.css describes). So the block draws a COPY at shell level, on a
 * layer of its own outside the pane, and this keeps the copy's box, tile size
 * and phase equal to the real grid's: re-read when either box resizes or the
 * grid's inline style (its half-cell phase) changes, never per frame.
 */

import { useEffect, useState } from 'react'

export function useBeatGridMirror(): {
  gridRef: (el: HTMLDivElement | null) => void
  mirrorRef: (el: HTMLDivElement | null) => void
} {
  const [grid, gridRef] = useState<HTMLDivElement | null>(null)
  const [mirror, mirrorRef] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!grid || !mirror) return
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
    }
  }, [grid, mirror])

  return { gridRef, mirrorRef }
}

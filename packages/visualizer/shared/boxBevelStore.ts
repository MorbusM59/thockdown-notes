/**
 * The live box bevel (`@thockdown/look/boxBevel`), for the layers
 * that draw the box outline: the editor's grid and the visualizer's. App
 * publishes the layout's setting here; each grid builds its two images from it
 * and its own cell size, so the setting reaches them without being passed
 * down through every component between. Changes only when a slider is moved.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { DEFAULT_BOX_BEVEL, boxBevelImages, type BoxBevelImages, type BoxBevelSettings } from '@thockdown/look/boxBevel'

let current: BoxBevelSettings = DEFAULT_BOX_BEVEL
const listeners = new Set<() => void>()

export function publishBoxBevel(settings: BoxBevelSettings): void {
  if (settings === current) return
  current = settings
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getCurrent = () => current

/**
 * An SVG image (`url("data:image/svg+xml,...")`) rasterized ONCE at one
 * pixel per CSS pixel, as a PNG `url(...)`. Shown with `image-rendering:
 * pixelated` (index.css), so under double size (a 2x page zoom) every
 * pixel of it is a 2x2 block like the rest of the box grid, rather than the
 * vector being redrawn at the zoomed resolution. Memoized by source.
 */
const rasterized = new Map<string, Promise<string>>()
function rasterize(svgUrl: string, width: number, height: number): Promise<string> {
  if (svgUrl === 'none') return Promise.resolve('none')
  const key = `${width}x${height}${svgUrl}`
  let pending = rasterized.get(key)
  if (!pending) {
    pending = new Promise<string>((resolve) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')?.drawImage(image, 0, 0, width, height)
        resolve(`url("${canvas.toDataURL('image/png')}")`)
      }
      // A source that will not load stays a vector rather than vanishing.
      image.onerror = () => resolve(svgUrl)
      image.src = svgUrl.slice(5, -2)
    })
    // The map holds the live images only: a slider sweep must not keep
    // every intermediate one.
    if (rasterized.size > 16) rasterized.clear()
    rasterized.set(key, pending)
  }
  return pending
}

/**
 * The bevel's images (the outline tile and the shading) for a cell of this
 * size, under the live setting, as bitmaps at one pixel per CSS pixel. Until
 * a new bitmap is ready the previous one stays up (the vector, on the very
 * first frame), so a moving slider never blanks the grid.
 */
export function useBoxBevelImages(width: number, height: number): BoxBevelImages {
  const settings = useSyncExternalStore(subscribe, getCurrent)
  const vector = useMemo(() => boxBevelImages(width, height, settings), [width, height, settings])
  const [bitmap, setBitmap] = useState<BoxBevelImages>(vector)
  useEffect(() => {
    let live = true
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    void Promise.all([rasterize(vector.tile, w, h), rasterize(vector.shading, w, h)]).then(([tile, shading]) => {
      if (live) setBitmap({ tile, shading })
    })
    return () => { live = false }
  }, [vector, width, height])
  return bitmap
}

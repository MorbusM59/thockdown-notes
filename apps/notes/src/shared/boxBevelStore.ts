/**
 * The live box bevel (`@thockdown/look/boxBevel`), for the layers
 * that draw the box outline: the editor's grid and the visualizer's. App
 * publishes the layout's setting here; each grid builds its two images from it
 * and its own cell size, so the setting reaches them without being passed
 * down through every component between. Changes only when a slider is moved.
 */

import { useMemo, useSyncExternalStore } from 'react'
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

/** The bevel's images (the outline tile and the shading) for a cell of this size, under the live setting. */
export function useBoxBevelImages(width: number, height: number): BoxBevelImages {
  const settings = useSyncExternalStore(subscribe, getCurrent)
  return useMemo(() => boxBevelImages(width, height, settings), [width, height, settings])
}

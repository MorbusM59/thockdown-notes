/**
 * The live box bevel's shape (`@thockdown/look/boxBevel`), for the layers
 * that draw the box outline: the editor's grid and the visualizer's. App
 * publishes the layout's setting here; each grid builds its outline tile from
 * it and its own cell size, so the setting reaches them without being passed
 * down through every component between. Changes only when a slider is moved.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { DEFAULT_BOX_BEVEL, boxOutlineTile, type BoxBevelSettings } from '@thockdown/look/boxBevel'

let current: BoxBevelSettings = DEFAULT_BOX_BEVEL
const listeners = new Set<() => void>()

export function publishBoxBevel(settings: BoxBevelSettings): void {
  if (settings.shape === current.shape && settings.softness === current.softness) {
    current = settings
    return
  }
  current = settings
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getShape = () => current.shape
const getSoftness = () => current.softness

/** The outline tile (a CSS image) for a cell of this size, under the live bevel. */
export function useBoxOutlineTile(width: number, height: number): string {
  const shape = useSyncExternalStore(subscribe, getShape)
  const softness = useSyncExternalStore(subscribe, getSoftness)
  return useMemo(() => boxOutlineTile(width, height, shape, softness), [width, height, shape, softness])
}

import { useEffect, useMemo } from 'react'
import { onScreenBoxBevel, type BoxBevelSettings } from '@thockdown/look/boxBevel'
import { publishBoxBevel } from './boxBevelStore'

/**
 * What a layout tells the box grids and the visualizer beyond its CSS
 * variables, published the same way by every app that draws them (the
 * desktop's App.tsx, the phone's MobileSoundscapeApp.tsx):
 * - the BOX BEVEL, through boxBevelStore, from which each grid builds its
 *   outline tile and shading at its own cell size (and the beat pane's copy
 *   of the grid with it). It is published as DRAWN, its shading turned in an
 *   inverted (dark) layout so the slider reads the same way.
 * - the scene's INVERT (`--scene-invert` on <html>), for a layer that keeps
 *   its own polarity under the layout's filter (the visualizer's glass
 *   cover, which counter-inverts itself by it).
 */
export function usePublishLayoutScene(boxBevel: BoxBevelSettings, filterInvert: number): void {
  const onScreenBevel = useMemo(() => onScreenBoxBevel(boxBevel, filterInvert), [boxBevel, filterInvert])
  useEffect(() => { publishBoxBevel(onScreenBevel) }, [onScreenBevel])
  useEffect(() => {
    document.documentElement.style.setProperty('--scene-invert', String(filterInvert))
  }, [filterInvert])
}

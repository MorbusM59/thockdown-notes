/**
 * The glaze the visualizer mode sways (parallaxSway.ts says how it moves):
 * the layout's linear stacks and radial sources at full count
 * (`visualizerGlazeSettings`), each stack on an element of its own at its
 * own depth, so they can shift against each other. The radial sources move
 * as one, behind the stacks, or in front of them when the layout puts
 * radial above linear. Gloom and sheen stay with the ordinary glaze and do
 * not move.
 *
 * Each element reaches past the window by the sway's overscan, so its
 * travel never shows an edge, and carries the blend mode its kind has in
 * the ordinary glaze (`.glaze-overlay-layer-*`, look.css). The elements are
 * moved by `parallaxSway.ts`'s `applySway`, which the scene's loop calls.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { visualizerGlazeSettings, type GlazeSettings } from '@thockdown/look/glaze'
import { buildLinearGlazeLayers, buildRadialGlazeLayers } from '@thockdown/look/loadoutTheme'
import { registerSwayLayer, swayAmplitudePx, swayOverscanPx } from './parallaxSway'

/** Depth of the nearest and the farthest layer; the rest are spaced evenly between. */
const NEAREST = 1
const FARTHEST = 0.25

type Layer = { key: string; kind: 'linear' | 'radial'; image: string; depth: number; index: number }

function useWindowOverscanPx(): number {
  const [overscan, setOverscan] = useState(() => swayOverscanPx(swayAmplitudePx(window.innerWidth, window.innerHeight)))
  useEffect(() => {
    const onResize = () => setOverscan(swayOverscanPx(swayAmplitudePx(window.innerWidth, window.innerHeight)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return overscan
}

function SwayLayer({ layer, overscan }: { layer: Layer; overscan: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return registerSwayLayer(element, layer.index, layer.depth)
  }, [layer.index, layer.depth])
  return (
    <div
      ref={ref}
      className={`glaze-overlay-layer glaze-overlay-layer-${layer.kind} visualizer-glaze-layer`}
      style={{ backgroundImage: layer.image, inset: -overscan } as CSSProperties}
    />
  )
}

export function VisualizerGlaze({ glaze }: { glaze: GlazeSettings }) {
  const overscan = useWindowOverscanPx()
  const layers = useMemo<Layer[]>(() => {
    const settings = visualizerGlazeSettings(glaze)
    // Nearest first: the top linear stack (each list is in stacking order,
    // the first drawn on top), unless radial sits above linear.
    const linear = buildLinearGlazeLayers(settings).map((image) => ({ kind: 'linear' as const, image }))
    const radialImages = buildRadialGlazeLayers(settings)
    const radial = radialImages.length > 0 ? [{ kind: 'radial' as const, image: radialImages.join(', ') }] : []
    const nearestFirst = glaze.radialAboveLinear ? [...radial, ...linear] : [...linear, ...radial]
    const step = nearestFirst.length > 1 ? (NEAREST - FARTHEST) / (nearestFirst.length - 1) : 0
    return nearestFirst.map((layer, index) => ({ ...layer, key: `${layer.kind}-${index}`, index, depth: NEAREST - step * index }))
  }, [glaze])

  // Drawn farthest first, so the nearest is on top within its kind (the
  // kinds' own order is the stack's z-index rule, as in the ordinary glaze).
  return (
    <div className={`glaze-overlay-stack visualizer-glaze${glaze.radialAboveLinear ? ' radial-above-linear' : ''}`} aria-hidden="true">
      {[...layers].reverse().map((layer) => <SwayLayer key={layer.key} layer={layer} overscan={overscan} />)}
    </div>
  )
}

/**
 * The glaze the visualizer mode sways (parallaxSway.ts says how it moves):
 * the layout's linear stacks and radial sources at full count
 * (`visualizerGlazeSettings`), at the strength set under Options > Visualizer
 * > Immersive, each stack on an element of its own at its own depth, so they
 * can shift against each other. The glaze spread there gives each linear
 * stack its share of that strength by its place among the stacks
 * (`glazeLayerShare`), as the element's opacity, so a change of spread
 * re-draws no gradient; the sway range and its spread set how far each layer
 * travels (`swayDepth`). The radial sources move
 * as one, behind the stacks, or in front of them when the layout puts
 * radial above linear. Gloom and sheen stay with the ordinary glaze and do
 * not move.
 *
 * Each element reaches past the window by the sway's overscan, so its
 * travel never shows an edge, and carries the blend mode its kind has in
 * the ordinary glaze (`.glaze-overlay-layer-*`, look.css). The elements are
 * moved by `parallaxSway.ts`'s `applySway`, which the scene's loop calls.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { visualizerGlazeSettings, type GlazeSettings } from '@thockdown/look/glaze'
import { glazeLayerShare, type VisualizerImmersive } from '@thockdown/look/visualizer'
import { buildLinearGlazeLayers, buildRadialGlazeLayers } from '@thockdown/look/loadoutTheme'
import { BREATH_AMPLITUDE_MAX, registerSwayLayer, setSwayRange, swayDepth, swayOverscanPx } from './parallaxSway'

/**
 * `index` counts from the nearest layer; `linearPosition` places a linear
 * stack among the linear stacks alone (0 the farthest, 1 the nearest), and is
 * null for the radial sources, which the glaze spread does not touch: they
 * blend by colour-dodge and the stacks by luminosity, so sharing strength
 * between the two kinds would turn the picture brighter or darker rather
 * than deeper.
 */
type Layer = { key: string; kind: 'linear' | 'radial'; image: string; depth: number; index: number; linearPosition: number | null }

function SwayLayer({ layer, overscan, opacity }: { layer: Layer; overscan: number; opacity: number }) {
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
      style={{ backgroundImage: layer.image, inset: -overscan, opacity } as CSSProperties}
    />
  )
}

export function VisualizerGlaze({ glaze, immersive }: { glaze: GlazeSettings; immersive: VisualizerImmersive }) {
  // The widest the music ever carries the nearest layer, which no layer exceeds.
  const overscan = swayOverscanPx(immersive.swayRangePx * BREATH_AMPLITUDE_MAX)
  useEffect(() => setSwayRange(immersive.swayRangePx), [immersive.swayRangePx])
  const layers = useMemo<Layer[]>(() => {
    const settings = visualizerGlazeSettings(glaze, immersive.glazeStrength)
    // Nearest first: the top linear stack (each list is in stacking order,
    // the first drawn on top), unless radial sits above linear.
    const linear = buildLinearGlazeLayers(settings).map((image) => ({ kind: 'linear' as const, image }))
    const radialImages = buildRadialGlazeLayers(settings)
    const radial = radialImages.length > 0 ? [{ kind: 'radial' as const, image: radialImages.join(', ') }] : []
    const nearestFirst = glaze.radialAboveLinear ? [...radial, ...linear] : [...linear, ...radial]
    let linearIndex = 0
    return nearestFirst.map((layer, index) => {
      // A lone stack is the nearest, so it keeps its share at either end of the spread.
      const linearPosition = layer.kind === 'linear' ? (linear.length > 1 ? 1 - linearIndex++ / (linear.length - 1) : 1) : null
      return { ...layer, key: `${layer.kind}-${index}`, index, depth: swayDepth(index, immersive.swaySpread), linearPosition }
    })
  }, [glaze, immersive.glazeStrength, immersive.swaySpread])

  // Drawn farthest first, so the nearest is on top within its kind (the
  // kinds' own order is the stack's z-index rule, as in the ordinary glaze).
  return (
    <div className={`glaze-overlay-stack visualizer-glaze${glaze.radialAboveLinear ? ' radial-above-linear' : ''}`} aria-hidden="true">
      {[...layers].reverse().map((layer) => (
        <SwayLayer
          key={layer.key}
          layer={layer}
          overscan={overscan}
          opacity={layer.linearPosition === null ? 1 : glazeLayerShare(layer.linearPosition, immersive.glazeSpread)}
        />
      ))}
    </div>
  )
}

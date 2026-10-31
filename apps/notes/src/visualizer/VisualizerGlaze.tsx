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
 * The radial sources' element reaches past the window by the sway's
 * overscan, so its travel never shows an edge; each linear stack is endless
 * (see `SwayLayer` and `parallaxSway.ts`). Each and carries the blend mode its kind has in
 * the ordinary glaze (`.glaze-overlay-layer-*`, look.css). The elements are
 * moved by `parallaxSway.ts`'s `applySway`, which the scene's loop calls.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { visualizerGlazeSettings, type GlazeSettings } from '@thockdown/look/glaze'
import { glazeLayerShare, type VisualizerImmersive } from '@thockdown/look/visualizer'
import { buildLinearGlazeStacks, buildRadialGlazeLayers } from '@thockdown/look/loadoutTheme'
import { BREATH_AMPLITUDE_MAX, registerSwayLayer, setSwayMotion, setSwayRange, swayDepth, swayOverscanPx } from './parallaxSway'

/**
 * `index` counts from the nearest layer; `linearPosition` places a linear
 * stack among the linear stacks alone (0 the farthest, 1 the nearest), and is
 * null for the radial sources, which the glaze spread does not touch: they
 * blend by colour-dodge and the stacks by luminosity, so sharing strength
 * between the two kinds would turn the picture brighter or darker rather
 * than deeper.
 */
type Layer = { key: string; kind: 'linear' | 'radial'; image: string; periodPx: number; depth: number; index: number; linearPosition: number | null }

/**
 * The angle the ordinary glaze draws its linear stacks at. Here each stack's
 * gradient is drawn along its element's own x axis (90deg) and the element is
 * turned to this angle, so moving it along the gradient is one translateX
 * (`parallaxSway.ts`).
 */
const LINEAR_ANGLE_DEG = 45
/** At least the screen's diagonal, the side a turned layer needs to cover the screen at any angle. */
const DIAGONAL = 'calc(100vmax * 1.415)'

function SwayLayer({ layer, overscan, opacity }: { layer: Layer; overscan: number; opacity: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return registerSwayLayer(element, layer.index, layer.depth, layer.kind === 'linear' ? { periodPx: layer.periodPx, angleDeg: LINEAR_ANGLE_DEG } : null)
  }, [layer.index, layer.depth, layer.kind, layer.periodPx])
  // A radial layer reaches past the screen by the sway's overscan. A linear
  // stack is a band as tall as the screen's diagonal and longer than it by
  // one period (half each end, what wrapping its position needs), centred
  // and turned to the stacks' angle; its sway across the stripes is
  // invisible, so it needs no overscan that way.
  const style: CSSProperties = layer.kind === 'radial'
    ? { backgroundImage: layer.image, inset: -overscan, opacity }
    : {
      backgroundImage: layer.image,
      opacity,
      inset: 'auto',
      left: '50%',
      top: '50%',
      width: `calc(${DIAGONAL} + ${layer.periodPx}px)`,
      height: DIAGONAL,
      translate: '-50% -50%',
      rotate: `${LINEAR_ANGLE_DEG - 90}deg`,
    }
  return (
    <div
      ref={ref}
      className={`glaze-overlay-layer glaze-overlay-layer-${layer.kind} visualizer-glaze-layer`}
      style={style}
    />
  )
}

export function VisualizerGlaze({ glaze, immersive }: { glaze: GlazeSettings; immersive: VisualizerImmersive }) {
  // The widest the music ever carries the nearest layer, which no layer exceeds.
  const overscan = swayOverscanPx(immersive.swayRangePx * BREATH_AMPLITUDE_MAX)
  useEffect(() => setSwayRange(immersive.swayRangePx), [immersive.swayRangePx])
  useEffect(() => setSwayMotion(immersive.swayPush, immersive.swayReturn, immersive.swayDrift), [immersive.swayPush, immersive.swayReturn, immersive.swayDrift])
  const layers = useMemo<Layer[]>(() => {
    const settings = visualizerGlazeSettings(glaze, immersive.glazeStrength)
    // Nearest first: the top linear stack (each list is in stacking order,
    // the first drawn on top), unless radial sits above linear.
    const linear = buildLinearGlazeStacks(settings, 90).map(({ image, periodPx }) => ({ kind: 'linear' as const, image, periodPx }))
    const radialImages = buildRadialGlazeLayers(settings)
    const radial = radialImages.length > 0 ? [{ kind: 'radial' as const, image: radialImages.join(', '), periodPx: 0 }] : []
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

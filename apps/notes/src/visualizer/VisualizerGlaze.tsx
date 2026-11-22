/**
 * The glaze the visualizer mode sways (parallaxSway.ts says how it moves):
 * the layout's linear stacks and radial sources at full count
 * (`visualizerGlazeSettings`), at the strength set under Options > Visualizer
 * > Immersive, each stack on an element of its own at its own depth, so they
 * can shift against each other (the layout's glare spread is already in each
 * stack's stripes, `buildLinearGlazeStacks`); the sway range and its spread
 * set how far each layer travels (`swayDepth`). The radial sources move
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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { glazeRayAngle, visualizerGlazeSettings, type GlazeSettings } from '@thockdown/look/glaze'
import { arcminToPx, type VisualizerImmersive } from '@thockdown/look/visualizer'
import { buildLinearGlazeStacks, buildRadialGlazeLayers, type GlazeStripe } from '@thockdown/look/loadoutTheme'
import { CANVAS_BLEND_MODE, GlazeStripesCanvas } from './GlazeStripesCanvas'
import { subscribeMusicTempo } from '../sound/musicBeat'
import { beatAlignedStart } from '../sound/musicTempo'
import { canUseShaderGlaze } from './glazeShaderSupport'
import { BREATH_AMPLITUDE_MAX, registerSwayLayer, advancePoleOrbit, advanceSway, restartPoleOrbit, setPoleOrbit, setSwayMotion, setSwayRange, swayDepth, swayOverscanPx } from './parallaxSway'

/** `index` counts from the nearest layer. */
type Layer = { key: string; kind: 'linear' | 'radial'; image: string; periodPx: number; stripes: GlazeStripe[]; depth: number; index: number }

/**
 * The side a band turned to `angleDeg` needs to cover a w x h screen, both
 * along and across its stripes: at most w x m + h x m with m the larger of
 * |cos| and |sin|, which at 45deg is the screen's extent projected onto a
 * 45deg axis, (w + h) / sqrt(2), plus a pixel each side for rounding. Not 1.415 x vmax,
 * which this was: that is the diagonal of a SQUARE screen and oversized a
 * 16:9 band by 28% each way. Each stack is promoted (it moves by transform
 * alone) and rasterized whole, five of them at full count, so the band's area
 * is the visualizer's largest tile-memory cost and exceeding the
 * compositor's budget left tiles undrawn.
 */
function bandSide(angleDeg: number): string {
  const radians = (angleDeg * Math.PI) / 180
  const m = Math.max(Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians)))
  return `calc((100vw + 100vh) * ${m.toFixed(5)} + 2px)`
}

/**
 * A CSS stack (the fallback where WebGL2 is unavailable): its gradient drawn
 * along its element's own x axis (90deg) and the element turned to
 * `angleDeg`, the glaze's heading, so moving it along the gradient is one
 * translateX (`parallaxSway.ts`). It cannot converge, so it stays parallel.
 */
function SwayLayer({ layer, overscan, angleDeg }: { layer: Layer; overscan: number; angleDeg: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return registerSwayLayer(element, layer.index, layer.depth, layer.kind === 'linear' ? { periodPx: layer.periodPx, angleDeg } : null)
  }, [layer.index, layer.depth, layer.kind, layer.periodPx, angleDeg])
  const side = bandSide(angleDeg)
  // A radial layer reaches past the screen by the sway's overscan. A linear
  // stack is a band as tall as `side` and longer than it by
  // one period (half each end, what wrapping its position needs), centred
  // and turned to the stacks' angle; its sway across the stripes is
  // invisible, so it needs no overscan that way.
  const style: CSSProperties = layer.kind === 'radial'
    ? { backgroundImage: layer.image, inset: -overscan }
    : {
      backgroundImage: layer.image,
      inset: 'auto',
      left: '50%',
      top: '50%',
      width: `calc(${side} + ${layer.periodPx}px)`,
      height: side,
      translate: '-50% -50%',
      rotate: `${angleDeg - 90}deg`,
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
  // The motion is set in arc minutes and drawn as the centre's travel in px,
  // which depends on the screen's size (`arcminToPx`).
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const toPx = (arcmin: number) => arcminToPx(arcmin, screen.w, screen.h)
  const rangePx = toPx(immersive.swayRange)
  const overscan = swayOverscanPx(rangePx * BREATH_AMPLITUDE_MAX)
  useEffect(() => setSwayRange(rangePx), [rangePx])
  useEffect(() => setPoleOrbit(immersive.poleOrbit, 1 / immersive.poleOrbitCycle), [immersive.poleOrbit, immersive.poleOrbitCycle])
  // The orbit moves at the app's one tempo (`musicTempo.ts`).
  const orbiting = immersive.poleOrbit > 0
  useEffect(() => {
    if (!orbiting) return
    // The first frame takes the count's share of a beat, so the orbit's laps start on beats (`beatAlignedStart`).
    let aligned = false
    return subscribeMusicTempo((passed, _rate, count) => {
      if (!aligned) restartPoleOrbit()
      advancePoleOrbit(aligned ? passed : beatAlignedStart(count))
      aligned = true
    })
  }, [orbiting])
  const pushPx = toPx(immersive.swayPush)
  const driftPx = toPx(immersive.swayDrift)
  useEffect(() => setSwayMotion(pushPx, immersive.swayReturn, driftPx, 1 / immersive.swayCycle), [pushPx, immersive.swayReturn, driftPx, immersive.swayCycle])
  // The sway and the drift run on the app's one tempo too (`advanceSway`).
  useEffect(() => subscribeMusicTempo((beats) => advanceSway(beats)), [])
  const { glareStrength, flairStrength, glareMinStacks, flairMinSources } = immersive
  const layers = useMemo<Layer[]>(() => {
    // The shader draws the fan (glaze.ray*) itself; the CSS fallback slides
    // straight stacks along the heading and stays parallel.
    const settings = visualizerGlazeSettings(glaze, { glareStrength, flairStrength, glareMinStacks, flairMinSources })
    // Nearest first: the top linear stack (each list is in stacking order,
    // the first drawn on top); the glare is always above the flair.
    const linear = buildLinearGlazeStacks(settings, 90).map(({ image, periodPx, stripes }) => ({ kind: 'linear' as const, image, periodPx, stripes }))
    const radialImages = buildRadialGlazeLayers(settings)
    const radial = radialImages.length > 0 ? [{ kind: 'radial' as const, image: radialImages.join(', '), periodPx: 0, stripes: [] }] : []
    const nearestFirst = [...linear, ...radial]
    return nearestFirst.map((layer, index) => ({ ...layer, key: `${layer.kind}-${index}`, index, depth: swayDepth(index, immersive.swaySpread) }))
  }, [glaze, glareStrength, flairStrength, glareMinStacks, flairMinSources, immersive.swaySpread])

  // The linear stacks on the shader (GlazeStripesCanvas.tsx) where it can
  // run: one canvas instead of a promoted layer per stack, and composited
  // among themselves before one blend onto the scene, exactly as the still
  // glaze's single multi-image element already is.
  const shader = useMemo(() => canUseShaderGlaze(), [])
  const shaderStacks = useMemo(() => {
    if (!shader) return null
    const linear = layers.filter((layer) => layer.kind === 'linear')
    return {
      stacks: linear.map((layer) => ({ stripes: layer.stripes, periodPx: layer.periodPx })),
      sway: linear.map((layer) => ({ index: layer.index, depth: layer.depth })),
    }
  }, [shader, layers])

  // Drawn farthest first, so the nearest is on top within its kind (the
  // kinds' own order is the stack's z-index rule, as in the ordinary glaze).
  // The glare (the shader's linear stacks) is drawn ABOVE the grid wave and
  // the pulse (z-index 6001, visualizer.css), the rest of the glaze below
  // them. Its own fixed layer carries the blend, so it blends with the whole
  // scene beneath it, wave and pulse included; a blend on the canvas alone
  // would only meet this layer's own (empty) backdrop.
  return (
    <>
      <div className="glaze-overlay-stack visualizer-glaze" aria-hidden="true">
        {[...layers].reverse().filter((layer) => !(shaderStacks && layer.kind === 'linear')).map((layer) => (
          <SwayLayer
            key={layer.key}
            layer={layer}
            overscan={overscan}
            angleDeg={glazeRayAngle(glaze) - 90}
          />
        ))}
      </div>
      {shaderStacks && shaderStacks.stacks.length > 0 ? (
        <div className="visualizer-glare-over" style={{ mixBlendMode: CANVAS_BLEND_MODE as CSSProperties['mixBlendMode'] }} aria-hidden="true">
          <GlazeStripesCanvas
            stacks={shaderStacks.stacks}
            sway={shaderStacks.sway}
            glaze={glaze}
          />
        </div>
      ) : null}
    </>
  )
}

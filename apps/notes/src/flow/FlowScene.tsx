/**
 * The filter wrapper around the whole scene (`.app-saturate-wrapper`), drawn
 * with the typing flow's look blended in. It is its own component so that the
 * flow can redraw the scene's filter and glaze without re-rendering App: the
 * scene arrives as `children`, an element App created, so a render here that
 * App did not cause re-renders nothing below it.
 *
 * The look is `themeFrame` of the blended loadout -- the same derivation as
 * the reader's own look, never a second filter stacked on it -- so the scene
 * is still filtered exactly once. The glaze's images are CSS variables App
 * puts on the root; while flowing they are redefined on this element, which
 * every glaze layer is inside. Image correction stays the reader's own: an
 * image is corrected for their look and sees the flow's change, like
 * everything else on screen.
 *
 * The level is taken in steps of `1 / LOOK_STEPS`, which is finer than a
 * filter change can be seen and coarse enough that a ramp is a few dozen
 * renders of this one element rather than one per frame.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { themeFrame, type ThemeFrame, type ThemeLoadout, type ThemeOptions } from '@thockdown/look/loadoutTheme'
import { blendThemeLoadout, flowLookTarget } from '@thockdown/look/loadoutBlend'
import { ThemeGlazeLayers } from '@thockdown/look/ThemeLayers'
import { flowMeter } from './flowMeter'

const LOOK_STEPS = 64

interface FlowSceneProps {
  loadout: ThemeLoadout
  options: ThemeOptions
  /** `themeFrame(loadout, options)`, which App has already computed for everything else. */
  baseFrame: ThemeFrame
  /** The look channel's strength, 0..1; 0 when flow is off. */
  lookStrength: number
  radialAboveLinear: boolean
  children: ReactNode
}

export function FlowScene({ loadout, options, baseFrame, lookStrength, radialAboveLinear, children }: FlowSceneProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (lookStrength <= 0) {
      setStep(0)
      return
    }
    return flowMeter.subscribe((level) => setStep(Math.round(level * LOOK_STEPS)))
  }, [lookStrength])

  const frame = useMemo(() => {
    if (step === 0 || lookStrength <= 0) return baseFrame
    return themeFrame(blendThemeLoadout(loadout, flowLookTarget(loadout, lookStrength), step / LOOK_STEPS), options)
  }, [step, lookStrength, loadout, options, baseFrame])

  const style = useMemo(() => {
    const next: Record<string, string | number | undefined> = { ...frame.wrapperStyle, position: 'fixed', inset: 0 }
    if (frame !== baseFrame) {
      next['--glaze-linear-background-image'] = frame.glaze.linear
      next['--glaze-radial-background-image'] = frame.glaze.radial
      next['--glaze-gloom-background-image'] = frame.glaze.gloom
      next['--glaze-sheen-background-image'] = frame.glaze.sheen
    }
    return next
  }, [frame, baseFrame])

  return (
    <div className="app-saturate-wrapper" style={style}>
      <ThemeGlazeLayers glaze={frame.glaze} radialAboveLinear={radialAboveLinear} />
      {children}
    </div>
  )
}

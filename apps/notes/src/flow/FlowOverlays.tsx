/**
 * The typing flow's look: three full-window layers above the whole scene, each
 * blended into it with a CSS blend mode, whose OPACITY follows the flow meter.
 *
 *   - saturation: a fully saturated colour with `mix-blend-mode: saturation`
 *     moves every colour towards full saturation by the layer's opacity, and
 *     leaves greys nearly grey (a grey has no hue to saturate);
 *   - warmth: a warm colour with `soft-light`, a gentle tint;
 *   - glow: white with `screen`, a slight lift of the light.
 *
 * WHY LAYERS AND NOT THE SCENE'S FILTER. Changing the `filter` on
 * `.app-saturate-wrapper` makes the browser filter the whole scene again, so a
 * filter that followed the meter repainted the window on every step while the
 * reader was typing. A layer that changes only its opacity, on its own
 * compositor layer (`will-change: opacity`), is blended by the GPU when the
 * frame is put together: the scene under it is neither repainted nor
 * re-filtered. That is also why the layers sit AFTER the filter wrapper rather
 * than inside it: inside, every opacity change would be part of what the
 * wrapper's filter has to process again.
 *
 * Contrast and blur cannot be done this way (they need the picture under them
 * as input), so the flow look does not touch them.
 *
 * The opacity is written straight onto the elements from the meter, with no
 * React render; `strength` (the look slider, 0 when flow or visual effects are
 * off) is the only prop, and at 0 nothing is mounted at all.
 */

import { useEffect, useRef } from 'react'
import { flowMeter } from './flowMeter'

/** Each layer's opacity at a full meter and a full look slider. */
const SATURATION_MAX_OPACITY = 0.3
const WARMTH_MAX_OPACITY = 0.2
const GLOW_MAX_OPACITY = 0.05

export function FlowOverlays({ strength }: { strength: number }) {
  const saturationRef = useRef<HTMLDivElement>(null)
  const warmthRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (strength <= 0) return
    return flowMeter.subscribe((level) => {
      const amount = level * strength
      if (saturationRef.current) saturationRef.current.style.opacity = (amount * SATURATION_MAX_OPACITY).toFixed(4)
      if (warmthRef.current) warmthRef.current.style.opacity = (amount * WARMTH_MAX_OPACITY).toFixed(4)
      if (glowRef.current) glowRef.current.style.opacity = (amount * GLOW_MAX_OPACITY).toFixed(4)
    })
  }, [strength])

  if (strength <= 0) return null
  return (
    <>
      <div ref={saturationRef} className="flow-overlay flow-overlay-saturation" aria-hidden="true" />
      <div ref={warmthRef} className="flow-overlay flow-overlay-warmth" aria-hidden="true" />
      <div ref={glowRef} className="flow-overlay flow-overlay-glow" aria-hidden="true" />
    </>
  )
}

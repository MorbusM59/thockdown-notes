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
 * FULL FLOW (flowMeter's state, entered when the meter reaches full) has a
 * fifth layer of its own, the EDGE GLOW: a warm radial gradient, clear over
 * the middle of the window and coloured only toward its edges, blended with
 * `screen`. It is the one layer that is on only at full rather than
 * proportionally, which is what makes arriving read as a change of state
 * rather than as the other layers going one step further. On the kick
 * (the state's start, re-armed only below half flow) it blooms in and the
 * frame visibly opens: opacity rises to `EDGE_ARRIVAL_PEAK` while the layer
 * scales from `EDGE_ARRIVAL_SCALE` to 1, then settles to `EDGE_SUSTAIN`. While
 * the state lasts it breathes by `EDGE_BREATH` on a `EDGE_BREATH_PERIOD_MS`
 * cycle; when it ends it fades out over `EDGE_EXIT_MS`. Opacity and transform
 * only, so the compositor does all of it. Peripheral by construction: the
 * middle of the window, where the text is, is not tinted at all.
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
const EDGE_ARRIVAL_PEAK = 0.5
const EDGE_ARRIVAL_SCALE = 1.06
const EDGE_ARRIVAL_RISE_MS = 250
const EDGE_ARRIVAL_SETTLE_MS = 1500
const EDGE_SUSTAIN = 0.25
const EDGE_BREATH = 0.06
const EDGE_BREATH_PERIOD_MS = 6000
const EDGE_EXIT_MS = 1000

export function FlowOverlays({ strength }: { strength: number }) {
  const saturationRef = useRef<HTMLDivElement>(null)
  const warmthRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const edgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (strength <= 0) return
    return flowMeter.subscribe((level) => {
      const amount = level * strength
      if (saturationRef.current) saturationRef.current.style.opacity = (amount * SATURATION_MAX_OPACITY).toFixed(4)
      if (warmthRef.current) warmthRef.current.style.opacity = (amount * WARMTH_MAX_OPACITY).toFixed(4)
      if (glowRef.current) glowRef.current.style.opacity = (amount * GLOW_MAX_OPACITY).toFixed(4)
    })
  }, [strength])

  useEffect(() => {
    if (strength <= 0) return
    const edge = edgeRef.current
    if (!edge) return
    let breath: Animation | null = null
    const stopAll = () => {
      for (const animation of edge.getAnimations()) animation.cancel()
      breath = null
    }
    // The breathing loop around the sustained level; started once the
    // arrival (if any) has settled, so the two never fight over opacity.
    const breathe = () => {
      breath = edge.animate(
        { opacity: [EDGE_SUSTAIN * strength, (EDGE_SUSTAIN + EDGE_BREATH) * strength, EDGE_SUSTAIN * strength] },
        { duration: EDGE_BREATH_PERIOD_MS, iterations: Infinity, easing: 'ease-in-out' },
      )
    }
    const unsubscribeKick = flowMeter.subscribeKick(() => {
      stopAll()
      const total = EDGE_ARRIVAL_RISE_MS + EDGE_ARRIVAL_SETTLE_MS
      const arrival = edge.animate(
        [
          { opacity: 0, transform: `scale(${EDGE_ARRIVAL_SCALE})`, easing: 'ease-out' },
          { opacity: EDGE_ARRIVAL_PEAK * strength, offset: EDGE_ARRIVAL_RISE_MS / total, easing: 'ease-in-out' },
          { opacity: EDGE_SUSTAIN * strength, transform: 'scale(1)' },
        ],
        { duration: total, fill: 'forwards' },
      )
      arrival.onfinish = () => {
        if (arrival.playState === 'finished' && edge.getAnimations().length === 1) breathe()
      }
    })
    const unsubscribeFull = flowMeter.subscribeFull((full) => {
      if (full) {
        // Entered without a kick (re-entered inside the kick's interval, or
        // already in it when this subscribed): the state shows quietly, from
        // wherever an exit fade had got to, with no arrival. A kick that
        // follows cancels this and plays the arrival instead.
        const from = Number(getComputedStyle(edge).opacity) || 0
        stopAll()
        const fadeIn = edge.animate({ opacity: [from, EDGE_SUSTAIN * strength] }, { duration: EDGE_EXIT_MS, fill: 'forwards' })
        fadeIn.onfinish = () => { if (edge.getAnimations().length === 1) breathe() }
        return
      }
      const from = Number(getComputedStyle(edge).opacity) || 0
      stopAll()
      edge.animate({ opacity: [from, 0] }, { duration: EDGE_EXIT_MS, easing: 'ease-in-out' })
    })
    return () => {
      unsubscribeKick()
      unsubscribeFull()
      stopAll()
      void breath
    }
  }, [strength])

  if (strength <= 0) return null
  return (
    <>
      <div ref={saturationRef} className="flow-overlay flow-overlay-saturation" aria-hidden="true" />
      <div ref={warmthRef} className="flow-overlay flow-overlay-warmth" aria-hidden="true" />
      <div ref={glowRef} className="flow-overlay flow-overlay-glow" aria-hidden="true" />
      <div ref={edgeRef} className="flow-overlay flow-overlay-edge" aria-hidden="true" />
    </>
  )
}

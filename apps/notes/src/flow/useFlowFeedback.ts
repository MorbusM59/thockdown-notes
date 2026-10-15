/**
 * Hands the reader's flow settings to the meter, and the meter's level to the
 * two channels that need no React: the caret's glow and effect strength, and
 * the reverb send (and its swell on the kick). The look is the third channel and lives in `FlowOverlays`,
 * because it has to go through the theme.
 */

import { useEffect } from 'react'
import type { FlowSettings } from '../shared/flowSettings'
import { flowMeter } from './flowMeter'
import { typingSoundManager } from '../sound/TypingSoundManager'

/**
 * At full flow and full strength the caret's own halo (Options > Caret) grows
 * by this much blur and spread, and its colour grows more
 * opaque (`--flow-caret-alpha`). The effect slider also blends to zero through
 * `--flow-caret-effect`, and the fill and outline fade out by the same amount
 * (`--flow-caret-fade`), so at full flow and full strength the caret is its
 * halo alone. `--flow-trail-head` is the trail's leading edge. The blink
 * keyframes consume these variables (`buildCaretBlinkKeyframesCss`), so the
 * flow draws nothing of its own: a halo of zero size still grows, and one
 * whose colour is transparent stays invisible.
 */
const HALO_GROW_BLUR_PX = 12
const HALO_GROW_SPREAD_PX = 2.5
/** The share of the way to opaque that the halo colour moves at full flow and full strength. */
const CARET_ALPHA_BOOST = 0.6

function setCaretFlow(grow: number): void {
  const root = document.documentElement
  if (grow <= 0) {
    root.style.removeProperty('--flow-halo-blur')
    root.style.removeProperty('--flow-halo-spread')
    root.style.removeProperty('--flow-caret-alpha')
    root.style.removeProperty('--flow-caret-effect')
    root.style.removeProperty('--flow-caret-fade')
    root.style.removeProperty('--flow-trail-head')
    return
  }
  root.style.setProperty('--flow-halo-blur', `${(grow * HALO_GROW_BLUR_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-halo-spread', `${(grow * HALO_GROW_SPREAD_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-caret-alpha', (grow * CARET_ALPHA_BOOST).toFixed(3))
  root.style.setProperty('--flow-caret-effect', grow.toFixed(3))
  root.style.setProperty('--flow-caret-fade', grow.toFixed(3))
  // The trail's leading edge (CM6Editor) glows at the live level, no decay.
  root.style.setProperty('--flow-trail-head', grow.toFixed(3))
}

export function useFlowFeedback(settings: FlowSettings): void {
  const { enabled, gainPercent, decayPercent, caret, reverb } = settings

  useEffect(() => {
    flowMeter.configure({ enabled, gainPercent, decayPercent })
  }, [enabled, gainPercent, decayPercent])

  useEffect(() => {
    flowMeter.configureTrail(caret)
  }, [caret])

  useEffect(() => {
    const unsubscribe = flowMeter.subscribe((level) => {
      setCaretFlow(level * caret)
      typingSoundManager.setFlowReverb(level * reverb)
    })
    const unsubscribeKick = flowMeter.subscribeKick(() => typingSoundManager.kickFlowReverb(reverb))
    return () => {
      unsubscribe()
      unsubscribeKick()
      setCaretFlow(0)
      typingSoundManager.setFlowReverb(0)
    }
  }, [caret, reverb])
}
